//! Win32 wrappers for the mirror tools window (docs/mirror-toolbar-spec.md
//! §4). Windows only. Handles cross the API as `isize`, because `HWND` holds
//! a raw pointer and is not `Send`. Every function is safe to call from a
//! tokio worker thread.
//!
//! Show, hide and move go through `SetWindowPos` only. Tauri's `show`,
//! `set_position`, `set_size` and `set_always_on_top` make tao call
//! `ShowWindow(SW_SHOW)`, which activates the window and steals the focus
//! from scrcpy.

use core::ffi::c_void;

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect,
    GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible,
    SetWindowLongPtrW, SetWindowPos, GA_ROOTOWNER, GWL_EXSTYLE, HWND_NOTOPMOST, HWND_TOPMOST,
    SWP_ASYNCWINDOWPOS, SWP_HIDEWINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    WS_EX_TOOLWINDOW,
};

use crate::mirror_tools::{Foreground, Rect};

fn hwnd(v: isize) -> HWND {
    HWND(v as *mut c_void)
}

fn rect_from(r: RECT) -> Rect {
    Rect {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
    }
}

struct FindCtx {
    title: String,
    pid: u32,
    found: isize,
}

unsafe extern "system" fn find_callback(window: HWND, lparam: LPARAM) -> BOOL {
    let ctx = &mut *(lparam.0 as *mut FindCtx);
    if !IsWindowVisible(window).as_bool() {
        return BOOL(1);
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(window, Some(&mut pid));
    if pid != ctx.pid {
        return BOOL(1);
    }
    let mut buf = [0u16; 512];
    let len = GetWindowTextW(window, &mut buf);
    if len > 0 && String::from_utf16_lossy(&buf[..len as usize]) == ctx.title {
        ctx.found = window.0 as isize;
        return BOOL(0);
    }
    BOOL(1)
}

/// The first visible top-level window whose title is exactly `title` AND
/// whose process id is `pid`. The pid check skips an old scrcpy window with
/// the same title that survived a Cowbell restart.
pub fn find_window(title: &str, pid: u32) -> Option<isize> {
    let mut ctx = FindCtx {
        title: title.to_string(),
        pid,
        found: 0,
    };
    // `EnumWindows` reports an error when the callback stops the walk; the
    // `found` field is the result.
    let _ = unsafe {
        EnumWindows(
            Some(find_callback),
            LPARAM(&mut ctx as *mut FindCtx as isize),
        )
    };
    (ctx.found != 0).then_some(ctx.found)
}

pub struct Snapshot {
    pub frame: Rect,
    pub minimized: bool,
    pub work_area: Rect,
    pub scale: f64,
}

/// `None` when the scrcpy window no longer exists.
pub fn snapshot(scrcpy: isize) -> Option<Snapshot> {
    let h = hwnd(scrcpy);
    unsafe {
        if !IsWindow(Some(h)).as_bool() {
            return None;
        }
        // `GetWindowRect` includes an invisible resize border of about 7 px
        // on Windows 10 and 11; the DWM frame bounds are the visible edge.
        let mut frame = RECT::default();
        let dwm = DwmGetWindowAttribute(
            h,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut frame as *mut RECT as *mut c_void,
            std::mem::size_of::<RECT>() as u32,
        );
        if dwm.is_err() && GetWindowRect(h, &mut frame).is_err() {
            return None;
        }
        let monitor = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let (mut dpi_x, mut dpi_y) = (0u32, 0u32);
        let scale = match GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) {
            Ok(()) if dpi_x > 0 => dpi_x as f64 / 96.0,
            _ => 1.0,
        };
        Some(Snapshot {
            frame: rect_from(frame),
            minimized: IsIconic(h).as_bool(),
            work_area: rect_from(info.rcWork),
            scale,
        })
    }
}

pub fn foreground(scrcpy: isize, tools: isize) -> Foreground {
    let fg = unsafe { GetForegroundWindow() };
    if fg.0.is_null() {
        return Foreground::None;
    }
    if fg == hwnd(scrcpy) {
        return Foreground::Scrcpy;
    }
    if fg == hwnd(tools) {
        return Foreground::Tools;
    }
    // The root owner, not only the first: the Save dialog's own "replace
    // this file?" box is owned by the dialog, which the tools window owns.
    if unsafe { GetAncestor(fg, GA_ROOTOWNER) } == hwnd(tools) {
        Foreground::ToolsOwned
    } else {
        Foreground::Other
    }
}

/// Gives the tools window `WS_EX_TOOLWINDOW`: no taskbar button and no
/// Alt+Tab entry. tao's `skip_taskbar(true)` runs once, while the window is
/// hidden, and Windows adds a taskbar button again when `SWP_SHOWWINDOW`
/// shows an unowned window later. Call it once, right after the window is
/// built and still hidden.
pub fn make_tool_window(tools: isize) {
    let h = hwnd(tools);
    unsafe {
        let style = GetWindowLongPtrW(h, GWL_EXSTYLE);
        SetWindowLongPtrW(h, GWL_EXSTYLE, style | WS_EX_TOOLWINDOW.0 as isize);
    }
}

/// The window's current size in physical px, or `None` when the call fails.
/// The tracker compares it with the size it asked for: on a monitor with a
/// different DPI, tao resizes the window itself after `SetWindowPos` moves it
/// there.
pub fn window_size(tools: isize) -> Option<(i32, i32)> {
    let mut r = RECT::default();
    unsafe { GetWindowRect(hwnd(tools), &mut r) }.ok()?;
    Some((r.right - r.left, r.bottom - r.top))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Placement {
    pub visible: bool,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// Shows, hides or moves the tools window. `HWND_TOPMOST` only while
/// visible, so it never floats over other apps. `SWP_ASYNCWINDOWPOS`: the
/// window belongs to the UI thread and the tracker runs on a worker; the
/// flag stops the tracker from blocking on the UI thread. wry resizes the
/// WebView2 controller on `WM_SIZE`, so the page follows a Win32 resize.
pub fn place(tools: isize, p: Placement) {
    let h = hwnd(tools);
    let result = unsafe {
        if p.visible {
            SetWindowPos(
                h,
                Some(HWND_TOPMOST),
                p.x,
                p.y,
                p.width,
                p.height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS,
            )
        } else {
            SetWindowPos(
                h,
                Some(HWND_NOTOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_HIDEWINDOW | SWP_ASYNCWINDOWPOS,
            )
        }
    };
    if let Err(err) = result {
        tracing::debug!("SetWindowPos failed: {err}");
    }
}
