// Sidebar agent list ordering (spec §6 "Sidebar"): "Agents list sorted by
// priority: Blocked > Working > Done > Idle > Unknown, then by
// state_change_seq descending (most recent first)."
//
// Field names match the wire JSON verbatim (`ClientShellAgent`,
// `src/protocol/wire.rs:1075-1093`) since this operates directly on the
// parsed `ClientShellSnapshot` JSON -- no camelCase remapping layer.

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface AgentRow {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  agent_status: AgentStatus;
  state_change_seq: number;
}

/** Lower sorts first. Matches spec §6's Blocked > Working > Done > Idle > Unknown. */
export const AGENT_STATUS_PRIORITY: Record<AgentStatus, number> = {
  blocked: 0,
  working: 1,
  done: 2,
  idle: 3,
  unknown: 4,
};

/**
 * Sorts agents by status priority, then by `state_change_seq` descending
 * (most recently changed first) within the same status. Stubbed:
 * ordering logic is left for the implementer.
 */
export function sortAgents<T extends AgentRow>(_agents: T[]): T[] {
  throw new Error("not implemented: sortAgents");
}
