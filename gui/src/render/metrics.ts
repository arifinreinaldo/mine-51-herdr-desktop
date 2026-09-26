// Pure device-pixel metric maths for the terminal canvas (spec phase1.5
// §8.2 "Draw in device pixels with no `setTransform` scaling"), extracted
// from the renderer so it is unit-testable without a `<canvas>`.
//
// "fontPx = size × dpr." "cellW = round(measureText("M").width) in device
// px." "cellH = round(fontPx × 1.2) (the Windows Terminal default), so 14px
// becomes 17px at DPR 1." "Canvas backing size = floor(avail × dpr), and
// CSS size = backing size / dpr." "cols = floor(backingW / cellW) and rows
// = floor(backingH / cellH)." "Integral origin ... shift the canvas by
// (round(v) − v)/dpr px."

export function fontPxForDpr(cssFontSizePx: number, dpr: number): number {
  return cssFontSizePx * dpr;
}

/** The Windows Terminal default line-height ratio: 14px -> 17px at DPR 1. */
export function cellHeightForFontPx(fontPx: number): number {
  return Math.round(fontPx * 1.2);
}

/** `measureText("M").width` is taken in device px (the canvas context's
 * font was already set to the device-px font size); this just rounds and
 * floors at 1px so a pathological zero-width measurement can't divide by
 * zero downstream. */
export function cellWidthFromMeasuredWidth(measuredWidthDevicePx: number): number {
  return Math.max(1, Math.round(measuredWidthDevicePx));
}

export interface PixelSize {
  width: number;
  height: number;
}

/** Canvas backing-store size in device px, floored (spec §8.2). */
export function backingSizeForAvailable(
  availableCssWidth: number,
  availableCssHeight: number,
  dpr: number,
): PixelSize {
  return {
    width: Math.floor(availableCssWidth * dpr),
    height: Math.floor(availableCssHeight * dpr),
  };
}

/** The CSS size that maps 1:1 back onto `backing`'s device pixels. */
export function cssSizeForBacking(backing: PixelSize, dpr: number): PixelSize {
  return { width: backing.width / dpr, height: backing.height / dpr };
}

export interface GridDims {
  cols: number;
  rows: number;
}

export function gridDimsForBacking(backing: PixelSize, cellWidthPx: number, cellHeightPx: number): GridDims {
  return {
    cols: Math.floor(backing.width / Math.max(1, cellWidthPx)),
    rows: Math.floor(backing.height / Math.max(1, cellHeightPx)),
  };
}

/**
 * Spec §8.2 "Integral origin": the chrome heights (30/35/22) × 1.25 are
 * fractional. Given the canvas's `getBoundingClientRect().top` (or `.left`)
 * already multiplied by `dpr`, returns the CSS-px `transform: translate()`
 * shift that snaps the backing store back onto whole device pixels. `0`
 * when the value is already integral.
 */
export function integralOriginShiftCssPx(devicePxValue: number, dpr: number): number {
  const rounded = Math.round(devicePxValue);
  return (rounded - devicePxValue) / dpr;
}

/**
 * Spec §8.3 "Baseline": `textBaseline = "alphabetic"`, drawn at
 * `rowTop + round((cellH - (ascent + descent)) / 2) + ascent`. Returns the
 * y offset *within* the row (add `rowTop` at the call site).
 */
export function baselineYWithinRow(cellHeightPx: number, ascent: number, descent: number): number {
  return Math.round((cellHeightPx - (ascent + descent)) / 2) + ascent;
}
