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
 * Applies a decoded full frame or row patch to `grid`, returning the
 * updated grid and the list of dirty row indices to repaint (spec §2
 * "Rendering": "Repaint dirty rows only").
 */
export function applyDecodedFrame(
  _grid: Grid,
  _frame: DecodedSurfaceFrame,
): { grid: Grid; dirtyRows: number[] } {
  throw new Error("not implemented: applyDecodedFrame");
}
