import { describe, expect, it } from "vitest";
import { TabMruTracker } from "../../../src/workspace/tabMru";

describe("TabMruTracker", () => {
  it("has no previous tab before anything is recorded", () => {
    const tracker = new TabMruTracker();
    expect(tracker.previousTabId()).toBeUndefined();
  });

  it("a sequence of distinct tabs: previous is always the one before the current head", () => {
    const tracker = new TabMruTracker();
    tracker.record("a");
    expect(tracker.previousTabId()).toBeUndefined(); // only one ever recorded
    tracker.record("b");
    expect(tracker.previousTabId()).toBe("a");
    tracker.record("c");
    expect(tracker.previousTabId()).toBe("b");
  });

  it("re-recording the same (already-current) tab is ignored, not pushed to the front", () => {
    const tracker = new TabMruTracker();
    tracker.record("a");
    tracker.record("b");
    expect(tracker.previousTabId()).toBe("a");
    tracker.record("b"); // no real change
    expect(tracker.previousTabId()).toBe("a");
  });

  it("toggling back and forth between two tabs keeps swapping previous/current", () => {
    const tracker = new TabMruTracker();
    tracker.record("a");
    tracker.record("b");
    expect(tracker.previousTabId()).toBe("a");
    tracker.record("a"); // toggled back
    expect(tracker.previousTabId()).toBe("b");
    tracker.record("b"); // toggled again
    expect(tracker.previousTabId()).toBe("a");
  });

  it("focusing a third tab drops the oldest, keeping only the last two distinct ids", () => {
    const tracker = new TabMruTracker();
    tracker.record("a");
    tracker.record("b");
    tracker.record("c");
    expect(tracker.previousTabId()).toBe("b"); // "a" fell off
  });

  it("null (nothing focused) is ignored", () => {
    const tracker = new TabMruTracker();
    tracker.record("a");
    tracker.record("b");
    tracker.record(null);
    expect(tracker.previousTabId()).toBe("a");
  });

  it("re-recording a tab that was the *previous* one (not current) moves it back to current", () => {
    const tracker = new TabMruTracker();
    tracker.record("a");
    tracker.record("b");
    tracker.record("c");
    // Stack is now [c, b] ("a" fell off already).
    tracker.record("b");
    expect(tracker.previousTabId()).toBe("c");
  });

  // Whether the previous tab still *exists* is the caller's job (it holds
  // the live snapshot) -- this tracker only ever knows the ids it was fed.
  it("does not itself know about a vanished tab: previousTabId still returns the last id recorded", () => {
    const tracker = new TabMruTracker();
    tracker.record("a");
    tracker.record("b");
    expect(tracker.previousTabId()).toBe("a");
  });
});
