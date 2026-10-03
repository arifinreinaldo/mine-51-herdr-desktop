//! Fake herdr server integration test (spec §9.6).
//!
//! An in-process listener speaks the framing on a temp named-pipe/socket
//! name, using `interprocess`'s tokio API directly (the same crate herdr
//! itself uses, `interprocess = "2.4.2"`). It plays the SERVER side of the
//! protocol for real: hello assertion, welcome, an unknown `EndpointControl`
//! kind (must be ignored), the snapshot, a full frame, a good patch, and a
//! bad patch that must trigger a same-size `ClientShellResize`.
//!
//! The CLIENT side is `herdr_gui_lib::conn::Connection`, which is fully
//! stubbed (`todo!()`) -- see `src/conn.rs`. Both tests below are expected
//! to fail (panic on the first stubbed call) until that module is
//! implemented. They stay here, fully wired, because they are the
//! regression tests for that implementation once it lands.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use herdr_wire::{
    ClientMessage, ClientSurfaceSize, CursorState, EndpointClientHello, FrameData,
    PaneSurfaceFrame, PaneSurfacePane, PaneSurfacePatch, PaneSurfacePatchRow, ServerMessage,
    SurfaceGraphicsScene, SurfaceRect,
};
use interprocess::local_socket::tokio::prelude::*;
use interprocess::local_socket::{ListenerOptions, Name};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use herdr_gui_lib::conn::Connection;
use herdr_gui_lib::mirror::{Delta, SurfaceMirror};

const TEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Disambiguates concurrent test runs beyond pid+nanos alone: the two tests
/// in this file run in parallel by default (`cargo test` spawns each
/// `#[tokio::test]` on its own thread), and pid+nanos alone was observed to
/// collide often enough to make the socket bind flaky
/// (`Os { code: 5, PermissionDenied }`, code review finding #4).
static SOCKET_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Windows named pipe / Unix filesystem socket, matching `conn.rs`.
fn listener_name(path: &std::path::Path) -> Name<'static> {
    #[cfg(windows)]
    {
        use interprocess::local_socket::{GenericNamespaced, ToNsName};
        path.to_string_lossy()
            .to_string()
            .to_ns_name::<GenericNamespaced>()
            .expect("valid local socket name")
    }
    #[cfg(unix)]
    {
        use interprocess::local_socket::{GenericFilePath, ToFsName};
        path.to_path_buf()
            .to_fs_name::<GenericFilePath>()
            .expect("valid local socket name")
    }
}

fn unique_socket_path() -> PathBuf {
    let counter = SOCKET_COUNTER.fetch_add(1, Ordering::SeqCst);
    let unique = format!(
        "herdr-gui-fake-server-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        counter,
    );
    // sun_path caps at ~104 bytes and macOS's temp_dir is long, so Unix
    // sockets go under /tmp.
    #[cfg(unix)]
    return PathBuf::from("/tmp").join(unique);
    #[cfg(not(unix))]
    return std::env::temp_dir().join(unique);
}

fn expected_hello() -> EndpointClientHello {
    // The exact JSON the GUI sends, per spec §1 "Handshake".
    EndpointClientHello {
        generation: 1,
        cell_width_px: 8,
        cell_height_px: 16,
        surface_size: ClientSurfaceSize { cols: 80, rows: 24 },
        pixel_mouse: false,
        direct_graphics: false,
        endpoint_keybindings: false,
        mouse_capture: true,
        surface_active: true,
        surface_reuse: false,
        surface_delta: false,
        snapshot_codecs: vec!["shell.snapshot.v1".into()],
        surface_codecs: vec!["shell.surface.v1".into()],
        input_codecs: vec!["shell.input.semantic.v1".into()],
        blob_codecs: vec!["shell.blob.v1".into()],
    }
}

async fn write_server_message<S>(stream: &mut S, msg: &ServerMessage)
where
    S: tokio::io::AsyncWrite + Unpin,
{
    let payload = bincode::serde::encode_to_vec(msg, bincode::config::standard())
        .expect("encode ServerMessage");
    stream
        .write_all(&(payload.len() as u32).to_le_bytes())
        .await
        .expect("write length prefix");
    stream.write_all(&payload).await.expect("write payload");
}

