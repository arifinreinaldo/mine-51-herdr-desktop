// @vitest-environment jsdom
//
// Finding #11: the agent popover's `onClose` must fire for every close path
// (not just a row click, the prior code's only reset site) so a caller's
// "is it open" bookkeeping never gets stuck stale; highlight-card hover
// must be reported back via `onHighlightHoverChange`; and Up/Down must
// move focus between rows (Enter-per-row already existed).

import { describe, expect, it, vi } from "vitest";
import { closeActiveOverlay, openOverlay } from "../../../src/ui/overlay";
import {
  formatAgentRowLine2,
  groupAgentRows,
  openAgentPopover,
  refreshOpenAgentPopover,
  type AgentPopoverRow,
} from "../../../src/ui/statusbar";

let overlayRoot: HTMLDivElement;

function row(overrides: Partial<AgentPopoverRow> = {}): AgentPopoverRow {
  return {
    pane_id: "p1",
    workspace_id: "w1",
    tab_id: "t1",
    workspace_label: "ws",
    tab_label: "tab",
    agent_status: "working",
    agentName: "claude",
    title: null,
    colorHex: undefined,
    ...overrides,
  };
}

function setup() {
  overlayRoot = document.createElement("div");
  document.body.appendChild(overlayRoot);
}

describe("openAgentPopover (finding #11)", () => {
  it("onClose fires on Escape, not just a row click", () => {
    setup();
    const onClose = vi.fn();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onClose },
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    overlayRoot.remove();
  });

  it("onClose fires on an outside click", async () => {
    setup();
    const onClose = vi.fn();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onClose },
    );
    await new Promise((r) => setTimeout(r, 0)); // the outside-click listener attaches deferred
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    outside.remove();
    overlayRoot.remove();
  });

  it("reports hover on a highlight card, not on an ordinary row", () => {
    setup();
    const onHighlightHoverChange = vi.fn();
    const highlightTransition = { pane_id: "p1", workspace_id: "w1", tab_id: "t1", agent_status: "done" as const, state_change_seq: 2 };
    openAgentPopover(
      overlayRoot,
      [row({ pane_id: "p2" })],
      {
        sortMode: "priority",
        highlightCards: [{ transition: highlightTransition, firedAt: 0 }],
        highlightRowFor: (paneId) => (paneId === "p1" ? row({ pane_id: "p1", agent_status: "done" }) : undefined),
      },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onHighlightHoverChange },
    );
    const highlightRow = overlayRoot.querySelector<HTMLElement>(".agent-row.is-highlight")!;
    highlightRow.dispatchEvent(new MouseEvent("mouseenter"));
    expect(onHighlightHoverChange).toHaveBeenCalledWith("p1", true);
    highlightRow.dispatchEvent(new MouseEvent("mouseleave"));
    expect(onHighlightHoverChange).toHaveBeenCalledWith("p1", false);

    const ordinaryRow = overlayRoot.querySelector<HTMLElement>(".agent-row:not(.is-highlight)")!;
    onHighlightHoverChange.mockClear();
    ordinaryRow.dispatchEvent(new MouseEvent("mouseenter"));
    expect(onHighlightHoverChange).not.toHaveBeenCalled();
    overlayRoot.remove();
  });

  it("ArrowDown/ArrowUp move focus between rows", () => {
    setup();
    openAgentPopover(
      overlayRoot,
      [row({ pane_id: "p1" }), row({ pane_id: "p2" }), row({ pane_id: "p3" })],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    const rows = Array.from(overlayRoot.querySelectorAll<HTMLElement>(".agent-row"));
    rows[0].focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(rows[1]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(rows[2]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(rows[0]); // wraps
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(rows[2]); // wraps backward
    overlayRoot.remove();
  });
});

// UX pass 1 spec §2 "Agent list rows (popover), line 2".
describe("formatAgentRowLine2 (UX pass 1 spec §2)", () => {
  it("agent · status word, no age, no title", () => {
    expect(formatAgentRowLine2("claude", "idle", "", null)).toBe("claude · idle");
  });

  it("agent · status word + age, no title", () => {
    expect(formatAgentRowLine2("claude", "blocked", "12m", null)).toBe("claude · blocked 12m");
  });

  it("the literal spec example: agent · status word + age · title", () => {
    expect(formatAgentRowLine2("claude", "blocked", "12m", "Review migration plan")).toBe(
      "claude · blocked 12m · Review migration plan",
    );
  });

  it("an unknown age (empty ageLabel) omits the trailing age, never a dangling space", () => {
    expect(formatAgentRowLine2("claude", "blocked", "", "Review migration plan")).toBe(
      "claude · blocked · Review migration plan",
    );
  });
});

// UX pass 1 spec §3 "Blocked and done first": Needs You (blocked, oldest
// first), Done (newest first), Working, Idle.
describe("groupAgentRows (UX pass 1 spec §3)", () => {
  function ageMsFor(ages: Record<string, number | undefined>) {
    return (paneId: string) => ages[paneId];
  }

  it("buckets by status, unknown falling in with idle", () => {
    const rows = [
      row({ pane_id: "b1", agent_status: "blocked" }),
      row({ pane_id: "d1", agent_status: "done" }),
      row({ pane_id: "w1", agent_status: "working" }),
      row({ pane_id: "i1", agent_status: "idle" }),
      row({ pane_id: "u1", agent_status: "unknown" }),
    ];
    const grouped = groupAgentRows(rows, () => undefined);
    expect(grouped.needsYou.map((r) => r.pane_id)).toEqual(["b1"]);
    expect(grouped.done.map((r) => r.pane_id)).toEqual(["d1"]);
    expect(grouped.working.map((r) => r.pane_id)).toEqual(["w1"]);
    expect(grouped.idle.map((r) => r.pane_id)).toEqual(["i1", "u1"]);
  });

  it("Needs You sorts oldest (largest age) first", () => {
    const rows = [
      row({ pane_id: "b1", agent_status: "blocked" }),
      row({ pane_id: "b2", agent_status: "blocked" }),
      row({ pane_id: "b3", agent_status: "blocked" }),
    ];
    const grouped = groupAgentRows(rows, ageMsFor({ b1: 1000, b2: 5000, b3: 2000 }));
    expect(grouped.needsYou.map((r) => r.pane_id)).toEqual(["b2", "b3", "b1"]);
  });

  it("Done sorts newest (smallest age) first", () => {
    const rows = [
      row({ pane_id: "d1", agent_status: "done" }),
      row({ pane_id: "d2", agent_status: "done" }),
      row({ pane_id: "d3", agent_status: "done" }),
    ];
    const grouped = groupAgentRows(rows, ageMsFor({ d1: 5000, d2: 1000, d3: 2000 }));
    expect(grouped.done.map((r) => r.pane_id)).toEqual(["d2", "d3", "d1"]);
  });

  it("Working/Idle keep the caller's relative order", () => {
    const rows = [
      row({ pane_id: "w1", agent_status: "working" }),
      row({ pane_id: "w2", agent_status: "working" }),
    ];
    const grouped = groupAgentRows(rows, () => undefined);
    expect(grouped.working.map((r) => r.pane_id)).toEqual(["w1", "w2"]);
  });
});

describe("openAgentPopover: grouped sections (UX pass 1 spec §3)", () => {
  it("renders a group header with a count above each non-empty group, in Needs You/Done/Working/Idle order", () => {
    setup();
    openAgentPopover(
      overlayRoot,
      [
        row({ pane_id: "w1", agent_status: "working" }),
        row({ pane_id: "b1", agent_status: "blocked" }),
      ],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    const headers = Array.from(overlayRoot.querySelectorAll(".agent-popover__group-header")).map((h) => h.textContent);
    expect(headers).toEqual(["Needs you (1)", "Working (1)"]);
    overlayRoot.remove();
  });

  it("renders no group headers with zero rows", () => {
    setup();
    openAgentPopover(
      overlayRoot,
      [],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    expect(overlayRoot.querySelectorAll(".agent-popover__group-header")).toHaveLength(0);
    overlayRoot.remove();
  });
});

// UX pass 1 spec §3 "Pinnable agent list".
describe("openAgentPopover: pin behaviour (UX pass 1 spec §3)", () => {
  it("outside clicks are ignored while pinned", async () => {
    setup();
    const onClose = vi.fn();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined, pinned: true },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onClose },
    );
    await new Promise((r) => setTimeout(r, 0));
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    outside.remove();
    overlayRoot.remove();
  });

  it("outside clicks still close it when not pinned", async () => {
    setup();
    const onClose = vi.fn();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined, pinned: false },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onClose },
    );
    await new Promise((r) => setTimeout(r, 0));
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    outside.remove();
    overlayRoot.remove();
  });

  // Finding #3 (UX pass 1 §3): a pinned list must never swallow an Esc
  // typed *outside* it (e.g. in the terminal) -- only an Esc typed while
  // focus is actually inside the popover may close it.
  it("Escape closes it while pinned, when focus is inside the popover", () => {
    setup();
    const onClose = vi.fn();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined, pinned: true },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onClose },
    );
    overlayRoot.querySelector<HTMLElement>(".agent-row")!.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    overlayRoot.remove();
  });

  it("Escape does NOT close it while pinned, when focus is outside the popover", () => {
    setup();
    const onClose = vi.fn();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined, pinned: true },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onClose },
    );
    // Nothing inside the popover has focus (e.g. the terminal capture does).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(overlayRoot.querySelector(".agent-popover")).not.toBeNull();
    overlayRoot.remove();
  });

  it("Escape still closes it when NOT pinned, even with focus outside the popover", () => {
    setup();
    const onClose = vi.fn();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined, pinned: false },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onClose },
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    overlayRoot.remove();
  });

  // Finding #3: Arrow keys must only navigate rows when focus is already
  // inside the popover -- not when the popover just happens to be open
  // while focus is elsewhere.
  it("ArrowDown/ArrowUp do nothing when focus is outside the popover", () => {
    setup();
    openAgentPopover(
      overlayRoot,
      [row({ pane_id: "p1" }), row({ pane_id: "p2" })],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    const outsideFocusable = document.createElement("input");
    document.body.appendChild(outsideFocusable);
    outsideFocusable.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(outsideFocusable);
    outsideFocusable.remove();
    overlayRoot.remove();
  });

  it("the pin toggle button reflects pinned state and fires onTogglePin on click", () => {
    setup();
    const onTogglePin = vi.fn();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined, pinned: false },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onTogglePin },
    );
    const pinBtn = overlayRoot.querySelector<HTMLElement>(".agent-popover__pin")!;
    expect(pinBtn.getAttribute("aria-pressed")).toBe("false");
    expect(pinBtn.querySelector(".codicon-pin")).not.toBeNull();
    pinBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    overlayRoot.remove();
  });

  it("the pin toggle shows the 'pinned' codicon and aria-pressed=true once pinned", () => {
    setup();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined, pinned: true },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    const pinBtn = overlayRoot.querySelector<HTMLElement>(".agent-popover__pin")!;
    expect(pinBtn.getAttribute("aria-pressed")).toBe("true");
    expect(pinBtn.querySelector(".codicon-pinned")).not.toBeNull();
    overlayRoot.remove();
  });
});

