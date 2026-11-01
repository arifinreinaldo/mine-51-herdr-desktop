//! macOS side of the mirror tools window (docs/mirror-tools-macos-spec.md).
//! The scrcpy window is found by owner pid in `CGWindowListCopyWindowInfo`,
//! never by title: `kCGWindowName` is blank without the Screen Recording
//! permission, and Cowbell asks for none. Owner pid, layer and bounds are
//! always readable. Coordinates are global points (top-left origin, y down),
//! the same space as Tauri `Logical*` on macOS, so the dock pipeline runs in
//! points with scale 1.0.
//!
//! The strip moves through Tauri's own `set_size`, `set_position`, `show` and
//! `hide`; there is no raw window handle here.

use std::time::Instant;

use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::window::{
    copy_window_info, kCGNullWindowID, kCGWindowBounds, kCGWindowLayer,
    kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, kCGWindowName,
    kCGWindowNumber, kCGWindowOwnerPID,
};

use crate::commands::ApiError;
use crate::flutter::api_error;
use crate::mirror_tools::{
    dock_position, fit_height_to, scrcpy_window_title, tools_label, tools_size, tools_url,
    tools_visible, DockSide, Foreground, MirrorToolsState, Rect, VisibilityInput, DOCK_GAP,
    FIND_TIMEOUT, STRIP_HEIGHT, STRIP_WIDTH, TRACK_INTERVAL,
};

/// One on-screen window, from the CoreGraphics window list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowInfo {
    pub number: u32,
    pub pid: i32,
    pub layer: i32,
    /// `None` or empty when macOS hides the title (no Screen Recording grant).
    pub name: Option<String>,
    /// Points.
    pub bounds: Rect,
}

/// Rounds `kCGWindowBounds` (x, y, width, height) to a point `Rect`.
pub fn bounds_to_rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
    Rect {
        left: x.round() as i32,
        top: y.round() as i32,
        right: (x + width).round() as i32,
        bottom: (y + height).round() as i32,
    }
}

/// The scrcpy window: owned by `pid`, layer 0, not empty, and (when the title
/// is readable) titled `title`. The largest wins when several match.
pub fn find_scrcpy<'a>(windows: &'a [WindowInfo], pid: i32, title: &str) -> Option<&'a WindowInfo> {
    windows
        .iter()
        .filter(|w| w.pid == pid && w.layer == 0)
        .filter(|w| w.bounds.right > w.bounds.left && w.bounds.bottom > w.bounds.top)
        .filter(|w| w.name.as_deref().is_none_or(|n| n.is_empty() || n == title))
        .max_by_key(|w| {
            i64::from(w.bounds.right - w.bounds.left) * i64::from(w.bounds.bottom - w.bounds.top)
        })
}

/// Owner pid of the first layer-0 window. The list is front to back.
pub fn front_pid(windows: &[WindowInfo]) -> Option<i32> {
    windows.iter().find(|w| w.layer == 0).map(|w| w.pid)
}

/// `tools_focused`: the tools window has the key focus. `main_focused`: the
/// main Cowbell window has it. `ToolsOwned` covers any Cowbell layer-0 window
/// in front while the main window is unfocused (the tools window itself, or
/// another Cowbell window such as a Save dialog). Known over-match: any other
/// unfocused Cowbell window in front also keeps the strip over scrcpy.
/// An NSSavePanel is not at layer 0, so it is not the premise.
pub fn classify_foreground(
    front: Option<i32>,
    scrcpy_pid: i32,
    own_pid: i32,
    tools_focused: bool,
    main_focused: bool,
) -> Foreground {
    if tools_focused {
        return Foreground::Tools;
    }
    match front {
        None => Foreground::None,
        Some(pid) if pid == scrcpy_pid => Foreground::Scrcpy,
        Some(pid) if pid == own_pid && !main_focused => Foreground::ToolsOwned,
        Some(_) => Foreground::Other,
    }
}

