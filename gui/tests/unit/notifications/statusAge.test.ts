// UX pass 1 spec §2 "Age" / §5 "statusAge: it records on change, ignores
// unchanged snapshots, resets on reconnect, and formats 'now', 'Nm', 'Nh',
// 'Nd'."

import { describe, expect, it } from "vitest";
import { formatAge, newestAgeMs, oldestAgeMs, StatusAgeTracker } from "../../../src/notifications/statusAge";

describe("StatusAgeTracker", () => {
  it("a pane seen for the first time has an unknown age, never '0m'", () => {
    const tracker = new StatusAgeTracker();
    tracker.update([{ pane_id: "p1", agent_status: "idle", state_change_seq: 1 }], 1000);
    expect(tracker.ageMs("p1", 1000)).toBeUndefined();
    expect(tracker.ageMs("p1", 5000)).toBeUndefined();
  });

  it("records on change (status differs from the baseline)", () => {
    const tracker = new StatusAgeTracker();
    tracker.update([{ pane_id: "p1", agent_status: "idle", state_change_seq: 1 }], 1000);
    tracker.update([{ pane_id: "p1", agent_status: "blocked", state_change_seq: 2 }], 2000);
    expect(tracker.ageMs("p1", 2000)).toBe(0);
    expect(tracker.ageMs("p1", 5000)).toBe(3000);
  });

  it("records on change (state_change_seq differs, even if status doesn't)", () => {
    const tracker = new StatusAgeTracker();
    tracker.update([{ pane_id: "p1", agent_status: "working", state_change_seq: 1 }], 1000);
    tracker.update([{ pane_id: "p1", agent_status: "working", state_change_seq: 2 }], 2000);
    expect(tracker.ageMs("p1", 2000)).toBe(0);
  });

  it("ignores unchanged snapshots -- the age keeps counting from the real change, not the last poll", () => {
    const tracker = new StatusAgeTracker();
    tracker.update([{ pane_id: "p1", agent_status: "idle", state_change_seq: 1 }], 1000);
    tracker.update([{ pane_id: "p1", agent_status: "blocked", state_change_seq: 2 }], 2000);
    tracker.update([{ pane_id: "p1", agent_status: "blocked", state_change_seq: 2 }], 10_000);
    tracker.update([{ pane_id: "p1", agent_status: "blocked", state_change_seq: 2 }], 20_000);
    expect(tracker.ageMs("p1", 20_000)).toBe(18_000); // still since t=2000, not t=10_000
  });

  it("prunes panes no longer live", () => {
    const tracker = new StatusAgeTracker();
    tracker.update([{ pane_id: "p1", agent_status: "idle", state_change_seq: 1 }], 1000);
    tracker.update([{ pane_id: "p1", agent_status: "blocked", state_change_seq: 2 }], 2000);
    tracker.update([], 3000);
    tracker.update([{ pane_id: "p1", agent_status: "blocked", state_change_seq: 2 }], 4000);
    // p1 reappears as a "new" pane (its old baseline was pruned), so its
    // age is unknown again until a further real change.
    expect(tracker.ageMs("p1", 4000)).toBeUndefined();
  });

  it("resets on reconnect: the unknown age shows nothing, not '0m'", () => {
    const tracker = new StatusAgeTracker();
    tracker.update([{ pane_id: "p1", agent_status: "idle", state_change_seq: 1 }], 1000);
    tracker.update([{ pane_id: "p1", agent_status: "blocked", state_change_seq: 2 }], 2000);
    expect(tracker.ageMs("p1", 2000)).toBe(0);

    tracker.reset();
    expect(tracker.ageMs("p1", 2000)).toBeUndefined();

    // The next update only re-seeds the baseline -- it must not itself
    // report an age until a further real change is observed.
    tracker.update([{ pane_id: "p1", agent_status: "blocked", state_change_seq: 2 }], 3000);
    expect(tracker.ageMs("p1", 3000)).toBeUndefined();
  });
});

describe("formatAge", () => {
  it("formats unknown as ''", () => {
    expect(formatAge(undefined)).toBe("");
  });

  it("formats under a minute as 'now'", () => {
    expect(formatAge(0)).toBe("now");
    expect(formatAge(59_999)).toBe("now");
  });

  it("formats minutes, floored", () => {
    expect(formatAge(60_000)).toBe("1m");
    expect(formatAge(119_999)).toBe("1m");
    expect(formatAge(59 * 60_000)).toBe("59m");
  });

  it("formats hours once minutes reach 60", () => {
    expect(formatAge(60 * 60_000)).toBe("1h");
    expect(formatAge(23 * 60 * 60_000)).toBe("23h");
  });

  it("formats days once hours reach 24", () => {
    expect(formatAge(24 * 60 * 60_000)).toBe("1d");
    expect(formatAge(3 * 24 * 60 * 60_000)).toBe("3d");
  });
});

describe("oldestAgeMs / newestAgeMs", () => {
  const ages: Record<string, number | undefined> = { a: 100, b: 500, c: undefined };
  const ageMsFor = (id: string) => ages[id];

  it("oldestAgeMs picks the largest known age, ignoring unknowns", () => {
    expect(oldestAgeMs(["a", "b", "c"], ageMsFor)).toBe(500);
  });

  it("newestAgeMs picks the smallest known age, ignoring unknowns", () => {
    expect(newestAgeMs(["a", "b", "c"], ageMsFor)).toBe(100);
  });

  it("both return undefined when nothing has a known age", () => {
    expect(oldestAgeMs(["c"], ageMsFor)).toBeUndefined();
    expect(newestAgeMs([], ageMsFor)).toBeUndefined();
  });
});
