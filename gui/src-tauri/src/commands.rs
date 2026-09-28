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

use herdr_wire::{ClientMessage, ClientPaneInputEvent, ClientSurfaceSize, PaneSurfacePane};
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

/// A pane's cell-space geometry, as `appTerminalMouse.ts` needs it: the
/// same `inner_rect` origin both `pane_at` and herdr's own TUI client
/// (`src/client/shell/mouse.rs::pane_mouse_position`) subtract from a raw
/// cell position to get pane-local coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PaneMouseRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

impl From<herdr_wire::SurfaceRect> for PaneMouseRect {
    fn from(rect: herdr_wire::SurfaceRect) -> Self {
        Self {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
        }
    }
}

/// Mirrors `herdr_wire::PaneSurfaceScrollMetrics`, re-exposed as its own
/// (smaller, `Copy`) type so `PaneMouseHit` doesn't need to derive
/// `Serialize` through a wire type it doesn't otherwise own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PaneMouseScroll {
    pub offset_from_bottom: u64,
    pub max_offset_from_bottom: u64,
    pub viewport_rows: u64,
}

/// What `appTerminalMouse.ts` needs to decide how to handle a mouse event
/// at one cell, mirroring herdr's TUI client's own per-event decision
/// (`src/client/shell/mouse.rs::handle_mouse`): forward raw mouse bytes to
/// the pane only when `mouse_reporting` is set (`push_pane_mouse_event`),
/// otherwise track a host-side text selection
/// (`crate::selection::Selection`) using `scroll` to convert a viewport row
/// to the pane's absolute screen-buffer row
/// (`src/selection.rs::absolute_row_for_viewport_row`).
#[derive(Debug, Clone, Serialize)]
pub struct PaneMouseHit {
    pub pane_id: String,
    pub inner_rect: PaneMouseRect,
    pub mouse_reporting: bool,
    pub focused: bool,
    pub scroll: Option<PaneMouseScroll>,
    /// The pane's `content_revision` at hit-test time (terminal-parity spec
    /// P0 #1 "Keep the last selection ... content_revision"; P1 #9 double/
    /// triple-click word/line selection): stamped onto a host-side
    /// selection so a later `pane.selection.read` for it targets the exact
    /// revision the selection was made against, mirroring
    /// `ClientWordSelection.content_revision`
    /// (`src/client/shell/word_selection.rs:41-47`), which reads the same
    /// field off `PaneSurfacePane` (`herdr_wire::PaneSurfacePane.content_revision`).
    pub content_revision: u64,
    /// The pane's scrollbar track, if it has one (terminal-parity spec P1
    /// #10 "Dragging the scrollbar thumb within `scrollbar_rect` ->
    /// `pane.scroll`"): mirrors herdr's TUI client's own hit-test
    /// (`src/client/shell/mouse.rs:2133-2144`), which checks this
    /// **alongside**, not instead of, `inner_rect` -- the scrollbar column
    /// sits just outside the pane's text area.
    pub scrollbar_rect: Option<PaneMouseRect>,
}

fn rect_contains(rect: herdr_wire::SurfaceRect, col: u16, row: u16) -> bool {
    col >= rect.x
        && col < rect.x.saturating_add(rect.width)
        && row >= rect.y
        && row < rect.y.saturating_add(rect.height)
}

/// The actual hit-test, factored out of the `#[tauri::command]` wrapper so
/// it's callable from a plain unit test without a `tauri::State`/`AppState`
/// (there is no established pattern in this crate for constructing those in
/// tests). A hit is `col`/`row` inside `pane.inner_rect` **or**
/// `pane.scrollbar_rect` (half-open on the high edge, same as `pane_at`) --
/// mirrors herdr's TUI client checking both independently
/// (`src/client/shell/mouse.rs:1756-1761` for the pane text area,
/// `:2133-2144` for the scrollbar column).
fn resolve_pane_mouse_hit(panes: &[PaneSurfacePane], col: u16, row: u16) -> Option<PaneMouseHit> {
    panes.iter().find_map(|pane| {
        let inner_hit = rect_contains(pane.inner_rect, col, row);
        let scrollbar_hit = pane
            .scrollbar_rect
            .is_some_and(|rect| rect_contains(rect, col, row));
        (inner_hit || scrollbar_hit).then(|| PaneMouseHit {
            pane_id: pane.pane_id.clone(),
            inner_rect: pane.inner_rect.into(),
            mouse_reporting: pane.mouse_reporting,
            focused: pane.focused,
            scroll: pane.scroll.map(|s| PaneMouseScroll {
                offset_from_bottom: s.offset_from_bottom,
                max_offset_from_bottom: s.max_offset_from_bottom,
                viewport_rows: s.viewport_rows,
            }),
            content_revision: pane.content_revision,
            scrollbar_rect: pane.scrollbar_rect.map(Into::into),
        })
    })
}

