import { describe, expect, it } from "vitest";
import type { AgentRow } from "../../src/agents";
import { sortAgents } from "../../src/agents";

function agent(overrides: Partial<AgentRow>): AgentRow {
  return {
    pane_id: "w1:p1",
    workspace_id: "w1",
    tab_id: "w1:t1",
    agent_status: "idle",
    state_change_seq: 0,
    ...overrides,
  };
}

describe("sortAgents", () => {
  it("orders by status priority: blocked > working > done > idle > unknown", () => {
    const input = [
      agent({ pane_id: "unknown", agent_status: "unknown", state_change_seq: 1 }),
      agent({ pane_id: "idle", agent_status: "idle", state_change_seq: 1 }),
      agent({ pane_id: "done", agent_status: "done", state_change_seq: 1 }),
      agent({ pane_id: "working", agent_status: "working", state_change_seq: 1 }),
      agent({ pane_id: "blocked", agent_status: "blocked", state_change_seq: 1 }),
    ];
    const sorted = sortAgents(input).map((a) => a.pane_id);
    expect(sorted).toEqual(["blocked", "working", "done", "idle", "unknown"]);
  });

  it("breaks ties within the same status by state_change_seq descending", () => {
    const input = [
      agent({ pane_id: "older", agent_status: "working", state_change_seq: 5 }),
      agent({ pane_id: "newer", agent_status: "working", state_change_seq: 9 }),
      agent({ pane_id: "oldest", agent_status: "working", state_change_seq: 1 }),
    ];
    const sorted = sortAgents(input).map((a) => a.pane_id);
    expect(sorted).toEqual(["newer", "older", "oldest"]);
  });

  it("does not mutate the input array", () => {
    const input = [agent({ pane_id: "a", state_change_seq: 1 }), agent({ pane_id: "b", state_change_seq: 2 })];
    const originalOrder = input.map((a) => a.pane_id);
    sortAgents(input);
    expect(input.map((a) => a.pane_id)).toEqual(originalOrder);
  });

  it("an empty list sorts to an empty list", () => {
    expect(sortAgents([])).toEqual([]);
  });
});
