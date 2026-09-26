// Tab strip (spec phase1.5 §6 "Tab strip"). Renders the focused workspace's
// tabs only (no per-workspace grouping in the strip itself).

import { focusKeyboardCapture, keyboardCaptureReturnTarget } from "../keyboard/focusCapture";
import type { SeenDoneTabsTracker } from "../notifications/seenDoneTabs";
import { dragDropInsertIndex } from "../workspace/tabMove";
import { openMenu } from "./menu";
import { beginRenderGuard } from "./renderGuard";

/** The render-guard region name tab renames and drags claim (finding #5).
 * Exported so `sidebar.ts` can guard its own re-render under the *same*
 * region when it reuses this rename component (finding #14) -- a rename
 * started from either place must defer both the tab strip's and the
 * sidebar's rebuild, since `startInlineRename` doesn't know which one it
 * was called from. */
export const TAB_RENDER_GUARD_REGION = "tabs";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface TabRow {
  tab_id: string;
  label: string;
  focused: boolean;
  agent_status: AgentStatus;
}

export interface TabCallbacks {
  onFocusTab(tabId: string): void;
  onCloseTab(tabId: string): void;
  onRenameTab(tabId: string, label: string): void;
  onMoveTab(tabId: string, insertIndex: number): void;
  onSplitRight(tabId: string): void;
  onSplitDown(tabId: string): void;
  onToggleZoom(tabId: string): void;
}

function statusDotClass(status: AgentStatus): string {
  return `status-dot status-dot--${status}`;
}

/** A row inline rename can target: a tab (`{id: tab_id, label}`) or,
 * reusing this same component (finding #14), a sidebar workspace row
 * (`{id: workspace_id, label}`). */
export interface RenameTarget {
  id: string;
  label: string;
}

export interface RenameCallbacks {
  onRename(id: string, label: string): void;
}

/**
 * Exported so `main.ts` can trigger the same inline rename UI from the F2
 * shortcut and the `Tab ▸ Rename Tab…` menu item, not just double-click and
 * the tab's own context menu (spec §4 table: F2 is "tab UI focus only",
 * but the menu item and this function work on the *focused* tab too), and
 * so `sidebar.ts` can reuse it for a workspace row (finding #14).
 *
 * `region` claims the render guard (finding #5, `renderGuard.ts`): while
 * this input is showing, a snapshot re-render of that region must not
 * rebuild the DOM out from under it (destroying the input and dropping
 * focus). Defaults to the tab strip's own region for `tabs.ts`'s internal
 * call sites; `sidebar.ts` passes its own region explicitly.
 */
export function startInlineRename(
  labelEl: HTMLElement,
  target: RenameTarget,
  callbacks: RenameCallbacks,
  region: string = TAB_RENDER_GUARD_REGION,
): void {
  const release = beginRenderGuard(region);
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };

  const input = document.createElement("input");
  input.className = "tab-rename-input";
  input.value = target.label;
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const value = input.value.trim();
    input.replaceWith(labelEl);
    // An empty name reverts (spec §6 "Mouse": "an empty name reverts").
    if (value && value !== target.label) {
      callbacks.onRename(target.id, value);
    }
    releaseOnce();
  };
  const cancel = () => {
    input.replaceWith(labelEl);
    releaseOnce();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
    event.stopPropagation();
  });
  input.addEventListener("blur", commit, { once: true });
}

/** `startInlineRename` adapted to a tab row specifically, for `tabs.ts`'s
 * own call sites and `main.ts`'s F2/menu-item trigger. */
export function startTabInlineRename(
  labelEl: HTMLElement,
  tab: TabRow,
  callbacks: Pick<TabCallbacks, "onRenameTab">,
): void {
  startInlineRename(labelEl, { id: tab.tab_id, label: tab.label }, { onRename: callbacks.onRenameTab });
}

/**
 * Split Right/Down and Toggle Zoom on an inactive tab (spec §1 "(v3
 * correction)", finding #2): `snapshot.panes[].focused` is true only for
 * the *connection*-focused pane, never per-tab, so it cannot answer "which
 * pane in *this* tab" for a tab that isn't the focused one. The caller
 * (`main.ts`, which owns the snapshot and the `tab.focus` await/wait
 * sequence) decides whether this tab needs focusing first, using the
 * *current* snapshot at the moment the item is actually selected -- not
 * `isActive` captured back when the context menu was opened, which could
 * be stale by the time the user picks an item.
 */
function openTabContextMenu(
  overlayRoot: HTMLElement,
  x: number,
  y: number,
  tab: TabRow,
  labelEl: HTMLElement,
  callbacks: TabCallbacks,
): void {
  const rootRect = overlayRoot.getBoundingClientRect();
  openMenu(overlayRoot, { left: x - rootRect.left, top: y - rootRect.top }, [
    {
      id: "split-right",
      label: "Split Right",
      icon: "split-horizontal",
      shortcut: "Alt+Shift+=",
      onSelect: () => callbacks.onSplitRight(tab.tab_id),
    },
    {
      id: "split-down",
      label: "Split Down",
      icon: "split-vertical",
      shortcut: "Alt+Shift+-",
      onSelect: () => callbacks.onSplitDown(tab.tab_id),
    },
    {
      id: "rename",
      label: "Rename…",
      shortcut: "F2",
      separatorBefore: true,
      onSelect: () => startTabInlineRename(labelEl, tab, callbacks),
    },
    {
      id: "toggle-zoom",
      label: "Toggle Zoom",
      shortcut: "Alt+Shift+Z",
      onSelect: () => callbacks.onToggleZoom(tab.tab_id),
    },
  ], { returnFocusTo: keyboardCaptureReturnTarget() });
}