/// A monitor work area (physical px) in points.
pub fn work_area_points(position: (i32, i32), size: (u32, u32), scale: f64) -> Rect {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    bounds_to_rect(
        f64::from(position.0) / scale,
        f64::from(position.1) / scale,
        f64::from(size.0) / scale,
        f64::from(size.1) / scale,
    )
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Placement {
    pub visible: bool,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

fn number(
    dict: &CFDictionary<CFString, CFType>,
    key: core_foundation::string::CFStringRef,
) -> Option<f64> {
    // SAFETY: `key` is one of CoreGraphics' constant keys; "get rule" retains it.
    let key = unsafe { CFString::wrap_under_get_rule(key) };
    dict.find(&key)?.downcast::<CFNumber>()?.to_f64()
}

fn parse_window(dict: &CFDictionary<CFString, CFType>) -> Option<WindowInfo> {
    let (number_key, pid_key, layer_key, name_key, bounds_key) = unsafe {
        (
            kCGWindowNumber,
            kCGWindowOwnerPID,
            kCGWindowLayer,
            kCGWindowName,
            kCGWindowBounds,
        )
    };
    let name = {
        let key = unsafe { CFString::wrap_under_get_rule(name_key) };
        dict.find(&key)
            .and_then(|v| v.downcast::<CFString>())
            .map(|s| s.to_string())
    };
    let bounds = {
        let key = unsafe { CFString::wrap_under_get_rule(bounds_key) };
        let raw = dict.find(&key)?.downcast::<CFDictionary>()?;
        // SAFETY: the same dictionary object, typed with its real key/value types.
        let typed: CFDictionary<CFString, CFType> =
            unsafe { CFDictionary::wrap_under_get_rule(raw.as_concrete_TypeRef()) };
        let get = |k: &str| {
            typed
                .find(CFString::new(k))?
                .downcast::<CFNumber>()?
                .to_f64()
        };
        bounds_to_rect(get("X")?, get("Y")?, get("Width")?, get("Height")?)
    };
    Some(WindowInfo {
        number: number(dict, number_key)? as u32,
        pid: number(dict, pid_key)? as i32,
        layer: number(dict, layer_key)? as i32,
        name,
        bounds,
    })
}

/// Every on-screen window, front to back. `None` when CoreGraphics returns
/// no list.
fn on_screen_windows() -> Option<Vec<WindowInfo>> {
    let list = copy_window_info(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )?;
    let windows = list
        .get_all_values()
        .into_iter()
        .filter(|p| !p.is_null())
        .filter_map(|p| {
            // SAFETY: every element of the window list is a CFDictionary.
            let dict: CFDictionary<CFString, CFType> =
                unsafe { CFDictionary::wrap_under_get_rule(p as _) };
            parse_window(&dict)
        })
        .collect();
    Some(windows)
}

/// Builds the hidden tools window. Call it from a task, never from a
/// synchronous command on the main thread.
fn build_window(
    app: &tauri::AppHandle,
    label: &str,
    device_id: &str,
    device_name: &str,
) -> tauri::Result<tauri::WebviewWindow> {
    let url = tools_url(device_id, device_name);
    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(url.into()))
        .title("Cowbell mirror tools")
        // Points; the tracker sets the real size at once.
        .inner_size(STRIP_WIDTH, STRIP_HEIGHT)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        // Click-only strip: never becomes the key window, so showing or
        // moving it does not take the keyboard from scrcpy.
        .focusable(false)
        // The first click on the strip works while scrcpy has the focus.
        .accept_first_mouse(true)
        .focused(false)
        .visible(false)
        .zoom_hotkeys_enabled(false)
        .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff))
        .build()
}

pub struct Snapshot {
    /// `None`: not on screen (Cmd+M, Cmd+H, another Space), so minimized.
    pub window: Option<WindowInfo>,
    pub front: Option<i32>,
}

/// `None` when the window list cannot be read.
pub fn snapshot(scrcpy: isize) -> Option<Snapshot> {
    let windows = on_screen_windows()?;
    let front = front_pid(&windows);
    let window = windows.into_iter().find(|w| w.number as isize == scrcpy);
    Some(Snapshot { window, front })
}

