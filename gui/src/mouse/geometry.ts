// Pure cell-space geometry for herdr-native mouse selection, extracted so
// it is unit-testable without a `<canvas>` or a live connection (mirrors
// `render/metrics.ts`'s split: DOM/IPC glue lives in `appTerminalMouse.ts`,
// the maths lives here).
//
// The absolute-row/viewport-row conversion and the pane-local clamp mirror
// herdr's TUI client exactly (not invented): `absolute_row_for_viewport_row`
// and `clamp_to_pane` in `src/selection.rs`, `pane_mouse_position` in
// `src/client/shell/mouse.rs`.

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Device-pixel canvas coordinates -> cell coordinates, extracted from the
 * GUI's own prior click-to-focus handler (`appTerminalInput.ts`'s
 * `onCanvasClick`, now replaced by `appTerminalMouse.ts`). `rectLeft`/
 * `rectTop` come from `canvas.getBoundingClientRect()`, which already
 * reflects both `#terminal-wrap`'s 8px inset padding (the canvas element's
 * own box excludes it) and the renderer's integral-origin `transform`
 * shift (`getBoundingClientRect` includes CSS transforms) -- so no inset or
 * shift math is needed here beyond what the existing rect already carries.
 * Clamped to `[0, 65535]`: a `u16` on the Rust side of the IPC boundary
 * would otherwise reject a negative value (dragging past the canvas edge)
 * outright. */
export function pixelToCell(
  clientX: number,
  clientY: number,
  rectLeft: number,
  rectTop: number,
  dpr: number,
  cellWidthPx: number,
  cellHeightPx: number,
): { col: number; row: number } {
  const rawCol = Math.floor(((clientX - rectLeft) * dpr) / Math.max(1, cellWidthPx));
  const rawRow = Math.floor(((clientY - rectTop) * dpr) / Math.max(1, cellHeightPx));
  return { col: clampU16(rawCol), row: clampU16(rawRow) };
}

function clampU16(value: number): number {
  return Math.min(65535, Math.max(0, value));
}

/** Pane-local position for a mouse-reporting pane's forwarded `Mouse`
 * event: subtract the pane's `inner_rect` origin, floored at 0 on each axis
 * but never clamped to the pane's far edge -- mirrors
 * `pane_mouse_position`'s `saturating_sub` exactly (a raw mouse position
 * past the pane's bottom or right edge is sent as-is; only underflow past
 * the top or left edge is guarded against). */
export function toPaneLocal(col: number, row: number, innerRect: CellRect): { col: number; row: number } {
  return { col: Math.max(0, col - innerRect.x), row: Math.max(0, row - innerRect.y) };
}

/** Pane-local position for a host-side text selection, clamped to the
 * pane's bounds on both edges -- mirrors `clamp_to_pane`
 * (`src/selection.rs`) exactly: a drag past the pane's edge holds the
 * selection at that edge rather than running off it (no edge-autoscroll;
 * see this feature's scope notes). */
export function clampToPaneLocal(col: number, row: number, innerRect: CellRect): { col: number; row: number } {
  const maxCol = Math.max(0, innerRect.width - 1);
  const maxRow = Math.max(0, innerRect.height - 1);
  return {
    col: Math.min(maxCol, Math.max(0, col - innerRect.x)),
    row: Math.min(maxRow, Math.max(0, row - innerRect.y)),
  };
}

export interface ScrollMetricsLike {
  offset_from_bottom: number;
  max_offset_from_bottom: number;
}

/** The absolute screen-buffer row of the viewport's first visible row --
 * mirrors `viewport_top_row` (`src/selection.rs`) exactly: how many rows of
 * scrollback are above the currently visible viewport. `0` (viewing the
 * live bottom) when there is no scroll metrics at all (e.g. a pane with no
 * scrollback), matching that function's `unwrap_or(0)`. */
export function viewportTopRow(scroll: ScrollMetricsLike | null | undefined): number {
  if (!scroll) return 0;
  return Math.max(0, scroll.max_offset_from_bottom - scroll.offset_from_bottom);
}

/** Mirrors `absolute_row_for_viewport_row` (`src/selection.rs`): a
 * viewport-relative row plus the viewport's top absolute row. */
export function absoluteRowForViewportRow(viewportRow: number, top: number): number {
  return top + viewportRow;
}

/** Mirrors `viewport_row_for_absolute_row` (`src/selection.rs`), the
 * inverse conversion used when painting the highlight back onto the
 * viewport. */
export function viewportRowForAbsoluteRow(absoluteRow: number, top: number): number {
  return absoluteRow - top;
}

export interface AbsolutePoint {
  row: number;
  col: number;
}

/** Reading-order (start, end) for two absolute (row, col) points -- mirrors
 * `Selection::ordered` (`src/selection.rs`) exactly. */
export function orderSelectionPoints(anchor: AbsolutePoint, cursor: AbsolutePoint): [AbsolutePoint, AbsolutePoint] {
  if (anchor.row < cursor.row || (anchor.row === cursor.row && anchor.col <= cursor.col)) {
    return [anchor, cursor];
  }
  return [cursor, anchor];
}

export interface SelectionRowRect {
  /** Viewport-relative row (0 = the pane's first visible row). */
  row: number;
  /** Inclusive start column. */
  startCol: number;
  /** Exclusive end column. */
  endCol: number;
}

/**
 * Per-row highlight rectangles for a selection's ordered (start, end)
 * absolute points, clipped to the currently visible viewport rows and to
 * `innerWidth`. One row per visible selected line (simpler than herdr's own
 * 3-rect merge in `Selection::visible_rects`, but the same visible result:
 * the first/last selected row is column-bounded by the anchor/cursor, every
 * row in between spans the full pane width).
 *
 * `start`/`end` must already be in reading order (see
 * `orderSelectionPoints`).
 */
export function selectionRowRects(
  start: AbsolutePoint,
  end: AbsolutePoint,
  viewportTop: number,
  viewportRows: number,
  innerWidth: number,
): SelectionRowRect[] {
  const rects: SelectionRowRect[] = [];
  const bottomExclusive = viewportTop + viewportRows;
  const firstVisible = Math.max(start.row, viewportTop);
  const lastVisible = Math.min(end.row, bottomExclusive - 1);
  for (let row = firstVisible; row <= lastVisible; row++) {
    const isFirst = row === start.row;
    const isLast = row === end.row;
    const from = isFirst ? start.col : 0;
    const to = Math.min(innerWidth, isLast ? end.col + 1 : innerWidth);
    if (to > from) {
      rects.push({ row: row - viewportTop, startCol: from, endCol: to });
    }
  }
  return rects;
}
