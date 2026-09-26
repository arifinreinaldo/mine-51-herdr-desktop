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
class ByteReader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u64(): number {
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return Number(value);
  }

  bytes_(len: number): Uint8Array {
    const slice = this.bytes.subarray(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }
}

const textDecoder = new TextDecoder();

export function decodeSurfaceFrame(bytes: Uint8Array): DecodedSurfaceFrame {
  const reader = new ByteReader(bytes);
  const kindByte = reader.u8();
  const kind: "full" | "rows" = kindByte === 1 ? "full" : "rows";
  const surfaceRevision = reader.u64();
  const width = reader.u16();
  const height = reader.u16();
  const cursorX = reader.u16();
  const cursorY = reader.u16();
  const cursorVisible = reader.u8() !== 0;
  const rowCount = reader.u16();

  // A full frame always defines a concrete cursor. A row patch's cursor is
  // optional (`PaneSurfacePatch.cursor: Option<CursorState>`); in herdr's
  // own semantics `None` *replaces* the surface's cursor with "no cursor"
  // (`surface_patch.rs:50`), it does not mean "unchanged" (code review
  // finding #7). The wire format has no separate present/absent bit, so a
  // patch's all-zero sentinel (the encoder's representation of `None`,
  // spec §5) decodes back to `null` here; `grid.ts` must treat that `null`
  // as "clear the cursor", not "keep the previous one".
  const cursor: DecodedCursor | null =
    kind === "rows" && cursorX === 0 && cursorY === 0 && !cursorVisible
      ? null
      : { x: cursorX, y: cursorY, visible: cursorVisible };

  const rows: DecodedRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const y = reader.u16();
    const x = reader.u16();
    const cellCount = reader.u16();
    const cells: DecodedCell[] = [];
    for (let c = 0; c < cellCount; c++) {
      const symLen = reader.u8();
      const symbol = symLen === 0 ? "" : textDecoder.decode(reader.bytes_(symLen));
      const fg = reader.u32();
      const bg = reader.u32();
      const modifier = reader.u16();
      const flags = reader.u8();
      const skip = (flags & 1) === 1;
      cells.push({ symbol, fg, bg, modifier, skip });
    }
    rows.push({ y, x, cells });
  }

  return {
    kind,
    surfaceRevision,
    width,
    height,
    cursor,
    rows,
  };
}
