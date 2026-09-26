import { describe, expect, it } from "vitest";
import type { DecodedSurfaceFrame } from "../../src/decoder";
import { applyDecodedFrame, createEmptyGrid } from "../../src/grid";

function fullFrame(): DecodedSurfaceFrame {
  return {
    kind: "full",
    surfaceRevision: 1,
    width: 2,
    height: 1,
    cursor: { x: 0, y: 0, visible: true },
    rows: [
      {
        y: 0,
        x: 0,
        cells: [
          { symbol: "a", fg: 1, bg: 0, modifier: 0, skip: false },
          { symbol: "b", fg: 2, bg: 0, modifier: 0, skip: false },
        ],
      },
    ],
    rustUs: 0,
  };
}

describe("createEmptyGrid", () => {
  it("starts at 0x0 with no cursor", () => {
    const grid = createEmptyGrid();
    expect(grid.width).toBe(0);
    expect(grid.height).toBe(0);
    expect(grid.cells).toEqual([]);
    expect(grid.cursor).toBeNull();
  });
});

describe("applyDecodedFrame", () => {
  it("a full frame replaces the grid's dimensions, cells, and cursor", () => {
    const { grid, dirtyRows } = applyDecodedFrame(createEmptyGrid(), fullFrame());
    expect(grid.width).toBe(2);
    expect(grid.height).toBe(1);
    expect(grid.cells.map((c) => c.symbol)).toEqual(["a", "b"]);
    expect(grid.cursor).toEqual({ x: 0, y: 0, visible: true });
    expect(grid.surfaceRevision).toBe(1);
    expect(dirtyRows).toEqual([0]);
  });

  it("a row patch overwrites only the touched cells and reports only dirty rows", () => {
    const { grid: base } = applyDecodedFrame(createEmptyGrid(), fullFrame());
    const patch: DecodedSurfaceFrame = {
      kind: "rows",
      surfaceRevision: 2,
      width: 2,
      height: 1,
      cursor: { x: 1, y: 0, visible: true },
      rows: [{ y: 0, x: 1, cells: [{ symbol: "z", fg: 3, bg: 0, modifier: 0, skip: false }] }],
      rustUs: 0,
    };
    const { grid, dirtyRows } = applyDecodedFrame(base, patch);
    expect(grid.cells.map((c) => c.symbol)).toEqual(["a", "z"]);
    expect(grid.surfaceRevision).toBe(2);
    expect(dirtyRows).toEqual([0]);
  });

  it("a row patch with cursor: null clears the cursor, rather than keeping the old one", () => {
    // herdr's own semantics: PaneSurfacePatch.cursor: Option<CursorState>
    // replaces the surface's cursor; `None` means "no cursor", not
    // "unchanged" (surface_patch.rs:50, code review finding #7).
    const { grid: base } = applyDecodedFrame(createEmptyGrid(), fullFrame());
    expect(base.cursor).toEqual({ x: 0, y: 0, visible: true });
    const patch: DecodedSurfaceFrame = {
      kind: "rows",
      surfaceRevision: 2,
      width: 2,
      height: 1,
      cursor: null,
      rows: [{ y: 0, x: 1, cells: [{ symbol: "z", fg: 3, bg: 0, modifier: 0, skip: false }] }],
      rustUs: 0,
    };
    const { grid } = applyDecodedFrame(base, patch);
    expect(grid.cursor).toBeNull();
  });

  it("ignores an oversize frame header rather than allocating a huge cells array", () => {
    const huge: DecodedSurfaceFrame = {
      kind: "full",
      surfaceRevision: 1,
      width: 60000,
      height: 60000,
      cursor: null,
      rows: [],
      rustUs: 0,
    };
    const before = createEmptyGrid();
    const { grid, dirtyRows } = applyDecodedFrame(before, huge);
    expect(grid).toBe(before);
    expect(dirtyRows).toEqual([]);
  });

  it("a row patch touching only row 3 of a taller grid reports dirtyRows [3]", () => {
    const tall: DecodedSurfaceFrame = {
      kind: "full",
      surfaceRevision: 1,
      width: 1,
      height: 5,
      cursor: null,
      rows: [0, 1, 2, 3, 4].map((y) => ({
        y,
        x: 0,
        cells: [{ symbol: String(y), fg: 0, bg: 0, modifier: 0, skip: false }],
      })),
      rustUs: 0,
    };
    const { grid: base } = applyDecodedFrame(createEmptyGrid(), tall);
    const patch: DecodedSurfaceFrame = {
      kind: "rows",
      surfaceRevision: 2,
      width: 1,
      height: 5,
      cursor: null,
      rows: [{ y: 3, x: 0, cells: [{ symbol: "Z", fg: 0, bg: 0, modifier: 0, skip: false }] }],
      rustUs: 0,
    };
    const { dirtyRows } = applyDecodedFrame(base, patch);
    expect(dirtyRows).toEqual([3]);
  });
});
