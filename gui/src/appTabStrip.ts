import { requestCloseTab } from "./tabClose";
// Tab strip rendering, drag/move, and the overflow chevron's "All Tabs"
// modal (finding #16 extraction from `main.ts`).

import { listen } from "@tauri-apps/api/event";
import { api, showErrorNotice } from "./appApi";
import { requireConnected } from "./appConnectionGuard";
import { overlayRoot, tabListEl, tabOverflowEl, tabPlusEl } from "./appDom";
import { focusedWorkspaceTabs, tabLabel } from "./appLookups";
import { appState, seenDoneTabs, statusAge } from "./appState";
import type { RawSnapshot, RawTab } from "./appTypes";
import { formatAge, oldestAgeMs } from "./notifications/statusAge";
import { isRenderGuarded } from "./ui/renderGuard";
import { renderTabStrip, TAB_RENDER_GUARD_REGION, type TabRow } from "./ui/tabs";
import { openModal } from "./ui/modal";
import { createStatusDot } from "./ui/statusDot";
import { waitForTabFocusedPane } from "./workspace/tabFocusWait";
import { optimisticTabOrderAfterMove } from "./workspace/tabMove";

/**
 * Resolves the pane id to target for a tab-menu pane action (Split Right/
 * Down, Toggle Zoom -- spec §1 "(v3 correction)", finding #2). Already
 * active: use the current snapshot's `focused_pane_id` directly. Not
 * active: await `tab.focus`, then `waitForTabFocusedPane` -- awaited in
 * order, per the spec. A timeout shows a notice and resolves to
 * `undefined` (the caller then skips the pane action rather than sending
 * one with a stale or missing pane id).
 */
export async function focusedPaneIdForTabAction(tabId: string): Promise<string | undefined> {
  if (appState.snapshot?.focused_tab_id === tabId) {
    return appState.snapshot.focused_pane_id ?? undefined;
  }
  await api("tab.focus", { tab_id: tabId });
  const paneId = await waitForTabFocusedPane(
    {
      getSnapshot: () => appState.snapshot,
      subscribeSnapshot: (handler) => listen<RawSnapshot>("snapshot", (event) => handler(event.payload)),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    },
    tabId,
  );
  if (!paneId) {
    showErrorNotice(`Timed out waiting for "${tabLabel(tabId)}" to focus`);
    return undefined;
  }
  return paneId;
}

/** UX pass 1 spec §3 "Tab strip": the age suffix for a blocked, unselected
 * tab's label -- the oldest blocked pane within that tab, `""` while
 * unknown. */
function blockedAgeLabelFor(tabId: string): string {
  const now = Date.now();
  const blockedPaneIds = (appState.snapshot?.agents ?? [])
    .filter((a) => a.tab_id === tabId && a.agent_status === "blocked")
    .map((a) => a.pane_id);
  return formatAge(oldestAgeMs(blockedPaneIds, (paneId) => statusAge.ageMs(paneId, now)));
}

