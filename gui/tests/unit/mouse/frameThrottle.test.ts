import { describe, expect, it } from "vitest";
import { createFrameThrottler } from "../../../src/mouse/frameThrottle";

/** A fake `requestAnimationFrame`: captures the callback instead of
 * scheduling a real frame, and `flush()` runs it (once) on demand -- lets
 * the throttler be driven deterministically without a real animation
 * frame or DOM. */
function fakeRaf() {
  let queued: (() => void) | null = null;
  return {
    raf: (cb: () => void): number => {
      queued = cb;
      return 1;
    },
    flush: (): void => {
      const cb = queued;
      queued = null;
      cb?.();
    },
    isQueued: (): boolean => queued !== null,
  };
}

describe("createFrameThrottler", () => {
  it("runs a single scheduled callback on the next frame", () => {
    const { raf, flush } = fakeRaf();
    const throttler = createFrameThrottler(raf);
    let ran = 0;
    throttler.schedule(() => ran++);
    expect(ran).toBe(0); // not run synchronously
    flush();
    expect(ran).toBe(1);
  });

  it("coalesces several calls within one frame into just the latest", () => {
    const { raf, flush } = fakeRaf();
    const throttler = createFrameThrottler(raf);
    const seen: number[] = [];
    throttler.schedule(() => seen.push(1));
    throttler.schedule(() => seen.push(2));
    throttler.schedule(() => seen.push(3));
    flush();
    expect(seen).toEqual([3]); // only the latest-scheduled callback ran
  });

  it("only requests one animation frame per pending batch", () => {
    let rafCalls = 0;
    const { raf, flush } = fakeRaf();
    const countingRaf = (cb: () => void): number => {
      rafCalls++;
      return raf(cb);
    };
    const throttler = createFrameThrottler(countingRaf);
    throttler.schedule(() => {});
    throttler.schedule(() => {});
    throttler.schedule(() => {});
    expect(rafCalls).toBe(1);
    flush();
  });

  it("schedules a fresh frame for a call after the previous frame ran", () => {
    const { raf, flush } = fakeRaf();
    const throttler = createFrameThrottler(raf);
    const seen: number[] = [];
    throttler.schedule(() => seen.push(1));
    flush();
    throttler.schedule(() => seen.push(2));
    flush();
    expect(seen).toEqual([1, 2]);
  });
});
