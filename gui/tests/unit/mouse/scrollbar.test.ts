import { describe, expect, it } from "vitest";
import {
  scrollbarOffsetFromDragRow,
  scrollbarOffsetFromRow,
  scrollbarThumb,
  scrollbarThumbGrabOffset,
} from "../../../src/mouse/scrollbar";

const TRACK = { x: 79, y: 0, width: 1, height: 20 };

describe("scrollbarThumb", () => {
  it("is null with nothing to scroll", () => {
    expect(scrollbarThumb({ offset_from_bottom: 0, max_offset_from_bottom: 0, viewport_rows: 20 }, TRACK)).toBeNull();
  });

  it("is null with a zero-height track", () => {
    expect(
      scrollbarThumb({ offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 20 }, { ...TRACK, height: 0 }),
    ).toBeNull();
  });

  it("thumb sits near the bottom of the track when at the live bottom", () => {
    // total_rows = 100 + 20 = 120; thumb_len = round(20*20/120) = 3.
    // max_thumb_top = 20-3 = 17; scrolled_from_top = 100-0 = 100;
    // thumb_top = round(100*17/100) = 17.
    const thumb = scrollbarThumb({ offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 20 }, TRACK);
    expect(thumb).toEqual({ top: 17, len: 3 });
  });

  it("thumb sits at the top of the track when scrolled all the way up", () => {
    const thumb = scrollbarThumb({ offset_from_bottom: 100, max_offset_from_bottom: 100, viewport_rows: 20 }, TRACK);
    expect(thumb).toEqual({ top: 0, len: 3 });
  });

  it("thumb sits at the middle when half-scrolled", () => {
    const thumb = scrollbarThumb({ offset_from_bottom: 50, max_offset_from_bottom: 100, viewport_rows: 20 }, TRACK);
    // max_thumb_top = 20 - 3 = 17; scrolled_from_top = 100-50=50; thumb_top = round(50*17/100) = 9.
    expect(thumb).toEqual({ top: 9, len: 3 });
  });
});

describe("scrollbarThumbGrabOffset", () => {
  it("returns the row offset within the thumb when the row is inside it", () => {
    // thumb at top=17,len=3 (rows 17..19) for the live-bottom case above.
    expect(
      scrollbarThumbGrabOffset({ offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 20 }, TRACK, 18),
    ).toBe(1);
  });

  it("is null when the row is outside the thumb", () => {
    expect(
      scrollbarThumbGrabOffset({ offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 20 }, TRACK, 5),
    ).toBeNull();
  });
});

describe("scrollbarOffsetFromRow (jump-to-click)", () => {
  it("clicking the very top of the track scrolls to (near) the top of scrollback", () => {
    const offset = scrollbarOffsetFromRow(
      { offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 20 },
      TRACK,
      0,
    );
    expect(offset).toBeGreaterThan(80);
    expect(offset).toBeLessThanOrEqual(100);
  });

  it("clicking the very bottom of the track scrolls to (near) the live bottom", () => {
    const offset = scrollbarOffsetFromRow(
      { offset_from_bottom: 100, max_offset_from_bottom: 100, viewport_rows: 20 },
      TRACK,
      19,
    );
    expect(offset).toBeLessThan(20);
  });

  it("is 0 with nothing to scroll", () => {
    expect(
      scrollbarOffsetFromRow({ offset_from_bottom: 0, max_offset_from_bottom: 0, viewport_rows: 20 }, TRACK, 10),
    ).toBe(0);
  });
});

describe("scrollbarOffsetFromDragRow", () => {
  it("dragging the grabbed thumb down toward the track's bottom decreases the offset toward 0", () => {
    const metrics = { offset_from_bottom: 100, max_offset_from_bottom: 100, viewport_rows: 20 };
    const grab = scrollbarThumbGrabOffset(metrics, TRACK, 0)!; // thumb starts at top=0
    const offsetAtBottom = scrollbarOffsetFromDragRow(metrics, TRACK, 19, grab);
    expect(offsetAtBottom).toBeLessThan(100);
  });

  it("clamps the dragged row to the track's own bounds", () => {
    const metrics = { offset_from_bottom: 0, max_offset_from_bottom: 100, viewport_rows: 20 };
    const grab = 0;
    const past = scrollbarOffsetFromDragRow(metrics, TRACK, 999, grab);
    const atEdge = scrollbarOffsetFromDragRow(metrics, TRACK, TRACK.height - 1, grab);
    expect(past).toBe(atEdge);
  });
});
