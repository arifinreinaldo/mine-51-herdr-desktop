import { describe, expect, it } from "vitest";
import {
  absoluteRowForViewportRow,
  clampToPaneLocal,
  orderSelectionPoints,
  pixelToCell,
  selectionRowRects,
  toPaneLocal,
  viewportRowForAbsoluteRow,
  viewportTopRow,
  type CellRect,
} from "../../../src/mouse/geometry";

describe("pixelToCell", () => {
  it("converts device-pixel canvas coordinates to cell coordinates", () => {
    // rect origin (10, 20) CSS px, dpr 2, cell 16x32 device px (8x16 CSS).
    // A click at CSS (10 + 24, 20 + 40) is (24, 40) CSS past the origin,
    // i.e. (48, 80) device px -> col floor(48/16)=3, row floor(80/32)=2.
    expect(pixelToCell(34, 60, 10, 20, 2, 16, 32)).toEqual({ col: 3, row: 2 });
  });

  it("floors partial cells rather than rounding", () => {
    expect(pixelToCell(15, 15, 0, 0, 1, 10, 10)).toEqual({ col: 1, row: 1 });
    expect(pixelToCell(9, 9, 0, 0, 1, 10, 10)).toEqual({ col: 0, row: 0 });
  });

  it("clamps a position before the canvas origin to 0, never negative", () => {
    expect(pixelToCell(-50, -50, 0, 0, 1, 10, 10)).toEqual({ col: 0, row: 0 });
  });

  it("clamps an absurdly large position to 65535 (a wire u16's max)", () => {
    expect(pixelToCell(1_000_000_000, 1_000_000_000, 0, 0, 1, 1, 1)).toEqual({
      col: 65535,
      row: 65535,
    });
  });

  it("guards against a zero cell size instead of dividing by zero", () => {
    expect(pixelToCell(100, 100, 0, 0, 1, 0, 0)).toEqual({ col: 100, row: 100 });
  });
});

describe("toPaneLocal", () => {
  const innerRect: CellRect = { x: 5, y: 3, width: 20, height: 10 };

  it("subtracts the pane's inner_rect origin", () => {
    expect(toPaneLocal(8, 7, innerRect)).toEqual({ col: 3, row: 4 });
  });

  it("floors at 0 when the position is left of or above the pane", () => {
    expect(toPaneLocal(0, 0, innerRect)).toEqual({ col: 0, row: 0 });
  });

  it("does not clamp the far edge (mirrors pane_mouse_position's saturating_sub)", () => {
    // 100 cells past the pane's right/bottom edge -- sent through as-is.
    expect(toPaneLocal(125, 113, innerRect)).toEqual({ col: 120, row: 110 });
  });
});

describe("clampToPaneLocal", () => {
  const innerRect: CellRect = { x: 10, y: 5, width: 8, height: 4 };

  it("clamps to the pane's bounds on both edges (mirrors clamp_to_pane)", () => {
    expect(clampToPaneLocal(200, 100, innerRect)).toEqual({ col: 7, row: 3 });
    expect(clampToPaneLocal(0, 0, innerRect)).toEqual({ col: 0, row: 0 });
  });

  it("passes through a position already inside the pane", () => {
    expect(clampToPaneLocal(13, 6, innerRect)).toEqual({ col: 3, row: 1 });
  });

  it("degrades to a single cell for a zero-sized pane instead of panicking", () => {
    const empty: CellRect = { x: 0, y: 0, width: 0, height: 0 };
    expect(clampToPaneLocal(50, 50, empty)).toEqual({ col: 0, row: 0 });
  });
});

