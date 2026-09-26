//! Encodes the backend -> frontend compact binary surface format (spec §5).
//!
//! This is the Rust-side encoder half of the golden-bytes contract (spec
//! §9.7): it is implemented for real (not stubbed), because
//! `tests/golden_bytes.rs`'s `UPDATE_GOLDEN=1` generator needs real,
//! deterministic bytes to write to `gui/tests/golden/*.bin`. The
//! TypeScript decoder that reads those same files back
//! (`src/decoder.ts`) is the stub half: it is the single consumer per
//! spec §5, and porting it is left for the implementer.
//!
//! Format (v1, little-endian), copied from spec §5:
//! ```text
//! u8  kind            1 = full, 2 = rows
//! u64 surface_revision
//! u16 width, u16 height
//! u16 cursor_x, u16 cursor_y, u8 cursor_visible
//! u16 row_count
//! repeat row_count:
//!   u16 y, u16 x, u16 cell_count
//!   repeat cell_count:
//!     u8 sym_len, sym_len bytes UTF-8 (sym_len 0 = empty/skip cell)
//!     u32 fg, u32 bg, u16 modifier, u8 flags (bit0 = skip)
//! ```

use herdr_wire::CursorState;

use crate::mirror::Cell;

pub const KIND_FULL: u8 = 1;
pub const KIND_ROWS: u8 = 2;

/// One encoded row: `y`/`x` are absolute surface coordinates, `cells` are
/// contiguous starting at `x`.
pub struct EncodedRow<'a> {
    pub y: u16,
    pub x: u16,
    pub cells: &'a [Cell],
}

/// Encodes a full frame: `kind = 1`, one row per surface row, each row
/// spanning the whole width (`x = 0`, `cell_count = width`).
pub fn encode_full_frame(
    surface_revision: u64,
    width: u16,
    height: u16,
    cursor: Option<&CursorState>,
    cells: &[Cell],
) -> Vec<u8> {
    debug_assert_eq!(cells.len(), usize::from(width) * usize::from(height));
    let rows: Vec<EncodedRow> = cells
        .chunks(usize::from(width).max(1))
        .enumerate()
        .map(|(y, row_cells)| EncodedRow {
            y: y as u16,
            x: 0,
            cells: row_cells,
        })
        .collect();
    encode_frame(KIND_FULL, surface_revision, width, height, cursor, &rows)
}

/// Encodes an incremental update: `kind = 2`, only the given rows.
pub fn encode_row_patch(
    surface_revision: u64,
    width: u16,
    height: u16,
    cursor: Option<&CursorState>,
    rows: &[EncodedRow],
) -> Vec<u8> {
    encode_frame(KIND_ROWS, surface_revision, width, height, cursor, rows)
}

fn encode_frame(
    kind: u8,
    surface_revision: u64,
    width: u16,
    height: u16,
    cursor: Option<&CursorState>,
    rows: &[EncodedRow],
) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(kind);
    out.extend_from_slice(&surface_revision.to_le_bytes());
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    let (cursor_x, cursor_y, cursor_visible) = match cursor {
        Some(cursor) => (cursor.x, cursor.y, u8::from(cursor.visible)),
        None => (0, 0, 0),
    };
    out.extend_from_slice(&cursor_x.to_le_bytes());
    out.extend_from_slice(&cursor_y.to_le_bytes());
    out.push(cursor_visible);
    out.extend_from_slice(&(rows.len() as u16).to_le_bytes());
    for row in rows {
        out.extend_from_slice(&row.y.to_le_bytes());
        out.extend_from_slice(&row.x.to_le_bytes());
        out.extend_from_slice(&(row.cells.len() as u16).to_le_bytes());
        for cell in row.cells {
            write_cell(&mut out, cell);
        }
    }
    out
}

