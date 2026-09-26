// @vitest-environment jsdom
//
// Finding #11: the agent popover's `onClose` must fire for every close path
// (not just a row click, the prior code's only reset site) so a caller's
// "is it open" bookkeeping never gets stuck stale; highlight-card hover
// must be reported back via `onHighlightHoverChange`; and Up/Down must
// move focus between rows (Enter-per-row already existed).

import { describe, expect, it, vi } from "vitest";
import { openAgentPopover, type AgentPopoverRow } from "../../../src/ui/statusbar";

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