/// Hit-tests `mirror.panes[].inner_rect` like `pane_at`, but returns the
/// covering pane's full mouse-relevant geometry in one round trip instead
/// of just its id -- `appTerminalMouse.ts` needs `mouse_reporting`/`scroll`/
/// `focused` on every pointerdown and wheel tick, and a second IPC call per
/// event would fight the "throttle to one per animation frame" budget.
#[tauri::command]
pub fn pane_mouse_hit(
    state: tauri::State<'_, AppState>,
    col: u16,
    row: u16,
) -> Option<PaneMouseHit> {
    let mirror = lock_or_recover(&state.inner.mirror);
    resolve_pane_mouse_hit(&mirror.panes, col, row)
}

/// The focused pane's outer rect, only while the tab is split: the
/// frontend anchors its "close pane" button to it. `None` on a single-pane
/// tab, where closing the pane would close the tab (and maybe the workspace).
fn resolve_split_focused_pane_rect(panes: &[PaneSurfacePane]) -> Option<PaneMouseRect> {
    if panes.len() < 2 {
        return None;
    }
    panes
        .iter()
        .find(|pane| pane.focused)
        .map(|pane| pane.rect.into())
}

#[tauri::command]
pub fn split_focused_pane_rect(state: tauri::State<'_, AppState>) -> Option<PaneMouseRect> {
    let mirror = lock_or_recover(&state.inner.mirror);
    resolve_split_focused_pane_rect(&mirror.panes)
}

/// A pane's current scroll metrics by pane id, for keyboard-driven
/// scrollback (terminal-parity spec P1 #10 "Scrollback keys"):
/// Shift+PgUp/PgDn/Home/End act on the *focused* pane, which has no cell
/// position to hit-test through `pane_mouse_hit` -- this is the same
/// `PaneSurfacePane.scroll` data, looked up by id instead of by coordinate.
#[tauri::command]
pub fn pane_scroll_info(
    state: tauri::State<'_, AppState>,
    pane_id: String,
) -> Option<PaneMouseScroll> {
    let mirror = lock_or_recover(&state.inner.mirror);
    mirror
        .panes
        .iter()
        .find(|pane| pane.pane_id == pane_id)
        .and_then(|pane| pane.scroll)
        .map(|s| PaneMouseScroll {
            offset_from_bottom: s.offset_from_bottom,
            max_offset_from_bottom: s.max_offset_from_bottom,
            viewport_rows: s.viewport_rows,
        })
}

/// A pane's `content_revision`/`inner_rect`/scroll by pane id, for the two
/// other keyboard-driven (no cell position to hit-test) features that need
/// more than `pane_scroll_info` alone: find-in-scrollback (P1 #7, needs
/// `content_revision` for `pane.copy_search`) and copy mode (P1 #8, needs
/// `inner_rect.width` for motions like `$`/line-end and `content_revision`
/// for `pane.copy_motion`).
#[derive(Debug, Clone, Serialize)]
pub struct PaneKeyboardInfo {
    pub content_revision: u64,
    pub inner_rect: PaneMouseRect,
    pub scroll: Option<PaneMouseScroll>,
}