/// The work area, in points, of the monitor under the middle of `frame`.
fn work_area_at(tools: &tauri::WebviewWindow, frame: Rect) -> Option<Rect> {
    let cx = f64::from(frame.left + frame.right) / 2.0;
    let cy = f64::from(frame.top + frame.bottom) / 2.0;
    let monitor = tools
        .monitor_from_point(cx, cy)
        .ok()
        .flatten()
        .or_else(|| tools.current_monitor().ok().flatten())
        .or_else(|| tools.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some(work_area_points(
        (area.position.x, area.position.y),
        (area.size.width, area.size.height),
        monitor.scale_factor(),
    ))
}

/// Shows, hides or moves the tools window. `show()` runs only on the
/// hidden to visible change: on macOS it orders the window front and key.
fn place(tools: &tauri::WebviewWindow, p: Placement, was_visible: bool) {
    let result = if p.visible {
        tools
            .set_size(tauri::LogicalSize::new(
                f64::from(p.width),
                f64::from(p.height),
            ))
            .and_then(|_| {
                tools.set_position(tauri::LogicalPosition::new(f64::from(p.x), f64::from(p.y)))
            })
            .and_then(|_| if was_visible { Ok(()) } else { tools.show() })
    } else {
        tools.hide()
    };
    if let Err(err) = result {
        tracing::debug!("placing the mirror tools window failed: {err}");
    }
}

enum Tick {
    Continue,
    Stop,
}

/// One placement step, shared by the tracker and `resize`: snapshot scrcpy,
/// dock, decide visibility, place when it changed, and tell the page when the
/// dock side flipped. `last` `None` forces a placement.
fn apply(app: &tauri::AppHandle, label: &str, last: &mut Option<Placement>) -> Tick {
    use tauri::{Emitter, Manager};

    let state = app.state::<MirrorToolsState>();
    let Some(entry) = state.get(label) else {
        return Tick::Stop;
    };
    let Some(tools) = app.get_webview_window(label) else {
        return Tick::Stop;
    };
    // A failed read keeps the last placement.
    let Some(snap) = snapshot(entry.scrcpy_hwnd) else {
        return Tick::Continue;
    };
    let layout = snap.window.as_ref().and_then(|w| {
        let area = work_area_at(&tools, w.bounds)?;
        Some((w, area))
    });
    let pinned = !entry.expanded && entry.pinned(Instant::now());
    let size_dock = layout.map(|(w, area)| {
        let size = fit_height_to(
            tools_size(entry.expanded, pinned, 1.0, area),
            w.bounds,
            entry.expanded,
            1.0,
        );
        (
            size,
            dock_position(w.bounds, size, area, DOCK_GAP.round() as i32),
        )
    });
    let dock = size_dock.and_then(|(_, d)| d);
    let foreground = match &snap.window {
        Some(w) => classify_foreground(
            snap.front,
            w.pid,
            std::process::id() as i32,
            tools.is_focused().unwrap_or(false),
            app.get_webview_window("main")
                .is_some_and(|m| m.is_focused().unwrap_or(false)),
        ),
        None => Foreground::None,
    };
    let visible = tools_visible(
        VisibilityInput {
            scrcpy_exists: true,
            scrcpy_minimized: snap.window.is_none(),
            ready: entry.ready,
            fits: dock.is_some(),
            foreground,
            pinned,
        },
        last.is_some_and(|p| p.visible),
    );
    let placement = match (size_dock, dock) {
        // A hidden window keeps the default position, so a moving scrcpy
        // does not repeat the hide.
        (Some((size, _)), Some(d)) if visible => Placement {
            visible: true,
            x: d.x,
            y: d.y,
            width: size.width,
            height: size.height,
        },
        _ => Placement::default(),
    };
    // Place only on a change: the idle cost stays near zero.
    if *last != Some(placement) {
        place(&tools, placement, last.is_some_and(|p| p.visible));
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
async fn find_scrcpy_window(child: &mut tokio::process::Child, device_id: &str) -> Option<isize> {
    let pid = i32::try_from(child.id()?).ok()?;
    let title = scrcpy_window_title(device_id);
    let deadline = tokio::time::Instant::now() + FIND_TIMEOUT;
    loop {
        if let Some(windows) = on_screen_windows() {
            if let Some(w) = find_scrcpy(&windows, pid, &title) {
                return Some(w.number as isize);
            }
        }
        if tokio::time::Instant::now() >= deadline || !matches!(child.try_wait(), Ok(None)) {
            return None;
        }
        tokio::time::sleep(TRACK_INTERVAL).await;
    }
}

/// Owns the tools window for one scrcpy: find the scrcpy window, build the
/// tools window, follow it until either side closes. Spawned by
/// `android_mirror`. A failure only logs: scrcpy itself works. No recorder
/// exists on macOS, so nothing to stop at the end.
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
    let Some(scrcpy_window) = find_scrcpy_window(&mut child, &device_id).await else {
        tracing::warn!("scrcpy window not found for {device_id}");
        state.release(&label);
        return;
    };
    state.update(&label, |e| e.scrcpy_hwnd = scrcpy_window);
    if let Err(err) = build_window(&app, &label, &device_id, &device_name) {
        tracing::warn!("mirror tools window failed for {device_id}: {err}");
        state.release(&label);
        return;
    }
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
        if let Tick::Stop = apply(&app, &label, &mut last) {
            break;
        }
    }
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.destroy();
    }
    state.release(&label);
}

