//! The mirror tools window: a small frameless window that docks just outside
//! the scrcpy mirror window and follows it (docs/mirror-toolbar-spec.md).
//! Not `mirror.rs`, which is the terminal `SurfaceMirror`.
//!
//! The pure functions and `MirrorToolsState` compile and run on every target.
//! The Win32 calls live in `mirror_tools_win32.rs` (Windows only).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use crate::commands::ApiError;
use crate::flutter::api_error;
#[cfg(windows)]
use crate::mirror_tools_win32;

pub const TRACK_INTERVAL: Duration = Duration::from_millis(100);
pub const FIND_TIMEOUT: Duration = Duration::from_secs(5);
/// Logical px. Multiplied by the monitor scale before use.
pub const DOCK_GAP: f64 = 6.0;
pub const STRIP_WIDTH: f64 = 52.0;
pub const STRIP_HEIGHT: f64 = 132.0;
pub const PANEL_WIDTH: f64 = 320.0;
pub const EXPANDED_WIDTH: f64 = STRIP_WIDTH + PANEL_WIDTH;
pub const EXPANDED_HEIGHT: f64 = 820.0;
pub const DEVICE_NAME_MAX_CHARS: usize = 80;
pub const LABEL_PREFIX: &str = "mirror-tools-";

/// Screen rectangle in physical px, same layout as Win32 `RECT`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Size {
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DockSide {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Dock {
    pub x: i32,
    pub y: i32,
    pub side: DockSide,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Foreground {
    Scrcpy,
    Tools,
    /// A window whose owner is the tools window (the Save as… dialog).
    ToolsOwned,
    /// Any other window.
    Other,
    /// `GetForegroundWindow` returned null (it does during Alt+Tab).
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct VisibilityInput {
    pub scrcpy_exists: bool,
    pub scrcpy_minimized: bool,
    /// The page called `mirror_tools_resize` at least once.
    pub ready: bool,
    /// `dock_position` returned `Some`.
    pub fits: bool,
    pub foreground: Foreground,
}

/// Where the tools window goes: right of scrcpy, else left, else `None`.
/// `None` means hide it. It never clamps into the work area when no side
/// fits, because that would cover the phone image. `tools` is the CURRENT
/// size (strip or expanded), so an expanded window on the left grows away
/// from scrcpy.
pub fn dock_position(scrcpy: Rect, tools: Size, work_area: Rect, gap: i32) -> Option<Dock> {
    let right_x = scrcpy.right + gap;
    let (x, side) = if right_x + tools.width <= work_area.right {
        (right_x, DockSide::Right)
    } else {
        let left_x = scrcpy.left - gap - tools.width;
        if left_x >= work_area.left {
            (left_x, DockSide::Left)
        } else {
            return None;
        }
    };
    // `max` runs last: a window taller than the work area sits at its top.
    let y = scrcpy
        .top
        .min(work_area.bottom - tools.height)
        .max(work_area.top);
    Some(Dock { x, y, side })
}

/// The window must not float over other apps, so it shows only while scrcpy
/// or the tools window (or a dialog it owns) is in front. A null foreground
/// keeps the last state, so Alt+Tab does not flicker it.
pub fn tools_visible(input: VisibilityInput, was_visible: bool) -> bool {
    if !input.scrcpy_exists || input.scrcpy_minimized || !input.ready || !input.fits {
        return false;
    }
    match input.foreground {
        Foreground::Scrcpy | Foreground::Tools | Foreground::ToolsOwned => true,
        Foreground::Other => false,
        Foreground::None => was_visible,
    }
}

/// Strip or expanded size in physical px, the height capped at the work area.
pub fn tools_size(expanded: bool, scale: f64, work_area: Rect) -> Size {
    let (w, h) = if expanded {
        (EXPANDED_WIDTH, EXPANDED_HEIGHT)
    } else {
        (STRIP_WIDTH, STRIP_HEIGHT)
    };
    let height = ((h * scale).round() as i32).min(work_area.bottom - work_area.top);
    Size {
        width: (w * scale).round() as i32,
        height,
    }
}

/// A Tauri label allows only `[a-zA-Z0-9-/:_]`, so `.` is the one id
/// character to map. Ids that differ only in `.` versus `_` collide; a real
/// adb id does not do that.
pub fn tools_label(device_id: &str) -> String {
    format!("{LABEL_PREFIX}{}", device_id.replace('.', "_"))
}

pub fn scrcpy_window_title(device_id: &str) -> String {
    format!("Cowbell mirror {device_id}")
}

/// Control chars removed, trimmed, cut to `DEVICE_NAME_MAX_CHARS`. An empty
/// result gives the device id.
pub fn sanitize_device_name(name: &str, device_id: &str) -> String {
    let cleaned: String = name.chars().filter(|c| !c.is_control()).collect();
    let cut: String = cleaned.trim().chars().take(DEVICE_NAME_MAX_CHARS).collect();
    if cut.is_empty() {
        device_id.to_string()
    } else {
        cut
    }
}

/// `mirror-tools.html?device=<id>&name=<name>`, both values form-encoded.
pub fn tools_url(device_id: &str, device_name: &str) -> String {
    let mut url = tauri::Url::parse("http://x/mirror-tools.html").expect("static url");
    url.query_pairs_mut()
        .append_pair("device", device_id)
        .append_pair("name", device_name);
    format!("mirror-tools.html?{}", url.query().unwrap_or(""))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ToolsEntry {
    /// The scrcpy HWND as `isize` (0 until found). `HWND` holds a raw
    /// pointer and is not `Send`.
    pub scrcpy_hwnd: isize,
    pub expanded: bool,
    pub ready: bool,
    pub side: DockSide,
}

/// One entry per tools window, keyed by window label. Rust owns it; the page
/// owns only its DOM state. Also the "one tools window per device" guard.
#[derive(Default)]
pub struct MirrorToolsState(Mutex<HashMap<String, ToolsEntry>>);

impl MirrorToolsState {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, ToolsEntry>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Inserts a fresh entry. `false` when the label is already claimed.
    pub fn claim(&self, label: &str) -> bool {
        let mut map = self.lock();
        if map.contains_key(label) {
            return false;
        }
        map.insert(
            label.to_string(),
            ToolsEntry {
                scrcpy_hwnd: 0,
                expanded: false,
                ready: false,
                side: DockSide::Right,
            },
        );
        true
    }

    pub fn release(&self, label: &str) {
        self.lock().remove(label);
    }

    pub fn get(&self, label: &str) -> Option<ToolsEntry> {
        self.lock().get(label).copied()
    }

    /// Applies `f` to the entry, if any; returns the new value.
    pub fn update(&self, label: &str, f: impl FnOnce(&mut ToolsEntry)) -> Option<ToolsEntry> {
        let mut map = self.lock();
        let entry = map.get_mut(label)?;
        f(entry);
        Some(*entry)
    }
}

/// The main window's `additional_browser_args`. All webviews share one
/// WebView2 environment and user data folder, and a webview built with other
/// browser arguments fails to create.
#[cfg(windows)]
fn main_browser_args(app: &tauri::AppHandle) -> Option<String> {
    app.config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .and_then(|w| w.additional_browser_args.clone())
}

/// Builds the hidden tools window. Call it from a task, never from a
/// synchronous command on the main thread (that deadlocks on Windows).
#[cfg(windows)]
fn build_window(
    app: &tauri::AppHandle,
    label: &str,
    device_id: &str,
    device_name: &str,
) -> tauri::Result<tauri::WebviewWindow> {
    let url = tools_url(device_id, device_name);
    let mut builder =
        tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(url.into()))
            .title("Cowbell mirror tools")
            // Logical px; the tracker sets the real size at once.
            .inner_size(STRIP_WIDTH, STRIP_HEIGHT)
            .decorations(false)
            // `true` draws a 1 px white border on an undecorated window.
            .shadow(false)
            .resizable(false)
            .skip_taskbar(true)
            // Topmost is set by `SetWindowPos` only.
            .always_on_top(false)
            .focused(false)
            .visible(false)
            .zoom_hotkeys_enabled(false)
            .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff));
    if let Some(args) = main_browser_args(app) {
        builder = builder.additional_browser_args(&args);
    }
    builder.build()
}

#[cfg(windows)]
enum Tick {
    Continue,
    Stop,
}

/// One placement step, shared by the tracker and `mirror_tools_resize`:
/// snapshot scrcpy, dock, decide visibility, place when it changed, and tell
/// the page when the dock side flipped. `last` `None` forces a placement.
#[cfg(windows)]
fn apply(
    app: &tauri::AppHandle,
    label: &str,
    tools_hwnd: isize,
    last: &mut Option<mirror_tools_win32::Placement>,
) -> Tick {
    use tauri::{Emitter, Manager};

    let state = app.state::<MirrorToolsState>();
    let Some(entry) = state.get(label) else {
        return Tick::Stop;
    };
    let Some(snap) = mirror_tools_win32::snapshot(entry.scrcpy_hwnd) else {
        return Tick::Stop;
    };
    let size = tools_size(entry.expanded, snap.scale, snap.work_area);
    let gap = (DOCK_GAP * snap.scale).round() as i32;
    let dock = dock_position(snap.frame, size, snap.work_area, gap);
    let visible = tools_visible(
        VisibilityInput {
            scrcpy_exists: true,
            scrcpy_minimized: snap.minimized,
            ready: entry.ready,
            fits: dock.is_some(),
            foreground: mirror_tools_win32::foreground(entry.scrcpy_hwnd, tools_hwnd),
        },
        last.is_some_and(|p| p.visible),
    );
    let placement = match dock {
        // A hidden window keeps the default position, so a moving scrcpy
        // does not repeat the hide.
        Some(d) if visible => mirror_tools_win32::Placement {
            visible: true,
            x: d.x,
            y: d.y,
            width: size.width,
            height: size.height,
        },
        _ => mirror_tools_win32::Placement::default(),
    };
    // Place only on a change: the idle cost stays near zero. One more case:
    // moving the window to a monitor with another DPI makes tao resize it
    // (`WM_DPICHANGED`), so its real size no longer matches `last`. Place
    // again; the second `SetWindowPos` lands on the same monitor and sticks.
    // The 2 px slack keeps a rounding difference from re-placing every tick.
    let resized_by_dpi = placement.visible
        && last.is_some_and(|p| p.visible)
        && mirror_tools_win32::window_size(tools_hwnd).is_some_and(|(w, h)| {
            (w - placement.width).abs() > 2 || (h - placement.height).abs() > 2
        });
    if *last != Some(placement) || resized_by_dpi {
        mirror_tools_win32::place(tools_hwnd, placement);
        *last = Some(placement);
    }
    if let Some(d) = dock {
        if d.side != entry.side {
            state.update(label, |e| e.side = d.side);
            let _ = app.emit_to(label, "mirror-tools-side", d.side);
        }
    }
    Tick::Continue
}

/// Waits for the scrcpy window to appear, up to `FIND_TIMEOUT`. `None` when
/// it never shows or scrcpy exits first.
#[cfg(windows)]
async fn find_scrcpy_window(child: &mut tokio::process::Child, device_id: &str) -> Option<isize> {
    let pid = child.id()?;
    let title = scrcpy_window_title(device_id);
    let deadline = tokio::time::Instant::now() + FIND_TIMEOUT;
    loop {
        if let Some(hwnd) = mirror_tools_win32::find_window(&title, pid) {
            return Some(hwnd);
        }
        if tokio::time::Instant::now() >= deadline || !matches!(child.try_wait(), Ok(None)) {
            return None;
        }
        tokio::time::sleep(TRACK_INTERVAL).await;
    }
}

/// Owns the tools window for one scrcpy: find the scrcpy window, build the
/// tools window, follow it until either side closes. Spawned by
/// `android_mirror`. A failure only logs: scrcpy itself works.
#[cfg(windows)]
pub async fn run(
    app: tauri::AppHandle,
    mut child: tokio::process::Child,
    device_id: String,
    device_name: String,
) {
    use tauri::Manager;

    let state = app.state::<MirrorToolsState>();
    let label = tools_label(&device_id);
    if !state.claim(&label) {
        tracing::info!("mirror tools window already open for {device_id}");
        return;
    }
    let Some(scrcpy_hwnd) = find_scrcpy_window(&mut child, &device_id).await else {
        tracing::warn!("scrcpy window not found for {device_id}");
        state.release(&label);
        return;
    };
    state.update(&label, |e| e.scrcpy_hwnd = scrcpy_hwnd);
    let window = match build_window(&app, &label, &device_id, &device_name) {
        Ok(window) => window,
        Err(err) => {
            tracing::warn!("mirror tools window failed for {device_id}: {err}");
            state.release(&label);
            return;
        }
    };
    let tools_hwnd = match window.hwnd() {
        Ok(hwnd) => Some(hwnd.0 as isize),
        Err(err) => {
            tracing::warn!("mirror tools window has no hwnd: {err}");
            None
        }
    };
    if let Some(tools_hwnd) = tools_hwnd {
        // Once, while the window is still hidden (see the function's note).
        mirror_tools_win32::make_tool_window(tools_hwnd);
        let mut last = None;
        loop {
            tokio::select! {
                _ = child.wait() => break,
                _ = tokio::time::sleep(TRACK_INTERVAL) => {}
            }
            // The user closed the tools window.
            if app.get_webview_window(&label).is_none() {
                break;
            }
            if let Tick::Stop = apply(&app, &label, tools_hwnd, &mut last) {
                break;
            }
        }
    }
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.destroy();
    }
    state.release(&label);
}

