// Tab-level "seen done" tracking (spec phase1.5 §6 "Attention markers"):
// "A Done tab dot stays green until the user focuses that tab. That 'seen'
// state is client-side."
//
// A tab's dot shows green while its `agent_status` is `done` and it has
// not been focused since that transition. Focusing it marks it "seen"
// (dot no longer calls attention); a fresh transition back to `done` later
// un-marks it, so it calls attention again.

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface TabForSeenTracking {
  tab_id: string;
  agent_status: AgentStatus;
  focused: boolean;
}

export class SeenDoneTabsTracker {
  private seen = new Set<string>();
  private lastStatus = new Map<string, AgentStatus>();

  /** Call once per snapshot with every live tab. Prunes ids no longer
   * live, un-marks a fresh done transition as unseen, and marks a
   * currently-focused done tab as seen. */
  update(tabs: readonly TabForSeenTracking[]): void {
    const liveIds = new Set(tabs.map((t) => t.tab_id));
    for (const id of this.seen) {
      if (!liveIds.has(id)) this.seen.delete(id);
    }
    for (const id of this.lastStatus.keys()) {
      if (!liveIds.has(id)) this.lastStatus.delete(id);
    }

    for (const tab of tabs) {
      const previousStatus = this.lastStatus.get(tab.tab_id);
      if (tab.agent_status === "done" && previousStatus !== "done") {
        this.seen.delete(tab.tab_id);
      }
      if (tab.focused && tab.agent_status === "done") {
        this.seen.add(tab.tab_id);
      }
      this.lastStatus.set(tab.tab_id, tab.agent_status);
    }
  }

  isSeen(tabId: string): boolean {
    return this.seen.has(tabId);
  }
}
