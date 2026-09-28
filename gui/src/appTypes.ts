// Raw snapshot JSON shapes (field names verbatim from `ClientShellSnapshot`)
// and the other wire-event payload shapes `main.ts` and its orchestration
// modules share. Extracted (finding #16) purely to keep `main.ts` under
// the spec's own 600-line ceiling -- these are plain data shapes, not
// behavior, so moving them is zero-risk.

import type { AgentStatus } from "./agents";

export interface RawWorktree {
  key: string;
  label: string;
  is_linked_worktree: boolean;
}

export interface RawWorkspace {
  workspace_id: string;
  label: string;
  focused: boolean;
  agent_status: AgentStatus;
  branch: string | null;
  git_ahead_behind: [number, number] | null;
  new_workspace_cwd: string;
  worktree: RawWorktree | null;
}

export interface RawTab {
  tab_id: string;
  workspace_id: string;
  label: string;
  focused: boolean;
  agent_status: AgentStatus;
}

export interface RawPane {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
  /** Terminal-parity spec P0 #5 "Terminal right-click menu": herdr's own
   * `ClientShellPane.right_click_passthrough` (`src/protocol/wire.rs:1072`),
   * already present on the JSON snapshot -- the compact binary surface
   * stream and `pane_mouse_hit` omit it (it isn't cell geometry), so the
   * right-click rule reads it from here instead. */
  right_click_passthrough: boolean;
}

export interface RawAgent {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  agent_status: AgentStatus;
  state_change_seq: number;
  display_agent: string | null;
  agent: string | null;
  name: string | null;
  title: string | null;
  terminal_title_stripped: string | null;
}

export interface RawReleaseNotes {
  version: string;
  body: string;
  preview: boolean;
}

export interface RawSnapshot {
  boot_id: string;
  focused_workspace_id: string | null;
  focused_tab_id: string | null;
  focused_pane_id: string | null;
  workspaces: RawWorkspace[];
  tabs: RawTab[];
  panes: RawPane[];
  agents: RawAgent[];
  agent_order: string[];
  update_available: string | null;
  update_install_command: string;
  latest_release_notes_available: boolean;
  release_notes: RawReleaseNotes | null;
  integration_updates_available: boolean;
}

export interface UsageEventPayload {
  five_hour: { used_pct: number; resets_at: number } | null;
  seven_day: { used_pct: number; resets_at: number } | null;
  captured_at: number | null;
  status: "ok" | "missing" | "invalid";
}
