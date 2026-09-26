import { describe, expect, it } from "vitest";
import {
  DoneTransitionDetector,
  HighlightCardStack,
  type AgentForDetection,
} from "../../../src/notifications/doneDetector";

function agent(overrides: Partial<AgentForDetection>): AgentForDetection {
  return {
    pane_id: "p1",
    workspace_id: "w1",
    tab_id: "t1",
    agent_status: "working",
    state_change_seq: 1,
    ...overrides,
  };
}

describe("DoneTransitionDetector", () => {
  it("never fires on the very first snapshot (no baseline yet)", () => {
    const detector = new DoneTransitionDetector();
    const transitions = detector.diff([agent({ agent_status: "done", state_change_seq: 5 })]);
    expect(transitions).toEqual([]);
  });

  it("fires when an agent transitions to done with a higher seq", () => {
    const detector = new DoneTransitionDetector();
    detector.diff([agent({ agent_status: "working", state_change_seq: 1 })]);
    const transitions = detector.diff([agent({ agent_status: "done", state_change_seq: 2 })]);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].pane_id).toBe("p1");
  });

  it("does not fire if the seq did not increase", () => {
    const detector = new DoneTransitionDetector();
    detector.diff([agent({ agent_status: "working", state_change_seq: 5 })]);
    const transitions = detector.diff([agent({ agent_status: "done", state_change_seq: 5 })]);
    expect(transitions).toEqual([]);
  });

  it("does not fire from done to done", () => {
    const detector = new DoneTransitionDetector();
    detector.diff([agent({ agent_status: "done", state_change_seq: 1 })]);
    const transitions = detector.diff([agent({ agent_status: "done", state_change_seq: 2 })]);
    expect(transitions).toEqual([]);
  });

  it("ignores an agent whose pane has disappeared", () => {
    const detector = new DoneTransitionDetector();
    detector.diff([agent({ pane_id: "p1", agent_status: "blocked", state_change_seq: 1 })]);
    // p1 is gone entirely from the next snapshot.
    const transitions = detector.diff([]);
    expect(transitions).toEqual([]);
  });

  it("resetBaseline() takes no snapshot and never reports a transition on the snapshot right after it (finding #8)", () => {
    const detector = new DoneTransitionDetector();
    detector.diff([agent({ agent_status: "working", state_change_seq: 1 })]);
    detector.resetBaseline();
    // The first diff after a reset only re-seeds the baseline -- it must
    // never fire, even though "done" differs from the pre-reset "working".
    const transitions = detector.diff([agent({ agent_status: "done", state_change_seq: 2 })]);
    expect(transitions).toEqual([]);
  });

  it("resets cleanly on a boot_id change scenario: the snapshot right after a reset only seeds; a later genuine transition still fires (finding #8)", () => {
    const detector = new DoneTransitionDetector();
    detector.diff([agent({ agent_status: "blocked", state_change_seq: 1 })]);
    detector.resetBaseline();
    const firstAfterReset = detector.diff([agent({ agent_status: "working", state_change_seq: 2 })]);
    expect(firstAfterReset).toEqual([]);
    const transitions = detector.diff([agent({ agent_status: "done", state_change_seq: 3 })]);
    expect(transitions).toHaveLength(1);
  });

  it("resetBaseline is idempotent and safe to call with no prior baseline", () => {
    const detector = new DoneTransitionDetector();
    detector.resetBaseline();
    detector.resetBaseline();
    const transitions = detector.diff([agent({ agent_status: "done", state_change_seq: 1 })]);
    expect(transitions).toEqual([]);
  });

  it("handles multiple agents independently by pane_id", () => {
    const detector = new DoneTransitionDetector();
    detector.diff([
      agent({ pane_id: "p1", agent_status: "working", state_change_seq: 1 }),
      agent({ pane_id: "p2", agent_status: "blocked", state_change_seq: 1 }),
    ]);
    const transitions = detector.diff([
      agent({ pane_id: "p1", agent_status: "done", state_change_seq: 2 }),
      agent({ pane_id: "p2", agent_status: "blocked", state_change_seq: 1 }),
    ]);
    expect(transitions.map((t) => t.pane_id)).toEqual(["p1"]);
  });
});

describe("HighlightCardStack", () => {
  it("caps at 3 cards, newest first", () => {
    const stack = new HighlightCardStack();
    stack.push(agent({ pane_id: "p1" }), 0);
    stack.push(agent({ pane_id: "p2" }), 1);
    stack.push(agent({ pane_id: "p3" }), 2);
    stack.push(agent({ pane_id: "p4" }), 3);
    const ids = stack.list().map((c) => c.transition.pane_id);
    expect(ids).toEqual(["p4", "p3", "p2"]);
  });

  it("auto-hides after the window elapses", () => {
    const stack = new HighlightCardStack(3, 8000);
    stack.push(agent({ pane_id: "p1" }), 0);
    stack.prune(7999);
    expect(stack.list()).toHaveLength(1);
    stack.prune(8000);
    expect(stack.list()).toHaveLength(0);
  });

  it("hover pauses the auto-hide timer", () => {
    const stack = new HighlightCardStack(3, 8000);
    stack.push(agent({ pane_id: "p1" }), 0);
    stack.prune(20000, new Set(["p1"]));
    expect(stack.list()).toHaveLength(1);
    stack.prune(20000, new Set());
    expect(stack.list()).toHaveLength(0);
  });
});