// UX pass 1 spec §2 "refresh": rebuilds the open popover's content in
// place, never via dispose+reopen, and never steals focus.
describe("refreshOpenAgentPopover (finding #2)", () => {
  it("returns false and does nothing when no popover is open", () => {
    setup();
    const refreshed = refreshOpenAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    expect(refreshed).toBe(false);
    overlayRoot.remove();
  });

  it("rebuilds the rows in place, without disposing/reopening the popover", () => {
    setup();
    openAgentPopover(
      overlayRoot,
      [row({ pane_id: "p1" })],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    expect(overlayRoot.querySelectorAll(".agent-row")).toHaveLength(1);

    const refreshed = refreshOpenAgentPopover(
      overlayRoot,
      [row({ pane_id: "p1" }), row({ pane_id: "p2" })],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    expect(refreshed).toBe(true);
    // Same popover element, fresh content -- not a dispose+reopen.
    expect(overlayRoot.querySelectorAll(".agent-popover")).toHaveLength(1);
    expect(overlayRoot.querySelectorAll(".agent-row")).toHaveLength(2);
    overlayRoot.remove();
  });

  it("never calls focusKeyboardCapture / never changes document.activeElement", () => {
    setup();
    const outsideFocusable = document.createElement("input");
    document.body.appendChild(outsideFocusable);
    outsideFocusable.focus();

    openAgentPopover(
      overlayRoot,
      [row({ pane_id: "p1" })],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    // Opening moved nothing -- confirm the baseline before refreshing.
    expect(document.activeElement).toBe(outsideFocusable);

    refreshOpenAgentPopover(
      overlayRoot,
      [row({ pane_id: "p1" }), row({ pane_id: "p2" })],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    expect(document.activeElement).toBe(outsideFocusable);
    outsideFocusable.remove();
    overlayRoot.remove();
  });

  it("is a no-op (returns false, leaves rows untouched) while the user's focus is inside the popover", () => {
    setup();
    openAgentPopover(
      overlayRoot,
      [row({ pane_id: "p1" })],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    const rowEl = overlayRoot.querySelector<HTMLElement>(".agent-row")!;
    rowEl.focus();

    const refreshed = refreshOpenAgentPopover(
      overlayRoot,
      [row({ pane_id: "p1" }), row({ pane_id: "p2" })],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn() },
    );
    expect(refreshed).toBe(false);
    expect(document.activeElement).toBe(rowEl);
    expect(overlayRoot.querySelectorAll(".agent-row")).toHaveLength(1); // untouched
    overlayRoot.remove();
  });
});

// UX pass 1 spec §3 "Pinnable agent list" / finding #5: when another
// overlay (a menu, a hover popover, a confirm) closes the pinned list via
// `openOverlay`, the pinned list reopens once *that* overlay itself closes.
describe("openAgentPopover: reopens after being superseded, while pinned (finding #5)", () => {
  it("calls onSupersededReopen once the overlay that bumped it later closes -- not immediately", () => {
    setup();
    const onSupersededReopen = vi.fn();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined, pinned: true },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onSupersededReopen },
    );
    expect(overlayRoot.querySelector(".agent-popover")).not.toBeNull();

    // Some other overlay (a menu, a hover popover, a confirm) opens over
    // it, exactly as `ui/menu.ts`/`ui/confirmPopover.ts` do.
    const otherOverlayDispose = vi.fn();
    openOverlay(otherOverlayDispose);
    expect(overlayRoot.querySelector(".agent-popover")).toBeNull(); // superseded
    expect(onSupersededReopen).not.toHaveBeenCalled(); // deferred, not immediate

    // That other overlay now closes on its own (an outside click, Esc via
    // the router, ...).
    closeActiveOverlay();
    expect(otherOverlayDispose).toHaveBeenCalledTimes(1);
    expect(onSupersededReopen).toHaveBeenCalledTimes(1);
    overlayRoot.remove();
  });

  it("does not defer a reopen for an unpinned popover", () => {
    setup();
    const onSupersededReopen = vi.fn();
    openAgentPopover(
      overlayRoot,
      [row()],
      { sortMode: "priority", highlightCards: [], highlightRowFor: () => undefined, pinned: false },
      { onFocusRow: vi.fn(), onToggleSort: vi.fn(), onSupersededReopen },
    );
    const otherOverlayDispose = vi.fn();
    openOverlay(otherOverlayDispose);
    closeActiveOverlay();
    expect(onSupersededReopen).not.toHaveBeenCalled();
    overlayRoot.remove();
  });
});
