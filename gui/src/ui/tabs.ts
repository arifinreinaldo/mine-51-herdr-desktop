// Tab strip (spec phase1.5 §6 "Tab strip"). Renders the focused workspace's
// tabs only (no per-workspace grouping in the strip itself).

import { focusKeyboardCapture, keyboardCaptureReturnTarget } from "../keyboard/focusCapture";
import type { SeenDoneTabsTracker } from "../notifications/seenDoneTabs";
import { DIRECT_FOCUS_SLOT_COUNT, shortcutDisplay } from "../shortcuts";
import { LAST_FOCUS_SHORTCUT_DIGIT } from "../workspace/focusByIndex";
import { caretSlotFromPos, dragDropInsertIndex } from "../workspace/tabMove";
import { openMenu } from "./menu";
import { closeItems, paneLayoutItems } from "./paneActionItems";
import { beginRenderGuard } from "./renderGuard";
import { createStatusDotOrSlot } from "./statusDot";

/** Keyboard shortcuts feature, item 6: `"<label> (Alt+N)"` for a tab at
 * `index` (0-based, tab strip order) among `total` tabs -- N for index <
 * `DIRECT_FOCUS_SLOT_COUNT` (1-8), and the last tab (whatever its index)
 * also always mentions Alt+9. Plain `label` when neither applies. */
export function tabShortcutTooltip(label: string, index: number, total: number): string {
  const hints: string[] = [];
  if (index < DIRECT_FOCUS_SLOT_COUNT) hints.push(shortcutDisplay(`tab.focusByIndex.${index + 1}`) ?? "");
  if (index === total - 1) hints.push(shortcutDisplay(`tab.focusByIndex.${LAST_FOCUS_SHORTCUT_DIGIT}`) ?? "");
  return hints.length > 0 ? `${label} (${hints.join(" / ")})` : label;
}

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
  /** UX pass 1 spec §3 "Tab strip": "a blocked tab's label ... gains the
   * age suffix '· 12m' when the tab is not selected." `""`/`undefined`
   * when the age isn't known yet -- no suffix, never "· ". */
  blockedAgeLabel?: string;
  /** Close Pane shows only on a split tab: closing the only pane would
   * close the tab (and maybe the workspace) without the last-tab confirm. */
  paneCount?: number;
}

export interface TabCallbacks {
  onFocusTab(tabId: string): void;
  onCloseTab(tabId: string): void;
  onRenameTab(tabId: string, label: string): void;
  onMoveTab(tabId: string, insertIndex: number): void;
  onSplitRight(tabId: string): void;
  onSplitDown(tabId: string): void;
  onToggleZoom(tabId: string): void;
  onClosePane(tabId: string): void;
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
    ...paneLayoutItems({
      onSplitRight: () => callbacks.onSplitRight(tab.tab_id),
      onSplitDown: () => callbacks.onSplitDown(tab.tab_id),
      onToggleZoom: () => callbacks.onToggleZoom(tab.tab_id),
    }),
    {
      id: "tab.rename",
      label: "Rename Tab…",
      shortcut: shortcutDisplay("tab.rename"),
      separatorBefore: true,
      onSelect: () => startTabInlineRename(labelEl, tab, callbacks),
    },
    ...closeItems({
      onClosePane: (tab.paneCount ?? 1) > 1 ? () => callbacks.onClosePane(tab.tab_id) : undefined,
      onCloseTab: () => callbacks.onCloseTab(tab.tab_id),
    }),
  ], { returnFocusTo: keyboardCaptureReturnTarget() });
}

interface DragState {
  sourceIndex: number;
  caretEl: HTMLElement;
  startX: number;
  /** The pointer has moved past `TAB_DRAG_START_PX`: the press is now a drag. */
  active: boolean;
  /** The caret slot the pointer is over (0..=tab count). */
  slot: number;
}

