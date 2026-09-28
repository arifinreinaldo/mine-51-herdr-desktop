// Accumulates fractional wheel deltas (as a trackpad delivers, e.g.
// `deltaY` = 3.33 per tick) into whole "lines" for
// `ClientPaneInputEvent::Mouse`'s `ScrollUp`/`ScrollDown`/`ScrollLeft`/
// `ScrollRight`, carrying the sub-line remainder forward instead of
// dropping it every tick -- a slow trackpad scroll would otherwise round to
// 0 lines forever and never scroll at all.

/** `WheelEvent.deltaMode` values (DOM spec): 0 = pixels, 1 = lines, 2 =
 * pages. herdr/the terminal has no concept of "a page" for wheel purposes,
 * so mode 2 is treated as a (large) pixel delta via `pixelsPerLine`, same
 * as mode 0 -- an actual page-mode wheel is vanishingly rare in practice
 * (mode 0 or 1 covers effectively every real mouse/trackpad). */
const WHEEL_DELTA_LINE = 1;

/** One accumulator per pane (`appTerminalMouse.ts` keys a `Map` by
 * `pane_id`): a still-settling fractional remainder must not leak into a
 * different pane's first wheel tick. */
export class WheelAccumulator {
  private residualY = 0;
  private residualX = 0;

  /** Returns the whole lines to send now (0 when the accumulated delta
   * hasn't reached a full line yet); the remainder is carried in `this`
   * for the next call. */
  accumulateY(deltaY: number, deltaMode: number, pixelsPerLine: number): number {
    this.residualY += toLines(deltaY, deltaMode, pixelsPerLine);
    return this.takeWhole("residualY");
  }

  accumulateX(deltaX: number, deltaMode: number, pixelsPerLine: number): number {
    this.residualX += toLines(deltaX, deltaMode, pixelsPerLine);
    return this.takeWhole("residualX");
  }

  private takeWhole(field: "residualX" | "residualY"): number {
    // `|| 0` normalizes a `Math.trunc` result of `-0` (e.g. truncating
    // -0.58) to `0`: both compare equal for every caller's `=== 0` check,
    // but `-0` is a confusing thing to hand back as "no whole lines yet".
    const whole = Math.trunc(this[field]) || 0;
    this[field] -= whole;
    return whole;
  }

  reset(): void {
    this.residualX = 0;
    this.residualY = 0;
  }
}

function toLines(delta: number, deltaMode: number, pixelsPerLine: number): number {
  if (deltaMode === WHEEL_DELTA_LINE) return delta;
  return delta / Math.max(1, pixelsPerLine);
}