describe("viewportTopRow / absoluteRowForViewportRow / viewportRowForAbsoluteRow", () => {
  it("is 0 with no scroll metrics at all", () => {
    expect(viewportTopRow(null)).toBe(0);
    expect(viewportTopRow(undefined)).toBe(0);
  });

  it("is max_offset_from_bottom - offset_from_bottom when scrolled back", () => {
    expect(viewportTopRow({ offset_from_bottom: 5, max_offset_from_bottom: 20 })).toBe(15);
  });

  it("is 0 when viewing the live bottom (offset_from_bottom == max)", () => {
    expect(viewportTopRow({ offset_from_bottom: 20, max_offset_from_bottom: 20 })).toBe(0);
  });

  it("round-trips a viewport row through the absolute conversion", () => {
    const top = 15;
    expect(absoluteRowForViewportRow(3, top)).toBe(18);
    expect(viewportRowForAbsoluteRow(18, top)).toBe(3);
  });
});

describe("orderSelectionPoints", () => {
  it("keeps an already-ordered pair as-is", () => {
    const anchor = { row: 1, col: 2 };
    const cursor = { row: 3, col: 0 };
    expect(orderSelectionPoints(anchor, cursor)).toEqual([anchor, cursor]);
  });

  it("swaps a reversed drag (cursor above the anchor)", () => {
    const anchor = { row: 5, col: 2 };
    const cursor = { row: 1, col: 9 };
    expect(orderSelectionPoints(anchor, cursor)).toEqual([cursor, anchor]);
  });

  it("orders by column on the same row", () => {
    const anchor = { row: 2, col: 8 };
    const cursor = { row: 2, col: 3 };
    expect(orderSelectionPoints(anchor, cursor)).toEqual([cursor, anchor]);
  });

  it("a same-cell selection (a plain click) is stable either way", () => {
    const point = { row: 4, col: 4 };
    expect(orderSelectionPoints(point, point)).toEqual([point, point]);
  });
});

describe("selectionRowRects", () => {
  it("a single-row selection produces one column-bounded rect", () => {
    const rects = selectionRowRects({ row: 5, col: 2 }, { row: 5, col: 6 }, 0, 24, 80);
    expect(rects).toEqual([{ row: 5, startCol: 2, endCol: 7 }]);
  });

  it("a multi-row selection spans full width in the middle rows", () => {
    const rects = selectionRowRects({ row: 2, col: 5 }, { row: 4, col: 3 }, 0, 24, 80);
    expect(rects).toEqual([
      { row: 2, startCol: 5, endCol: 80 },
      { row: 3, startCol: 0, endCol: 80 },
      { row: 4, startCol: 0, endCol: 4 },
    ]);
  });

  it("clips rows above the visible viewport (scrolled selection)", () => {
    // Selection spans absolute rows 0..5, but the viewport only shows
    // absolute rows 3..(3+10).
    const rects = selectionRowRects({ row: 0, col: 0 }, { row: 5, col: 2 }, 3, 10, 20);
    expect(rects.map((r) => r.row)).toEqual([0, 1, 2]); // viewport-relative: absolute 3,4,5
    expect(rects[0]).toEqual({ row: 0, startCol: 0, endCol: 20 });
    expect(rects[2]).toEqual({ row: 2, startCol: 0, endCol: 3 });
  });

  it("clips rows below the visible viewport", () => {
    const rects = selectionRowRects({ row: 0, col: 0 }, { row: 10, col: 0 }, 0, 3, 20);
    expect(rects).toHaveLength(3);
    expect(rects[2].row).toBe(2);
  });

  it("returns nothing when the selection is fully scrolled out of view", () => {
    expect(selectionRowRects({ row: 0, col: 0 }, { row: 1, col: 0 }, 10, 5, 20)).toEqual([]);
  });

  it("a zero-width selection on one row (endCol == startCol - 1 case) is dropped", () => {
    // start.col > end.col within a single row cannot happen for an ordered
    // pair, but a degenerate 0-width middle-row-only case (innerWidth 0)
    // should never emit an empty rect.
    expect(selectionRowRects({ row: 0, col: 0 }, { row: 2, col: 0 }, 0, 5, 0)).toEqual([]);
  });
});