async fn read_client_message<S>(stream: &mut S) -> ClientMessage
where
    S: tokio::io::AsyncRead + Unpin,
{
    let mut len_buf = [0u8; 4];
    stream
        .read_exact(&mut len_buf)
        .await
        .expect("read length prefix");
    let len = u32::from_le_bytes(len_buf) as usize;
    let mut payload = vec![0u8; len];
    stream.read_exact(&mut payload).await.expect("read payload");
    let (msg, _): (ClientMessage, usize) =
        bincode::serde::decode_from_slice(&payload, bincode::config::standard())
            .expect("decode ClientMessage");
    msg
}

fn assert_hello_matches_spec(hello_json: &str) {
    let value: serde_json::Value = serde_json::from_str(hello_json).expect("hello is JSON");
    assert_eq!(value["generation"], 1);
    assert_eq!(value["pixel_mouse"], false);
    assert_eq!(value["direct_graphics"], false);
    assert_eq!(value["endpoint_keybindings"], false);
    assert_eq!(value["mouse_capture"], true);
    assert_eq!(value["surface_active"], true);
    assert_eq!(value["surface_reuse"], false);
    assert_eq!(value["surface_delta"], false);
    assert_eq!(
        value["snapshot_codecs"],
        serde_json::json!(["shell.snapshot.v1"])
    );
    assert_eq!(
        value["surface_codecs"],
        serde_json::json!(["shell.surface.v1"])
    );
    assert_eq!(
        value["input_codecs"],
        serde_json::json!(["shell.input.semantic.v1"])
    );
    assert_eq!(value["blob_codecs"], serde_json::json!(["shell.blob.v1"]));
    assert!(value["cell_width_px"].is_u64());
    assert!(value["cell_height_px"].is_u64());
    assert!(value["surface_size"]["cols"].is_u64());
    assert!(value["surface_size"]["rows"].is_u64());
}

fn minimal_snapshot_json() -> String {
    // A minimal but structurally valid ClientShellSnapshot; this test does
    // not exercise sidebar/snapshot rendering, only that an unrecognized
    // EndpointControl kind arriving first does not break the handshake.
    serde_json::json!({
        "boot_id": "boot-1",
        "revision": 1,
        "config_diagnostic": null,
        "product_announcement": null,
        "update_available": null,
        "update_install_command": "herdr update",
        "server_keybindings_toml": null,
        "latest_release_notes_available": false,
        "integration_updates_available": false,
        "worktree_directory": "",
        "release_notes": null,
        "focused_workspace_id": null,
        "focused_tab_id": null,
        "focused_pane_id": "w1:p1",
        "tab_bar_right": [],
        "tab_bar_right_separator": "",
        "agent_view_label": null,
        "agent_order": [],
        "workspaces": [],
        "tabs": [],
        "panes": [],
        "agents": [],
        "commands": [],
    })
    .to_string()
}

