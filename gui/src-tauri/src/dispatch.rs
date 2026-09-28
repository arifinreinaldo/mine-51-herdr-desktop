//! The reconnect loop and per-connection dispatch loop (spec §4 `conn.rs`:
//! "connect... After the welcome, loop: read frame -> dispatch. On
//! `ServerShutdown` or EOF -> state `Disconnected` and reconnect loop.").
//!
//! Owns the one background task that drives `conn::Connection` for the
//! whole app: it applies every `PaneSurface`/`PaneSurfacePatch` to the
//! shared `SurfaceMirror`, pushes the compact encoded frame (spec §5) to
//! the subscribed `tauri::ipc::Channel`, parses and emits the
//! `shell.snapshot.v1` snapshot, and resyncs a rejected patch with a
//! same-size `ClientShellResize` (spec §1 "Resync on reject").

use std::sync::Arc;
use std::time::{Duration, Instant};

use herdr_wire::{
    ClientMessage, ClientShellSnapshot, ClientSurfaceSize, EndpointClientHello, ServerMessage,
    SNAPSHOT_CODEC_V1,
};
use tauri::{AppHandle, Emitter};

use crate::commands::Inner;
use crate::conn::{ConnError, Connection};
use crate::mirror::Delta;
use crate::surface_encode::{
    append_rust_us_trailer, encode_full_frame, encode_row_patch, EncodedRow,
};

const RECONNECT_DELAY: Duration = Duration::from_secs(2);

/// The initial handshake hello. Uses the last requested `(cols, rows,
/// cell_w, cell_h)` recorded by `commands::resize` (spec §4 v3 "resize
/// stores the last requested ... the hello after a (re)connect and the
/// resync resize both use it"), falling back to 80x24 @ 8x16 before the
/// frontend's first `ResizeObserver`-driven `resize` call. `surface_active:
/// true`, `surface_reuse: false`, `surface_delta: false` per spec:
/// full/patch `PaneSurface` frames only.
pub(crate) fn initial_hello(inner: &Inner) -> EndpointClientHello {
    let (cols, rows, cell_width_px, cell_height_px) = inner.last_size();
    EndpointClientHello {
        generation: 1,
        cell_width_px,
        cell_height_px,
        surface_size: ClientSurfaceSize { cols, rows },
        pixel_mouse: false,
        direct_graphics: false,
        endpoint_keybindings: false,
        mouse_capture: true,
        surface_active: true,
        surface_reuse: false,
        surface_delta: false,
        snapshot_codecs: vec![herdr_wire::SNAPSHOT_CODEC_V1.to_string()],
        surface_codecs: vec![herdr_wire::SURFACE_CODEC_V1.to_string()],
        input_codecs: vec![herdr_wire::INPUT_CODEC_V1.to_string()],
        blob_codecs: vec![herdr_wire::BLOB_CODEC_V1.to_string()],
    }
}

/// Emits the `connection-status` event and caches it on `inner` so
/// `commands::sync_state` (spec §4 v3) can re-emit it for a frontend that
/// registered its listener after this fired (finding #1). `server_version`
/// (finding #14 "About shows the server version") is `Some` only for the
/// "connected" status, from the welcome handshake.
fn emit_connection_status(
    app: &AppHandle,
    inner: &Inner,
    status: &str,
    socket_path: &str,
    server_version: Option<&str>,
) {
    // spec phase1.5 §9.1 "Empty log file": connect/disconnect/handshake
    // results belong in the log at `info` level.
    tracing::info!(status, socket_path, "connection status changed");
    inner.record_connection_status(status, socket_path, server_version);
    let _ = app.emit(
        "connection-status",
        serde_json::json!({ "status": status, "socketPath": socket_path, "serverVersion": server_version }),
    );
}