interface DragState {
  sourceIndex: number;
  caretEl: HTMLElement;
}

export function renderTabStrip(
  listEl: HTMLElement,
  overlayRoot: HTMLElement,
  tabs: readonly TabRow[],
  seenDoneTracker: SeenDoneTabsTracker,
  callbacks: TabCallbacks,
): void {
  listEl.textContent = "";
  let drag: DragState | null = null;
  let releaseDragGuard: (() => void) | null = null;

  tabs.forEach((tab, index) => {
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.dataset.tabId = tab.tab_id;
    tabEl.setAttribute("role", "tab");
    tabEl.tabIndex = tab.focused ? 0 : -1;
    tabEl.draggable = true;
    if (tab.focused) tabEl.classList.add("active");
    if (tab.agent_status === "blocked" && !tab.focused) tabEl.classList.add("is-blocked");

    const labelEl = document.createElement("span");
    labelEl.className = "tab-label";
    labelEl.textContent = tab.label;
    tabEl.appendChild(labelEl);

    const slot = document.createElement("span");
    slot.className = "tab-slot";
    const dotStatus: AgentStatus =
      tab.agent_status === "done" && seenDoneTracker.isSeen(tab.tab_id) ? "idle" : tab.agent_status;
    const dot = document.createElement("span");
    dot.className = statusDotClass(dotStatus);
    slot.appendChild(dot);
    const closeIcon = document.createElement("i");
    closeIcon.className = "codicon codicon-close tab-close-icon";
    slot.appendChild(closeIcon);
    tabEl.appendChild(slot);

    tabEl.addEventListener("click", (event) => {
      if (slot.contains(event.target as Node)) {
        callbacks.onCloseTab(tab.tab_id);
        return;
      }
      callbacks.onFocusTab(tab.tab_id);
    });
    tabEl.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        callbacks.onCloseTab(tab.tab_id);
      }
    });
    tabEl.addEventListener("dblclick", (event) => {
      if (slot.contains(event.target as Node)) return;
      event.preventDefault();
      startTabInlineRename(labelEl, tab, callbacks);
    });
    tabEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openTabContextMenu(overlayRoot, event.clientX, event.clientY, tab, labelEl, callbacks);
    });
    tabEl.addEventListener("keydown", (event) => {
      if (event.key === "F10" && event.shiftKey) {
        event.preventDefault();
        const rect = tabEl.getBoundingClientRect();
        openTabContextMenu(overlayRoot, rect.left, rect.bottom, tab, labelEl, callbacks);
      } else if (event.key === "Enter") {
        callbacks.onFocusTab(tab.tab_id);
      }
    });
    // A left click returns focus to the terminal capture (spec §1 "Tab UI
    // focus"): only Tab-key navigation or right-click give a tab UI focus.
    // Finding #3: `blur()` alone (the prior code) drops focus to
    // `document.body`, not the capture -- `focusKeyboardCapture()` is the
    // fix, and it already declines to steal focus from an active rename
    // input on its own.
    tabEl.addEventListener("mousedown", (event) => {
      if (event.button === 0) {
        window.setTimeout(() => focusKeyboardCapture(), 0);
      }
    });

    tabEl.addEventListener("dragstart", (event) => {
      drag = { sourceIndex: index, caretEl: document.createElement("div") };
      drag.caretEl.className = "tab-drop-caret";
      tabEl.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", tab.tab_id);
      event.dataTransfer!.effectAllowed = "move";
      // Finding #5: a snapshot mid-drag must not call `renderTabStrip`
      // again -- that would create a brand new `drag` closure (`null`),
      // breaking this drag's own `dragover`/`drop` handling.
      releaseDragGuard = beginRenderGuard(TAB_RENDER_GUARD_REGION);
    });
    tabEl.addEventListener("dragend", () => {
      tabEl.classList.remove("is-dragging");
      drag?.caretEl.remove();
      drag = null;
      releaseDragGuard?.();
      releaseDragGuard = null;
    });
    tabEl.addEventListener("dragover", (event) => {
      if (!drag) return;
      event.preventDefault();
      const rect = tabEl.getBoundingClientRect();
      const before = event.clientX - rect.left < rect.width / 2;
      const caretSlot = before ? index : index + 1;
      drag.caretEl.dataset.caretSlot = String(caretSlot);
      if (before) {
        listEl.insertBefore(drag.caretEl, tabEl);
      } else {
        listEl.insertBefore(drag.caretEl, tabEl.nextSibling);
      }
    });
    tabEl.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!drag) return;
      const caretSlot = Number(drag.caretEl.dataset.caretSlot ?? "0");
      const sourceTabId = tabs[drag.sourceIndex].tab_id;
      drag.caretEl.remove();
      drag = null;
      callbacks.onMoveTab(sourceTabId, dragDropInsertIndex(caretSlot));
    });

    listEl.appendChild(tabEl);
  });

  // Finding #11 "Tab overflow: the active tab always scrolls into view"
  // (spec §6 "Overflow"): re-run on every render, since which tab is
  // active can change (e.g. Ctrl+Tab) without the strip's scroll position
  // following it on its own. The extra `?.` on the method itself (not
  // just the element) is jsdom feature-detection for the test suite --
  // jsdom does not implement `scrollIntoView` at all.
  const activeTabEl = listEl.querySelector<HTMLElement>(".tab.active");
  activeTabEl?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}