/// Not Windows: no tools window. Dropping `child` does not kill scrcpy
/// (`kill_on_drop` is off by default).
#[cfg(not(windows))]
pub async fn run(
    app: tauri::AppHandle,
    child: tokio::process::Child,
    device_id: String,
    device_name: String,
) {
    let _ = (app, device_id, device_name);
    drop(child);
}

/// The page calls this for three things: the ready signal (the first call,
/// with `false`), expand, and collapse. Returns the side scrcpy is docked on.
#[tauri::command]
pub async fn mirror_tools_resize(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MirrorToolsState>,
    expanded: bool,
) -> Result<DockSide, ApiError> {
    let label = window.label().to_string();
    let entry = state.get(&label).ok_or_else(|| {
        api_error(
            "not_mirror_tools",
            "This window is not a mirror tools window",
        )
    })?;
    #[cfg(not(windows))]
    {
        let _ = (entry, expanded);
        Err(api_error("unsupported", "Mirror tools are Windows only"))
    }
    #[cfg(windows)]
    {
        use tauri::Manager;

        let snap = mirror_tools_win32::snapshot(entry.scrcpy_hwnd)
            .ok_or_else(|| api_error("mirror_closed", "The mirror window is closed"))?;
        let size = tools_size(expanded, snap.scale, snap.work_area);
        let gap = (DOCK_GAP * snap.scale).round() as i32;
        let dock = dock_position(snap.frame, size, snap.work_area, gap);
        // No room: leave `expanded` as it is.
        if expanded && dock.is_none() {
            return Err(api_error(
                "no_room",
                "No room next to the mirror for the preview",
            ));
        }
        let updated = state
            .update(&label, |e| {
                e.expanded = expanded;
                e.ready = true;
            })
            .ok_or_else(|| {
                api_error(
                    "not_mirror_tools",
                    "This window is not a mirror tools window",
                )
            })?;
        let tools_hwnd = window
            .hwnd()
            .map_err(|err| api_error("window_failed", err.to_string()))?
            .0 as isize;
        // Post the resize now. `SWP_ASYNCWINDOWPOS` applies it a moment later,
        // so the page may render once into the old size before it lands.
        apply(window.app_handle(), &label, tools_hwnd, &mut None);
        Ok(dock.map_or(updated.side, |d| d.side))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Rect = Rect {
        left: 0,
        top: 0,
        right: 1920,
        bottom: 1040,
    };
    const STRIP: Size = Size {
        width: 52,
        height: 132,
    };

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> Rect {
        Rect {
            left,
            top,
            right,
            bottom,
        }
    }

    fn dock(x: i32, y: i32, side: DockSide) -> Option<Dock> {
        Some(Dock { x, y, side })
    }

    #[test]
    fn dock_goes_right_of_scrcpy_top_aligned() {
        assert_eq!(
            dock_position(rect(100, 50, 500, 900), STRIP, WORK, 6),
            dock(506, 50, DockSide::Right)
        );
    }

    #[test]
    fn dock_flips_left_when_the_right_side_has_no_room() {
        assert_eq!(
            dock_position(rect(1400, 50, 1900, 900), STRIP, WORK, 6),
            dock(1342, 50, DockSide::Left)
        );
    }

    #[test]
    fn dock_exact_fit_on_the_right_stays_right() {
        // right + gap + width == work.right
        let scrcpy = rect(1000, 50, 1862, 900);
        assert_eq!(
            dock_position(scrcpy, STRIP, WORK, 6),
            dock(1868, 50, DockSide::Right)
        );
        // One pixel more and it flips.
        let scrcpy = rect(1000, 50, 1863, 900);
        assert_eq!(
            dock_position(scrcpy, STRIP, WORK, 6).map(|d| d.side),
            Some(DockSide::Left)
        );
    }

    #[test]
    fn dock_is_none_when_no_side_fits() {
        assert_eq!(dock_position(rect(0, 0, 1920, 1040), STRIP, WORK, 6), None);
    }

    #[test]
    fn dock_clamps_y_into_the_work_area() {
        let cases = [(-20, 0), (1000, 1040 - 132), (50, 50)];
        for (top, want) in cases {
            let d = dock_position(rect(100, top, 500, top + 400), STRIP, WORK, 6).unwrap();
            assert_eq!(d.y, want, "top {top}");
        }
    }

    #[test]
    fn dock_taller_than_the_work_area_sits_at_the_top() {
        let tall = Size {
            width: 52,
            height: 2000,
        };
        let d = dock_position(rect(100, 300, 500, 900), tall, WORK, 6).unwrap();
        assert_eq!(d.y, 0);
    }

    #[test]
    fn dock_expanded_grows_away_from_scrcpy_on_the_left() {
        let expanded = Size {
            width: 372,
            height: 820,
        };
        assert_eq!(
            dock_position(rect(1400, 50, 1900, 900), expanded, WORK, 6),
            dock(1022, 50, DockSide::Left)
        );
    }

    #[test]
    fn dock_works_on_a_monitor_with_negative_coordinates() {
        let work = rect(-1920, 0, 0, 1040);
        assert_eq!(
            dock_position(rect(-1000, 100, -500, 900), STRIP, work, 6),
            dock(-494, 100, DockSide::Right)
        );
    }

    fn input(foreground: Foreground) -> VisibilityInput {
        VisibilityInput {
            scrcpy_exists: true,
            scrcpy_minimized: false,
            ready: true,
            fits: true,
            foreground,
        }
    }

    const ALL_FOREGROUNDS: [Foreground; 5] = [
        Foreground::Scrcpy,
        Foreground::Tools,
        Foreground::ToolsOwned,
        Foreground::Other,
        Foreground::None,
    ];

    #[test]
    fn hidden_when_any_precondition_fails() {
        let breakers: [fn(&mut VisibilityInput); 4] = [
            |i| i.scrcpy_exists = false,
            |i| i.scrcpy_minimized = true,
            |i| i.ready = false,
            |i| i.fits = false,
        ];
        for breaker in breakers {
            for fg in ALL_FOREGROUNDS {
                for was in [false, true] {
                    let mut i = input(fg);
                    breaker(&mut i);
                    assert!(!tools_visible(i, was), "{i:?} was={was}");
                }
            }
        }
    }

    #[test]
    fn visible_only_while_scrcpy_or_tools_is_in_front() {
        for was in [false, true] {
            assert!(tools_visible(input(Foreground::Scrcpy), was));
            assert!(tools_visible(input(Foreground::Tools), was));
            assert!(tools_visible(input(Foreground::ToolsOwned), was));
            assert!(!tools_visible(input(Foreground::Other), was));
        }
    }

    #[test]
    fn null_foreground_keeps_the_last_state() {
        assert!(tools_visible(input(Foreground::None), true));
        assert!(!tools_visible(input(Foreground::None), false));
    }

    #[test]
    fn size_scales_and_rounds() {
        assert_eq!(
            tools_size(false, 1.0, WORK),
            Size {
                width: 52,
                height: 132
            }
        );
        assert_eq!(
            tools_size(false, 1.5, WORK),
            Size {
                width: 78,
                height: 198
            }
        );
        assert_eq!(
            tools_size(true, 1.0, WORK),
            Size {
                width: 372,
                height: 820
            }
        );
    }

    #[test]
    fn expanded_height_is_capped_by_the_work_area() {
        let short = rect(0, 0, 1920, 700);
        assert_eq!(tools_size(true, 1.0, short).height, 700);
    }

    #[test]
    fn label_maps_dots_and_stays_in_the_tauri_charset() {
        assert_eq!(tools_label("RF8W3085JEW"), "mirror-tools-RF8W3085JEW");
        let label = tools_label("192.168.1.5:5555");
        assert_eq!(label, "mirror-tools-192_168_1_5:5555");
        assert!(label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '/' | ':' | '_')));
    }

    #[test]
    fn scrcpy_title_names_the_device() {
        assert_eq!(
            scrcpy_window_title("RF8W3085JEW"),
            "Cowbell mirror RF8W3085JEW"
        );
    }

    #[test]
    fn device_name_is_cleaned_cut_and_falls_back_to_the_id() {
        assert_eq!(sanitize_device_name(" Pixel\u{7}\n 8 ", "id1"), "Pixel 8");
        assert_eq!(
            sanitize_device_name(&"a".repeat(100), "id1"),
            "a".repeat(80)
        );
        assert_eq!(sanitize_device_name("", "id1"), "id1");
        assert_eq!(sanitize_device_name(" \t\u{0}", "id1"), "id1");
    }

    #[test]
    fn url_round_trips_special_characters() {
        let url = tools_url("192.168.1.5:5555", "My phone & co");
        let query = url.strip_prefix("mirror-tools.html?").unwrap();
        let parsed = tauri::Url::parse(&format!("http://x/?{query}")).unwrap();
        let pairs: Vec<(String, String)> = parsed
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        assert_eq!(
            pairs,
            [
                ("device".to_string(), "192.168.1.5:5555".to_string()),
                ("name".to_string(), "My phone & co".to_string()),
            ]
        );
        assert!(!query.contains(' '));
        assert_eq!(query.matches('&').count(), 1);
    }

    #[test]
    fn state_claims_a_label_once() {
        let state = MirrorToolsState::default();
        assert!(state.claim("a"));
        assert!(!state.claim("a"));
        assert!(state.claim("b"));
        state.release("a");
        assert!(state.claim("a"));
    }

    #[test]
    fn state_update_and_get() {
        let state = MirrorToolsState::default();
        assert_eq!(state.update("a", |e| e.ready = true), None);
        assert_eq!(state.get("a"), None);
        state.claim("a");
        let fresh = state.get("a").unwrap();
        assert!(!fresh.ready && !fresh.expanded);
        assert_eq!(fresh.side, DockSide::Right);
        let updated = state
            .update("a", |e| {
                e.ready = true;
                e.side = DockSide::Left;
            })
            .unwrap();
        assert!(updated.ready);
        assert_eq!(state.get("a"), Some(updated));
    }
}