export function renderTabsNow(): void {
  // Finding #5: a snapshot mid-rename or mid-drag must not rebuild the tab
  // strip -- that destroys the rename `<input>` (and its focus/typed text)
  // or the in-progress drag's own local state. `onRenderGuardReleased`
  // (wired in `main()`) re-renders with whatever is current once it ends.
  if (isRenderGuarded(TAB_RENDER_GUARD_REGION)) return;
  const tabs = focusedWorkspaceTabs();
  seenDoneTabs.update(tabs.map((t) => ({ tab_id: t.tab_id, agent_status: t.agent_status, focused: t.focused })));
  const rows: TabRow[] = tabs.map((t) => ({
    tab_id: t.tab_id,
    label: t.label,
    focused: t.focused,
    agent_status: t.agent_status,
    blockedAgeLabel: blockedAgeLabelFor(t.tab_id),
    paneCount: appState.snapshot?.panes.filter((p) => p.tab_id === t.tab_id).length ?? 1,
  }));
  renderTabStrip(tabListEl, overlayRoot, rows, seenDoneTabs, {
    onFocusTab: (id) => {
      // UX pass 1 spec §4: "not interactive (no API calls). A click shows
      // the notice 'herdr is not connected'."
      if (!requireConnected()) return;
      void api("tab.focus", { tab_id: id });
    },
    onCloseTab: (id) => {
      if (!requireConnected()) return;
      requestCloseTab(id);
    },
    onRenameTab: (id, label) => {
      if (!requireConnected()) return;
      void api("tab.rename", { tab_id: id, label });
    },
    onMoveTab: (id, insertIndex) => {
      if (!requireConnected()) return;
      // Finding #11 "Tab drag: optimistic reorder + snap back on error"
      // (spec §6 "reorder optimistically ... On an error, snap back and
      // show a notice").
      appState.optimisticTabOrder = optimisticTabOrderAfterMove(tabs.map((t) => t.tab_id), id, insertIndex);
      renderTabsNow();
      void api("tab.move", { tab_id: id, insert_index: insertIndex }).then((result) => {
        if (result === undefined) {
          // `invokeSafe` already showed the error notice; snap back.
          appState.optimisticTabOrder = null;
          renderTabsNow();
        }
      });
    },
    onSplitRight: (tabId) => {
      if (!requireConnected()) return;
      void (async () => {
        const paneId = await focusedPaneIdForTabAction(tabId);
        if (paneId) void api("pane.split", { direction: "right", target_pane_id: paneId, focus: true });
      })();
    },
    onSplitDown: (tabId) => {
      if (!requireConnected()) return;
      void (async () => {
        const paneId = await focusedPaneIdForTabAction(tabId);
        if (paneId) void api("pane.split", { direction: "down", target_pane_id: paneId, focus: true });
      })();
    },
    onToggleZoom: (tabId) => {
      if (!requireConnected()) return;
      void (async () => {
        const paneId = await focusedPaneIdForTabAction(tabId);
        if (paneId) void api("pane.zoom", { pane_id: paneId });
      })();
    },
    onClosePane: (tabId) => {
      if (!requireConnected()) return;
      void (async () => {
        const paneId = await focusedPaneIdForTabAction(tabId);
        if (paneId) void api("pane.close", { pane_id: paneId });
      })();
    },
  });
}

/** The overflow chevron's "every tab, with its status dot" modal (spec §6
 * "Overflow"). Finding #16: this used to exist twice -- once here (used,
 * but with no status dot) and once as `TabCallbacks.onShowAllTabs` (which
 * had the status dot, but `renderTabStrip` never actually called it). One
 * function, used from the one real call site below. */
function openAllTabsModal(tabs: readonly RawTab[]): void {
  openModal("All Tabs", (body) => {
    for (const tab of tabs) {
      const row = document.createElement("div");
      row.className = "modal-shortcut-row";
      row.appendChild(createStatusDot(tab.agent_status));
      row.append(tab.label);
      row.addEventListener("click", () => {
        if (!requireConnected()) return;
        void api("tab.focus", { tab_id: tab.tab_id });
      });
      body.appendChild(row);
    }
  });
}

export function wireTabStripControls(): void {
  tabPlusEl.addEventListener("click", () => {
    if (!requireConnected()) return;
    void api("tab.create", { workspace_id: appState.snapshot?.focused_workspace_id ?? undefined, focus: true });
  });
  tabOverflowEl.addEventListener("click", () => openAllTabsModal(focusedWorkspaceTabs()));
  // Finding #11 "Tab overflow: wheel scrolls strip horizontally" (spec
  // §6): a plain vertical wheel gesture over the horizontally-overflowing
  // strip otherwise does nothing (there is nothing above/below it to
  // scroll). Wired once, here, rather than inside `renderTabStrip` (called
  // on every snapshot) to avoid accumulating a fresh listener on every
  // render.
  tabListEl.addEventListener("wheel", (event) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    tabListEl.scrollLeft += event.deltaY;
  });
}
