// Decodes the backend -> frontend compact binary surface format (spec §5).
// The single consumer of `gui/tests/golden/*.bin`. Stubbed: decoding is
// application logic, not scaffolding, and is left for the implementer.
// See `../src-tauri/src/surface_encode.rs` for the (real, implemented)
// Rust-side encoder this must invert byte-for-byte.

export interface DecodedCell {
  symbol: string;
  /** Packed colour: see spec §1 "Colour packing". */
  fg: number;
  bg: number;
  /** See spec §1 "modifier bits" (bits 12-15 are herdr's underline-style nibble). */
  modifier: number;
  skip: boolean;
}

export interface DecodedRow {
  y: number;
  x: number;
  cells: DecodedCell[];
}

export interface DecodedCursor {
  x: number;
  y: number;
  visible: boolean;
}

export interface DecodedSurfaceFrame {
  kind: "full" | "rows";
  /**
   * `u64` on the wire. Kept as `number` for simplicity: a session would
   * need over 2^53 revisions before this loses precision.
   */
  surfaceRevision: number;
  width: number;
  height: number;
  cursor: DecodedCursor | null;
  rows: DecodedRow[];
}

/**
 * Decodes one binary surface frame (spec §5 layout):
 * ```text
 * u8  kind            1 = full, 2 = rows
 * u64 surface_revision
 * u16 width, u16 height
 * u16 cursor_x, u16 cursor_y, u8 cursor_visible
 * u16 row_count
 * repeat row_count:
 *   u16 y, u16 x, u16 cell_count
 *   repeat cell_count:
 *     u8 sym_len, sym_len bytes UTF-8 (sym_len 0 = empty/skip cell)
 *     u32 fg, u32 bg, u16 modifier, u8 flags (bit0 = skip)
 * ```
 */
export function decodeSurfaceFrame(_bytes: Uint8Array): DecodedSurfaceFrame {
  throw new Error("not implemented: decodeSurfaceFrame");
}