/// Connects, then loops: on a lost connection, waits 2s and reconnects
/// (spec §4 `conn.rs`). Never returns.
pub async fn run_reconnect_loop(app: AppHandle, inner: Arc<Inner>) {
    loop {
        let socket_path = crate::socket::client_socket_path();
        let socket_path_str = socket_path.to_string_lossy().to_string();
        emit_connection_status(&app, &inner, "connecting", &socket_path_str, None);

        // Recorded once, on the very first connection attempt: `attach_ms`
        // (spec §4 `main.rs`: "from connect start to the first `PaneSurface`
        // applied") measures from here, not from process start (finding #5).
        inner.record_connect_start();

        match Connection::connect(&socket_path, &initial_hello(&inner)).await {
            Ok(conn) => {
                // Finding #1 "Stop Server auto-undone": a successful
                // connection means herdr is up right now, whether or not
                // *this* launch's own auto-start ever had to spawn it.
                // Claiming the guard here too means a later disconnect --
                // including a deliberate Stop that runs outside
                // `engine_stop_server` (e.g. `herdr server stop` from a
                // terminal) -- always shows the banner instead of being
                // silently respawned; this launch already got its one
                // silent start opportunity, spent or not.
                inner.server_start_guard.try_claim();
                let conn = Arc::new(conn);
                *inner.connection.write().await = Some(conn.clone());
                emit_connection_status(
                    &app,
                    &inner,
                    "connected",
                    &socket_path_str,
                    Some(&conn.server_version),
                );

                run_dispatch_loop(&app, &inner, &conn).await;

                *inner.connection.write().await = None;
                emit_connection_status(&app, &inner, "disconnected", &socket_path_str, None);
            }
            Err(_) => {
                emit_connection_status(&app, &inner, "unavailable", &socket_path_str, None);
                maybe_auto_start_server(&inner, &socket_path).await;
            }
        }

        tokio::time::sleep(RECONNECT_DELAY).await;
    }
}

/// Phase 1.6 spec §3.3: "the reconnect loop uses probe -> start -> connect.
/// It starts the server once per launch." `ensure_server_started` itself
/// holds the actual probe -> start -> poll decision and the start-once
/// guard (spec §3.3 "one entry point"); this just skips even *locating*
/// herdr (an extra `--version` subprocess) once that one attempt for this
/// launch has already happened, so a permanently-down/never-installed
/// herdr doesn't get re-probed on every failed reconnect forever.
async fn maybe_auto_start_server(inner: &Inner, socket_path: &std::path::Path) {
    if inner.server_start_guard.already_claimed() {
        return;
    }
    let status = crate::engine::locate_herdr().await;
    if !should_attempt_auto_start(&status) {
        // Finding #2 "clean-machine ordering": Missing/Broken (installing
        // herdr is the wizard's job, spec §4.1) never claims the guard
        // here. The old code claimed it unconditionally on this branch, on
        // the theory that it would otherwise re-run `herdr --version` on
        // every failed reconnect forever -- but claiming it also
        // permanently spent this launch's one silent start attempt before
        // any real spawn was ever attempted. Right after the wizard
        // installs herdr, `engine_ensure_server_started` would then find
        // the guard already claimed and (pre-finding-#3) report a false
        // failure. `locate_herdr` is one `--version` probe (~3s worst
        // case, `RECONNECT_DELAY` is 2s) -- an acceptable, bounded cost to
        // keep re-checking while herdr is genuinely still missing, not a
        // runaway loop.
        return;
    }
    let crate::engine::EngineStatus::Found { path, .. } = status else {
        return; // unreachable given should_attempt_auto_start's contract
    };
    let hello = initial_hello(inner);
    let _ =
        crate::engine::ensure_server_started(&inner.server_start_guard, &path, socket_path, &hello)
            .await;
}

/// Whether `maybe_auto_start_server` should even attempt a start for
/// `status` (finding #2 "clean-machine ordering"): only `Found` ever
/// spawns anything, so only `Found` may touch the start-once guard.
fn should_attempt_auto_start(status: &crate::engine::EngineStatus) -> bool {
    matches!(status, crate::engine::EngineStatus::Found { .. })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn missing_and_broken_never_attempt_auto_start() {
        assert!(!should_attempt_auto_start(
            &crate::engine::EngineStatus::Missing
        ));
        assert!(!should_attempt_auto_start(
            &crate::engine::EngineStatus::Broken {
                path: PathBuf::from("herdr.exe"),
                error: "boom".to_string(),
            }
        ));
    }

    #[test]
    fn found_attempts_auto_start() {
        assert!(should_attempt_auto_start(
            &crate::engine::EngineStatus::Found {
                path: PathBuf::from("herdr.exe"),
                version: "0.9.1".to_string(),
            }
        ));
    }
}

