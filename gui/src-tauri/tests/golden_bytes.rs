//! Golden surface bytes generator (spec §9.7).
//!
//! Rust encodes a handful of fixed fixtures into `gui/tests/golden/*.bin`
//! plus a matching `*.json` describing the expected decoded shape. Run with
//! `UPDATE_GOLDEN=1 cargo test -p herdr-gui --test golden_bytes` to
//! (re)generate the committed files; a plain `cargo test` (as `npm run
//! check` runs) instead asserts the encoder still reproduces the committed
//! bytes exactly, so this test is a real regression check, not a stub.
//!
//! `gui/tests/unit/golden.test.ts` decodes the same files with the
//! TypeScript decoder (`src/decoder.ts`, stubbed) and compares against the
//! `.json` -- that side is expected to fail (red) until the decoder is
//! implemented.

use std::path::PathBuf;

use herdr_gui_lib::mirror::Cell;
use herdr_gui_lib::surface_encode::{
    append_rust_us_trailer, encode_full_frame, encode_row_patch, EncodedRow,
};
use herdr_wire::CursorState;

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/golden")
}

fn cell(symbol: &str, fg: u32, bg: u32, modifier: u16, skip: bool) -> Cell {
    Cell {
        symbol: symbol.to_owned(),
        fg,
        bg,
        modifier,
        skip,
        hyperlink: None,
    }
}

/// The JSON a decoder should produce for `cell`, matching `write_cell`'s
/// encoding exactly: a skipped (or already-empty) cell's symbol is encoded
/// as `sym_len = 0`, so it must decode back to `""`, not the original
/// pre-encoding symbol.
fn cell_json(cell: &Cell) -> serde_json::Value {
    let symbol = if cell.skip || cell.symbol.is_empty() {
        ""
    } else {
        &cell.symbol
    };
    serde_json::json!({
        "symbol": symbol,
        "fg": cell.fg,
        "bg": cell.bg,
        "modifier": cell.modifier,
        "skip": cell.skip,
    })
}

struct Fixture {
    name: &'static str,
    bytes: Vec<u8>,
    json: serde_json::Value,
}

/// A 3x2 full frame: plain colours, one bold cell, one skipped cell, and one
/// multi-byte grapheme, so both the byte format and the JSON expectation
/// exercise the interesting cases from spec §5.
fn full_frame_basic() -> Fixture {
    let cursor = CursorState {
        x: 1,
        y: 0,
        visible: true,
        shape: 0,
    };
    let cells = vec![
        cell("h", 2, 0, 0, false),
        cell("i", 3, 0, 1, false), // modifier bit0 = BOLD
        cell(" ", 0, 0, 0, true),  // skipped
        cell("!", 0, 0, 0, false),
        cell("\u{1F980}", 4, 5, 0, false), // "🦀"
        cell(".", 0, 0, 0, false),
    ];
    let bytes = encode_full_frame(7, 3, 2, Some(&cursor), &cells);
    let json = serde_json::json!({
        "kind": "full",
        "surfaceRevision": 7,
        "width": 3,
        "height": 2,
        "cursor": { "x": 1, "y": 0, "visible": true },
        "rows": [
            { "y": 0, "x": 0, "cells": cells[0..3].iter().map(cell_json).collect::<Vec<_>>() },
            { "y": 1, "x": 0, "cells": cells[3..6].iter().map(cell_json).collect::<Vec<_>>() },
        ],
        // No trailing rust_us bytes on this fixture (spec §8a.4): the
        // decoder must treat that absence as 0.
        "rustUs": 0,
    });
    Fixture {
        name: "full-frame-basic",
        bytes,
        json,
    }
}

/// An incremental row patch touching two disjoint spans, with no cursor
/// change (cursor absent).
fn row_patch_basic() -> Fixture {
    let row0_cells = vec![cell("x", 1, 1, 0, false), cell("y", 1, 1, 0, false)];
    let row1_cells = vec![cell("z", 2, 2, 8, false)]; // modifier bit3 = UNDERLINED
    let rows = vec![
        EncodedRow {
            y: 0,
            x: 2,
            cells: &row0_cells,
        },
        EncodedRow {
            y: 1,
            x: 5,
            cells: &row1_cells,
        },
    ];
    let bytes = encode_row_patch(11, 80, 24, None, &rows);
    let json = serde_json::json!({
        "kind": "rows",
        "surfaceRevision": 11,
        "width": 80,
        "height": 24,
        "cursor": null,
        "rows": [
            { "y": 0, "x": 2, "cells": row0_cells.iter().map(cell_json).collect::<Vec<_>>() },
            { "y": 1, "x": 5, "cells": row1_cells.iter().map(cell_json).collect::<Vec<_>>() },
        ],
        "rustUs": 0,
    });
    Fixture {
        name: "row-patch-basic",
        bytes,
        json,
    }
}