fn resolve_pane_keyboard_info(
    panes: &[PaneSurfacePane],
    pane_id: &str,
) -> Option<PaneKeyboardInfo> {
    panes
        .iter()
        .find(|pane| pane.pane_id == pane_id)
        .map(|pane| PaneKeyboardInfo {
            content_revision: pane.content_revision,
            inner_rect: pane.inner_rect.into(),
            scroll: pane.scroll.map(|s| PaneMouseScroll {
                offset_from_bottom: s.offset_from_bottom,
                max_offset_from_bottom: s.max_offset_from_bottom,
                viewport_rows: s.viewport_rows,
            }),
        })
}

#[tauri::command]
pub fn pane_keyboard_info(
    state: tauri::State<'_, AppState>,
    pane_id: String,
) -> Option<PaneKeyboardInfo> {
    let mirror = lock_or_recover(&state.inner.mirror);
    resolve_pane_keyboard_info(&mirror.panes, &pane_id)
}

/// Writes `text` to the OS clipboard (`crate::clipboard`), for the mouse-
/// selection auto-copy flow: `appTerminalMouse.ts` reads the selected text
/// via the `pane.selection.read` endpoint (mirroring herdr's TUI client's
/// `request_selection_copy`) and hands the result here, the same native
/// write path `dispatch::handle_clipboard` uses for OSC 52 passthrough.
#[tauri::command]
pub fn write_clipboard_text(text: String) -> bool {
    crate::clipboard::write_clipboard_bytes(text.as_bytes())
}

/// Reads plain text from the OS clipboard (terminal-parity spec P0 #4
/// "Paste"): the Rust-side replacement for `navigator.clipboard.readText()`
/// used by both Shift+Insert and the reserved Ctrl+Shift+V override
/// (`keyboard/routing.ts`'s `onPasteOverride`). `None` when the clipboard
/// has no text (or is unavailable) -- callers already treat "nothing to
/// paste" as a no-op.
#[tauri::command]
pub fn clipboard_read_text() -> Option<String> {
    crate::clipboard::read_clipboard_text()
}

/// Opens `url` in the OS's default browser via the opener plugin (terminal-
/// parity spec P0 #6 "Links"), after the same strict scheme check herdr's
/// TUI client applies before ever handing an unhandled link to the OS
/// (`app::actions::safe_web_url`, `src/app/actions.rs:1035-1037`: only
/// `http://`/`https://`, never `file:`/`javascript:`/anything else). The
/// frontend already gates this call on `pane.link.activate`'s own
/// `handled: false` response (spec fact "Link handling"), but the scheme is
/// re-checked here too -- Rust, not the webview, is what actually shells out
/// to the OS, so it must never trust an unvalidated string crossing the IPC
/// boundary.
#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), ApiError> {
    if !is_safe_web_url(&url) {
        return Err(ApiError {
            code: "unsafe_url".to_string(),
            message: format!("refusing to open non-http(s) url: {url}"),
        });
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|err| ApiError {
            code: "io_error".to_string(),
            message: err.to_string(),
        })
}

/// `http://`/`https://` only, byte-for-byte the same rule as herdr's TUI
/// client's own `safe_web_url` (`src/app/actions.rs:1035-1037`): no
/// `file:`, no `javascript:`, no scheme-relative or bare paths.
fn is_safe_web_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// Sends `ClientMessage::ClientShellFocus` (terminal-parity spec P0 #3
/// "Focus reporting"): called from the frontend on every DOM `window` focus
/// and blur (`main.ts`). `dispatch::run_reconnect_loop` separately sends one
/// more, right after each (re)connect, using the window's *current* focus
/// state -- so a reconnect that happens while the window is already
/// focused still tells the server this client is foreground without
/// waiting for the next real focus/blur transition. Only the foreground
/// client gets bell and OSC 52 (`src/server/headless/notifications.rs:325,338`);
/// a client becomes foreground again through `ClientShellFocus{true}`
/// (`headless.rs:2241`).
#[tauri::command]
pub async fn set_client_focus(
    state: tauri::State<'_, AppState>,
    focused: bool,
) -> Result<(), ApiError> {
    let conn = current_connection(&state).await?;
    conn.send(&ClientMessage::ClientShellFocus { focused })
        .await
        .map_err(ApiError::from)
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
            let mut bytes = crate::surface_encode::encode_full_frame(
                mirror.surface_revision,
                mirror.width,
                mirror.height,
                mirror.cursor.as_ref(),
                &mirror.cells,
            );
            // Spec P1 #15 "Rendering": this replay frame carries the cursor
            // shape trailer too, so a frontend that (re)registers its surface
            // listener via `sync_state` sees the right shape immediately
            // instead of the "no shape info" default until the next real
            // frame arrives.
            crate::surface_encode::append_cursor_shape_trailer(&mut bytes, mirror.cursor.as_ref());
            bytes
        })
    };
    if let Some(bytes) = full_frame_bytes {
        crate::dispatch::push_surface_bytes(inner, bytes);
    }

    Ok(())
}

