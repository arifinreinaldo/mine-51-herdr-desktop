//! Digest parity with herdr's frozen generation-1 wire values.
//!
//! Each test here rebuilds one of herdr's `encoded_sha256(...)` values
//! (`src/protocol/wire.rs`, from line 1864) using `herdr-wire` types only,
//! and asserts the **same hex digest**, copied verbatim from herdr. A
//! mismatch means a copied type's field order, type, or serde attribute
//! drifted from herdr's source -- never "fix" the expected digest here.
//!
//! Test names mirror herdr's: `digest_<herdr_test_name>`. Two additional
//! exact-byte tests (not sha256 digests, but the same "frozen wire bytes"
//! contract) cover the `EndpointControl` variant-tag assertions at
//! `wire.rs:1920-1930` and `wire.rs:2708-2726`.

use herdr_wire::*;
use sha2::{Digest, Sha256};

fn encoded_sha256(value: &impl serde::Serialize) -> String {
    let encoded = bincode::serde::encode_to_vec(value, bincode::config::standard()).unwrap();
    format!("{:x}", Sha256::digest(encoded))
}

/// `src/protocol/wire.rs:1946` -- `ClientMessage::ClientShellResize`.
/// Sent by the GUI on every canvas resize.
#[test]
fn digest_client_shell_resize_roundtrip() {
    let msg = ClientMessage::ClientShellResize {
        cell_width_px: 8,
        cell_height_px: 16,
        surface_size: ClientSurfaceSize { cols: 74, rows: 29 },
        pixel_mouse: true,
    };
    assert_eq!(
        encoded_sha256(&msg),
        "676d6376202750e72c45ff511e256b6154d3d20c0ee088d3792fa3a69d9704b9"
    );
}

/// `src/protocol/wire.rs:2165` -- `ClientMessage::ClientShellPaneInput` with
/// a `Some(WindowsKeyRecord)` case. Sent by the GUI on every keystroke
/// (always with `windows_record: None` per spec, but the type must still
/// match for bincode, hence exercising the `Some` case here too).
#[test]
fn digest_client_shell_pane_input_roundtrips_semantic_and_windows_keys() {
    const SHIFT: u8 = 1;
    const CONTROL: u8 = 2;
    let windows_record = WindowsKeyRecord {
        key_down: true,
        repeat_count: 1,
        virtual_key_code: 0x37,
        virtual_scan_code: 0x08,
        unicode: 0,
        control_key_state: 0x0008,
    };
    let message = ClientMessage::ClientShellPaneInput {
        pane_id: "w1:p2".into(),
        events: vec![
            ClientPaneInputEvent::Key {
                code: ClientKeyCode::Char('l'),
                modifiers: SHIFT,
                kind: ClientKeyKind::Release,
                repeat_count: 1,
                shifted_codepoint: Some('L' as u32),
                generated_text: None,
                tracks_release: true,
                physical_key_id: None,
                windows_record: None,
            },
            ClientPaneInputEvent::Key {
                code: ClientKeyCode::Char('7'),
                modifiers: CONTROL,
                kind: ClientKeyKind::Press,
                repeat_count: 1,
                shifted_codepoint: None,
                generated_text: None,
                tracks_release: true,
                physical_key_id: Some(0x08),
                windows_record: Some(windows_record),
            },
        ],
    };
    assert_eq!(
        encoded_sha256(&message),
        "f558384bb53dfd2baf1fa72e1709d88be6891da79e51f88513905afc085065e6"
    );
}

/// `src/protocol/wire.rs:2356,2373` -- `ClientMessage::ClientShellEndpointRequest`
/// (sent by `commands::api`) and `ServerMessage::ClientShellEndpointResponseChunk`
/// (decoded by `commands::api`).
#[test]
fn digest_client_shell_endpoint_messages_roundtrip() {
    let request = ClientMessage::ClientShellEndpointRequest {
        boot_id: "boot-a".into(),
        request: r#"{"id":"request-a","method":"session.snapshot","params":{}}"#.into(),
    };
    assert_eq!(
        encoded_sha256(&request),
        "de5693585a01f6b0d5ee07c51b6ddf79ee9f67dbf183255822d31f35210f5ffb"
    );

    let response = ServerMessage::ClientShellEndpointResponseChunk {
        boot_id: "boot-a".into(),
        request_id: "request-a".into(),
        final_chunk: true,
        data: br#"{"id":"request-a","result":{"type":"ok"}}"#.to_vec(),
    };
    assert_eq!(
        encoded_sha256(&response),
        "bc14dbb5263d3097fe6d3e70a4b6d71aa9c2fa4ae3206d692a7182512bffdd1d"
    );
}

