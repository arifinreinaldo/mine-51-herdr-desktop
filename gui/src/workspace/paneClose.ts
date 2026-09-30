import { agentDisplayName } from "../agentText";
import type { RawAgent, RawPane, RawTab } from "../appTypes";
import { workspaceClosedByTabClose } from "./lastTab";

export type PaneCloseDecision =
  | { kind: "close" }
  | { kind: "confirmAgent"; agentName: string; status: "working" | "blocked" }
  | { kind: "closeTab"; tabId: string };

export interface PaneCloseSnapshot {
  panes: readonly Pick<RawPane, "pane_id" | "tab_id">[];
  tabs: readonly Pick<RawTab, "tab_id" | "workspace_id">[];
  agents: readonly RawAgent[];
}

/** What closing `paneId` should do. herdr closes the workspace when the last
 * pane of the last tab closes (`src/app/api/panes.rs`), so that case goes
 * through the tab-close confirm; a working or blocked agent confirms first. */
export function paneCloseDecision(paneId: string, snapshot: PaneCloseSnapshot): PaneCloseDecision {
  const pane = snapshot.panes.find((p) => p.pane_id === paneId);
  if (!pane) return { kind: "close" };
  const siblings = snapshot.panes.filter((p) => p.tab_id === pane.tab_id).length;
  if (siblings <= 1 && workspaceClosedByTabClose(snapshot.tabs, pane.tab_id) !== null) {
    return { kind: "closeTab", tabId: pane.tab_id };
  }
  const agent = snapshot.agents.find((a) => a.pane_id === paneId);
  if (agent && (agent.agent_status === "working" || agent.agent_status === "blocked")) {
    return { kind: "confirmAgent", agentName: agentDisplayName(agent), status: agent.agent_status };
  }
  return { kind: "close" };
}

/** The confirm body line. */
export function paneCloseDetail(agentName: string, status: "working" | "blocked"): string {
  return status === "working"
    ? `${agentName} is working. Closing the pane stops it.`
    : `${agentName} is waiting for your input. Closing the pane stops it.`;
}
