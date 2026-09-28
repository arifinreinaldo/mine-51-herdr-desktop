// vim-like copy mode (terminal-parity spec P1 #8), entered with
// Ctrl+Shift+Space. Keys follow the TUI's own copy mode
// (`src/client/shell/copy_mode.rs`): hjkl/arrows move the cursor one cell,
// w/b/e move by word (server-side, `pane.copy_motion` -- word boundaries
// need the actual text), 0/g/G are simple column/row arithmetic (client-
// side: column 0, the top of scrollback, the live bottom), `$` is
// `PaneCopyMotion::LineEnd` (server-side: the actual trimmed line length),
// `v` starts/extends a selection from the cursor, `y`/Enter copies it
// (`pane.selection.read`, bound to the entry `content_revision` -- the same
// non-live path herdr's own word-selection copy uses,
// `src/client/shell/actions.rs:273-305`), and Esc exits without copying.
//
// Deliberately out of scope: dragging the mouse while in copy mode, and
// re-fetching pane geometry/`content_revision` mid-session if the pane's
// content changes underneath it (a stale `content_revision` simply makes
// the next server round trip fail, same as any other stale-revision call
// in this codebase) -- copy mode is a short-lived, keyboard-only session.

import { api, invokeSafe } from "./appApi";
import { terminalWrapEl } from "./appDom";
import { focusedPaneId } from "./appLookups";
import { appState } from "./appState";
import { showCopiedNotice } from "./copyNotice";
import type { AbsolutePoint } from "./mouse/geometry";
import { orderSelectionPoints, selectionRowRects, viewportTopRow } from "./mouse/geometry";
import { paneOverlayOrigin } from "./mouse/overlayGeometry";
import { SelectionOverlay } from "./mouse/selectionOverlay";
import { writeToClipboard } from "./paneActions";

interface PaneKeyboardInfoLike {
  content_revision: number;
  inner_rect: { x: number; y: number; width: number; height: number };
  scroll: { offset_from_bottom: number; max_offset_from_bottom: number; viewport_rows: number } | null;
}

interface CopyModeSession {
  paneId: string;
  width: number;
  viewportTop: number;
  viewportRows: number;
  maxOffsetFromBottom: number;
  contentRevision: number;
  cursor: AbsolutePoint;
  anchor: AbsolutePoint | null;
}

let session: CopyModeSession | null = null;
let selectionOverlay: SelectionOverlay | null = null;
let cursorOverlay: SelectionOverlay | null = null;
let badgeEl: HTMLDivElement | null = null;

export function isCopyModeActive(): boolean {
  return session !== null;
}

function selectionOverlayFor(): SelectionOverlay {
  if (!selectionOverlay) selectionOverlay = new SelectionOverlay(terminalWrapEl, "terminal-copymode-row");
  return selectionOverlay;
}

function cursorOverlayFor(): SelectionOverlay {
  if (!cursorOverlay) cursorOverlay = new SelectionOverlay(terminalWrapEl, "terminal-copymode-cursor");
  return cursorOverlay;
}

function badge(): HTMLDivElement {
  if (!badgeEl) {
    badgeEl = document.createElement("div");
    badgeEl.className = "copy-mode-badge";
    terminalWrapEl.appendChild(badgeEl);
  }
  return badgeEl;
}

/** Ctrl+Shift+Space: enters copy mode on the focused pane, starting the
 * cursor at the pane's own live cursor position (the most intuitive
 * "where am I" starting point) when known, else the viewport's top-left. */
export async function enterCopyMode(): Promise<void> {
  if (session) return;
  const paneId = focusedPaneId();
  if (!paneId) return;
  const info = await invokeSafe<PaneKeyboardInfoLike | null>("pane_keyboard_info", { paneId });
  if (!info) return;
  const top = viewportTopRow(info.scroll);
  const viewportRows = info.scroll?.viewport_rows ?? info.inner_rect.height;
  const liveCursor = appState.grid.cursor;
  const cursor: AbsolutePoint =
    liveCursor && liveCursor.y >= 0 && liveCursor.y < viewportRows
      ? { row: top + liveCursor.y, col: liveCursor.x }
      : { row: top, col: 0 };
  session = {
    paneId,
    width: info.inner_rect.width,
    viewportTop: top,
    viewportRows,
    maxOffsetFromBottom: info.scroll?.max_offset_from_bottom ?? 0,
    contentRevision: info.content_revision,
    cursor,
    anchor: null,
  };
  render();
}

export function exitCopyMode(): void {
  if (!session) return;
  session = null;
  selectionOverlay?.clear();
  cursorOverlay?.clear();
  badgeEl?.remove();
  badgeEl = null;
}