/// Same full frame as `full_frame_basic`, plus the spec §8a.4 trailing
/// `rust_us` (a fixed, made-up value -- this fixture exists to prove the
/// *decoder* reads a trailer when one is present, not to assert a real
/// timing).
fn full_frame_with_rust_us() -> Fixture {
    let cursor = CursorState {
        x: 1,
        y: 0,
        visible: true,
        shape: 0,
    };
    let cells = vec![cell("h", 2, 0, 0, false), cell("i", 3, 0, 1, false)];
    let mut bytes = encode_full_frame(7, 2, 1, Some(&cursor), &cells);
    append_rust_us_trailer(&mut bytes, 1234);
    let json = serde_json::json!({
        "kind": "full",
        "surfaceRevision": 7,
        "width": 2,
        "height": 1,
        "cursor": { "x": 1, "y": 0, "visible": true },
        "rows": [
            { "y": 0, "x": 0, "cells": cells.iter().map(cell_json).collect::<Vec<_>>() },
        ],
        "rustUs": 1234,
    });
    Fixture {
        name: "full-frame-with-rust-us",
        bytes,
        json,
    }
}

/// Same row patch shape as `row_patch_basic`, plus the trailer, exercising
/// `kind = 2` (rows) with a trailer too.
fn row_patch_with_rust_us() -> Fixture {
    let row0_cells = vec![cell("x", 1, 1, 0, false)];
    let rows = vec![EncodedRow {
        y: 0,
        x: 2,
        cells: &row0_cells,
    }];
    let mut bytes = encode_row_patch(11, 80, 24, None, &rows);
    append_rust_us_trailer(&mut bytes, 42);
    let json = serde_json::json!({
        "kind": "rows",
        "surfaceRevision": 11,
        "width": 80,
        "height": 24,
        "cursor": null,
        "rows": [
            { "y": 0, "x": 2, "cells": row0_cells.iter().map(cell_json).collect::<Vec<_>>() },
        ],
        "rustUs": 42,
    });
    Fixture {
        name: "row-patch-with-rust-us",
        bytes,
        json,
    }
}

#[test]
fn golden_bytes_match_committed_fixtures() {
    let update = std::env::var("UPDATE_GOLDEN").as_deref() == Ok("1");
    let dir = golden_dir();
    let fixtures = vec![
        full_frame_basic(),
        row_patch_basic(),
        full_frame_with_rust_us(),
        row_patch_with_rust_us(),
    ];

    if update {
        std::fs::create_dir_all(&dir).expect("create gui/tests/golden");
        for fixture in &fixtures {
            std::fs::write(dir.join(format!("{}.bin", fixture.name)), &fixture.bytes)
                .expect("write golden .bin");
            std::fs::write(
                dir.join(format!("{}.json", fixture.name)),
                serde_json::to_string_pretty(&fixture.json).unwrap(),
            )
            .expect("write golden .json");
        }
        return;
    }

    for fixture in &fixtures {
        let bin_path = dir.join(format!("{}.bin", fixture.name));
        let committed = std::fs::read(&bin_path).unwrap_or_else(|_| {
            panic!(
                "missing committed golden fixture {}; run `UPDATE_GOLDEN=1 cargo test -p herdr-gui --test golden_bytes` to generate it",
                bin_path.display()
            )
        });
        assert_eq!(
            committed, fixture.bytes,
            "golden bytes for {} drifted from surface_encode's output; re-run with UPDATE_GOLDEN=1 if this is an intentional format change",
            fixture.name
        );

        let json_path = dir.join(format!("{}.json", fixture.name));
        let committed_json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&json_path).expect("read golden .json"))
                .expect("parse golden .json");
        assert_eq!(
            committed_json, fixture.json,
            "golden JSON for {} drifted",
            fixture.name
        );
    }
}