/// `src/protocol/wire.rs:2390` -- `ClientMessage::ClipboardImage`. The GUI
/// does not send this variant in Phase 1, but it must still exist at the
/// correct tag and copy byte-for-byte, so its digest is included per the
/// spec's explicit line list.
#[test]
fn digest_client_clipboard_image_roundtrip() {
    let msg = ClientMessage::ClipboardImage {
        target: ClientClipboardImageTarget::Pane("w1:p1".into()),
        extension: "png".to_owned(),
        data: vec![0x89, b'P', b'N', b'G'],
    };
    assert_eq!(
        encoded_sha256(&msg),
        "1c02110be0671faf318b3f4d8f507748d5a0a98cd474832669c5290d97ef19ab"
    );
}

/// `src/protocol/wire.rs:2595` -- `ServerMessage::PaneSurface` with a
/// non-trivial frame (all named-colour paths, RGB, indexed, hyperlink,
/// skip, and a multi-byte / wide grapheme). Decoded by the GUI on every
/// full surface.
#[test]
fn digest_server_frame_roundtrip_nontrivial() {
    // Colour packing from wire.rs:1522-1546 (no ratatui dependency here --
    // see spec §1 "Colour packing" / "No ratatui type is on the wire").
    const RESET: u32 = 0x00_0000_00;
    const BLACK: u32 = 0x00_0000_01;
    const RED: u32 = 0x00_0000_02;
    const GREEN: u32 = 0x00_0000_03;
    const YELLOW: u32 = 0x00_0000_04;
    const BLUE: u32 = 0x00_0000_05;
    const MAGENTA: u32 = 0x00_0000_06;
    const CYAN: u32 = 0x00_0000_07;
    const RGB_255_128_0: u32 = 0x02_FF80_00;
    const INDEXED_220: u32 = 0x01_0000_DC;

    const BOLD: u16 = 1;
    const ITALIC: u16 = 4;
    const UNDERLINED: u16 = 8;
    const REVERSED: u16 = 64;

    let frame = FrameData {
        cells: vec![
            CellData {
                symbol: "H".into(),
                fg: RED,
                bg: BLACK,
                modifier: BOLD,
                skip: false,
                hyperlink: None,
            },
            CellData {
                symbol: "i".into(),
                fg: GREEN,
                bg: RESET,
                modifier: ITALIC,
                skip: false,
                hyperlink: None,
            },
            CellData {
                symbol: "!".into(),
                fg: RGB_255_128_0,
                bg: INDEXED_220,
                modifier: BOLD | UNDERLINED,
                skip: false,
                hyperlink: Some(0),
            },
            CellData {
                symbol: " ".into(),
                fg: RESET,
                bg: RESET,
                modifier: 0,
                skip: true,
                hyperlink: None,
            },
            CellData {
                symbol: "\u{2192}".into(), // "→", multi-byte grapheme
                fg: CYAN,
                bg: BLUE,
                modifier: REVERSED,
                skip: false,
                hyperlink: None,
            },
            CellData {
                symbol: "\u{1F980}".into(), // "🦀", wide grapheme cluster
                fg: YELLOW,
                bg: MAGENTA,
                modifier: 0,
                skip: false,
                hyperlink: None,
            },
        ],
        width: 3,
        height: 2,
        cursor: Some(CursorState {
            x: 0,
            y: 0,
            visible: true,
            shape: 6,
        }),
        hyperlinks: vec!["https://example.com".to_owned()],
        graphics: Vec::new(),
    };
    let msg = ServerMessage::PaneSurface(PaneSurfaceFrame {
        boot_id: "boot-1".into(),
        projection_revision: 1,
        surface_revision: 1,
        frame,
        panes: Vec::new(),
        splits: Vec::new(),
        popup: None,
        graphics: SurfaceGraphicsScene::default(),
    });
    assert_eq!(
        encoded_sha256(&msg),
        "7c016f7b21ddb5ac79212cf65a968b93eb292b5305b941263e89ffaa40158ee3"
    );
}

/// `src/protocol/wire.rs:2642` -- `ServerMessage::PaneSurfacePatch`. Decoded
/// by the GUI on every incremental surface update.
#[test]
fn digest_pane_surface_patch_roundtrip() {
    let msg = ServerMessage::PaneSurfacePatch(PaneSurfacePatch {
        boot_id: "boot-1".into(),
        projection_revision: 3,
        base_surface_revision: 7,
        surface_revision: 8,
        rows: vec![PaneSurfacePatchRow {
            x: 2,
            y: 4,
            cells: vec![CellData {
                symbol: "x".into(),
                fg: 1,
                bg: 2,
                modifier: 3,
                skip: false,
                hyperlink: None,
            }],
        }],
        panes: Vec::new(),
        cursor: Some(CursorState {
            x: 2,
            y: 4,
            visible: true,
            shape: 2,
        }),
    });
    assert_eq!(
        encoded_sha256(&msg),
        "0814b99a1dc6eaf7918424aa416c066509cbfb73b72344a809c27cde78cb6dbd"
    );
}

