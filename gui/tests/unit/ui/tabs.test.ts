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
    onClosePane: vi.fn(),
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
    .forEach((tabEl) => tabEl.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true })));
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

    pointer(tabEl, "pointerdown", 50);
    pointer(tabEl, "pointermove", 80);
    expect(isRenderGuarded(TAB_RENDER_GUARD_REGION)).toBe(true);

    // A "snapshot arrived mid-drag" re-render attempt must be skipped --
    // otherwise the dragging tab loses its `.is-dragging` class (proof the
    // whole strip, including this element, would have been torn down and
    // rebuilt fresh, discarding the drag closure).
    guardedRender(callbacks);
    expect(listEl.querySelector('[data-tab-id="t1"]')?.classList.contains("is-dragging")).toBe(true);

    pointer(tabEl, "pointercancel", 80);
    expect(isRenderGuarded(TAB_RENDER_GUARD_REGION)).toBe(false);
  });
});

function pointer(el: HTMLElement, type: string, clientX: number): void {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 }));
}

/** Three 100px tabs laid out at x = 0, 100, 200 (midpoints 50, 150, 250). */
function threeTabs(callbacks: TabCallbacks): void {
  const rows: TabRow[] = [
    { tab_id: "t1", label: "one", focused: true, agent_status: "idle" },
    { tab_id: "t2", label: "two", focused: false, agent_status: "idle" },
    { tab_id: "t3", label: "three", focused: false, agent_status: "idle" },
  ];
  renderTabStrip(listEl, overlayRoot, rows, seenTracker, callbacks);
  listEl.querySelectorAll<HTMLElement>(".tab").forEach((el, i) => {
    el.getBoundingClientRect = () => ({ left: i * 100, width: 100 }) as DOMRect;
  });
}

