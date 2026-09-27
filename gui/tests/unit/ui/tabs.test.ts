// @vitest-environment jsdom
//
// Finding #5: every snapshot rebuilt the tab strip from scratch
// (`renderTabStrip`'s first line is `listEl.textContent = ""`), which
// destroyed an in-progress inline rename `<input>` (its typed text and
// keyboard focus) and a drag's own local `drag` state (a fresh call
// creates a brand new closure with `drag: null`, breaking `dragover`/
// `drop`). The fix defers the rebuild while the render guard is claimed,
// then re-renders once it releases -- these tests exercise that against a
// real (jsdom) DOM, mirroring how `main.ts`'s `renderTabsNow` uses the same
// `renderGuard` primitives.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRenderGuarded, onRenderGuardReleased } from "../../../src/ui/renderGuard";
import {
  renderTabStrip,
  startTabInlineRename,
  tabShortcutTooltip,
  TAB_RENDER_GUARD_REGION,
  type TabCallbacks,
  type TabRow,
} from "../../../src/ui/tabs";
import { SeenDoneTabsTracker } from "../../../src/notifications/seenDoneTabs";

let listEl: HTMLDivElement;
let overlayRoot: HTMLDivElement;
let seenTracker: SeenDoneTabsTracker;

function makeCallbacks(overrides: Partial<TabCallbacks> = {}): TabCallbacks {
  return {
    onFocusTab: vi.fn(),
    onCloseTab: vi.fn(),
    onRenameTab: vi.fn(),
    onMoveTab: vi.fn(),
    onSplitRight: vi.fn(),
    onSplitDown: vi.fn(),
    onToggleZoom: vi.fn(),
    ...overrides,
  };
}

function tabs(): TabRow[] {
  return [
    { tab_id: "t1", label: "one", focused: true, agent_status: "idle" },
    { tab_id: "t2", label: "two", focused: false, agent_status: "idle" },
  ];
}

/** Mirrors `main.ts`'s `renderTabsNow`: skip the rebuild while guarded. */
function guardedRender(callbacks: TabCallbacks, rows: TabRow[] = tabs()): void {
  if (isRenderGuarded(TAB_RENDER_GUARD_REGION)) return;
  renderTabStrip(listEl, overlayRoot, rows, seenTracker, callbacks);
}

beforeEach(() => {
  listEl = document.createElement("div");
  overlayRoot = document.createElement("div");
  document.body.append(listEl, overlayRoot);
  seenTracker = new SeenDoneTabsTracker();
  onRenderGuardReleased(TAB_RENDER_GUARD_REGION, null); // isolate tests from each other
});

