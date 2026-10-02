import { describe, expect, it } from "vitest";
import { probeCell, scrollMakesDrag, selectionPointFor, viewportChanged, viewportFor } from "../../../src/mouse/selectionFollow";

const pane = { x: 10, y: 5, width: 80, height: 24 };

describe("viewportFor", () => {
  it("is the row count of scrollback above the viewport, and its height", () => {
    // 100 rows of scrollback, scrolled 30 up from the bottom: the viewport starts at row 70.
    expect(viewportFor({ offset_from_bottom: 30, max_offset_from_bottom: 100, viewport_rows: 24 }, 99)).toEqual({
      top: 70,
      rows: 24,
    });
  });

  it("starts at row 0 at the very top of the scrollback", () => {
    expect(viewportFor({ offset_from_bottom: 100, max_offset_from_bottom: 100, viewport_rows: 24 }, 99).top).toBe(0);
  });

  it("uses the live bottom and the fallback height when there are no metrics", () => {
    expect(viewportFor(null, 24)).toEqual({ top: 0, rows: 24 });
    expect(viewportFor(undefined, 12)).toEqual({ top: 0, rows: 12 });
  });
});

describe("viewportChanged", () => {
  it("is false for the same top and height", () => {
    expect(viewportChanged({ top: 70, rows: 24 }, { top: 70, rows: 24 })).toBe(false);
  });

  it("is true when the wheel moved the top, or a resize changed the height", () => {
    expect(viewportChanged({ top: 70, rows: 24 }, { top: 67, rows: 24 })).toBe(true);
    expect(viewportChanged({ top: 70, rows: 24 }, { top: 70, rows: 30 })).toBe(true);
  });
});

describe("selectionPointFor", () => {
  it("adds the viewport top to the pointer's pane-local row", () => {
    // Screen cell (15, 8) is pane-local (5, 3); the viewport starts at absolute row 70.
    expect(selectionPointFor({ col: 15, row: 8 }, pane, 70)).toEqual({ row: 73, col: 5 });
  });

  it("follows the scroll: the same pointer cell gives a new absolute row after the wheel", () => {
    const before = selectionPointFor({ col: 15, row: 8 }, pane, 70);
    const after = selectionPointFor({ col: 15, row: 8 }, pane, 55); // scrolled 15 rows up
    expect(after.row).toBe(before.row - 15);
    expect(after.col).toBe(before.col);
  });

  it("holds the selection at the pane edge when the pointer is outside it", () => {
    expect(selectionPointFor({ col: 500, row: 500 }, pane, 70)).toEqual({ row: 70 + 23, col: 79 });
    expect(selectionPointFor({ col: 0, row: 0 }, pane, 70)).toEqual({ row: 70, col: 0 });
  });
});

describe("scrollMakesDrag", () => {
  const anchor = { row: 80, col: 5 };
  const scroll = (offset: number, max: number) => ({ offset_from_bottom: offset, max_offset_from_bottom: max, viewport_rows: 24 });

  it("is true when the user scrolled (the offset changed) and the cursor left the anchor", () => {
    expect(scrollMakesDrag(0, scroll(20, 100), { row: 60, col: 5 }, anchor)).toBe(true);
  });

  it("is false for output growth alone: the offset stays 0 while the scrollback grows", () => {
    // A busy pane at the live bottom: max_offset_from_bottom grows, so the viewport's top moves
    // and the cursor row changes, but the user did not scroll. A plain click must stay a click.
    expect(scrollMakesDrag(0, scroll(0, 103), { row: 83, col: 5 }, anchor)).toBe(false);
  });

  it("is false when the user scrolled but the cursor is still on the anchor", () => {
    expect(scrollMakesDrag(0, scroll(20, 100), anchor, anchor)).toBe(false);
  });

  it("treats missing metrics as offset 0", () => {
    expect(scrollMakesDrag(0, null, { row: 83, col: 5 }, anchor)).toBe(false);
    expect(scrollMakesDrag(5, undefined, { row: 83, col: 5 }, anchor)).toBe(true);
  });
});

describe("probeCell", () => {
  it("keeps a pointer cell inside the pane as it is", () => {
    expect(probeCell({ col: 15, row: 8 }, pane)).toEqual({ col: 15, row: 8 });
  });

  it("clamps a pointer outside the pane onto its nearest edge cell, in screen coordinates", () => {
    expect(probeCell({ col: 500, row: 500 }, pane)).toEqual({ col: 10 + 79, row: 5 + 23 });
    expect(probeCell({ col: 0, row: 0 }, pane)).toEqual({ col: 10, row: 5 });
  });
});