fn pane(id: &str, rect: SurfaceRect) -> PaneSurfacePane {
    PaneSurfacePane {
        pane_id: id.into(),
        content_revision: 1,
        rect,
        inner_rect: rect,
        scrollbar_rect: None,
        scroll: None,
        focused: true,
        mouse_reporting: false,
        sgr_pixel_mouse: false,
        alternate_screen_active: false,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn full_frame() -> PaneSurfaceFrame {
    let rect = SurfaceRect {
        x: 0,
        y: 0,
        width: 80,
        height: 24,
    };
    PaneSurfaceFrame {
        boot_id: "boot-1".into(),
        projection_revision: 1,
        surface_revision: 1,
        frame: FrameData {
            cells: vec![
                herdr_wire::CellData {
                    symbol: " ".into(),
                    fg: 0,
                    bg: 0,
                    modifier: 0,
                    skip: false,
                    hyperlink: None,
                };
                80 * 24
            ],
            width: 80,
            height: 24,
            cursor: Some(CursorState {
                x: 0,
                y: 0,
                visible: true,
                shape: 0,
            }),
            hyperlinks: Vec::new(),
            graphics: Vec::new(),
        },
        panes: vec![pane("w1:p1", rect)],
        splits: Vec::new(),
        popup: None,
        graphics: SurfaceGraphicsScene::default(),
    }
}

fn good_patch() -> PaneSurfacePatch {
    PaneSurfacePatch {
        boot_id: "boot-1".into(),
        projection_revision: 1,
        base_surface_revision: 1,
        surface_revision: 2,
        rows: vec![PaneSurfacePatchRow {
            x: 0,
            y: 0,
            cells: vec![herdr_wire::CellData {
                symbol: "h".into(),
                fg: 0,
                bg: 0,
                modifier: 0,
                skip: false,
                hyperlink: None,
            }],
        }],
        panes: vec![pane(
            "w1:p1",
            SurfaceRect {
                x: 0,
                y: 0,
                width: 80,
                height: 24,
            },
        )],
        cursor: Some(CursorState {
            x: 1,
            y: 0,
            visible: true,
            shape: 0,
        }),
    }
}

fn bad_patch() -> PaneSurfacePatch {
    // Wrong base_surface_revision: current is 2 after `good_patch`, not 99.
    let mut patch = good_patch();
    patch.base_surface_revision = 99;
    patch.surface_revision = 100;
    patch
}

/// Drives the full handshake + snapshot + full frame + good patch + bad
/// patch sequence, and asserts the client resyncs a rejected patch with a
/// same-size `ClientShellResize` (spec §1 "Resync on reject").
#[tokio::test]
async fn fake_server_drives_handshake_and_patch_resync() {
    let socket_path = unique_socket_path();
    let name = listener_name(&socket_path);
    let listener = LocalSocketListener::from_options(ListenerOptions::new().name(name))
        .expect("bind fake server");

    let server = tokio::spawn(async move {
        let mut stream = listener.accept().await.expect("accept client connection");

        // 1. Hello.
        let hello = read_client_message(&mut stream).await;
        let ClientMessage::EndpointControl { kind, data } = hello else {
            panic!("expected EndpointControl hello, got something else");
        };
        assert_eq!(kind, "endpoint.hello.v1");
        assert_hello_matches_spec(&data);

        // 2. Welcome.
        write_server_message(
            &mut stream,
            &ServerMessage::EndpointControl {
                kind: "endpoint.welcome.v1".into(),
                data: serde_json::json!({
                    "generation": 1,
                    "server_version": "0.9.1",
                    "snapshot_codec": "shell.snapshot.v1",
                    "surface_codec": "shell.surface.v1",
                    "input_codec": "shell.input.semantic.v1",
                    "blob_codec": "shell.blob.v1",
                    "methods": ["pane.focus", "tab.focus"],
                    "capabilities": [],
                })
                .to_string(),
            },
        )
        .await;

        // 3. An unknown EndpointControl kind before the snapshot: the
        // client must ignore it, not error or disconnect.
        write_server_message(
            &mut stream,
            &ServerMessage::EndpointControl {
                kind: "endpoint.agent-completions.v1".into(),
                data: "{}".into(),
            },
        )
        .await;

        // 4. Snapshot.
        write_server_message(
            &mut stream,
            &ServerMessage::EndpointControl {
                kind: "shell.snapshot.v1".into(),
                data: minimal_snapshot_json(),
            },
        )
        .await;

        // 5. Full frame.
        write_server_message(&mut stream, &ServerMessage::PaneSurface(full_frame())).await;

        // 6. A good patch.
        write_server_message(&mut stream, &ServerMessage::PaneSurfacePatch(good_patch())).await;

        // 7. A bad patch (wrong base_surface_revision).
        write_server_message(&mut stream, &ServerMessage::PaneSurfacePatch(bad_patch())).await;

        // 8. The client must resync with a same-size ClientShellResize.
        let resync = read_client_message(&mut stream).await;
        match resync {
            ClientMessage::ClientShellResize { surface_size, .. } => {
                assert_eq!(surface_size, ClientSurfaceSize { cols: 80, rows: 24 });
            }
            other => panic!("expected a resync ClientShellResize, got {other:?}"),
        }
    });

    let client = async {
        let conn = Connection::connect(&socket_path, &expected_hello())
            .await
            .expect("connect to fake server");

        let mut mirror = SurfaceMirror::empty();
        loop {
            match conn.read_message().await.expect("read server message") {
                ServerMessage::EndpointControl { kind, .. } if kind == "shell.snapshot.v1" => {
                    // Recorded elsewhere in the real implementation; not
                    // this test's concern.
                }
                ServerMessage::EndpointControl { .. } => {
                    // An unrecognized kind (e.g. endpoint.agent-completions.v1):
                    // ignored per spec §1.
                }
                ServerMessage::PaneSurface(frame) => {
                    assert_eq!(
                        mirror.apply_full(frame).expect("valid full frame"),
                        Delta::Full
                    );
                    break;
                }
                other => panic!("unexpected message before PaneSurface: {other:?}"),
            }
        }

        let good = match conn.read_message().await.expect("read good patch") {
            ServerMessage::PaneSurfacePatch(patch) => patch,
            other => panic!("expected PaneSurfacePatch, got {other:?}"),
        };
        mirror
            .apply_patch(good)
            .expect("good patch must be accepted");
        assert_eq!(mirror.surface_revision, 2);

        let bad = match conn.read_message().await.expect("read bad patch") {
            ServerMessage::PaneSurfacePatch(patch) => patch,
            other => panic!("expected PaneSurfacePatch, got {other:?}"),
        };
        let before = mirror.clone();
        assert!(
            mirror.apply_patch(bad).is_err(),
            "bad patch must be rejected"
        );
        assert_eq!(
            mirror, before,
            "a rejected patch must not mutate the mirror"
        );

        // Resync: resend ClientShellResize with the current size.
        conn.send(&ClientMessage::ClientShellResize {
            cell_width_px: 8,
            cell_height_px: 16,
            surface_size: ClientSurfaceSize {
                cols: mirror.width,
                rows: mirror.height,
            },
            pixel_mouse: false,
        })
        .await
        .expect("send resync resize");
    };

    tokio::time::timeout(TEST_TIMEOUT, async {
        tokio::join!(client, async { server.await.expect("server task") });
    })
    .await
    .expect("fake server test timed out (expected while conn.rs is stubbed)");
}

/// `api()`/`Connection::endpoint_request` must queue: only one
/// `ClientShellEndpointRequest` may be in flight per connection. This test
/// fires two requests concurrently and asserts the fake server observes
/// them one at a time, never a second request before it has answered the
/// first.
#[tokio::test]
async fn endpoint_request_serializes_concurrent_calls() {
    let socket_path = unique_socket_path();
    let name = listener_name(&socket_path);
    let listener = LocalSocketListener::from_options(ListenerOptions::new().name(name))
        .expect("bind fake server");

    let server = tokio::spawn(async move {
        let mut stream = listener.accept().await.expect("accept client connection");

        // Minimal handshake: hello -> welcome -> snapshot, then two
        // request/response round trips, each fully completed before the
        // next request is read.
        let _hello = read_client_message(&mut stream).await;
        write_server_message(
            &mut stream,
            &ServerMessage::EndpointControl {
                kind: "endpoint.welcome.v1".into(),
                data: serde_json::json!({
                    "generation": 1, "server_version": "0.9.1",
                    "snapshot_codec": "shell.snapshot.v1", "surface_codec": "shell.surface.v1",
                    "input_codec": "shell.input.semantic.v1", "blob_codec": "shell.blob.v1",
                    "methods": ["pane.focus"], "capabilities": [],
                })
                .to_string(),
            },
        )
        .await;
        write_server_message(
            &mut stream,
            &ServerMessage::EndpointControl {
                kind: "shell.snapshot.v1".into(),
                data: minimal_snapshot_json(),
            },
        )
        .await;

        for _ in 0..2 {
            let request = read_client_message(&mut stream).await;
            let ClientMessage::ClientShellEndpointRequest { boot_id, request } = request else {
                panic!("expected ClientShellEndpointRequest, got {request:?}");
            };
            let parsed: serde_json::Value =
                serde_json::from_str(&request).expect("request is JSON");
            let request_id = parsed["id"].as_str().expect("request has an id").to_owned();
            write_server_message(
                &mut stream,
                &ServerMessage::ClientShellEndpointResponseChunk {
                    boot_id,
                    request_id,
                    final_chunk: true,
                    data: br#"{"result":{"type":"ok"}}"#.to_vec(),
                },
            )
            .await;
        }
    });

    let client = async {
        let conn = Connection::connect(&socket_path, &expected_hello())
            .await
            .expect("connect to fake server");

        let first = conn.endpoint_request(
            "boot-1",
            "pane.focus",
            serde_json::json!({"pane_id": "w1:p1"}),
        );
        let second = conn.endpoint_request(
            "boot-1",
            "pane.focus",
            serde_json::json!({"pane_id": "w1:p2"}),
        );
        let (first_result, second_result) = tokio::join!(first, second);
        first_result.expect("first request must succeed");
        second_result.expect("second request must succeed only after the first completed");
    };

    tokio::time::timeout(TEST_TIMEOUT, async {
        tokio::join!(client, async { server.await.expect("server task") });
    })
    .await
    .expect("fake server test timed out (expected while conn.rs is stubbed)");
}
