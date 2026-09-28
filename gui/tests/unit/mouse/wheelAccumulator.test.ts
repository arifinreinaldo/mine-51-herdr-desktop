import { describe, expect, it } from "vitest";
import { WheelAccumulator } from "../../../src/mouse/wheelAccumulator";

const PIXEL_MODE = 0;
const LINE_MODE = 1;

describe("WheelAccumulator", () => {
  it("passes whole line-mode deltas straight through", () => {
    const acc = new WheelAccumulator();
    expect(acc.accumulateY(3, LINE_MODE, 17)).toBe(3);
    expect(acc.accumulateY(-2, LINE_MODE, 17)).toBe(-2);
  });

  it("converts a pixel-mode delta using the given pixels-per-line", () => {
    const acc = new WheelAccumulator();
    // 34 px at 17 px/line = exactly 2 lines.
    expect(acc.accumulateY(34, PIXEL_MODE, 17)).toBe(2);
  });

  it("accumulates fractional trackpad deltas across ticks instead of always rounding to 0", () => {
    const acc = new WheelAccumulator();
    // 5px ticks at 17px/line: 0.294 lines each. None round to a whole line
    // alone, but they add up.
    expect(acc.accumulateY(5, PIXEL_MODE, 17)).toBe(0);
    expect(acc.accumulateY(5, PIXEL_MODE, 17)).toBe(0);
    expect(acc.accumulateY(5, PIXEL_MODE, 17)).toBe(0);
    // 4th tick pushes the running total (~1.176) past 1.
    expect(acc.accumulateY(5, PIXEL_MODE, 17)).toBe(1);
  });

  it("keeps X and Y accumulators independent", () => {
    const acc = new WheelAccumulator();
    expect(acc.accumulateY(17, PIXEL_MODE, 17)).toBe(1);
    expect(acc.accumulateX(0, PIXEL_MODE, 17)).toBe(0);
  });

  it("carries a negative residual correctly across calls", () => {
    const acc = new WheelAccumulator();
    expect(acc.accumulateY(-10, PIXEL_MODE, 17)).toBe(0);
    expect(acc.accumulateY(-10, PIXEL_MODE, 17)).toBe(-1); // -20/17 ≈ -1.18
  });

  it("reset clears both accumulated remainders", () => {
    const acc = new WheelAccumulator();
    acc.accumulateY(10, PIXEL_MODE, 17); // residual ~0.588, not yet a whole line
    acc.reset();
    // Without the reset, one more 10px tick would cross 1 line (20/17>1).
    // After reset, it starts fresh from 0 and still doesn't reach a line.
    expect(acc.accumulateY(10, PIXEL_MODE, 17)).toBe(0);
  });

  it("guards against a zero pixels-per-line instead of dividing by zero", () => {
    const acc = new WheelAccumulator();
    expect(() => acc.accumulateY(10, PIXEL_MODE, 0)).not.toThrow();
  });
});