function render(): void {
  if (!session) return;
  const renderer = appState.renderer;
  if (!renderer) return;
  const origin = paneOverlayOrigin(
    { x: 0, y: 0, width: session.width, height: session.viewportRows },
    renderer,
  );
  const cursorRow = session.cursor.row - session.viewportTop;
  if (cursorRow >= 0 && cursorRow < session.viewportRows) {
    cursorOverlayFor().render(
      [{ row: cursorRow, startCol: session.cursor.col, endCol: session.cursor.col + 1 }],
      origin.originLeft,
      origin.originTop,
      origin.cellWidthCss,
      origin.cellHeightCss,
    );
  } else {
    cursorOverlayFor().clear();
  }
  if (session.anchor) {
    const [start, end] = orderSelectionPoints(session.anchor, session.cursor);
    const rects = selectionRowRects(start, end, session.viewportTop, session.viewportRows, session.width);
    selectionOverlayFor().render(rects, origin.originLeft, origin.originTop, origin.cellWidthCss, origin.cellHeightCss);
  } else {
    selectionOverlay?.clear();
  }
  badge().textContent = session.anchor ? "-- VISUAL --" : "-- COPY --";
}

/** Pure clamp of a cursor point to `[0, maxRow] x [0, width - 1]` -- pulled
 * out of `clampCursor` below so the bounds arithmetic is unit-testable
 * without a live copy-mode session. */
export function clampToPaneBounds(point: AbsolutePoint, maxRow: number, width: number): AbsolutePoint {
  return {
    row: Math.min(Math.max(point.row, 0), Math.max(0, maxRow)),
    col: Math.min(Math.max(point.col, 0), Math.max(0, width - 1)),
  };
}

function clampCursor(): void {
  if (!session) return;
  const maxRow = session.maxOffsetFromBottom + session.viewportRows - 1;
  session.cursor = clampToPaneBounds(session.cursor, maxRow, session.width);
}

async function applyMotion(motion: string): Promise<void> {
  if (!session) return;
  const result = await api<{ cursor?: { row: number; col: number } }>("pane.copy_motion", {
    pane_id: session.paneId,
    cursor: { row: session.cursor.row, col: session.cursor.col },
    motion,
    content_revision: session.contentRevision,
  });
  if (!session || !result?.cursor) return;
  session.cursor = { row: result.cursor.row, col: result.cursor.col };
  render();
}

async function copySelection(): Promise<void> {
  if (!session?.anchor) return;
  const [start, end] = orderSelectionPoints(session.anchor, session.cursor);
  const result = await api<{ text?: string }>("pane.selection.read", {
    pane_id: session.paneId,
    anchor: { row: start.row, col: start.col },
    cursor: { row: end.row, col: end.col },
    content_revision: session.contentRevision,
  });
  if (await writeToClipboard(result?.text)) showCopiedNotice();
}

/**
 * Handles one keydown while copy mode is active. Returns `true` when the
 * key was a copy-mode binding (the caller must `preventDefault()` and never
 * forward it to the terminal), `false` for anything else (left alone).
 */
export function handleCopyModeKeydown(event: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  if (!session || event.ctrlKey || event.altKey || event.metaKey) return false;
  switch (event.key) {
    case "Escape":
      exitCopyMode();
      return true;
    case "h":
    case "ArrowLeft":
      session.cursor.col -= 1;
      clampCursor();
      render();
      return true;
    case "l":
    case "ArrowRight":
      session.cursor.col += 1;
      clampCursor();
      render();
      return true;
    case "k":
    case "ArrowUp":
      session.cursor.row -= 1;
      clampCursor();
      render();
      return true;
    case "j":
    case "ArrowDown":
      session.cursor.row += 1;
      clampCursor();
      render();
      return true;
    case "0":
      session.cursor.col = 0;
      render();
      return true;
    case "g":
      session.cursor = { row: 0, col: session.cursor.col };
      clampCursor();
      render();
      return true;
    case "G":
      session.cursor = { row: session.maxOffsetFromBottom + session.viewportRows - 1, col: session.cursor.col };
      clampCursor();
      render();
      return true;
    case "$":
      void applyMotion("line_end");
      return true;
    case "w":
      void applyMotion("next_word_start");
      return true;
    case "b":
      void applyMotion("previous_word_start");
      return true;
    case "e":
      void applyMotion("next_word_end");
      return true;
    case "v":
      session.anchor = session.anchor ? null : { ...session.cursor };
      render();
      return true;
    case "y":
    case "Enter":
      void copySelection();
      exitCopyMode();
      return true;
    default:
      return false;
  }
}
