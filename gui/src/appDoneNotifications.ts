import { agentDisplayName, agentTaskTitle } from "./agentText";
// Agent-done transition detection wiring: the in-app highlight-card path
// (window focused) and the desktop-toast path (window unfocused) -- spec
// §7, finding #16 extraction from `main.ts`.

import { invokeSafe } from "./appApi";
import { openOrRefreshAgentPopover } from "./appStatusBar";
import { tabLabel, workspaceLabel } from "./appLookups";
import { appState, doneToastDedup, highlightCards, hoveredHighlightPaneIds, seenDoneTabs } from "./appState";
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

export function handleDoneTransitions(all: AgentForDetection[]): void {
  // A done in a tab the user is already looking at (window focused, tab in
  // front) is seen at once: no card, no popover, and it counts as idle.
  const transitions = all.filter((t) => !seenDoneTabs.isSeen(t.tab_id));
  if (transitions.length === 0) return;
  const now = Date.now();
  for (const t of transitions) highlightCards.push(t, now);

  if (appState.windowFocused) {
    openOrRefreshAgentPopover(true);
    window.setTimeout(() => {
      // Finding #11: hover pauses this, and it only ever auto-closes the
      // popover this same done-transition auto-opened -- never one the
      // user has since taken over manually. Pruning stale highlight cards
      // always happens; UX pass 1 spec §3 only exempts the *close* while
      // pinned ("does not auto-hide").
      highlightCards.prune(Date.now(), hoveredHighlightPaneIds);
      if (appState.settings.agentListPinned) return;
      if (highlightCards.list().length === 0 && appState.agentPopoverAutoOpened) appState.agentPopoverCloser?.();
    }, 8100);
  } else {
    for (const t of transitions) {
      // P1 #13: the dedup key here is the same one `handleSemanticNotification`
      // below checks, so whichever source (this snapshot diff, or a
      // `SemanticNotification`) sees this exact transition first wins.
      if (!doneToastDedup.shouldShow(t.pane_id, t.state_change_seq)) continue;
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

/** Raw `ServerMessage::SemanticNotification` payload shape (JSON field names
 * verbatim, no `rename_all` on the Rust side -- `gui/crates/herdr-wire/src/
 * server.rs:344-363`). */
export interface RawSemanticNotification {
  kind: "NeedsAttention" | "Finished" | "UpdateInstalled" | "Custom";
  title: string;
  body: string | null;
  agent: string | null;
  workspace_id: string | null;
  tab_id: string | null;
  pane_id: string | null;
}

/** `ServerMessage::SemanticNotification` (P1 #13): a second source for the
 * same done desktop-toast the snapshot detector already drives above,
 * de-duplicated against it by pane id and `state_change_seq`
 * (`doneToastDedup`). Only `kind: "Finished"` maps to the done toast; other
 * kinds aren't this item's concern. Only relevant while the window is
 * unfocused -- while focused, the snapshot-driven in-app highlight card
 * already covers it, and this never opens a second one. */
export function handleSemanticNotification(notification: RawSemanticNotification): void {
  if (notification.kind !== "Finished" || appState.windowFocused) return;
  const paneId = notification.pane_id;
  if (!paneId) return;
  const agent = appState.snapshot?.agents.find((a) => a.pane_id === paneId);
  const seq = agent?.state_change_seq ?? 0;
  if (!doneToastDedup.shouldShow(paneId, seq)) return;
  void invokeSafe("notify_agent_done", {
    workspace: workspaceLabel(notification.workspace_id ?? ""),
    tab: tabLabel(notification.tab_id ?? ""),
    agent: notification.agent ?? agentDisplayInfo(paneId).agentName,
    title: notification.body ?? notification.title,
  });
}