afterEach(() => {
  // `renderGuard`'s counters are a module-level singleton (by design, so
  // production code across files shares one registry) -- release
  // whatever this test left claimed, so the next test starts unguarded.
  document
    .querySelectorAll<HTMLElement>(".tab-rename-input")
    .forEach((input) => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  document
    .querySelectorAll<HTMLElement>(".tab.is-dragging")
    .forEach((tabEl) => tabEl.dispatchEvent(new Event("dragend", { bubbles: true })));
  listEl.remove();
  overlayRoot.remove();
});

describe("tab strip render guard (finding #5)", () => {
  it("a snapshot re-render during an inline rename keeps the input in the DOM", () => {
    const callbacks = makeCallbacks();
    guardedRender(callbacks);
    const labelEl = listEl.querySelector<HTMLElement>('[data-tab-id="t1"] .tab-label')!;
    startTabInlineRename(labelEl, tabs()[0], callbacks);

    expect(listEl.querySelector(".tab-rename-input")).not.toBeNull();
    expect(isRenderGuarded(TAB_RENDER_GUARD_REGION)).toBe(true);

    // A "snapshot arrived mid-rename" re-render attempt.
    guardedRender(callbacks);

    // The rename input must have survived it.
    expect(listEl.querySelector(".tab-rename-input")).not.toBeNull();
  });

  it("committing the rename releases the guard and a later render applies the latest data", () => {
    const callbacks = makeCallbacks();
    guardedRender(callbacks);
    const labelEl = listEl.querySelector<HTMLElement>('[data-tab-id="t1"] .tab-label')!;
    startTabInlineRename(labelEl, tabs()[0], callbacks);

    let rendered = false;
    onRenderGuardReleased(TAB_RENDER_GUARD_REGION, () => {
      rendered = true;
      guardedRender(callbacks, [{ tab_id: "t1", label: "renamed", focused: true, agent_status: "idle" }]);
    });

    const input = listEl.querySelector<HTMLInputElement>(".tab-rename-input")!;
    input.value = "new name";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

    expect(callbacks.onRenameTab).toHaveBeenCalledWith("t1", "new name");
    expect(isRenderGuarded(TAB_RENDER_GUARD_REGION)).toBe(false);
    expect(rendered).toBe(true);
    expect(listEl.querySelector(".tab-rename-input")).toBeNull();
    expect(listEl.querySelector('[data-tab-id="t1"] .tab-label')?.textContent).toBe("renamed");
  });

  it("cancelling the rename (Esc) also releases the guard", () => {
    const callbacks = makeCallbacks();
    guardedRender(callbacks);
    const labelEl = listEl.querySelector<HTMLElement>('[data-tab-id="t1"] .tab-label')!;
    startTabInlineRename(labelEl, tabs()[0], callbacks);
    expect(isRenderGuarded(TAB_RENDER_GUARD_REGION)).toBe(true);

    const input = listEl.querySelector<HTMLInputElement>(".tab-rename-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(callbacks.onRenameTab).not.toHaveBeenCalled();
    expect(isRenderGuarded(TAB_RENDER_GUARD_REGION)).toBe(false);
  });

  it("a snapshot re-render mid-drag does not tear down the in-progress drag state", () => {
    const callbacks = makeCallbacks();
    guardedRender(callbacks);
    const tabEl = listEl.querySelector<HTMLElement>('[data-tab-id="t1"]')!;

    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(dragStart, "dataTransfer", {
      value: { setData: vi.fn(), effectAllowed: "" },
    });
    tabEl.dispatchEvent(dragStart);
    expect(isRenderGuarded(TAB_RENDER_GUARD_REGION)).toBe(true);

    // A "snapshot arrived mid-drag" re-render attempt must be skipped --
    // otherwise the dragging tab loses its `.is-dragging` class (proof the
    // whole strip, including this element, would have been torn down and
    // rebuilt fresh, discarding the drag closure the pre-fix code relied
    // on `dragover`/`drop` seeing).
    guardedRender(callbacks);
    expect(listEl.querySelector('[data-tab-id="t1"]')?.classList.contains("is-dragging")).toBe(true);

    tabEl.dispatchEvent(new Event("dragend", { bubbles: true }));
    expect(isRenderGuarded(TAB_RENDER_GUARD_REGION)).toBe(false);
  });
});

describe("tab overflow: active tab scroll-into-view (finding #11)", () => {
  it("scrolls the active tab, and only the active tab, into view on every render", () => {
    const callbacks = makeCallbacks();
    const calls: string[] = [];
    // jsdom doesn't implement `scrollIntoView`; stub it on the prototype
    // (each render creates fresh `.tab` elements) so the test can see
    // which one, if any, was actually called.
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      calls.push(this.dataset.tabId ?? "");
    };
    try {
      guardedRender(callbacks);
      expect(calls).toEqual(["t1"]); // t1 is `focused: true` in `tabs()`
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe("status dots in the tab strip (UX pass 1 spec §2)", () => {
  it("every tab's dot gets role=img and an aria-label matching its status", () => {
    const callbacks = makeCallbacks();
    guardedRender(callbacks); // tabs(): both idle
    const dot = listEl.querySelector('[data-tab-id="t1"] .status-dot')!;
    expect(dot.getAttribute("role")).toBe("img");
    expect(dot.getAttribute("aria-label")).toBe("idle");
  });
});

describe("blocked tab age suffix (UX pass 1 spec §3)", () => {
  it("a blocked, unselected tab's label gains a '· <age>' suffix", () => {
    const callbacks = makeCallbacks();
    guardedRender(callbacks, [
      { tab_id: "t1", label: "one", focused: true, agent_status: "idle" },
      { tab_id: "t2", label: "two", focused: false, agent_status: "blocked", blockedAgeLabel: "12m" },
    ]);
    expect(listEl.querySelector('[data-tab-id="t2"] .tab-label')?.textContent).toBe("two · 12m");
  });

  it("no suffix while the age is unknown ('') -- never '· '", () => {
    const callbacks = makeCallbacks();
    guardedRender(callbacks, [
      { tab_id: "t1", label: "one", focused: true, agent_status: "idle" },
      { tab_id: "t2", label: "two", focused: false, agent_status: "blocked", blockedAgeLabel: "" },
    ]);
    expect(listEl.querySelector('[data-tab-id="t2"] .tab-label')?.textContent).toBe("two");
  });

  it("no suffix on the selected (focused) tab, even if blocked", () => {
    const callbacks = makeCallbacks();
    guardedRender(callbacks, [
      { tab_id: "t1", label: "one", focused: true, agent_status: "blocked", blockedAgeLabel: "12m" },
    ]);
    expect(listEl.querySelector('[data-tab-id="t1"] .tab-label')?.textContent).toBe("one");
  });
});

describe("tabShortcutTooltip (keyboard shortcuts feature, item 6)", () => {
  it("positions 1-8 get their own Alt+N hint", () => {
    expect(tabShortcutTooltip("one", 0, 10)).toBe("one (Alt+1)");
    expect(tabShortcutTooltip("eight", 7, 10)).toBe("eight (Alt+8)");
  });

  it("the last tab always also mentions Alt+9, even within positions 1-8", () => {
    expect(tabShortcutTooltip("last-of-five", 4, 5)).toBe("last-of-five (Alt+5 / Alt+9)");
  });

  it("the last tab beyond position 8 mentions only Alt+9", () => {
    expect(tabShortcutTooltip("last-of-twelve", 11, 12)).toBe("last-of-twelve (Alt+9)");
  });

  it("a tab beyond position 8 that is not last gets the plain label", () => {
    expect(tabShortcutTooltip("ninth", 8, 12)).toBe("ninth");
  });

  it("renderTabStrip wires the title attribute for every tab", () => {
    const callbacks = makeCallbacks();
    guardedRender(callbacks); // tabs(): t1 (index 0), t2 (index 1, last)
    expect(listEl.querySelector('[data-tab-id="t1"]')?.getAttribute("title")).toBe("one (Alt+1)");
    expect(listEl.querySelector('[data-tab-id="t2"]')?.getAttribute("title")).toBe("two (Alt+2 / Alt+9)");
  });
});
