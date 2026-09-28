import { describe, expect, it } from "vitest";
import { cursorShapeFromParam, decodeSurfaceFrame } from "../../src/decoder";

/** Builds a minimal valid v1 frame (spec §5): kind=1, 1x1, one plain cell. */
function buildMinimalFullFrame(): Uint8Array {
  const bytes: number[] = [];
  bytes.push(1); // kind = full
  // surface_revision: u64 LE = 1
  bytes.push(1, 0, 0, 0, 0, 0, 0, 0);
  // width=1, height=1
  bytes.push(1, 0, 1, 0);
  // cursor_x=0, cursor_y=0, cursor_visible=0
  bytes.push(0, 0, 0, 0, 0);
  // row_count = 1
  bytes.push(1, 0);
  // row: y=0, x=0, cell_count=1
  bytes.push(0, 0, 0, 0, 1, 0);
  // cell: sym_len=1, "a", fg=0,bg=0,modifier=0,flags=0
  bytes.push(1, "a".charCodeAt(0));
  bytes.push(0, 0, 0, 0); // fg
  bytes.push(0, 0, 0, 0); // bg
  bytes.push(0, 0); // modifier
  bytes.push(0); // flags
  return new Uint8Array(bytes);
}

describe("decodeSurfaceFrame", () => {
  it("decodes a minimal full frame's header and one cell", () => {
    const decoded = decodeSurfaceFrame(buildMinimalFullFrame());
    expect(decoded.kind).toBe("full");
    expect(decoded.surfaceRevision).toBe(1);
    expect(decoded.width).toBe(1);
    expect(decoded.height).toBe(1);
    expect(decoded.cursor).toEqual({ x: 0, y: 0, visible: false, shape: "block", blink: true });
    expect(decoded.rows).toEqual([{ y: 0, x: 0, cells: [{ symbol: "a", fg: 0, bg: 0, modifier: 0, skip: false }] }]);
  });

  it("decodes kind=2 as a row patch", () => {
    const bytes = buildMinimalFullFrame();
    bytes[0] = 2;
    expect(decodeSurfaceFrame(bytes).kind).toBe("rows");
  });

  it("decodes cursor_visible=1 as a visible cursor", () => {
    const bytes = buildMinimalFullFrame();
    bytes[17] = 1; // cursor_visible offset (see header layout)
    expect(decodeSurfaceFrame(bytes).cursor?.visible).toBe(true);
  });

  it("decodes sym_len=0 as an empty/skip cell symbol", () => {
    const bytes = buildMinimalFullFrame();
    // Replace the one cell (sym_len=1,'a') with sym_len=0 and flags bit0 set.
    const withoutCell = Array.from(bytes.slice(0, 26)); // up to and including row header
    withoutCell.push(0); // sym_len = 0
    withoutCell.push(0, 0, 0, 0); // fg
    withoutCell.push(0, 0, 0, 0); // bg
    withoutCell.push(0, 0); // modifier
    withoutCell.push(1); // flags bit0 = skip
    const decoded = decodeSurfaceFrame(new Uint8Array(withoutCell));
    expect(decoded.rows[0].cells[0]).toEqual({ symbol: "", fg: 0, bg: 0, modifier: 0, skip: true });
  });

  it("decodes a multi-byte UTF-8 grapheme symbol", () => {
    const crab = new TextEncoder().encode("\u{1F980}"); // "🦀", 4 bytes
    const bytes: number[] = [
      1, // kind
      1, 0, 0, 0, 0, 0, 0, 0, // surface_revision
      1, 0, 1, 0, // width, height
      0, 0, 0, 0, 0, // cursor
      1, 0, // row_count
      0, 0, 0, 0, 1, 0, // row header: y,x,cell_count
      crab.length, ...crab,
      0, 0, 0, 0, // fg
      0, 0, 0, 0, // bg
      0, 0, // modifier
      0, // flags
    ];
    const decoded = decodeSurfaceFrame(new Uint8Array(bytes));
    expect(decoded.rows[0].cells[0].symbol).toBe("\u{1F980}");
  });

  it("decodes rustUs as 0 when the trailing u32 is absent (existing golden fixtures)", () => {
    const decoded = decodeSurfaceFrame(buildMinimalFullFrame());
    expect(decoded.rustUs).toBe(0);
  });

  it("decodes the trailing little-endian u32 rust_us when present (spec §8a.4)", () => {
    const bytes = Array.from(buildMinimalFullFrame());
    // 1_500_000 = 0x16E360, little-endian u32.
    bytes.push(0x60, 0xe3, 0x16, 0x00);
    const decoded = decodeSurfaceFrame(new Uint8Array(bytes));
    expect(decoded.rustUs).toBe(1_500_000);
    // The trailer must not disturb anything the payload already carried.
    expect(decoded.rows).toEqual([{ y: 0, x: 0, cells: [{ symbol: "a", fg: 0, bg: 0, modifier: 0, skip: false }] }]);
  });

  it("cursorShapeFromParam maps every DECSCUSR value (src/protocol/wire.rs:746-765)", () => {
    expect(cursorShapeFromParam(0)).toEqual({ shape: "block", blink: true }); // terminal default
    expect(cursorShapeFromParam(1)).toEqual({ shape: "block", blink: true });
    expect(cursorShapeFromParam(2)).toEqual({ shape: "block", blink: false });
    expect(cursorShapeFromParam(3)).toEqual({ shape: "underline", blink: true });
    expect(cursorShapeFromParam(4)).toEqual({ shape: "underline", blink: false });
    expect(cursorShapeFromParam(5)).toEqual({ shape: "bar", blink: true });
    expect(cursorShapeFromParam(6)).toEqual({ shape: "bar", blink: false });
    expect(cursorShapeFromParam(99)).toEqual({ shape: "block", blink: true }); // unknown -> default
  });

  it("decodes a cursor-shape-only trailer (1 byte left, no rust_us) -- commands::sync_state's replay frame", () => {
    const bytes = Array.from(buildMinimalFullFrame());
    bytes[17] = 1; // cursor_visible = true, so the cursor isn't the "absent" sentinel
    bytes.push(5); // shape trailer only: blinking bar
    const decoded = decodeSurfaceFrame(new Uint8Array(bytes));
    expect(decoded.rustUs).toBe(0);
    expect(decoded.cursor).toEqual({ x: 0, y: 0, visible: true, shape: "bar", blink: true });
  });

  it("decodes a shape-then-rust_us trailer (5+ bytes left)", () => {
    const bytes = Array.from(buildMinimalFullFrame());
    bytes[17] = 1; // cursor_visible = true
    bytes.push(4); // shape: steady underline
    bytes.push(0x60, 0xe3, 0x16, 0x00); // rust_us = 1_500_000, little-endian u32
    const decoded = decodeSurfaceFrame(new Uint8Array(bytes));
    expect(decoded.rustUs).toBe(1_500_000);
    expect(decoded.cursor).toEqual({ x: 0, y: 0, visible: true, shape: "underline", blink: false });
  });

  it("a rust_us-only trailer (exactly 4 bytes left) still decodes with no shape info -- old golden fixtures", () => {
    const bytes = Array.from(buildMinimalFullFrame());
    bytes[17] = 1; // cursor_visible = true
    bytes.push(0x60, 0xe3, 0x16, 0x00); // rust_us = 1_500_000
    const decoded = decodeSurfaceFrame(new Uint8Array(bytes));
    expect(decoded.rustUs).toBe(1_500_000);
    expect(decoded.cursor).toEqual({ x: 0, y: 0, visible: true, shape: "block", blink: true });
  });

  it("decodes multiple rows in a row patch", () => {
    const bytes: number[] = [
      2, // kind = rows
      5, 0, 0, 0, 0, 0, 0, 0, // surface_revision = 5
      80, 0, 24, 0, // width, height
      0, 0, 0, 0, 0, // cursor
      2, 0, // row_count = 2
      3, 0, 2, 0, 1, 0, // row 0: y=3,x=2,cell_count=1
      1, "x".charCodeAt(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      7, 0, 9, 0, 1, 0, // row 1: y=7,x=9,cell_count=1
      1, "y".charCodeAt(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    const decoded = decodeSurfaceFrame(new Uint8Array(bytes));
    expect(decoded.rows).toHaveLength(2);
    expect(decoded.rows[0].y).toBe(3);
    expect(decoded.rows[1].y).toBe(7);
  });
});
