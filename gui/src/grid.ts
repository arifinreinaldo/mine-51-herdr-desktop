// The frontend's own paint-grid copy (spec §2 "State ownership": "The
// frontend keeps a grid copy for painting, fed only by backend messages").
// This is presentation state, distinct from the backend's authoritative
// `SurfaceMirror` (`src-tauri/src/mirror.rs`). Stubbed: applying a decoded
// frame to the grid is application logic, left for the implementer.

import type { DecodedCursor, DecodedSurfaceFrame } from "./decoder";

export interface GridCell {
  symbol: string;
  fg: number;
  bg: number;
  modifier: number;
  skip: boolean;
}

export interface Grid {
  width: number;
  height: number;
  cells: GridCell[];
  cursor: DecodedCursor | null;
  surfaceRevision: number;
}

export function createEmptyGrid(): Grid {
  return { width: 0, height: 0, cells: [], cursor: null, surfaceRevision: 0 };
}

/**
 * Caps on a decoded frame's `width`/`height` (code review finding #3):
 * without these, a corrupted or malicious header could make
 * `applyDecodedFrame` allocate up to 65535 * 65535 cells.
 */
const MAX_FRAME_DIMENSION = 1000;
const MAX_FRAME_CELLS = 1_000_000;

/**
 * Applies a decoded full frame or row patch to `grid`, returning the
 * updated grid and the list of dirty row indices to repaint (spec §2
 * "Rendering": "Repaint dirty rows only").
 */
function emptyCell(): GridCell {
  return { symbol: "", fg: 0, bg: 0, modifier: 0, skip: true };
}

export function applyDecodedFrame(
  grid: Grid,
  frame: DecodedSurfaceFrame,
): { grid: Grid; dirtyRows: number[] } {
  if (
    frame.width > MAX_FRAME_DIMENSION ||
    frame.height > MAX_FRAME_DIMENSION ||
    frame.width * frame.height > MAX_FRAME_CELLS
  ) {
    console.warn(
      `applyDecodedFrame: ignoring oversize frame ${frame.width}x${frame.height}`,
    );
    return { grid, dirtyRows: [] };
  }

  if (frame.kind === "full") {
    const cells: GridCell[] = new Array(frame.width * frame.height);
    for (const row of frame.rows) {
      for (let i = 0; i < row.cells.length; i++) {
        cells[row.y * frame.width + row.x + i] = row.cells[i];
      }
    }
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) cells[i] = emptyCell();
    }
    const next: Grid = {
      width: frame.width,
      height: frame.height,
      cells,
      cursor: frame.cursor,
      surfaceRevision: frame.surfaceRevision,
    };
    const dirtyRows = frame.rows.map((row) => row.y);
    return { grid: next, dirtyRows };
  }

  // A row patch: overwrite only the touched cells, in place on a copy of
  // the existing grid, and report only the rows that changed. In herdr's
  // own semantics (`PaneSurfacePatch.cursor: Option<CursorState>`,
  // `surface_patch.rs:50`), a patch's cursor *replaces* the mirror's:
  // `None` means "no cursor" outright, not "unchanged" (code review
  // finding #7 -- the old `frame.cursor ?? grid.cursor` treated `null` as
  // "keep old", which left ghost cursors behind when one moved).
  const cells = grid.cells.slice();
  const dirtyRows: number[] = [];
  for (const row of frame.rows) {
    for (let i = 0; i < row.cells.length; i++) {
      cells[row.y * grid.width + row.x + i] = row.cells[i];
    }
    dirtyRows.push(row.y);
  }
  const next: Grid = {
    width: grid.width,
    height: grid.height,
    cells,
    cursor: frame.cursor,
    surfaceRevision: frame.surfaceRevision,
  };
  return { grid: next, dirtyRows };
}