/// The macOS body of `mirror_tools_resize`. Returns the side scrcpy is docked
/// on.
pub fn resize(
    window: &tauri::WebviewWindow,
    state: &MirrorToolsState,
    expanded: bool,
) -> Result<DockSide, ApiError> {
    use tauri::Manager;

    let label = window.label().to_string();
    let not_tools = || {
        api_error(
            "not_mirror_tools",
            "This window is not a mirror tools window",
        )
    };
    let entry = state.get(&label).ok_or_else(not_tools)?;
    let closed = || api_error("mirror_closed", "The mirror window is closed");
    let snap = snapshot(entry.scrcpy_hwnd).ok_or_else(closed)?;
    // scrcpy off screen (minimized, hidden, other Space): it is not gone. Keep
    // the page's state; the tracker docks the strip when scrcpy returns.
    let Some(frame) = snap.window.map(|w| w.bounds) else {
        let updated = state
            .update(&label, |e| {
                e.expanded = expanded;
                e.ready = true;
            })
            .ok_or_else(not_tools)?;
        return Ok(updated.side);
    };
    let area = work_area_at(window, frame)
        .ok_or_else(|| api_error("window_failed", "The screen of the mirror is unknown"))?;
    let pinned = !expanded && entry.pinned(Instant::now());
    let size = fit_height_to(
        tools_size(expanded, pinned, 1.0, area),
        frame,
        expanded,
        1.0,
    );
    let dock = dock_position(frame, size, area, DOCK_GAP.round() as i32);
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
        .ok_or_else(not_tools)?;
    apply(window.app_handle(), &label, &mut None);
    Ok(dock.map_or(updated.side, |d| d.side))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TITLE: &str = "Cowbell mirror R5CT1";

    fn win(pid: i32, layer: i32, name: Option<&str>, w: i32, h: i32) -> WindowInfo {
        WindowInfo {
            number: 1,
            pid,
            layer,
            name: name.map(str::to_string),
            bounds: Rect {
                left: 10,
                top: 20,
                right: 10 + w,
                bottom: 20 + h,
            },
        }
    }

    #[test]
    fn find_scrcpy_matches_pid_and_layer_without_a_title() {
        let windows = [win(42, 0, None, 300, 600)];
        assert_eq!(find_scrcpy(&windows, 42, TITLE), Some(&windows[0]));
        let blank = [win(42, 0, Some(""), 300, 600)];
        assert_eq!(find_scrcpy(&blank, 42, TITLE), Some(&blank[0]));
    }

    #[test]
    fn find_scrcpy_skips_a_different_title() {
        let windows = [win(42, 0, Some("scrcpy"), 300, 600)];
        assert_eq!(find_scrcpy(&windows, 42, TITLE), None);
        let ok = [win(42, 0, Some(TITLE), 300, 600)];
        assert!(find_scrcpy(&ok, 42, TITLE).is_some());
    }

    #[test]
    fn find_scrcpy_skips_other_pids_menu_layers_and_zero_size() {
        let windows = [
            win(7, 0, None, 300, 600),
            win(42, 25, None, 300, 600),
            win(42, 0, None, 0, 600),
            win(42, 0, None, 300, 0),
        ];
        assert_eq!(find_scrcpy(&windows, 42, TITLE), None);
    }

    #[test]
    fn find_scrcpy_takes_the_largest() {
        let mut small = win(42, 0, None, 100, 100);
        small.number = 1;
        let mut big = win(42, 0, None, 400, 800);
        big.number = 2;
        let windows = [small, big];
        assert_eq!(find_scrcpy(&windows, 42, TITLE).map(|w| w.number), Some(2));
    }

    #[test]
    fn front_pid_is_the_first_layer_0_window() {
        let windows = [
            win(1, 25, None, 10, 10),
            win(2, 0, None, 10, 10),
            win(3, 0, None, 10, 10),
        ];
        assert_eq!(front_pid(&windows), Some(2));
        assert_eq!(front_pid(&windows[..1]), None);
        assert_eq!(front_pid(&[]), None);
    }

    #[test]
    fn classify_foreground_covers_every_branch() {
        let c = |front, tools, main| classify_foreground(front, 42, 99, tools, main);
        assert_eq!(c(None, false, false), Foreground::None);
        assert_eq!(c(Some(42), false, false), Foreground::Scrcpy);
        assert_eq!(c(Some(5), false, false), Foreground::Other);
        assert_eq!(c(Some(99), false, false), Foreground::ToolsOwned);
        assert_eq!(c(Some(99), false, true), Foreground::Other);
        assert_eq!(c(Some(99), true, false), Foreground::Tools);
        assert_eq!(c(Some(5), true, false), Foreground::Tools);
    }

    #[test]
    fn work_area_points_divides_by_the_monitor_scale() {
        assert_eq!(
            work_area_points((0, 50), (2880, 1750), 2.0),
            Rect {
                left: 0,
                top: 25,
                right: 1440,
                bottom: 900
            }
        );
        assert_eq!(
            work_area_points((10, 20), (100, 200), 1.0),
            Rect {
                left: 10,
                top: 20,
                right: 110,
                bottom: 220
            }
        );
    }

    #[test]
    fn bounds_to_rect_rounds_each_edge() {
        assert_eq!(
            bounds_to_rect(10.4, 20.6, 100.5, 200.2),
            Rect {
                left: 10,
                top: 21,
                right: 111,
                bottom: 221
            }
        );
    }
}
