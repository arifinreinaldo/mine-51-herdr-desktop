import { agentDisplayName, agentTaskTitle } from "./agentText";
// Status bar: agent counts (with the agent popover), connection
// indicator, and the usage item (finding #16 extraction from `main.ts`).

import type { AgentRow } from "./agents";
import { sortAgents } from "./agents";
import { api } from "./appApi";
import { requireConnected } from "./appConnectionGuard";
import { overlayRoot, statusAgentCountsEl, statusConnectionEl, statusUsageEl } from "./appDom";
import { currentThemeDef, tabLabel, workspaceLabel } from "./appLookups";
import { appState, highlightCards, hoveredHighlightPaneIds, persistSettings, statusAge } from "./appState";
import { resolveWorkspacePaletteColor } from "./themes/tokens";
import {
  formatAsOfClock,
  openAgentPopover,
  refreshOpenAgentPopover,
  renderAgentCounts,
  renderConnectionStatus,
  renderUsageStatusItem,
  type AgentPopoverCallbacks,
  type AgentCounts,
  type AgentPopoverRow,
  type OpenAgentPopoverOptions,
} from "./ui/statusbar";
import type { UsageState as FormatUsageState } from "./usage";

function computeAgentCounts(): AgentCounts {
  const counts: AgentCounts = { working: 0, blocked: 0, done: 0, idle: 0 };
  for (const agent of appState.snapshot?.agents ?? []) {
    if (agent.agent_status in counts) counts[agent.agent_status as keyof AgentCounts]++;
  }
  return counts;
}

function agentPopoverRows(): AgentPopoverRow[] {
  const rows = (appState.snapshot?.agents ?? []).map((a) => ({
    pane_id: a.pane_id,
    workspace_id: a.workspace_id,
    tab_id: a.tab_id,
    workspace_label: workspaceLabel(a.workspace_id),
    tab_label: tabLabel(a.tab_id),
    agent_status: a.agent_status,
    agentName: agentDisplayName(a),
    title: agentTaskTitle(a),
    colorHex: (() => {
      const index = appState.settings.workspaceColors[a.workspace_id];
      return index === undefined ? undefined : resolveWorkspacePaletteColor(index, currentThemeDef().colors);
    })(),
  }));
  if (appState.settings.agentSort === "priority") {
    return sortAgents(rows as (AgentPopoverRow & AgentRow)[]);
  }
  const order = appState.snapshot?.agent_order ?? [];
  return [...rows].sort((a, b) => order.indexOf(a.pane_id) - order.indexOf(b.pane_id));
}

export async function focusAgentSequence(row: { workspace_id: string; tab_id: string; pane_id: string }): Promise<void> {
  await api("workspace.focus", { workspace_id: row.workspace_id });
  await api("tab.focus", { tab_id: row.tab_id });
  await api("pane.focus", { pane_id: row.pane_id });
}

/** Shared between the initial `openAgentPopover` call and (finding #2) a
 * background `refreshOpenAgentPopover` call -- kept as one function so the
 * two never drift out of sync on what the popover actually shows. */
function agentPopoverRenderOptions(): OpenAgentPopoverOptions {
  return {
    sortMode: appState.settings.agentSort,
    highlightCards: highlightCards.list(),
    highlightRowFor: (paneId) => agentPopoverRows().find((r) => r.pane_id === paneId),
    pinned: appState.settings.agentListPinned,
    ageMsFor: (paneId) => statusAge.ageMs(paneId, Date.now()),
    anchor: statusAgentCountsEl,
  };
}

/** Shared between the initial `openAgentPopover` call and (finding #2) a
 * background `refreshOpenAgentPopover` call -- see
 * `agentPopoverRenderOptions`. */
function agentPopoverCallbacks(): AgentPopoverCallbacks {
  return {
    onFocusRow: (row) => {
      // MINOR guard (finding #6): a row click focuses that workspace/tab/
      // pane via three chained API calls -- must not fire while herdr is
      // not connected, same as every other sidebar/tab-strip click.
      if (!requireConnected()) return;
      appState.agentPopoverCloser?.();
      void focusAgentSequence(row);
    },
    onToggleSort: () => {
      appState.settings.agentSort = appState.settings.agentSort === "priority" ? "server_order" : "priority";
      persistSettings();
      openOrRefreshAgentPopover();
    },
    onHighlightHoverChange: (paneId, hovering) => {
      if (hovering) hoveredHighlightPaneIds.add(paneId);
      else hoveredHighlightPaneIds.delete(paneId);
    },
    // UX pass 1 spec §3 "Pinnable agent list": toggling on keeps the
    // popover open (re-rendered so the header icon flips to "pinned");
    // toggling off is one of the explicit ways to close it.
    onTogglePin: () => {
      appState.settings.agentListPinned = !appState.settings.agentListPinned;
      persistSettings();
      if (appState.settings.agentListPinned) {
        openOrRefreshAgentPopover();
      } else {
        appState.agentPopoverCloser?.();
      }
    },
    // Finding #11 "closer reset so Ctrl+Shift+A always toggles": fires
    // no matter how the popover actually closed (a row click, Esc, an
    // outside click, or the auto-hide timeout below), unlike the prior
    // code's manual reset only in `onFocusRow`.
    onClose: () => {
      appState.agentPopoverCloser = null;
    },
    // MINOR (finding #5): only wired into `openOverlay` while pinned (see
    // `ui/statusbar.ts`'s `openAgentPopover`) -- reopens the pinned list
    // once whatever superseded it (a menu, a hover popover, a confirm)
    // itself finishes closing. Re-checks the setting at that later point,
    // in case the user unpinned it in the meantime.
    onSupersededReopen: () => {
      if (appState.settings.agentListPinned) openOrRefreshAgentPopover();
    },
  };
}