fn write_cell(out: &mut Vec<u8>, cell: &Cell) {
    if cell.skip || cell.symbol.is_empty() {
        out.push(0);
    } else {
        let bytes = cell.symbol.as_bytes();
        debug_assert!(
            bytes.len() <= u8::MAX as usize,
            "grapheme cluster too long for sym_len"
        );
        out.push(bytes.len() as u8);
        out.extend_from_slice(bytes);
    }
    out.extend_from_slice(&cell.fg.to_le_bytes());
    out.extend_from_slice(&cell.bg.to_le_bytes());
    out.extend_from_slice(&cell.modifier.to_le_bytes());
    out.push(u8::from(cell.skip));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(symbol: &str, fg: u32, bg: u32, modifier: u16, skip: bool) -> Cell {
        Cell {
            symbol: symbol.into(),
            fg,
            bg,
            modifier,
            skip,
            hyperlink: None,
        }
    }

    #[test]
    fn full_frame_header_matches_the_v1_layout() {
        let cells = vec![cell("a", 1, 2, 3, false), cell("b", 4, 5, 6, false)];
        let bytes = encode_full_frame(7, 2, 1, None, &cells);
        assert_eq!(bytes[0], KIND_FULL);
        assert_eq!(u64::from_le_bytes(bytes[1..9].try_into().unwrap()), 7);
        assert_eq!(u16::from_le_bytes(bytes[9..11].try_into().unwrap()), 2); // width
        assert_eq!(u16::from_le_bytes(bytes[11..13].try_into().unwrap()), 1); // height
        assert_eq!(u16::from_le_bytes(bytes[13..15].try_into().unwrap()), 0); // cursor_x
        assert_eq!(u16::from_le_bytes(bytes[15..17].try_into().unwrap()), 0); // cursor_y
        assert_eq!(bytes[17], 0); // cursor_visible
        assert_eq!(u16::from_le_bytes(bytes[18..20].try_into().unwrap()), 1); // row_count
    }

    #[test]
    fn skip_cell_encodes_sym_len_zero_and_flag_bit0() {
        let cells = vec![cell(" ", 0, 0, 0, true)];
        let bytes = encode_full_frame(1, 1, 1, None, &cells);
        // header is 20 bytes, then row header (y,x,cell_count) is 6 bytes.
        let row_start = 20 + 6;
        assert_eq!(bytes[row_start], 0, "sym_len must be 0 for a skip cell");
        let flags_offset = row_start + 1 + 4 + 4 + 2; // sym_len + fg + bg + modifier
        assert_eq!(
            bytes[flags_offset] & 1,
            1,
            "flags bit0 must be set for skip"
        );
    }

    #[test]
    fn cursor_is_encoded_when_present() {
        let cursor = CursorState {
            x: 3,
            y: 4,
            visible: true,
            shape: 0,
        };
        let bytes = encode_full_frame(1, 1, 1, Some(&cursor), &[cell(" ", 0, 0, 0, false)]);
        assert_eq!(u16::from_le_bytes(bytes[13..15].try_into().unwrap()), 3);
        assert_eq!(u16::from_le_bytes(bytes[15..17].try_into().unwrap()), 4);
        assert_eq!(bytes[17], 1);
    }

    #[test]
    fn row_patch_uses_kind_2_and_only_the_given_rows() {
        let cells = vec![cell("x", 1, 1, 0, false)];
        let rows = vec![EncodedRow {
            y: 5,
            x: 2,
            cells: &cells,
        }];
        let bytes = encode_row_patch(9, 80, 24, None, &rows);
        assert_eq!(bytes[0], KIND_ROWS);
        assert_eq!(u16::from_le_bytes(bytes[18..20].try_into().unwrap()), 1); // row_count
        let row_y = u16::from_le_bytes(bytes[20..22].try_into().unwrap());
        let row_x = u16::from_le_bytes(bytes[22..24].try_into().unwrap());
        assert_eq!(row_y, 5);
        assert_eq!(row_x, 2);
    }

    #[test]
    fn multi_byte_grapheme_symbol_round_trips_length_prefixed() {
        let cells = vec![cell("\u{1F980}", 0, 0, 0, false)]; // "🦀", 4 UTF-8 bytes
        let bytes = encode_full_frame(1, 1, 1, None, &cells);
        let row_start = 20 + 6;
        assert_eq!(bytes[row_start], 4);
        assert_eq!(&bytes[row_start + 1..row_start + 5], "\u{1F980}".as_bytes());
    }
}
