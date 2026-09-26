import { describe, expect, it } from "vitest";
import {
  backingSizeForAvailable,
  baselineYWithinRow,
  cellHeightForFontPx,
  cellWidthFromMeasuredWidth,
  cssSizeForBacking,
  fontPxForDpr,
  gridDimsForBacking,
  integralOriginShiftCssPx,
} from "../../../src/render/metrics";

describe("fontPxForDpr", () => {
  it("scales the CSS font size by the device pixel ratio", () => {
    expect(fontPxForDpr(14, 1)).toBe(14);
    expect(fontPxForDpr(14, 1.25)).toBe(17.5);
    expect(fontPxForDpr(14, 1.5)).toBe(21);
    expect(fontPxForDpr(14, 2)).toBe(28);
  });
});

describe("cellHeightForFontPx", () => {
  it("14px becomes 17px at DPR 1 (the Windows Terminal default ratio)", () => {
    expect(cellHeightForFontPx(14)).toBe(17);
  });

  it("scales with DPR", () => {
    expect(cellHeightForFontPx(fontPxForDpr(14, 2))).toBe(Math.round(28 * 1.2));
  });
});

describe("cellWidthFromMeasuredWidth", () => {
  it("rounds to the nearest device pixel", () => {
    expect(cellWidthFromMeasuredWidth(8.4)).toBe(8);
    expect(cellWidthFromMeasuredWidth(8.6)).toBe(9);
  });

  it("never returns less than 1px", () => {
    expect(cellWidthFromMeasuredWidth(0)).toBe(1);
  });
});

describe("backingSizeForAvailable / cssSizeForBacking", () => {
  it("floors the backing size at every tested DPR", () => {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      const backing = backingSizeForAvailable(801.3, 500.7, dpr);
      expect(backing.width).toBe(Math.floor(801.3 * dpr));
      expect(backing.height).toBe(Math.floor(500.7 * dpr));
      expect(Number.isInteger(backing.width)).toBe(true);
      expect(Number.isInteger(backing.height)).toBe(true);
    }
  });

  it("cssSizeForBacking maps 1:1 back onto the backing size at each DPR", () => {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      const backing = backingSizeForAvailable(800, 500, dpr);
      const css = cssSizeForBacking(backing, dpr);
      expect(css.width * dpr).toBeCloseTo(backing.width, 10);
      expect(css.height * dpr).toBeCloseTo(backing.height, 10);
    }
  });
});

describe("gridDimsForBacking", () => {
  it("floors cols/rows from the backing size and cell size", () => {
    const backing = { width: 803, height: 407 };
    const dims = gridDimsForBacking(backing, 8, 17);
    expect(dims.cols).toBe(Math.floor(803 / 8));
    expect(dims.rows).toBe(Math.floor(407 / 17));
  });

  it("never divides by zero for a degenerate cell size", () => {
    expect(gridDimsForBacking({ width: 100, height: 100 }, 0, 0)).toEqual({ cols: 100, rows: 100 });
  });
});

describe("integralOriginShiftCssPx", () => {
  it("is zero when the device-px value is already integral", () => {
    expect(integralOriginShiftCssPx(30, 1)).toBe(0);
  });

  it("shifts a fractional device-px value back onto the pixel grid", () => {
    // 30 CSS px * 1.25 dpr = 37.5 device px -> round to 38, shift = (38-37.5)/1.25
    const shift = integralOriginShiftCssPx(30 * 1.25, 1.25);
    expect(shift).toBeCloseTo((38 - 37.5) / 1.25, 10);
  });

  it("the shift always lands back on a whole device pixel", () => {
    for (const dpr of [1.25, 1.5, 2]) {
      const devicePxValue = 35 * dpr;
      const shift = integralOriginShiftCssPx(devicePxValue, dpr);
      const shifted = (devicePxValue / dpr + shift) * dpr;
      expect(Math.abs(shifted - Math.round(shifted))).toBeLessThan(1e-9);
    }
  });
});

describe("baselineYWithinRow", () => {
  it("centers the glyph box vertically within the row", () => {
    // cellH 17, ascent 12, descent 3 -> (17-15)/2 = 1, +12 = 13
    expect(baselineYWithinRow(17, 12, 3)).toBe(13);
  });
});