export function openOrRefreshAgentPopover(autoOpened?: boolean): void {
  appState.agentPopoverCloser?.();
  if (autoOpened !== undefined) appState.agentPopoverAutoOpened = autoOpened;
  appState.agentPopoverCloser = openAgentPopover(
    overlayRoot,
    agentPopoverRows(),
    agentPopoverRenderOptions(),
    agentPopoverCallbacks(),
  );
}

/** UX pass 1 spec §2 "refresh": re-renders the open agent popover's rows in
 * place (fresh ages, snapshot-driven changes) without disposing/reopening
 * it and without stealing focus -- a no-op when no popover is open, or
 * while the user's focus is already inside it. Called on the 30s
 * age-refresh tick and after every snapshot (finding #2). */
export function refreshAgentPopoverIfOpen(): void {
  if (!appState.agentPopoverCloser) return;
  refreshOpenAgentPopover(overlayRoot, agentPopoverRows(), agentPopoverRenderOptions(), agentPopoverCallbacks());
}

/** Finding #14 "agent-count click scrolls to and highlights that status
 * group in the popover" (spec §7 "a click opens the agent popover,
 * filtered to nothing; it only scrolls to that status group"). */
function scrollAgentPopoverToStatusGroup(status: keyof AgentCounts): void {
  const popover = overlayRoot.querySelector<HTMLElement>(".agent-popover");
  if (!popover) return;
  if (status === "idle") {
    // Idle rows sit behind the summary row: open it first.
    const summary = popover.querySelector<HTMLElement>(".agent-popover__idle-summary");
    if (summary?.getAttribute("aria-expanded") === "false") summary.click();
  }
  const selector =
    status === "idle"
      ? '.agent-row[data-status="idle"], .agent-row[data-status="unknown"]'
      : `.agent-row[data-status="${status}"]`;
  const row = popover.querySelector<HTMLElement>(selector);
  if (!row) return;
  row.scrollIntoView({ block: "nearest" });
  row.classList.add("is-scroll-highlight");
  window.setTimeout(() => row.classList.remove("is-scroll-highlight"), 1500);
}

export function renderStatusBarNow(): void {
  // UX pass 1 spec §4 "Honest disconnected state": the counts dim and gain
  // an "as of HH:MM" suffix (the last snapshot's time) while not connected.
  // Finding #8: omit the "as of HH:MM" suffix entirely when no snapshot has
  // ever been received yet (`lastSnapshotAt === null`) -- falling back to
  // `Date.now()` there would label the suffix with the current time, not
  // "the last snapshot", which is not what it claims to be.
  const disconnected =
    appState.lastConnectionStatus === "connected"
      ? null
      : { asOfLabel: appState.lastSnapshotAt !== null ? formatAsOfClock(appState.lastSnapshotAt) : "" };
  renderAgentCounts(
    statusAgentCountsEl,
    computeAgentCounts(),
    (status) => {
      // MINOR (finding #4): clicking the counts while the *pinned* list is
      // already open closes it -- a toggle -- rather than just refreshing
      // it in place. An unpinned popover keeps the prior behaviour
      // (re-open/re-scroll to the clicked group), since it isn't "the
      // persistent list" the finding is about.
      if (appState.agentPopoverCloser && appState.settings.agentListPinned) {
        appState.agentPopoverCloser();
        return;
      }
      openOrRefreshAgentPopover(false);
      scrollAgentPopoverToStatusGroup(status);
    },
    disconnected,
  );
  renderConnectionStatus(statusConnectionEl, appState.lastConnectionStatus);
}

export function renderUsageBarNow(): void {
  const state: FormatUsageState = {
    five_hour: appState.usagePayload.five_hour,
    seven_day: appState.usagePayload.seven_day,
    captured_at: appState.usagePayload.captured_at,
    status: appState.usagePayload.status,
  };
  renderUsageStatusItem(statusUsageEl, overlayRoot, state, Math.floor(Date.now() / 1000));
}

const USAGE_REFRESH_INTERVAL_MS = 30_000;
export function wireUsageRefresh(): void {
  window.setInterval(renderUsageBarNow, USAGE_REFRESH_INTERVAL_MS);
}