#[cfg(test)]
mod safe_web_url_tests {
    use super::is_safe_web_url;

    #[test]
    fn accepts_http_and_https() {
        assert!(is_safe_web_url("http://example.com"));
        assert!(is_safe_web_url("https://example.com/path?q=1"));
    }

    #[test]
    fn rejects_non_web_schemes() {
        assert!(!is_safe_web_url("file:///etc/passwd"));
        assert!(!is_safe_web_url("javascript:alert(1)"));
        assert!(!is_safe_web_url("ftp://example.com"));
        assert!(!is_safe_web_url("data:text/html,hi"));
    }

    #[test]
    fn rejects_scheme_relative_and_bare_paths() {
        assert!(!is_safe_web_url("//example.com"));
        assert!(!is_safe_web_url("example.com"));
        assert!(!is_safe_web_url(""));
    }
}

#[cfg(test)]
mod pane_mouse_hit_tests {
    use super::*;
    use herdr_wire::SurfaceRect;

    fn rect(x: u16, y: u16, width: u16, height: u16) -> SurfaceRect {
        SurfaceRect {
            x,
            y,
            width,
            height,
        }
    }

    /// Same shape `mirror.rs`'s own tests use for a `PaneSurfacePane`
    /// fixture, extended with the fields this module actually varies
    /// (`mouse_reporting`/`focused`/`scroll`).
    fn pane(
        id: &str,
        inner: SurfaceRect,
        mouse_reporting: bool,
        focused: bool,
        scroll: Option<herdr_wire::PaneSurfaceScrollMetrics>,
    ) -> PaneSurfacePane {
        PaneSurfacePane {
            pane_id: id.into(),
            content_revision: 42,
            rect: inner,
            inner_rect: inner,
            scrollbar_rect: None,
            scroll,
            focused,
            mouse_reporting,
            sgr_pixel_mouse: false,
            alternate_screen_active: false,
            pixel_width: 0,
            pixel_height: 0,
        }
    }

    #[test]
    fn split_focused_pane_rect_only_on_a_split_tab() {
        let single = vec![pane("p1", rect(0, 0, 10, 5), false, true, None)];
        assert!(resolve_split_focused_pane_rect(&single).is_none());
        let split = vec![
            pane("p1", rect(0, 0, 10, 5), false, false, None),
            pane("p2", rect(10, 0, 8, 5), false, true, None),
        ];
        let r = resolve_split_focused_pane_rect(&split).expect("focused pane");
        assert_eq!((r.x, r.y, r.width, r.height), (10, 0, 8, 5));
    }

    #[test]
    fn misses_outside_every_pane() {
        let panes = vec![pane("p1", rect(0, 0, 10, 5), false, true, None)];
        assert!(resolve_pane_mouse_hit(&panes, 10, 0).is_none()); // x == right edge, exclusive
        assert!(resolve_pane_mouse_hit(&panes, 0, 5).is_none()); // y == bottom edge, exclusive
    }

