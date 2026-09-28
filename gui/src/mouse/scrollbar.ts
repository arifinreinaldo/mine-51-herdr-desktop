// Pane scrollbar-thumb geometry and drag-to-offset maths (terminal-parity
// spec P1 #10 "Scrollback keys ... Dragging the scrollbar thumb within
// `scrollbar_rect` -> `pane.scroll`"), ported line-for-line from herdr's TUI
// client's own `src/ui/scrollbar.rs:37-134` (`scrollbar_thumb`,
// `scrollbar_thumb_grab_offset`, `scrollbar_offset_from_thumb_top`,
// `scrollbar_offset_from_row`, `scrollbar_offset_from_drag_row`) -- not
// invented. Kept pure/DOM-free, like `mouse/geometry.ts`, so it is
// unit-testable without a canvas or a live connection.

import type { CellRect } from "./geometry";

export interface ScrollMetricsLike {
  offset_from_bottom: number;
  max_offset_from_bottom: number;
  viewport_rows: number;
}

export interface ScrollbarThumb {
  top: number;
  len: number;
}

/** `src/ui/scrollbar.rs:37-71`. `null` when there is nothing to scroll
 * (`max_offset_from_bottom === 0`) or the track has no height. */
export function scrollbarThumb(metrics: ScrollMetricsLike, track: CellRect): ScrollbarThumb | null {
  if (metrics.max_offset_from_bottom === 0 || track.height === 0) return null;

  const trackHeight = track.height;
  const totalRows = metrics.max_offset_from_bottom + metrics.viewport_rows;
  if (totalRows === 0) return null;

  const thumbLen = Math.min(
    trackHeight,
    Math.max(1, Math.round((metrics.viewport_rows * trackHeight) / totalRows)),
  );
  const maxThumbTop = Math.max(0, trackHeight - thumbLen);
  const scrolledFromTop = Math.max(0, metrics.max_offset_from_bottom - metrics.offset_from_bottom);
  const thumbTop =
    maxThumbTop === 0 || metrics.max_offset_from_bottom === 0
      ? 0
      : Math.min(maxThumbTop, Math.max(0, Math.round((scrolledFromTop * maxThumbTop) / metrics.max_offset_from_bottom)));

  return { top: track.y + thumbTop, len: thumbLen };
}

/** `src/ui/scrollbar.rs:73-80`: the row offset *within the thumb* where a
 * Down at `row` grabbed it, or `null` when `row` is outside the thumb
 * (the caller then jump-scrolls instead of starting a drag,
 * `mouse.rs:2156-2168`). */
export function scrollbarThumbGrabOffset(metrics: ScrollMetricsLike, track: CellRect, row: number): number | null {
  const thumb = scrollbarThumb(metrics, track);
  if (!thumb) return null;
  return row >= thumb.top && row < thumb.top + thumb.len ? row - thumb.top : null;
}

/** `src/ui/scrollbar.rs:82-106`. */
function scrollbarOffsetFromThumbTop(metrics: ScrollMetricsLike, track: CellRect, thumbTop: number): number {
  if (metrics.max_offset_from_bottom === 0) return 0;

  const thumbLen = scrollbarThumb(metrics, track)?.len ?? 1;
  const maxThumbTop = track.height - Math.min(thumbLen, track.height);
  if (maxThumbTop === 0) return 0;

  const desiredTop = Math.min(thumbTop, maxThumbTop);
  const scrolledFromTop = Math.round((desiredTop * metrics.max_offset_from_bottom) / maxThumbTop);
  return Math.max(0, metrics.max_offset_from_bottom - scrolledFromTop);
}

/** `src/ui/scrollbar.rs:108-122`: a click on the track (not the thumb
 * itself) centers the thumb on the clicked row -- the "jump scroll" case. */
export function scrollbarOffsetFromRow(metrics: ScrollMetricsLike, track: CellRect, row: number): number {
  const thumb = scrollbarThumb(metrics, track);
  if (!thumb) return 0;
  const clampedRow = Math.min(Math.max(row, track.y), track.y + Math.max(0, track.height - 1));
  const rowOffset = Math.max(0, clampedRow - track.y);
  const thumbCenter = Math.floor(thumb.len / 2);
  const desiredTop = Math.max(0, rowOffset - thumbCenter);
  return scrollbarOffsetFromThumbTop(metrics, track, desiredTop);
}

/** `src/ui/scrollbar.rs:124-134`: an in-progress thumb drag, `grabRowOffset`
 * being the row within the thumb captured at grab time
 * (`scrollbarThumbGrabOffset`). */
export function scrollbarOffsetFromDragRow(
  metrics: ScrollMetricsLike,
  track: CellRect,
  row: number,
  grabRowOffset: number,
): number {
  const clampedRow = Math.min(Math.max(row, track.y), track.y + Math.max(0, track.height - 1));
  const rowOffset = Math.max(0, clampedRow - track.y);
  const desiredTop = Math.max(0, rowOffset - grabRowOffset);
  return scrollbarOffsetFromThumbTop(metrics, track, desiredTop);
}
