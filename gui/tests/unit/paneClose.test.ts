import { describe, expect, it } from "vitest";
import type { RawAgent } from "../../src/appTypes";
import { paneCloseDecision, paneCloseDetail, type PaneCloseSnapshot } from "../../src/workspace/paneClose";

function agent(pane_id: string, agent_status: RawAgent["agent_status"], extra: Partial<RawAgent> = {}): RawAgent {
  return {
    pane_id,
    workspace_id: "w1",
    tab_id: "w1:t1",
    agent_status,
    state_change_seq: 1,
    display_agent: "claude",
    agent: "claude",
    name: null,
    title: null,
    terminal_title_stripped: null,
    ...extra,
  };
}

function snap(over: Partial<PaneCloseSnapshot> = {}): PaneCloseSnapshot {
  return {
    panes: [
      { pane_id: "p1", tab_id: "w1:t1" },
      { pane_id: "p2", tab_id: "w1:t1" },
    ],
    tabs: [
      { tab_id: "w1:t1", workspace_id: "w1" },
      { tab_id: "w1:t2", workspace_id: "w1" },
    ],
    agents: [],
    ...over,
  };
}

describe("paneCloseDecision", () => {
  it("confirms a working agent in a split tab", () => {
    expect(paneCloseDecision("p1", snap({ agents: [agent("p1", "working")] }))).toEqual({
      kind: "confirmAgent",
      agentName: "claude",
      status: "working",
    });
  });
  it("confirms a blocked agent", () => {
    expect(paneCloseDecision("p1", snap({ agents: [agent("p1", "blocked")] }))).toEqual({
      kind: "confirmAgent",
      agentName: "claude",
      status: "blocked",
    });
  });
  it("closes at once for idle, done, unknown and no agent", () => {
    for (const status of ["idle", "done", "unknown"] as const) {
      expect(paneCloseDecision("p1", snap({ agents: [agent("p1", status)] }))).toEqual({ kind: "close" });
    }
    expect(paneCloseDecision("p1", snap())).toEqual({ kind: "close" });
  });
  it("ignores an agent that runs in another pane", () => {
    expect(paneCloseDecision("p1", snap({ agents: [agent("p2", "working")] }))).toEqual({ kind: "close" });
  });
  it("routes the only pane of the only tab to closeTab, even with a working agent", () => {
    const s = snap({
      panes: [{ pane_id: "p1", tab_id: "w1:t1" }],
      tabs: [{ tab_id: "w1:t1", workspace_id: "w1" }],
      agents: [agent("p1", "working")],
    });
    expect(paneCloseDecision("p1", s)).toEqual({ kind: "closeTab", tabId: "w1:t1" });
  });
  it("confirms the agent for the only pane of one of two tabs", () => {
    const s = snap({
      panes: [{ pane_id: "p1", tab_id: "w1:t1" }],
      agents: [agent("p1", "working")],
    });
    expect(paneCloseDecision("p1", s)).toEqual({ kind: "confirmAgent", agentName: "claude", status: "working" });
  });
  it("closes for an unknown pane id", () => {
    expect(paneCloseDecision("nope", snap())).toEqual({ kind: "close" });
  });
});

describe("paneCloseDetail", () => {
  it("words both statuses", () => {
    expect(paneCloseDetail("claude", "working")).toBe("claude is working. Closing the pane stops it.");
    expect(paneCloseDetail("claude", "blocked")).toBe("claude is waiting for your input. Closing the pane stops it.");
  });
});
