import { describe, expect, it } from "vitest";
import { SeenDoneTabsTracker, seenTrackingInput } from "../../../src/notifications/seenDoneTabs";

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

  it("effectiveStatus shows a seen done tab as idle and leaves everything else alone", () => {
    const tracker = new SeenDoneTabsTracker();
    tracker.update([
      { tab_id: "seen", agent_status: "done", focused: true },
      { tab_id: "unseen", agent_status: "done", focused: false },
      { tab_id: "busy", agent_status: "working", focused: true },
    ]);
    expect(tracker.effectiveStatus("seen", "done")).toBe("idle");
    expect(tracker.effectiveStatus("unseen", "done")).toBe("done");
    expect(tracker.effectiveStatus("busy", "working")).toBe("working");
    expect(tracker.effectiveStatus("seen", "blocked")).toBe("blocked");
  });

  it("a seen tab in a background workspace stays seen while another workspace is in front", () => {
    const tracker = new SeenDoneTabsTracker();
    const tabs = [
      { tab_id: "a1", workspace_id: "wA", agent_status: "done" as const, focused: true },
      { tab_id: "b1", workspace_id: "wB", agent_status: "idle" as const, focused: true },
    ];
    tracker.update(seenTrackingInput(tabs, "wA", true));
    expect(tracker.isSeen("a1")).toBe(true);
    tracker.update(seenTrackingInput(tabs, "wB", true)); // user switches to workspace B
    expect(tracker.isSeen("a1")).toBe(true);
  });
});

describe("seenTrackingInput", () => {
  const tabs = [
    { tab_id: "a1", workspace_id: "wA", agent_status: "done" as const, focused: true },
    { tab_id: "b1", workspace_id: "wB", agent_status: "done" as const, focused: true },
  ];

  it("counts only the focused tab of the focused workspace as focused", () => {
    expect(seenTrackingInput(tabs, "wA", true).map((t) => t.focused)).toEqual([true, false]);
  });

  it("counts nothing as focused while the window has no focus", () => {
    expect(seenTrackingInput(tabs, "wA", false).map((t) => t.focused)).toEqual([false, false]);
  });

  it("counts nothing as focused when no workspace is focused", () => {
    expect(seenTrackingInput(tabs, null, true).map((t) => t.focused)).toEqual([false, false]);
  });
});