    #[test]
    fn a_click_on_the_scrollbar_column_hits_even_though_its_outside_inner_rect() {
        let mut p = pane("p1", rect(0, 0, 10, 5), false, true, None);
        p.rect = rect(0, 0, 11, 5);
        p.scrollbar_rect = Some(rect(10, 0, 1, 5)); // one column right of inner_rect
        let panes = vec![p];

        // Outside inner_rect (x=10 is inner_rect's exclusive right edge) but
        // inside scrollbar_rect: still a hit.
        let hit = resolve_pane_mouse_hit(&panes, 10, 2).expect("scrollbar column is a hit");
        assert_eq!(hit.pane_id, "p1");
        assert_eq!(
            hit.scrollbar_rect,
            Some(PaneMouseRect {
                x: 10,
                y: 0,
                width: 1,
                height: 5
            })
        );

        // A hit *inside* inner_rect also reports the pane's scrollbar_rect.
        let hit = resolve_pane_mouse_hit(&panes, 2, 2).expect("inside inner_rect");
        assert_eq!(
            hit.scrollbar_rect,
            Some(PaneMouseRect {
                x: 10,
                y: 0,
                width: 1,
                height: 5
            })
        );

        // Past both rects: a miss.
        assert!(resolve_pane_mouse_hit(&panes, 11, 2).is_none());
    }

    #[test]
    fn no_scrollbar_rect_means_none_in_the_hit() {
        let panes = vec![pane("p1", rect(0, 0, 10, 5), false, true, None)];
        let hit = resolve_pane_mouse_hit(&panes, 2, 2).unwrap();
        assert_eq!(hit.scrollbar_rect, None);
    }

    #[test]
    fn pane_keyboard_info_looks_up_by_id_not_coordinate() {
        let scroll = herdr_wire::PaneSurfaceScrollMetrics {
            offset_from_bottom: 3,
            max_offset_from_bottom: 20,
            viewport_rows: 10,
        };
        let panes = vec![
            pane("a", rect(0, 0, 10, 5), false, true, None),
            pane("b", rect(10, 0, 10, 5), false, false, Some(scroll)),
        ];
        assert!(resolve_pane_keyboard_info(&panes, "missing").is_none());
        let info = resolve_pane_keyboard_info(&panes, "b").expect("pane b exists");
        assert_eq!(info.content_revision, 42);
        assert_eq!(
            info.inner_rect,
            PaneMouseRect {
                x: 10,
                y: 0,
                width: 10,
                height: 5
            }
        );
        assert_eq!(info.scroll.unwrap().max_offset_from_bottom, 20);
    }

    #[test]
    fn hits_return_pane_local_geometry_and_flags() {
        let panes = vec![
            pane("left", rect(0, 0, 10, 5), false, true, None),
            pane(
                "right",
                rect(10, 0, 10, 5),
                true,
                false,
                Some(herdr_wire::PaneSurfaceScrollMetrics {
                    offset_from_bottom: 3,
                    max_offset_from_bottom: 20,
                    viewport_rows: 5,
                }),
            ),
        ];

        let hit = resolve_pane_mouse_hit(&panes, 2, 3).expect("inside `left`");
        assert_eq!(hit.pane_id, "left");
        assert_eq!(
            hit.inner_rect,
            PaneMouseRect {
                x: 0,
                y: 0,
                width: 10,
                height: 5
            }
        );
        assert!(!hit.mouse_reporting);
        assert!(hit.focused);
        assert!(hit.scroll.is_none());
        assert_eq!(hit.content_revision, 42);

        let hit = resolve_pane_mouse_hit(&panes, 15, 4).expect("inside `right`");
        assert_eq!(hit.pane_id, "right");
        assert!(hit.mouse_reporting);
        assert!(!hit.focused);
        let scroll = hit.scroll.expect("right pane has scroll metrics");
        assert_eq!(scroll.offset_from_bottom, 3);
        assert_eq!(scroll.max_offset_from_bottom, 20);
        assert_eq!(scroll.viewport_rows, 5);
    }

    #[test]
    fn first_matching_pane_wins_on_overlap() {
        // Mirrors `pane_at`'s own `find_map` (first match wins): overlapping
        // panes should not occur in a real surface, but the tie-break rule
        // still needs a defined, tested answer.
        let panes = vec![
            pane("first", rect(0, 0, 10, 10), false, true, None),
            pane("second", rect(0, 0, 10, 10), true, true, None),
        ];
        assert_eq!(
            resolve_pane_mouse_hit(&panes, 5, 5).unwrap().pane_id,
            "first"
        );
    }
}
