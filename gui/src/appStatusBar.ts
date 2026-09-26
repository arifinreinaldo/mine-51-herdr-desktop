import { agentDisplayName, agentTaskTitle } from "./agentText";
// Status bar: agent counts (with the agent popover), connection
// indicator, and the usage item (finding #16 extraction from `main.ts`).

import type { AgentRow } from "./agents";
import { sortAgents } from "./agents";
import { api } from "./appApi";
import { overlayRoot, statusAgentCountsEl, statusConnectionEl, statusUsageEl } from "./appDom";
import { currentThemeDef, tabLabel, workspaceLabel } from "./appLookups";
import { appState, highlightCards, hoveredHighlightPaneIds, persistSettings } from "./appState";
import { resolveWorkspacePaletteColor } from "./themes/tokens";
import {
  openAgentPopover,
  renderAgentCounts,
  renderConnectionStatus,
  renderUsageStatusItem,
  type AgentCounts,
  type AgentPopoverRow,
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

export function openOrRefreshAgentPopover(autoOpened?: boolean): void {
  appState.agentPopoverCloser?.();
  if (autoOpened !== undefined) appState.agentPopoverAutoOpened = autoOpened;
  appState.agentPopoverCloser = openAgentPopover(
    overlayRoot,
    agentPopoverRows(),
    {
      sortMode: appState.settings.agentSort,
      highlightCards: highlightCards.list(),
      highlightRowFor: (paneId) => agentPopoverRows().find((r) => r.pane_id === paneId),
    },
    {
      onFocusRow: (row) => {
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
      // Finding #11 "closer reset so Ctrl+Shift+A always toggles": fires
      // no matter how the popover actually closed (a row click, Esc, an
      // outside click, or the auto-hide timeout below), unlike the prior
      // code's manual reset only in `onFocusRow`.
      onClose: () => {
        appState.agentPopoverCloser = null;
      },
    },
  );
}

/** Finding #14 "agent-count click scrolls to and highlights that status
 * group in the popover" (spec §7 "a click opens the agent popover,
 * filtered to nothing; it only scrolls to that status group"). */
function scrollAgentPopoverToStatusGroup(status: keyof AgentCounts): void {
  const popover = overlayRoot.querySelector<HTMLElement>(".agent-popover");
  if (!popover) return;
  const dotClass = `status-dot--${status}`;
  const row = Array.from(popover.querySelectorAll<HTMLElement>(".agent-row")).find((el) =>
    el.querySelector(`.${dotClass}`),
  );
  if (!row) return;
  row.scrollIntoView({ block: "nearest" });
  row.classList.add("is-scroll-highlight");
  window.setTimeout(() => row.classList.remove("is-scroll-highlight"), 1500);
}

export function renderStatusBarNow(): void {
  renderAgentCounts(statusAgentCountsEl, computeAgentCounts(), (status) => {
    openOrRefreshAgentPopover(false);
    scrollAgentPopoverToStatusGroup(status);
  });
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