/// Reads and dispatches messages until the connection ends (`ServerShutdown`
/// or EOF/error), per spec §4 `conn.rs`.
async fn run_dispatch_loop(app: &AppHandle, inner: &Arc<Inner>, conn: &Arc<Connection>) {
    loop {
        match conn.read_message().await {
            Ok(ServerMessage::PaneSurface(frame)) => {
                // Spec §8a.4 "Rust decode+apply+encode µs per frame": timed
                // around exactly the three steps named there -- decoding the
                // `ServerMessage` payload into `frame` already happened by
                // the time this arm runs (`conn::Connection`'s reader task),
                // so this window covers applying it to the mirror and
                // encoding the compact frame, which is what actually varies
                // with frame size and dominates the cost.
                let rust_start = Instant::now();
                let outcome = {
                    let mut mirror = mirror_lock(inner);
                    match mirror.apply_full(frame) {
                        Ok(_) => Ok(encode_full_frame(
                            mirror.surface_revision,
                            mirror.width,
                            mirror.height,
                            mirror.cursor.as_ref(),
                            &mirror.cells,
                        )),
                        // A corrupted/malformed full frame (finding #3): keep
                        // whatever the mirror already had and resync, same as
                        // a rejected patch (spec §1 "Resync on reject").
                        Err(_rejected) => Err(()),
                    }
                };
                match outcome {
                    Ok(mut bytes) => {
                        inner.record_attach();
                        append_rust_us_trailer(&mut bytes, elapsed_us(rust_start));
                        push_surface_bytes(inner, bytes);
                    }
                    Err(()) => resync(inner, conn).await,
                }
            }
            Ok(ServerMessage::PaneSurfacePatch(patch)) => {
                handle_patch(inner, conn, patch).await;
            }
            Ok(ServerMessage::EndpointControl { kind, data }) => {
                if kind == SNAPSHOT_CODEC_V1 {
                    handle_snapshot(app, inner, &data);
                }
                // Any other kind (a repeated welcome, or an unrecognized
                // kind such as endpoint.agent-completions.v1/
                // endpoint.agent-view.v1) is ignored, per spec §1.
            }
            Ok(ServerMessage::Clipboard { data }) => {
                handle_clipboard(app, &data);
            }
            Ok(ServerMessage::ServerShutdown { .. }) => break,
            Ok(_) => {
                // Not decoded/used by the GUI in Phase 1 (Terminal,
                // Graphics, Notify, ...).
            }
            Err(ConnError::Closed) => break,
            Err(err) => {
                tracing::warn!("connection dispatch loop ending: {err}");
                break;
            }
        }
    }
}

/// `ServerMessage::Clipboard` is OSC 52 passthrough: a pane application
/// (vim, tmux, ...) wrote to the clipboard itself, and the server decoded
/// that write and is forwarding it to the foreground client
/// (`src/server/headless/notifications.rs`'s `AppEvent::ClipboardWrite`
/// arm) -- unrelated to mouse-selection copy, which goes through the
/// `pane.selection.read` endpoint instead (`appTerminalMouse.ts`). Never
/// logs the decoded bytes: clipboard contents can be arbitrarily
/// sensitive.
fn handle_clipboard(app: &AppHandle, data: &str) {
    let Some(bytes) = crate::clipboard::decode_clipboard_payload(data) else {
        tracing::warn!("dropped invalid or oversize clipboard payload from server");
        return;
    };
    if crate::clipboard::write_clipboard_bytes(&bytes) {
        let _ = app.emit("clipboard-copied", ());
    }
}