/// `src/protocol/wire.rs:2703` -- `ServerMessage::PaneSurface` carrying a
/// populated `SurfaceGraphicsScene`. Exercises the `SurfaceGraphicsAsset`
/// custom bytes (de)serializer (`wire.rs:1193-1240`). Phase 1 does not
/// render graphics, but the type must still decode byte-for-byte so a live
/// frame carrying assets doesn't get silently dropped as a decode failure.
#[test]
fn digest_client_shell_graphics_payload_codec_is_frozen() {
    let key = SurfaceGraphicsAssetKey {
        source: SurfaceGraphicsSource::Terminal {
            target: SurfaceGraphicsTarget::Pane {
                pane_id: "w1:p1".into(),
            },
            image_id: 7,
        },
        image_width: 2,
        image_height: 1,
        format: SurfaceGraphicsFormat::Rgba,
        data_len: 8,
        data_fingerprint: 42,
    };
    let message = ServerMessage::PaneSurface(PaneSurfaceFrame {
        boot_id: "boot-1".into(),
        projection_revision: 2,
        surface_revision: 3,
        frame: FrameData {
            cells: Vec::new(),
            width: 0,
            height: 0,
            cursor: None,
            hyperlinks: Vec::new(),
            graphics: Vec::new(),
        },
        panes: Vec::new(),
        splits: Vec::new(),
        popup: None,
        graphics: SurfaceGraphicsScene {
            assets: vec![SurfaceGraphicsAsset {
                key: key.clone(),
                data: vec![255, 0, 0, 255, 0, 255, 0, 255],
            }],
            placements: vec![SurfaceGraphicsPlacement {
                asset: key,
                logical_placement_id: 9,
                x: 1,
                y: 2,
                cols: 2,
                rows: 1,
                source_x: 0,
                source_y: 0,
                source_width: 2,
                source_height: 1,
                x_offset: 0,
                y_offset: 0,
                z: -1,
                scrollback_offset: 0,
            }],
            retained_assets: Vec::new(),
        },
    });
    assert_eq!(
        encoded_sha256(&message),
        "49c4efec0f1456c8ca4112ddf6ead1ab75d0224007576c2ccc18c3fca55a69f0"
    );
}

/// `src/protocol/wire.rs:2963` -- `ServerMessage::Graphics`. The GUI does not
/// decode this variant in Phase 1 (kitty graphics are out of scope, per
/// spec §7), but it must still exist at the correct tag and copy
/// byte-for-byte, so its digest is included per the spec's explicit line
/// list.
#[test]
fn digest_server_graphics_roundtrip() {
    let msg = ServerMessage::Graphics {
        bytes: b"\x1b_Ga=d,d=A,q=2;\x1b\\".to_vec(),
    };
    assert_eq!(
        encoded_sha256(&msg),
        "28a420f92e0e05e6760a8c140baf307c360c6d1b1aa68027481b324f87e22c44"
    );
}

/// `src/protocol/wire.rs:1911-1930` -- `ClientMessage::EndpointControl`'s
/// bincode tag and two-string payload are frozen for endpoint generation 1.
#[test]
fn digest_endpoint_control_roundtrip() {
    assert_eq!(
        bincode::serde::encode_to_vec(
            ClientMessage::EndpointControl {
                kind: String::new(),
                data: String::new(),
            },
            bincode::config::standard(),
        )
        .unwrap(),
        [20, 0, 0]
    );
}

/// `src/protocol/wire.rs:2708-2726` -- `ServerMessage::EndpointControl`'s
/// bincode tag and two-string payload are frozen for endpoint generation 1.
#[test]
fn digest_server_endpoint_control_tag_is_frozen() {
    let message = ServerMessage::EndpointControl {
        kind: "endpoint.welcome.v1".into(),
        data: r#"{"generation":1}"#.into(),
    };
    let encoded = bincode::serde::encode_to_vec(&message, bincode::config::standard()).unwrap();
    assert_eq!(encoded.first(), Some(&20));
    assert_eq!(
        bincode::serde::encode_to_vec(
            ServerMessage::EndpointControl {
                kind: String::new(),
                data: String::new(),
            },
            bincode::config::standard(),
        )
        .unwrap(),
        [20, 0, 0]
    );
}
