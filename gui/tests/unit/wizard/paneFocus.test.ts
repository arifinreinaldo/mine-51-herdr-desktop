// @vitest-environment jsdom
//
// Finding #6 "typing into the wrong pane": `waitForFocusedPaneId` is the
// one helper both the provider install/sign-in flow and the first-
// workspace "Start <provider> here" flow rely on to be sure they're
// typing into the pane that actually just opened, never a stale one.
// jsdom is needed because the helper uses `window.setTimeout`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../../src/appState";
import { waitForFocusedPaneId } from "../../../src/wizard/paneFocus";

function setFocusedPaneId(id: string | null): void {
  appState.snapshot = { ...(appState.snapshot ?? {}), focused_pane_id: id } as typeof appState.snapshot;
}

describe("waitForFocusedPaneId", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appState.snapshot = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves as soon as a different, non-empty pane id appears", async () => {
    setFocusedPaneId("old-pane");
    const promise = waitForFocusedPaneId("old-pane");
    await vi.advanceTimersByTimeAsync(100);
    setFocusedPaneId("new-pane");
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toBe("new-pane");
  });

  it("returns null on timeout when the focused pane id never changes (unchanged id -> null)", async () => {
    setFocusedPaneId("same-pane");
    const promise = waitForFocusedPaneId("same-pane");
    await vi.advanceTimersByTimeAsync(2100);
    expect(await promise).toBeNull();
  });

  it("returns null on timeout when no pane is ever focused at all", async () => {
    setFocusedPaneId(null);
    const promise = waitForFocusedPaneId(null);
    await vi.advanceTimersByTimeAsync(2100);
    expect(await promise).toBeNull();
  });

  it("never returns the previous id, even as the very last poll before the deadline", async () => {
    setFocusedPaneId("stale-pane");
    const promise = waitForFocusedPaneId("stale-pane");
    // Right up to (but not past) the 2s deadline, still the same id.
    await vi.advanceTimersByTimeAsync(1900);
    expect(await Promise.race([promise, Promise.resolve("pending")])).toBe("pending");
    await vi.advanceTimersByTimeAsync(200);
    expect(await promise).toBeNull();
  });
});
