//! Tauri commands invoked from the frontend (spec §4 `commands.rs`).
//!
//! Fully stubbed: every command needs the (also stubbed) `conn.rs` to do
//! anything real, so the bodies are `todo!()`. `api`'s queueing behavior
//! (one `ClientShellEndpointRequest` in flight per connection; further
//! calls queue) is exercised by `src-tauri/tests/fake_server.rs`, not by a
//! unit test here, since it needs a live fake server to observe wire
//! traffic against.

use herdr_wire::ClientPaneInputEvent;
use serde::Serialize;
use tauri::ipc::Channel;

/// Shared application state, injected into every command via `tauri::State`.
/// Owned by `conn.rs`'s background task in the real implementation.
#[derive(Default)]
pub struct AppState {
    _private: (),
}

/// Error shape returned to the frontend by `api`. Distinct from the
/// backend's own `conn::ConnError`: this is what crosses the Tauri IPC
/// boundary, so it must be `Serialize`.
#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

/// Sends classified input events to a stable pane target
/// (`ClientMessage::ClientShellPaneInput`).
#[tauri::command]
pub async fn send_input(
    state: tauri::State<'_, AppState>,
    pane_id: String,
    events: Vec<ClientPaneInputEvent>,
) -> Result<(), ApiError> {
    let _ = (state, pane_id, events);
    todo!("send_input: forward to conn::Connection::send as ClientShellPaneInput")
}

/// Resizes the client-owned shell's pane surface viewport
/// (`ClientMessage::ClientShellResize`). The frontend debounces calls by
/// 50ms (spec §6 "Resize"); this command does not debounce again.
#[tauri::command]
pub async fn resize(
    state: tauri::State<'_, AppState>,
    cols: u16,
    rows: u16,
    cell_w: u32,
    cell_h: u32,
) -> Result<(), ApiError> {
    let _ = (state, cols, rows, cell_w, cell_h);
    todo!("resize: forward to conn::Connection::send as ClientShellResize")
}

/// Invokes one endpoint API method
/// (`ClientMessage::ClientShellEndpointRequest`), correlates the reply by
/// `request_id`, and times out after 5s. Only one request may be in flight
/// per connection (`endpoint_busy` otherwise, per spec §1); further calls
/// while one is in flight must queue rather than race a second request.
#[tauri::command]
pub async fn api(
    state: tauri::State<'_, AppState>,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, ApiError> {
    let _ = (state, method, params);
    todo!("api: thin wrapper over conn::Connection::endpoint_request (which owns the one-in-flight queue)")
}

/// Reports that the frontend finished its first paint. `ms` is the
/// frontend's own measurement (time since navigation start). `main.rs`
/// combines this with its own `Instant::now()` capture for the
/// `HERDR_GUI_BENCH=1` startup bench output, and shows the (until-now
/// `visible: false`) window.
#[tauri::command]
pub async fn report_ready(state: tauri::State<'_, AppState>, ms: f64) -> Result<(), ApiError> {
    let _ = (state, ms);
    todo!("report_ready: record attach_ms/first_paint_ms for HERDR_GUI_BENCH=1, show the window")
}

/// Subscribes a `tauri::ipc::Channel` to receive the compact binary surface
/// frames encoded by `surface_encode.rs` (spec §5), as raw bytes.
#[tauri::command]
pub async fn subscribe_surface(
    state: tauri::State<'_, AppState>,
    channel: Channel<Vec<u8>>,
) -> Result<(), ApiError> {
    let _ = (state, channel);
    todo!("subscribe_surface: register the channel so conn.rs's dispatch loop can push encoded frames to it")
}
