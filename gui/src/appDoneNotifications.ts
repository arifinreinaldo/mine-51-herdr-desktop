import { agentDisplayName, agentTaskTitle } from "./agentText";
// Agent-done transition detection wiring: the in-app highlight-card path
// (window focused) and the desktop-toast path (window unfocused) -- spec
// §7, finding #16 extraction from `main.ts`.

import { invokeSafe } from "./appApi";
import { openOrRefreshAgentPopover } from "./appStatusBar";
import { tabLabel, workspaceLabel } from "./appLookups";
import { appState, highlightCards, hoveredHighlightPaneIds } from "./appState";
import type { AgentForDetection } from "./notifications/doneDetector";

export function toDetectionAgents(): AgentForDetection[] {
  return (appState.snapshot?.agents ?? []).map((a) => ({
    pane_id: a.pane_id,
    workspace_id: a.workspace_id,
    tab_id: a.tab_id,
    agent_status: a.agent_status,
    state_change_seq: a.state_change_seq,
  }));
}

/** Finding #9 "toast content": `agent = display_agent ?? name ?? "agent"`;
 * `title = title ?? terminal_title_stripped ?? ""`. Looked up from the
 * current snapshot's full `RawAgent` by pane id, since `AgentForDetection`
 * (the diff/highlight-card shape) only carries the fields the detector
 * itself needs. */
function agentDisplayInfo(paneId: string): { agentName: string; title: string } {
  const agent = appState.snapshot?.agents.find((a) => a.pane_id === paneId);
  return {
    agentName: agentDisplayName(agent),
    title: agentTaskTitle(agent) ?? "",
  };
}

export function handleDoneTransitions(transitions: AgentForDetection[]): void {
  if (transitions.length === 0) return;
  const now = Date.now();
  for (const t of transitions) highlightCards.push(t, now);

  if (appState.windowFocused) {
    openOrRefreshAgentPopover(true);
    window.setTimeout(() => {
      // Finding #11: hover pauses this, and it only ever auto-closes the
      // popover this same done-transition auto-opened -- never one the
      // user has since taken over manually.
      highlightCards.prune(Date.now(), hoveredHighlightPaneIds);
      if (highlightCards.list().length === 0 && appState.agentPopoverAutoOpened) appState.agentPopoverCloser?.();
    }, 8100);
  } else {
    for (const t of transitions) {
      const { agentName, title } = agentDisplayInfo(t.pane_id);
      void invokeSafe("notify_agent_done", {
        workspace: workspaceLabel(t.workspace_id),
        tab: tabLabel(t.tab_id),
        agent: agentName,
        title,
      });
    }
  }
}
