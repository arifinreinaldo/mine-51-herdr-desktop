// Box-drawing and block-element classification (spec phase1.5 §8.4):
// "draw U+2500–U+257F lines (light and heavy, horizontal, vertical, and
// corners at minimum; rounded corners may fall back to square) and
// U+2580–U+259F block elements as filled rects or paths that span the
// whole cell. That removes the dashed-rule gaps."
//
// Pure classification + geometry tables; the actual canvas drawing (which
// needs a `CanvasRenderingContext2D`) lives in the renderer.

export type GlyphDrawKind = "box-line" | "block" | "text";

export function classifyGlyph(codePoint: number): GlyphDrawKind {
  if (codePoint >= 0x2500 && codePoint <= 0x257f) return "box-line";
  if (codePoint >= 0x2580 && codePoint <= 0x259f) return "block";
  return "text";
}

export interface BoxLineDescriptor {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  heavy: boolean;
}

/** Light/heavy horizontal, vertical, corners, T-junctions, and the cross,
 * plus the four rounded corners falling back to their square equivalent
 * (spec: "rounded corners may fall back to square"). Double-line box
 * drawing (U+2550-256C) is not in this table and paints as ordinary text
 * via the glyph atlas -- outside spec's stated minimum. */
const BOX_LINE_TABLE: Readonly<Record<number, BoxLineDescriptor>> = {
  0x2500: { up: false, down: false, left: true, right: true, heavy: false },
  0x2501: { up: false, down: false, left: true, right: true, heavy: true },
  0x2502: { up: true, down: true, left: false, right: false, heavy: false },
  0x2503: { up: true, down: true, left: false, right: false, heavy: true },
  0x250c: { up: false, down: true, left: false, right: true, heavy: false },
  0x250f: { up: false, down: true, left: false, right: true, heavy: true },
  0x2510: { up: false, down: true, left: true, right: false, heavy: false },
  0x2513: { up: false, down: true, left: true, right: false, heavy: true },
  0x2514: { up: true, down: false, left: false, right: true, heavy: false },
  0x2517: { up: true, down: false, left: false, right: true, heavy: true },
  0x2518: { up: true, down: false, left: true, right: false, heavy: false },
  0x251b: { up: true, down: false, left: true, right: false, heavy: true },
  0x251c: { up: true, down: true, left: false, right: true, heavy: false },
  0x2523: { up: true, down: true, left: false, right: true, heavy: true },
  0x2524: { up: true, down: true, left: true, right: false, heavy: false },
  0x252b: { up: true, down: true, left: true, right: false, heavy: true },
  0x252c: { up: false, down: true, left: true, right: true, heavy: false },
  0x2533: { up: false, down: true, left: true, right: true, heavy: true },
  0x2534: { up: true, down: false, left: true, right: true, heavy: false },
  0x253b: { up: true, down: false, left: true, right: true, heavy: true },
  0x253c: { up: true, down: true, left: true, right: true, heavy: false },
  0x254b: { up: true, down: true, left: true, right: true, heavy: true },
  // Rounded corners fall back to their square equivalents.
  0x256d: { up: false, down: true, left: false, right: true, heavy: false }, // ╭ -> ┌
  0x256e: { up: false, down: true, left: true, right: false, heavy: false }, // ╮ -> ┐
  0x256f: { up: true, down: false, left: true, right: false, heavy: false }, // ╯ -> ┘
  0x2570: { up: true, down: false, left: false, right: true, heavy: false }, // ╰ -> └
};

export function boxLineDescriptor(codePoint: number): BoxLineDescriptor | undefined {
  return BOX_LINE_TABLE[codePoint];
}

export interface FractionalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlockDescriptor {
  /** One or more cell-fraction rects (0..1) to fill solid. Most glyphs are
   * a single rect; the quadrant-combination glyphs (U+2599-259F) are 2-3. */
  rects: readonly FractionalRect[];
  /** Shade glyphs (U+2591-2593) fill the whole cell at reduced alpha
   * instead of a partial rect. */
  alpha?: number;
}

const FULL: FractionalRect = { x: 0, y: 0, width: 1, height: 1 };
const UL: FractionalRect = { x: 0, y: 0, width: 0.5, height: 0.5 };
const UR: FractionalRect = { x: 0.5, y: 0, width: 0.5, height: 0.5 };
const LL: FractionalRect = { x: 0, y: 0.5, width: 0.5, height: 0.5 };
const LR: FractionalRect = { x: 0.5, y: 0.5, width: 0.5, height: 0.5 };

function lowerEighths(n: number): FractionalRect {
  return { x: 0, y: 1 - n / 8, width: 1, height: n / 8 };
}
function leftEighths(n: number): FractionalRect {
  return { x: 0, y: 0, width: n / 8, height: 1 };
}

const BLOCK_TABLE: Readonly<Record<number, BlockDescriptor>> = {
  0x2580: { rects: [{ x: 0, y: 0, width: 1, height: 0.5 }] }, // upper half
  0x2581: { rects: [lowerEighths(1)] },
  0x2582: { rects: [lowerEighths(2)] },
  0x2583: { rects: [lowerEighths(3)] },
  0x2584: { rects: [lowerEighths(4)] }, // lower half
  0x2585: { rects: [lowerEighths(5)] },
  0x2586: { rects: [lowerEighths(6)] },
  0x2587: { rects: [lowerEighths(7)] },
  0x2588: { rects: [FULL] }, // full block
  0x2589: { rects: [leftEighths(7)] },
  0x258a: { rects: [leftEighths(6)] },
  0x258b: { rects: [leftEighths(5)] },
  0x258c: { rects: [leftEighths(4)] }, // left half
  0x258d: { rects: [leftEighths(3)] },
  0x258e: { rects: [leftEighths(2)] },
  0x258f: { rects: [leftEighths(1)] },
  0x2590: { rects: [{ x: 0.5, y: 0, width: 0.5, height: 1 }] }, // right half
  0x2591: { rects: [FULL], alpha: 0.25 }, // light shade
  0x2592: { rects: [FULL], alpha: 0.5 }, // medium shade
  0x2593: { rects: [FULL], alpha: 0.75 }, // dark shade
  0x2594: { rects: [{ x: 0, y: 0, width: 1, height: 1 / 8 }] }, // upper one eighth
  0x2595: { rects: [{ x: 7 / 8, y: 0, width: 1 / 8, height: 1 }] }, // right one eighth
  0x2596: { rects: [LL] },
  0x2597: { rects: [LR] },
  0x2598: { rects: [UL] },
  0x2599: { rects: [UL, LL, LR] },
  0x259a: { rects: [UL, LR] },
  0x259b: { rects: [UL, UR, LL] },
  0x259c: { rects: [UL, UR, LR] },
  0x259d: { rects: [UR] },
  0x259e: { rects: [UR, LL] },
  0x259f: { rects: [UR, LL, LR] },
};

export function blockDescriptor(codePoint: number): BlockDescriptor | undefined {
  return BLOCK_TABLE[codePoint];
}
