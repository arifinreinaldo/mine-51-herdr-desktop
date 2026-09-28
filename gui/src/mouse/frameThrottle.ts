// "Throttle Drag/Moved to one per animation frame": coalesces a flood of
// pointermove/wheel calls into at most one processed callback per rAF tick,
// always the *latest* one queued (an in-between position during a fast drag
// is never worth painting or sending).

export interface FrameScheduler {
  /** Replaces whatever callback was queued for the next frame with this
   * one. Only one `raf` is ever outstanding at a time. */
  schedule(callback: () => void): void;
}

/** `raf` is injectable so this is testable without a real animation frame
 * (`tests/unit/mouse/frameThrottle.test.ts` drives it by hand); production
 * code omits it and gets the real `requestAnimationFrame`. */
export function createFrameThrottler(raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb)): FrameScheduler {
  let frameRequested = false;
  let pending: (() => void) | null = null;
  return {
    schedule(callback: () => void): void {
      pending = callback;
      if (frameRequested) return;
      frameRequested = true;
      raf(() => {
        frameRequested = false;
        const run = pending;
        pending = null;
        run?.();
      });
    },
  };
}
