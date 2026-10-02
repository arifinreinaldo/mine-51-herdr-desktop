// Pure parts of "the selection follows the pane's scroll". A selection is
// stored as absolute scrollback rows, but the highlight and the pointer's row
// are viewport-relative, so both need the viewport's CURRENT top row. When the
// wheel scrolls the pane during or after a selection, the top row changes and
// the highlight and the drag end must be recomputed (`appTerminalMouse.ts`
// polls the pane's scroll metrics and uses these).

import {
  absoluteRowForViewportRow,
  clampToPaneLocal,
  viewportTopRow,
  type AbsolutePoint,
  type CellRect,
} from "./geometry";

/** The scroll metrics `pane_mouse_hit` reports for a pane. */
export interface PaneScroll {
  offset_from_bottom: number;
  max_offset_from_bottom: number;
  viewport_rows: number;
}

export interface Viewport {
  /** The absolute row of the viewport's first visible row. */
  top: number;
  rows: number;
}

/** The viewport for the pane's current scroll metrics. No metrics (a pane with no scrollback)
 * means the live bottom, `fallbackRows` tall. */
export function viewportFor(scroll: PaneScroll | null | undefined, fallbackRows: number): Viewport {
  return { top: viewportTopRow(scroll), rows: scroll?.viewport_rows ?? fallbackRows };
}

export function viewportChanged(a: Viewport, b: Viewport): boolean {
  return a.top !== b.top || a.rows !== b.rows;
}

/** The selection point under a pointer at screen cell `cell`, for a viewport that starts at row
 * `top`. The cell is clamped into the pane, so a pointer outside it holds the selection at the
 * pane's edge. */
export function selectionPointFor(cell: { col: number; row: number }, innerRect: CellRect, top: number): AbsolutePoint {
  const local = clampToPaneLocal(cell.col, cell.row, innerRect);
  return { row: absoluteRowForViewportRow(local.row, top), col: local.col };
}

/** Whether the pane scrolling under a still pointer makes this press a selection. Only a USER
 * scroll counts: `offset_from_bottom` differs from its value at mouse-down. Output growing at the
 * live bottom also moves the viewport's top row (`max_offset_from_bottom` grows), and must not turn
 * a plain click on a busy pane into a selection that overwrites the clipboard. */
export function scrollMakesDrag(
  startOffset: number,
  scroll: PaneScroll | null | undefined,
  cursor: AbsolutePoint,
  anchor: AbsolutePoint,
): boolean {
  const offset = scroll?.offset_from_bottom ?? 0;
  return offset !== startOffset && (cursor.row !== anchor.row || cursor.col !== anchor.col);
}

/** A screen cell inside the pane to ask for its scroll metrics: the pointer cell, clamped into the
 * pane. A pointer outside the pane would otherwise hit another pane or nothing. */
export function probeCell(cell: { col: number; row: number }, innerRect: CellRect): { col: number; row: number } {
  const local = clampToPaneLocal(cell.col, cell.row, innerRect);
  return { col: innerRect.x + local.col, row: innerRect.y + local.row };
}
