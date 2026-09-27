//! Tauri commands invoked from the frontend (spec §4 `commands.rs`).
//!
//! `AppState` is the shared handle both the background connection task
//! (spawned in `lib.rs`) and these commands operate on: the current
//! `Connection` (once attached), the authoritative `SurfaceMirror`, the
//! active `boot_id`, the subscribed surface `Channel`, and the bookkeeping
//! `report_ready` needs for the `HERDR_GUI_BENCH=1` startup bench output.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard, PoisonError};
use std::time::Instant;

use herdr_wire::{ClientMessage, ClientPaneInputEvent, ClientSurfaceSize};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock as AsyncRwLock;

use crate::conn::{ConnError, Connection};
use crate::mirror::SurfaceMirror;
use crate::usage;

/// Locks `mutex`, recovering from a poisoned lock (a prior panic while it
/// was held) instead of panicking on every later access (finding #14): no
/// data derived from the herdr server should ever be allowed to cascade a
/// panic into a permanently unusable lock.
fn lock_or_recover<T>(mutex: &StdMutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Shared state behind `AppState`, cloned (via `Arc`) into the background
/// connection task spawned from `lib.rs::run`.
pub struct Inner {
    /// The live connection, once the reconnect loop has attached. `None`
    /// while `Unavailable`/`Disconnected` (spec §4 `conn.rs`).
    pub connection: AsyncRwLock<Option<Arc<Connection>>>,
    /// The backend's authoritative mirror of the current composited grid.
    pub mirror: StdMutex<SurfaceMirror>,
    /// The active snapshot's `boot_id`, needed to build
    /// `ClientShellEndpointRequest`/`ClientShellResize` (spec §1 "boot_id").
    pub boot_id: StdMutex<String>,
    /// The channel `subscribe_surface` registered, if any. The dispatch
    /// loop pushes each encoded surface frame here as raw bytes.
    pub surface_channel: StdMutex<Option<Channel<InvokeResponseBody>>>,
    /// `main.rs`'s `Instant::now()`, captured before anything else.
    pub start: Instant,
    /// Set once the first full `PaneSurface` has been applied.
    pub attach_ms: StdMutex<Option<f64>>,
    /// Guards against `report_ready` running its `HERDR_GUI_BENCH=1` exit
    /// path more than once.
    pub bench_reported: AtomicBool,
    /// The last requested `(cols, rows, cell_width_px, cell_height_px)`
    /// from `resize` (spec §4 v3), reused by the handshake hello
    /// (`dispatch::initial_hello`) and the dispatch loop's resync-on-reject
    /// `ClientShellResize` (spec §1 "Resync on reject") -- never the
    /// mirror's own (possibly 0x0 before the first frame, or stale) size
    /// (finding #2). Falls back to 80x24 @ 8x16 before the first `resize`.
    last_size: StdMutex<(u16, u16, u32, u32)>,
    /// The `Instant` the very first connection attempt started, recorded by
    /// `dispatch::run_reconnect_loop`. `attach_ms` (spec §4 v3 `main.rs`)
    /// measures from here, not from `start` (process start) (finding #5).
    connect_start: StdMutex<Option<Instant>>,
    /// The last `snapshot`/`usage`/`connection-status` payload, cached so
    /// `sync_state` (spec §4 v3) can re-emit each to a frontend that
    /// registered its `listen` calls after they first fired (finding #1).
    last_snapshot: StdMutex<Option<serde_json::Value>>,
    last_usage: StdMutex<Option<usage::UsageState>>,
    /// `(status, socket_path, server_version)`. `server_version` (finding
    /// #14 "About shows the server version") is `Some` only once
    /// `status == "connected"`, from the welcome handshake
    /// (`conn::Connection::server_version`).
    last_connection_status: StdMutex<Option<(String, String, Option<String>)>>,
    /// The agent-done desktop toast rate limiter (spec phase1.5 §7): "one
    /// toast per 5s, with extra transitions coalesced into 'and N more'".
    pub toast_limiter: StdMutex<crate::notify::ToastRateLimiter>,
    /// Serializes `settings_set` writes (finding #7): several near-
    /// simultaneous saves (e.g. a sidebar-resize drag-end racing a theme
    /// change) must never interleave their write-tmp-then-rename steps.
    /// A `tokio` mutex, not `StdMutex`, because the lock is held across the
    /// blocking file write inside an `async fn` command.
    pub settings_save_lock: tokio::sync::Mutex<()>,
    /// The once-per-launch herdr server auto-start guard (Phase 1.6 spec
    /// §3.3): shared by the reconnect loop's `Err` arm and the wizard's
    /// step 1, per "one entry point `ensure_server_started()`".
    pub server_start_guard: crate::engine::StartOnceGuard,
}

impl Inner {
    fn new(start: Instant) -> Self {
        Self {
            connection: AsyncRwLock::new(None),
            mirror: StdMutex::new(SurfaceMirror::empty()),
            boot_id: StdMutex::new(String::new()),
            surface_channel: StdMutex::new(None),
            start,
            attach_ms: StdMutex::new(None),
            bench_reported: AtomicBool::new(false),
            last_size: StdMutex::new((80, 24, 8, 16)),
            connect_start: StdMutex::new(None),
            last_snapshot: StdMutex::new(None),
            last_usage: StdMutex::new(None),
            last_connection_status: StdMutex::new(None),
            toast_limiter: StdMutex::new(crate::notify::ToastRateLimiter::default()),
            settings_save_lock: tokio::sync::Mutex::new(()),
            server_start_guard: crate::engine::StartOnceGuard::default(),
        }
    }

    /// Records the first successful attach (first full `PaneSurface`
    /// applied), if not already recorded, measured from `connect_start`
    /// (finding #5) when known, else from process `start`.
    pub fn record_attach(&self) {
        let mut attach_ms = lock_or_recover(&self.attach_ms);
        if attach_ms.is_none() {
            let began = lock_or_recover(&self.connect_start).unwrap_or(self.start);
            *attach_ms = Some(began.elapsed().as_secs_f64() * 1000.0);
        }
    }

    /// Records the very first connection attempt's start time, if not
    /// already recorded. Idempotent: safe to call on every reconnect.
    pub fn record_connect_start(&self) {
        let mut connect_start = lock_or_recover(&self.connect_start);
        if connect_start.is_none() {
            *connect_start = Some(Instant::now());
        }
    }

    pub fn last_size(&self) -> (u16, u16, u32, u32) {
        *lock_or_recover(&self.last_size)
    }

    pub fn set_last_size(&self, cols: u16, rows: u16, cell_w: u32, cell_h: u32) {
        *lock_or_recover(&self.last_size) = (cols, rows, cell_w, cell_h);
    }

    pub fn record_connection_status(
        &self,
        status: &str,
        socket_path: &str,
        server_version: Option<&str>,
    ) {
        *lock_or_recover(&self.last_connection_status) = Some((
            status.to_string(),
            socket_path.to_string(),
            server_version.map(str::to_string),
        ));
    }

    pub fn record_snapshot(&self, value: serde_json::Value) {
        *lock_or_recover(&self.last_snapshot) = Some(value);
    }

    pub fn record_usage(&self, state: usage::UsageState) {
        *lock_or_recover(&self.last_usage) = Some(state);
    }
}

/// Shared application state, injected into every command via `tauri::State`.
/// Owned by `conn.rs`'s background task in the real implementation.
pub struct AppState {
    pub inner: Arc<Inner>,
}

impl AppState {
    pub fn new(start: Instant) -> Self {
        Self {
            inner: Arc::new(Inner::new(start)),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new(Instant::now())
    }
}

/// Error shape returned to the frontend by `api`. Distinct from the
/// backend's own `conn::ConnError`: this is what crosses the Tauri IPC
/// boundary, so it must be `Serialize`.
#[derive(Debug, Clone, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl From<ConnError> for ApiError {
    fn from(err: ConnError) -> Self {
        let code = match &err {
            ConnError::Timeout => "timeout",
            ConnError::Io(_) => "io_error",
            ConnError::HandshakeRejected(_) => "handshake_rejected",
            ConnError::Closed => "closed",
            ConnError::EndpointError { code, .. } => code.as_str(),
        }
        .to_string();
        ApiError {
            code,
            message: err.to_string(),
        }
    }
}

fn not_connected() -> ApiError {
    ApiError {
        code: "not_connected".to_string(),
        message: "not connected to a herdr server".to_string(),
    }
}

async fn current_connection(state: &AppState) -> Result<Arc<Connection>, ApiError> {
    state
        .inner
        .connection
        .read()
        .await
        .clone()
        .ok_or_else(not_connected)
}

/// Sends classified input events to a stable pane target
/// (`ClientMessage::ClientShellPaneInput`).
#[tauri::command]
pub async fn send_input(
    state: tauri::State<'_, AppState>,
    pane_id: String,
    events: Vec<ClientPaneInputEvent>,
) -> Result<(), ApiError> {
    let conn = current_connection(&state).await?;
    conn.send(&ClientMessage::ClientShellPaneInput { pane_id, events })
        .await
        .map_err(ApiError::from)
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
    state.inner.set_last_size(cols, rows, cell_w, cell_h);
    let conn = current_connection(&state).await?;
    conn.send(&ClientMessage::ClientShellResize {
        cell_width_px: cell_w,
        cell_height_px: cell_h,
        surface_size: ClientSurfaceSize { cols, rows },
        pixel_mouse: false,
    })
    .await
    .map_err(ApiError::from)
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
    let conn = current_connection(&state).await?;
    let boot_id = lock_or_recover(&state.inner.boot_id).clone();
    conn.endpoint_request(&boot_id, &method, params)
        .await
        .map_err(ApiError::from)
}

/// Polls (bounded) for `attach_ms` to be recorded, for the
/// `HERDR_GUI_BENCH=1` output. Returns `-1.0` if the surface never attached
/// within the timeout, which the bench script's threshold check correctly
/// treats as a failure rather than hanging forever.
async fn wait_for_attach_ms(inner: &Inner) -> f64 {
    let deadline = Instant::now() + std::time::Duration::from_secs(30);
    loop {
        if let Some(ms) = *lock_or_recover(&inner.attach_ms) {
            return ms;
        }
        if Instant::now() >= deadline {
            return -1.0;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
}

/// Reports that the frontend finished its first paint, and shows the
/// (until-now `visible: false`) window. `ms` is the frontend's own
/// `performance.now()`-based measurement, kept only as a diagnostic: the
/// `HERDR_GUI_BENCH=1` output's `first_paint_ms` is measured here in Rust
/// instead, as `state.inner.start.elapsed()` (an `Instant` captured in
/// `main.rs` before anything else). The frontend clock's epoch (navigation
/// start) excludes Tauri/webview startup overhead before the page even
/// loads, which would understate the cold-start cost the bench measures
/// (finding #5).
#[tauri::command]
pub async fn report_ready(
    state: tauri::State<'_, AppState>,
    app: AppHandle,
    ms: f64,
) -> Result<(), ApiError> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
    }

    if std::env::var("HERDR_GUI_BENCH").ok().as_deref() == Some("1")
        && !state.inner.bench_reported.swap(true, Ordering::SeqCst)
    {
        let attach_ms = wait_for_attach_ms(&state.inner).await;
        let first_paint_ms = state.inner.start.elapsed().as_secs_f64() * 1000.0;
        tracing::debug!(
            js_first_paint_ms = ms,
            rust_first_paint_ms = first_paint_ms,
            "report_ready"
        );
        let line = serde_json::json!({
            "first_paint_ms": first_paint_ms,
            "attach_ms": attach_ms,
        })
        .to_string();
        println!("{line}");
        std::process::exit(0);
    }

    Ok(())
}

/// Subscribes a `tauri::ipc::Channel` to receive the compact binary surface
/// frames encoded by `surface_encode.rs` (spec §5), as raw bytes.
#[tauri::command]
pub async fn subscribe_surface(
    state: tauri::State<'_, AppState>,
    channel: Channel<InvokeResponseBody>,
) -> Result<(), ApiError> {
    *lock_or_recover(&state.inner.surface_channel) = Some(channel);
    Ok(())
}

/// Hit-tests `mirror.panes[].inner_rect` in cell coordinates and returns the
/// covering pane's id, or `None` (spec §4 v3 "`pane_at`"). Click-to-focus
/// (spec §6 "Input") uses this: the compact binary surface stream (spec §5)
/// and the snapshot both omit pane geometry, so this command is the only
/// source of it (finding #6).
#[tauri::command]
pub fn pane_at(state: tauri::State<'_, AppState>, col: u16, row: u16) -> Option<String> {
    let mirror = lock_or_recover(&state.inner.mirror);
    mirror.panes.iter().find_map(|pane| {
        let rect = pane.inner_rect;
        let hit = col >= rect.x
            && col < rect.x.saturating_add(rect.width)
            && row >= rect.y
            && row < rect.y.saturating_add(rect.height);
        hit.then(|| pane.pane_id.clone())
    })
}

/// Re-emits the last cached `snapshot`, `usage`, and `connection-status`,
/// and pushes an encoded full frame of the mirror (if any) to the
/// subscribed surface channel (spec §4 v3 "`sync_state`"). The frontend
/// calls this once, after it registers every listener and subscribes to
/// the surface: events emitted before the webview started listening are
/// otherwise lost for good (finding #1 -- the startup-event-loss blocker).
#[tauri::command]
pub async fn sync_state(state: tauri::State<'_, AppState>, app: AppHandle) -> Result<(), ApiError> {
    let inner = &state.inner;

    if let Some(snapshot) = lock_or_recover(&inner.last_snapshot).clone() {
        let _ = app.emit("snapshot", snapshot);
    }
    if let Some(usage_state) = lock_or_recover(&inner.last_usage).clone() {
        let _ = app.emit("usage", usage_state);
    }
    if let Some((status, socket_path, server_version)) =
        lock_or_recover(&inner.last_connection_status).clone()
    {
        let _ = app.emit(
            "connection-status",
            serde_json::json!({ "status": status, "socketPath": socket_path, "serverVersion": server_version }),
        );
    }

    let full_frame_bytes = {
        let mirror = lock_or_recover(&inner.mirror);
        mirror.has_surface().then(|| {
            crate::surface_encode::encode_full_frame(
                mirror.surface_revision,
                mirror.width,
                mirror.height,
                mirror.cursor.as_ref(),
                &mirror.cells,
            )
        })
    };
    if let Some(bytes) = full_frame_bytes {
        crate::dispatch::push_surface_bytes(inner, bytes);
    }

    Ok(())
}
