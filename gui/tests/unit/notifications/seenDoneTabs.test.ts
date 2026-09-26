import { describe, expect, it } from "vitest";
import { SeenDoneTabsTracker } from "../../../src/notifications/seenDoneTabs";

describe("SeenDoneTabsTracker", () => {
  it("a done tab starts unseen (shows the attention-calling green dot)", () => {
    const tracker = new SeenDoneTabsTracker();
    tracker.update([{ tab_id: "t1", agent_status: "done", focused: false }]);
    expect(tracker.isSeen("t1")).toBe(false);
  });

  it("focusing a done tab marks it seen", () => {
    const tracker = new SeenDoneTabsTracker();
    tracker.update([{ tab_id: "t1", agent_status: "done", focused: false }]);
    tracker.update([{ tab_id: "t1", agent_status: "done", focused: true }]);
    expect(tracker.isSeen("t1")).toBe(true);
  });

  it("stays seen after focus moves elsewhere, as long as status doesn't re-transition", () => {
    const tracker = new SeenDoneTabsTracker();
    tracker.update([{ tab_id: "t1", agent_status: "done", focused: true }]);
    tracker.update([{ tab_id: "t1", agent_status: "done", focused: false }]);
    expect(tracker.isSeen("t1")).toBe(true);
  });

  it("a fresh transition back to done un-marks it as seen", () => {
    const tracker = new SeenDoneTabsTracker();
    tracker.update([{ tab_id: "t1", agent_status: "done", focused: true }]);
    tracker.update([{ tab_id: "t1", agent_status: "working", focused: false }]);
    tracker.update([{ tab_id: "t1", agent_status: "done", focused: false }]);
    expect(tracker.isSeen("t1")).toBe(false);
  });

  it("prunes tabs that are no longer live", () => {
    const tracker = new SeenDoneTabsTracker();
    tracker.update([{ tab_id: "t1", agent_status: "done", focused: true }]);
    tracker.update([]);
    tracker.update([{ tab_id: "t1", agent_status: "done", focused: false }]);
    // t1 reappearing after having vanished starts fresh (unseen).
    expect(tracker.isSeen("t1")).toBe(false);
  });

  it("a non-done tab is never seen", () => {
    const tracker = new SeenDoneTabsTracker();
    tracker.update([{ tab_id: "t1", agent_status: "working", focused: true }]);
    expect(tracker.isSeen("t1")).toBe(false);
  });
});