fn handle_snapshot(app: &AppHandle, inner: &Arc<Inner>, data: &str) {
    match serde_json::from_str::<ClientShellSnapshot>(data) {
        Ok(snapshot) => {
            *boot_id_lock(inner) = snapshot.boot_id.clone();
            match serde_json::to_value(&snapshot) {
                Ok(value) => {
                    // Cached so `commands::sync_state` can re-emit the last
                    // snapshot to a frontend that registered its `listen`
                    // after this fired (spec §4 v3, finding #1).
                    inner.record_snapshot(value.clone());
                    let _ = app.emit("snapshot", value);
                }
                Err(err) => tracing::warn!("failed to re-serialize snapshot: {err}"),
            }
        }
        Err(err) => tracing::warn!("failed to parse {SNAPSHOT_CODEC_V1} payload: {err}"),
    }
}

/// Resends `ClientShellResize` with the last requested `(cols, rows,
/// cell_w, cell_h)` (spec §4 v3), never the mirror's own (possibly 0x0 or
/// stale) size, so the server clears `last_surface` and sends a fresh full
/// `PaneSurface` (spec §1 "Resync on reject", finding #2).
async fn resync(inner: &Inner, conn: &Connection) {
    tracing::info!("resyncing surface after a rejected patch/frame");
    let (cols, rows, cell_width_px, cell_height_px) = inner.last_size();
    let _ = conn
        .send(&ClientMessage::ClientShellResize {
            cell_width_px,
            cell_height_px,
            surface_size: ClientSurfaceSize { cols, rows },
            pixel_mouse: false,
        })
        .await;
}

async fn handle_patch(
    inner: &Arc<Inner>,
    conn: &Arc<Connection>,
    patch: herdr_wire::PaneSurfacePatch,
) {
    // Spec §8a.4: same measured window as the full-frame arm above (apply
    // to the mirror + encode the compact frame).
    let rust_start = Instant::now();
    let outcome = {
        let mut mirror = mirror_lock(inner);
        match mirror.apply_patch(patch) {
            Ok(Delta::Rows(rows)) => {
                let bytes = encode_row_patch(
                    mirror.surface_revision,
                    mirror.width,
                    mirror.height,
                    mirror.cursor.as_ref(),
                    &rows
                        .iter()
                        .map(|row| EncodedRow {
                            y: row.y,
                            x: row.x,
                            cells: &row.cells,
                        })
                        .collect::<Vec<_>>(),
                );
                Some(bytes)
            }
            // `apply_patch` never actually constructs `Delta::Full`; treated
            // as "nothing to encode" rather than `unreachable!()` (finding
            // #14: never panic on a value derived from server data).
            Ok(Delta::Full) => {
                tracing::warn!("apply_patch returned Delta::Full unexpectedly");
                None
            }
            Err(_rejected) => None,
        }
    };

    match outcome {
        Some(mut bytes) => {
            append_rust_us_trailer(&mut bytes, elapsed_us(rust_start));
            push_surface_bytes(inner, bytes);
        }
        None => resync(inner, conn).await,
    }
}

/// `start.elapsed()` as a wire-safe `u32` microsecond count, saturating
/// rather than panicking/wrapping on the pathological case of a stalled
/// frame taking over ~71 minutes (finding-style defensive guard, matching
/// this codebase's other never-panic-on-derived-timing choices).
fn elapsed_us(start: Instant) -> u32 {
    u32::try_from(start.elapsed().as_micros()).unwrap_or(u32::MAX)
}

/// Locks the mirror, recovering from a poisoned lock rather than panicking
/// on every later call (finding #14): a prior panic while this lock was
/// held (now prevented for server data by the mirror's own guards) must
/// not cascade into every subsequent access.
fn mirror_lock(inner: &Inner) -> std::sync::MutexGuard<'_, crate::mirror::SurfaceMirror> {
    inner
        .mirror
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn boot_id_lock(inner: &Inner) -> std::sync::MutexGuard<'_, String> {
    inner
        .boot_id
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn push_surface_bytes(inner: &Inner, bytes: Vec<u8>) {
    if let Some(channel) = inner
        .surface_channel
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
    {
        let _ = channel.send(tauri::ipc::InvokeResponseBody::Raw(bytes));
    }
}
