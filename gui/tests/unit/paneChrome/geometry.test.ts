import { describe, expect, it } from "vitest";
import type { Grid, GridCell } from "../../../src/grid";
import { borderTitle, headerMode, ringBox, type LayoutPane } from "../../../src/paneChrome/geometry";

function r(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

function pane(id: string, rect: LayoutPane["rect"], inner: LayoutPane["inner_rect"], extra: Partial<LayoutPane> = {}): LayoutPane {
  return { pane_id: id, rect, inner_rect: inner, scrollbar_rect: null, focused: false, ...extra };
}

describe("ringBox", () => {
  it("sits at content +- 0.5 when both panes keep all borders", () => {
    const left = pane("a", r(0, 0, 10, 6), r(1, 1, 8, 4), { focused: true });
    const right = pane("b", r(10, 0, 10, 6), r(11, 1, 8, 4));
    expect(ringBox(left, [left, right])).toEqual({ left: 0.5, top: 0.5, right: 9.5, bottom: 5.5 });
    expect(ringBox(right, [left, right])).toEqual({ left: 10.5, top: 0.5, right: 19.5, bottom: 5.5 });
  });

  it("covers the shared line when the left pane has no right border", () => {
    // pane_gaps off: the left pane owns no right border, the right pane owns a left border.
    const left = pane("a", r(0, 0, 10, 6), r(1, 1, 9, 4), { focused: true });
    const right = pane("b", r(10, 0, 10, 6), r(11, 1, 8, 4));
    const box = ringBox(left, [left, right]);
    expect(box.right).toBe(10.5);
    expect(box.left).toBe(0.5);
  });

  it("equals the rect when no pane has borders", () => {
    const a = pane("a", r(0, 0, 10, 6), r(0, 0, 10, 6), { focused: true });
    const b = pane("b", r(10, 0, 10, 6), r(10, 0, 10, 6));
    expect(ringBox(a, [a, b])).toEqual({ left: 0, top: 0, right: 10, bottom: 6 });
  });

  it("uses the scrollbar's right edge when the pane has a scrollbar column", () => {
    const a = pane("a", r(0, 0, 12, 6), r(1, 1, 9, 4), { focused: true, scrollbar_rect: r(10, 1, 1, 4) });
    expect(ringBox(a, [a]).right).toBe(11.5);
  });

  it("covers a shared horizontal line the same way on the y axis", () => {
    const top = pane("a", r(0, 0, 10, 6), r(1, 1, 8, 5), { focused: true });
    const bottom = pane("b", r(0, 6, 10, 6), r(1, 7, 8, 4));
    expect(ringBox(top, [top, bottom]).bottom).toBe(6.5);
  });

  it("ignores a neighbour that does not overlap this pane's rows", () => {
    const a = pane("a", r(0, 0, 10, 6), r(1, 1, 9, 4), { focused: true });
    const far = pane("b", r(10, 20, 10, 6), r(11, 21, 8, 4));
    expect(ringBox(a, [a, far]).right).toBe(10);
  });
});

function gridWithRow(row: string[], width = row.length, skips: number[] = []): Grid {
  const cells: GridCell[] = [];
  for (let i = 0; i < width; i++) {
    cells.push({ symbol: row[i] ?? " ", fg: 0, bg: 0, modifier: 0, skip: skips.includes(i) });
  }
  return { width, height: 1, cells, cursor: null, surfaceRevision: 1 };
}

describe("borderTitle", () => {
  const p = pane("a", r(0, 0, 20, 5), r(1, 1, 18, 3));

  it("reads a title after the corner and stops at the first box-drawing cell", () => {
    const row = ["┌", " ", "c", "l", "a", "u", "d", "e", " ", ..."─".repeat(10).split(""), "┐"];
    expect(borderTitle(gridWithRow(row, 20), p)).toEqual({ text: "claude", startCol: 1, cells: 8 });
  });

  it("stops at the first box-drawing cell even when text follows", () => {
    const row = ["┌", " ", "a", " ", "─", "b", "c", ..."─".repeat(12).split(""), "┐"];
    expect(borderTitle(gridWithRow(row, 20), p)?.text).toBe("a");
  });

  it("counts wide-character tails as cells without adding text", () => {
    const row = ["┌", " ", "世", "", "x", " ", ..."─".repeat(13).split(""), "┐"];
    const t = borderTitle(gridWithRow(row, 20, [3]), p);
    expect(t).toEqual({ text: "世x", startCol: 1, cells: 5 });
  });

  it("returns null without a title", () => {
    const row = ["┌", ..."─".repeat(18).split(""), "┐"];
    expect(borderTitle(gridWithRow(row, 20), p)).toBeNull();
  });

  it("returns null when the pane has no top border row", () => {
    const noBorder = pane("a", r(0, 0, 20, 5), r(0, 0, 20, 5));
    const row = [" ", "c", "l", ...Array(17).fill(" ")];
    expect(borderTitle(gridWithRow(row, 20), noBorder)).toBeNull();
  });
});

describe("headerMode", () => {
  const withBorder = pane("a", r(0, 0, 20, 5), r(1, 1, 18, 3));
  const noBorder = pane("b", r(0, 0, 20, 5), r(0, 0, 20, 5));

  it("is strip when the pane has a top border row", () => {
    expect(headerMode(withBorder, false)).toBe("strip");
    expect(headerMode(withBorder, true)).toBe("strip");
  });
  it("is pill for a focused, zoomed pane without a border", () => {
    expect(headerMode({ ...noBorder, focused: true }, true)).toBe("pill");
  });
  it("is none for an unfocused zoomed pane", () => {
    expect(headerMode(noBorder, true)).toBe("none");
  });
  it("is none for a single unzoomed pane without a border", () => {
    expect(headerMode({ ...noBorder, focused: true }, false)).toBe("none");
  });
});