const TAB_DRAG_START_PX = 4;

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
  /** The click that follows a drag's pointer release must not focus the tab. */
  let suppressClick = false;

  tabs.forEach((tab, index) => {
    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.dataset.tabId = tab.tab_id;
    tabEl.setAttribute("role", "tab");
    tabEl.tabIndex = tab.focused ? 0 : -1;
    tabEl.addEventListener(
      "click",
      (event) => {
        if (!suppressClick) return;
        event.stopImmediatePropagation();
        event.preventDefault();
      },
      true,
    );
    tabEl.title = tabShortcutTooltip(tab.label, index, tabs.length);
    if (tab.focused) tabEl.classList.add("active");
    if (tab.agent_status === "blocked" && !tab.focused) tabEl.classList.add("is-blocked");

    const labelEl = document.createElement("span");
    labelEl.className = "tab-label";
    // UX pass 1 spec §3 "Tab strip": a blocked, unselected tab's label
    // gains a "· 12m" age suffix; no suffix while the age is unknown.
    labelEl.textContent =
      tab.agent_status === "blocked" && !tab.focused && tab.blockedAgeLabel
        ? `${tab.label} · ${tab.blockedAgeLabel}`
        : tab.label;
    tabEl.appendChild(labelEl);

    const slot = document.createElement("span");
    slot.className = "tab-slot";
    const dotStatus: AgentStatus =
      tab.agent_status === "done" && seenDoneTracker.isSeen(tab.tab_id) ? "idle" : tab.agent_status;
    slot.appendChild(createStatusDotOrSlot(dotStatus));
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

    // Pointer events, not HTML5 drag and drop: Tauri's file-drop handler
    // (`dragDropFiles.ts`) turns HTML5 drag events off on Windows, so a
    // `dragstart` tab drag never completes there. Pointer capture keeps the
    // events coming while the cursor is anywhere in the window, so slot 0
    // (the first position) is reachable by moving past the left edge.
    tabEl.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || drag) return;
      if ((event.target as HTMLElement).closest(".tab-close-icon, .tab-rename-input")) return;
      drag = {
        sourceIndex: index,
        caretEl: document.createElement("div"),
        startX: event.clientX,
        active: false,
        slot: index,
      };
      drag.caretEl.className = "tab-drop-caret";
      tabEl.setPointerCapture?.(event.pointerId);
    });
    tabEl.addEventListener("pointermove", (event) => {
      if (!drag || drag.sourceIndex !== index) return;
      if (!drag.active) {
        if (Math.abs(event.clientX - drag.startX) < TAB_DRAG_START_PX) return;
        drag.active = true;
        tabEl.classList.add("is-dragging");
        // Finding #5: a snapshot mid-drag must not call `renderTabStrip`
        // again -- that would create a brand new `drag` closure (`null`),
        // breaking this drag's own `pointermove`/`pointerup` handling.
        releaseDragGuard = beginRenderGuard(TAB_RENDER_GUARD_REGION);
      }
      const tabEls = Array.from(listEl.querySelectorAll<HTMLElement>(".tab"));
      const midpoints = tabEls.map((el) => {
        const rect = el.getBoundingClientRect();
        return rect.left + rect.width / 2;
      });
      drag.slot = caretSlotFromPos(event.clientX, midpoints);
      listEl.insertBefore(drag.caretEl, tabEls[drag.slot] ?? null);
    });
    const endDrag = (commit: boolean) => {
      const ended = drag;
      if (!ended || ended.sourceIndex !== index) return;
      drag = null;
      ended.caretEl.remove();
      tabEl.classList.remove("is-dragging");
      if (ended.active) {
        suppressClick = true;
        window.setTimeout(() => {
          suppressClick = false;
        }, 0);
        // Dropping in place (before itself, or right after itself) moves nothing.
        if (commit && ended.slot !== ended.sourceIndex && ended.slot !== ended.sourceIndex + 1) {
          callbacks.onMoveTab(tab.tab_id, dragDropInsertIndex(ended.slot));
        }
      }
      releaseDragGuard?.();
      releaseDragGuard = null;
    };
    tabEl.addEventListener("pointerup", () => endDrag(true));
    tabEl.addEventListener("pointercancel", () => endDrag(false));

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