describe("tab drag with the pointer", () => {
  it("dragging the last tab past the left edge drops it at the first position", () => {
    const callbacks = makeCallbacks();
    threeTabs(callbacks);
    const t3 = listEl.querySelector<HTMLElement>('[data-tab-id="t3"]')!;
    pointer(t3, "pointerdown", 250);
    pointer(t3, "pointermove", 120);
    pointer(t3, "pointermove", -40); // left of the strip, over nothing
    expect(listEl.querySelector(".tab-drop-caret")).not.toBeNull();
    pointer(t3, "pointerup", -40);
    expect(callbacks.onMoveTab).toHaveBeenCalledWith("t3", 0);
    expect(listEl.querySelector(".tab-drop-caret")).toBeNull();
    expect(isRenderGuarded(TAB_RENDER_GUARD_REGION)).toBe(false);
  });

  it("dragging the first tab past the right edge drops it at the end", () => {
    const callbacks = makeCallbacks();
    threeTabs(callbacks);
    const t1 = listEl.querySelector<HTMLElement>('[data-tab-id="t1"]')!;
    pointer(t1, "pointerdown", 50);
    pointer(t1, "pointermove", 400);
    pointer(t1, "pointerup", 400);
    expect(callbacks.onMoveTab).toHaveBeenCalledWith("t1", 3);
  });

  it("dropping a tab back where it was moves nothing", () => {
    const callbacks = makeCallbacks();
    threeTabs(callbacks);
    const t2 = listEl.querySelector<HTMLElement>('[data-tab-id="t2"]')!;
    pointer(t2, "pointerdown", 150);
    pointer(t2, "pointermove", 170);
    pointer(t2, "pointerup", 170);
    expect(callbacks.onMoveTab).not.toHaveBeenCalled();
  });

  it("a plain click does not start a drag and still focuses the tab", () => {
    const callbacks = makeCallbacks();
    threeTabs(callbacks);
    const t2 = listEl.querySelector<HTMLElement>('[data-tab-id="t2"]')!;
    pointer(t2, "pointerdown", 150);
    pointer(t2, "pointermove", 151); // under the 4px threshold
    pointer(t2, "pointerup", 151);
    expect(isRenderGuarded(TAB_RENDER_GUARD_REGION)).toBe(false);
    t2.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(callbacks.onFocusTab).toHaveBeenCalledWith("t2");
    expect(callbacks.onMoveTab).not.toHaveBeenCalled();
  });

  it("the click that follows a drag does not focus the tab", () => {
    const callbacks = makeCallbacks();
    threeTabs(callbacks);
    const t3 = listEl.querySelector<HTMLElement>('[data-tab-id="t3"]')!;
    pointer(t3, "pointerdown", 250);
    pointer(t3, "pointermove", 20);
    pointer(t3, "pointerup", 20);
    t3.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(callbacks.onFocusTab).not.toHaveBeenCalled();
  });

  it("a cancelled drag (pointercancel) moves nothing and releases the guard", () => {
    const callbacks = makeCallbacks();
    threeTabs(callbacks);
    const t3 = listEl.querySelector<HTMLElement>('[data-tab-id="t3"]')!;
    pointer(t3, "pointerdown", 250);
    pointer(t3, "pointermove", 20);
    pointer(t3, "pointercancel", 20);
    expect(callbacks.onMoveTab).not.toHaveBeenCalled();
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
    guardedRender(callbacks, [
      { tab_id: "t1", label: "one", focused: true, agent_status: "working" },
      { tab_id: "t2", label: "two", focused: false, agent_status: "idle" },
    ]);
    const dot = listEl.querySelector('[data-tab-id="t1"] .status-dot')!;
    expect(dot.getAttribute("role")).toBe("img");
    expect(dot.getAttribute("aria-label")).toBe("working");
  });

  it("an idle tab has a .status-dot-slot and no .status-dot", () => {
    guardedRender(makeCallbacks()); // tabs(): both idle
    const tab = listEl.querySelector('[data-tab-id="t2"]')!;
    expect(tab.querySelector(".status-dot")).toBeNull();
    expect(tab.querySelectorAll(".status-dot-slot")).toHaveLength(1);
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

describe("tab context menu Close Pane", () => {
  function openMenuFor(rows: TabRow[], callbacks: TabCallbacks): void {
    renderTabStrip(listEl, overlayRoot, rows, seenTracker, callbacks);
    const tabEl = listEl.querySelector<HTMLElement>(".tab")!;
    tabEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  }

  it("is hidden on a single-pane tab", () => {
    openMenuFor([{ ...tabs()[0], paneCount: 1 }], makeCallbacks());
    expect(overlayRoot.textContent).toContain("Split Right");
    expect(overlayRoot.textContent).not.toContain("Close Pane");
  });

  it("always offers Close Tab, and calls onCloseTab", () => {
    const callbacks = makeCallbacks();
    openMenuFor([{ ...tabs()[0], paneCount: 1 }], callbacks);
    const item = Array.from(overlayRoot.querySelectorAll<HTMLElement>("*")).find(
      (el) => el.children.length === 0 && el.textContent === "Close Tab",
    );
    expect(item).toBeDefined();
    item!.click();
    expect(callbacks.onCloseTab).toHaveBeenCalledWith("t1");
  });

  it("labels the rename item 'Rename Tab…'", () => {
    openMenuFor([{ ...tabs()[0], paneCount: 1 }], makeCallbacks());
    expect(overlayRoot.textContent).toContain("Rename Tab…");
  });

  it("shows on a split tab and closes a pane of that tab", () => {
    const callbacks = makeCallbacks();
    openMenuFor([{ ...tabs()[0], paneCount: 2 }], callbacks);
    const item = Array.from(overlayRoot.querySelectorAll<HTMLElement>("*")).find(
      (el) => el.children.length === 0 && el.textContent === "Close Pane",
    );
    expect(item).toBeDefined();
    item!.click();
    expect(callbacks.onClosePane).toHaveBeenCalledWith("t1");
  });
});
