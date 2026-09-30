# Mirror tools window: build spec

Status: DRAFT, waiting for owner approval.
Scope: `gui/` only. Do not change herdr core (`src/`, `crates/` at the repo root).
Design authority for the preview panel: `gui/docs/screenshot-design.md` (states, copy, keyboard, a11y). The screenshot build spec `gui/docs/screenshot-spec.md` describes the code this feature reuses. Read both first. Where this spec and the design disagree, this spec wins (see §9).

## 0. Goal

When Cowbell starts a scrcpy mirror (`android_mirror`), Cowbell also opens a small frameless **mirror tools** window. The window docks just outside the right edge of the scrcpy window, top-aligned, and follows it. The window holds two buttons: **Screenshot** and **Record**.

- **Screenshot** opens the same preview experience as the main modal (preview, **Copy**, **Save as…**, **Close**) inside the mirror tools window. The window grows away from scrcpy to hold the panel, and shrinks back to the strip on Close.
- **Record** is a placeholder. A click shows a short "coming soon" note for 2 s and does nothing else.
- The main run-toolbar Screenshot button and its modal stay as they are.
- Windows only. On other targets the feature compiles as a no-op (`cfg(windows)` module plus `cfg(not(windows))` stubs).
- Do not bundle scrcpy. The main toolbar stays Flutter-workspace only. The mirror tools window follows every scrcpy that `android_mirror` starts.

Success criterion: the offline commands in §7.1 pass, and the owner confirms the live checklist in §7.2.

## 1. Deliverables

| File | Change |
|---|---|
| `src-tauri/src/mirror_tools.rs` | **new**: pure fns, `MirrorToolsState`, `run` task, `mirror_tools_resize` command, tests (§2, §3) |
| `src-tauri/src/mirror_tools_win32.rs` | **new**, `#[cfg(windows)]` only: the Win32 wrappers (§4) |
| `src-tauri/src/android.rs` | `android_mirror` restructure, `start_scrcpy`, window title, `screenshot_save` dialog owner, one test update (§5) |
| `src-tauri/src/lib.rs` | 2 `mod` lines, `.manage(...)`, 1 command, main-window-destroyed exit (§5.4) |
| `src-tauri/Cargo.toml` | `windows` features only (§4.1) |
| `src-tauri/capabilities/mirror-tools.json` | **new**: `core:event:allow-listen` for `mirror-tools-*` (§6.5) |
| `vite.config.ts` | multi-page input (§6.1) |
| `mirror-tools.html` | **new**, next to `index.html` (§6.2) |
| `src/mirrorTools.ts` | **new**: the page (§6.3) |
| `src/android/mirrorToolsParams.ts` | **new**: pure query and payload helpers (§6.4) |
| `src/ui/screenshotPanel.ts` | **new**: the panel body, extracted from `screenshotModal.ts` (§6.6) |
| `src/ui/screenshotModal.ts` | shrinks to a thin wrapper around `mountScreenshotPanel` (§6.6) |
| `src/flutter/flutterApi.ts` | `androidMirror` gets `deviceName`; new `mirrorToolsResize` (§6.7) |
| `src/appFlutterRun.ts` | pass `device.name` to both `androidMirror` calls in `mirror()` (§6.7) |
| `src/style.css` | `body.mirror-tools`, `.mt-*` classes, `.shot-body--stacked` (§6.8) |
| `tests/unit/mirrorToolsParams.test.ts` | **new** (§7) |

Do NOT touch: `src-tauri/src/flutter.rs` (it has known `cargo fmt` and clippy failures that are not yours; do not "fix" them), `src-tauri/src/mirror.rs` (unrelated: the terminal `SurfaceMirror`; do not confuse the names), `.impeccable/`, the herdr root `src/` and `crates/`, `package.json`, `tauri.conf.json`, `capabilities/default.json`, `src/main.ts`, `src/dragDropFiles.ts`, `src/ui/modal.ts`, icons. Existing tests stay unchanged, except the one Rust test named in §5.1. Do not commit. Do not start scrcpy, do not run the app, do not run any `adb` command that changes the phone.

## 2. Pure functions (`mirror_tools.rs`, unit-tested, all platforms)

These compile and run on every target. Keep them free of Win32 and Tauri types.

```rust
pub const TRACK_INTERVAL: Duration = Duration::from_millis(100);
pub const FIND_TIMEOUT: Duration = Duration::from_secs(5);
/// Logical px. Multiplied by the monitor scale before use.
pub const DOCK_GAP: f64 = 6.0;
pub const STRIP_WIDTH: f64 = 52.0;
pub const STRIP_HEIGHT: f64 = 132.0;
pub const PANEL_WIDTH: f64 = 320.0;
pub const EXPANDED_WIDTH: f64 = STRIP_WIDTH + PANEL_WIDTH; // 372
pub const EXPANDED_HEIGHT: f64 = 820.0;
pub const DEVICE_NAME_MAX_CHARS: usize = 80;
pub const LABEL_PREFIX: &str = "mirror-tools-";

/// Screen rectangle in physical px, same layout as Win32 `RECT`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Size { pub width: i32, pub height: i32 }

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DockSide { Left, Right }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Dock { pub x: i32, pub y: i32, pub side: DockSide }

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
    /// The page called `mirror_tools_resize` at least once (§3.3).
    pub ready: bool,
    /// `dock_position` returned `Some`.
    pub fits: bool,
    pub foreground: Foreground,
}

pub fn dock_position(scrcpy: Rect, tools: Size, work_area: Rect, gap: i32) -> Option<Dock>
pub fn tools_visible(input: VisibilityInput, was_visible: bool) -> bool
pub fn tools_size(expanded: bool, scale: f64, work_area: Rect) -> Size
pub fn tools_label(device_id: &str) -> String
pub fn scrcpy_window_title(device_id: &str) -> String
pub fn sanitize_device_name(name: &str, device_id: &str) -> String
pub fn tools_url(device_id: &str, device_name: &str) -> String
```

### 2.1 `dock_position`

1. Right side first: `x = scrcpy.right + gap`. It fits when `x + tools.width <= work_area.right`. Result side `Right`.
2. Else left side: `x = scrcpy.left - gap - tools.width`. It fits when `x >= work_area.left`. Result side `Left`.
3. Else `None`. The caller hides the window. **Never** clamp into the work area when no side fits: a clamped window would cover the phone image.
4. `y = scrcpy.top`, then clamp: `y = y.min(work_area.bottom - tools.height).max(work_area.top)`. The `max` runs last, so a window taller than the work area sits at `work_area.top`.

`tools` is always the CURRENT size (strip or expanded). An expanded window on the left side therefore grows toward the left, away from scrcpy.

### 2.2 `tools_visible` (the visibility rule)

Returns `false` when any of these is true: `!scrcpy_exists`, `scrcpy_minimized`, `!ready`, `!fits`. Otherwise:

| `foreground` | result |
|---|---|
| `Scrcpy`, `Tools`, `ToolsOwned` | `true` |
| `Other` | `false` |
| `None` | `was_visible` (no flicker during Alt+Tab) |

Reason: the window must not float over other apps. It is `HWND_TOPMOST` only while visible (§4.3). Known cost: after the user switches away and back, the strip reappears only when the scrcpy window (or the strip) is foreground. scrcpy normally takes the foreground when its window opens, so the first appearance is usually immediate.

### 2.3 The other pure functions

- `tools_size`: logical `(STRIP_WIDTH, STRIP_HEIGHT)` or `(EXPANDED_WIDTH, EXPANDED_HEIGHT)`, each multiplied by `scale` and rounded (`f64::round`, then `as i32`). The height is then capped at `work_area.bottom - work_area.top`.
- `tools_label`: `LABEL_PREFIX` + the id with every `.` replaced by `_`. The caller already validated the id with `is_valid_device_id` (`[A-Za-z0-9._:-]`, see `flutter.rs:55`). A Tauri label allows only `[a-zA-Z0-9-/:_]`, so `.` is the one character to map. Known collision: ids that differ only in `.` versus `_` get the same label. Accepted: a real adb id does not do that. The second mirror then gets no tools window (§3.1 step 1).
- `scrcpy_window_title`: `format!("Cowbell mirror {device_id}")`.
- `sanitize_device_name`: remove every char where `char::is_control` is true, trim, keep the first `DEVICE_NAME_MAX_CHARS` chars. Empty result gives `device_id`.
- `tools_url`: `"mirror-tools.html?device=<id>&name=<name>"`, with both values form-encoded. Build it with `tauri::Url::parse("http://x/mirror-tools.html")` and `query_pairs_mut().append_pair(...)`, then return `format!("mirror-tools.html?{}", url.query().unwrap_or(""))`. `tauri::Url` is the `url` crate that Tauri re-exports, so no new crate. `WebviewUrl::App` joins this string onto the app URL, and the query survives (`tauri-2.11.6/src/manager/webview.rs:444-461`).

## 3. State, lifecycle and the tracker (`mirror_tools.rs`)

### 3.1 State

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ToolsEntry {
    /// The scrcpy HWND as `isize` (0 until found). `HWND` holds a raw pointer and is not `Send`.
    pub scrcpy_hwnd: isize,
    pub expanded: bool,
    pub ready: bool,
    pub side: DockSide,
}

#[derive(Default)]
pub struct MirrorToolsState(std::sync::Mutex<std::collections::HashMap<String, ToolsEntry>>);

impl MirrorToolsState {
    /// Inserts a fresh entry. `false` when the label is already claimed.
    pub fn claim(&self, label: &str) -> bool
    pub fn release(&self, label: &str)
    pub fn get(&self, label: &str) -> Option<ToolsEntry>
    /// Applies `f` to the entry, if any; returns the new value.
    pub fn update(&self, label: &str, f: impl FnOnce(&mut ToolsEntry)) -> Option<ToolsEntry>
}
```

Ownership: Rust owns the entry. The page owns only its DOM state. Lock the mutex briefly, copy the entry out, and never hold the lock across `.await` or a Win32 call. Use `lock().unwrap_or_else(|e| e.into_inner())`, as `android.rs` does for `ScreenshotSlot`.

The entry is also the "one tools window per device" guard. A second `android_mirror` for a device that already has an entry creates no second window.

### 3.2 `run`

```rust
pub async fn run(app: tauri::AppHandle, child: tokio::process::Child, device_id: String, device_name: String)
```

`android_mirror` spawns it with `tauri::async_runtime::spawn` (§5.1). On `cfg(not(windows))` the body is empty: it drops `child`, which does not kill scrcpy (`kill_on_drop` is off by default). On Windows:

1. `label = tools_label(&device_id)`. If `!state.claim(&label)`: `tracing::info!`, return.
2. Find the scrcpy window: every `TRACK_INTERVAL`, call `mirror_tools_win32::find_window(&scrcpy_window_title(&device_id), pid)` with `pid = child.id()`. Stop when found, when `FIND_TIMEOUT` passes, or when `child.try_wait()` gives `Ok(Some(_))`. Not found: `tracing::warn!("scrcpy window not found for {device_id}")`, release, return. **No user-facing error**: scrcpy itself works.
3. `state.update(&label, |e| e.scrcpy_hwnd = hwnd)`.
4. Build the window (§3.4). On error: `tracing::warn!`, release, return.
5. Track (§3.5) until it stops.
6. If `app.get_webview_window(&label)` is `Some(w)`: `let _ = w.destroy();`. Then `state.release(&label)`.

### 3.3 Command `mirror_tools_resize`

```rust
#[tauri::command]
pub async fn mirror_tools_resize(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MirrorToolsState>,
    expanded: bool,
) -> Result<DockSide, ApiError>
```

Tauri injects `window` (the calling window). Use `crate::flutter::api_error` for errors.

1. Entry for `window.label()` missing: `not_mirror_tools`, "This window is not a mirror tools window".
2. `cfg(not(windows))`: `unsupported`, "Mirror tools are Windows only".
3. Windows: take a snapshot of the scrcpy window (§4.2). `None`: `mirror_closed`, "The mirror window is closed".
4. Compute `tools_size(expanded, …)` and `dock_position`. If `expanded` and the dock is `None`: return `no_room`, "No room next to the mirror for the preview". Do **not** change `expanded` in that case.
5. Otherwise set `expanded` and `ready = true`, then call the same `apply` step as the tracker (§3.5 steps 2 to 5) once, so the window has its new size before the command returns. Return the side.

The page uses this command for three things: the ready signal (the first call, with `false`), expand, and collapse. A custom command needs no capability entry (§6.5). The window JS API would need `core:window:*` permissions.

### 3.4 Window creation

```rust
let url = tools_url(&device_id, &device_name);
let mut builder = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
    .title("Cowbell mirror tools")
    .inner_size(STRIP_WIDTH, STRIP_HEIGHT)   // logical; the tracker sets the real size at once
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .skip_taskbar(true)
    .always_on_top(false)                    // topmost is set by SetWindowPos only (§4.3)
    .focused(false)
    .visible(false)
    .zoom_hotkeys_enabled(false)
    .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff));
if let Some(args) = main_browser_args(&app) { builder = builder.additional_browser_args(&args); }
let window = builder.build()?;
```

- **`additional_browser_args` must equal the main window's.** All webviews share one WebView2 environment and user data folder. A second webview with different browser arguments fails to create. `main_browser_args` reads `app.config().app.windows`, finds `label == "main"`, and returns its `additional_browser_args.clone()`. Do not copy the string by hand.
- `shadow(false)`: on Windows, `true` draws a 1 px white border on an undecorated window (`tauri-2.11.6/src/webview/webview_window.rs:600-615`). The page draws its own border.
- `transparent`: leave off. A transparent WebView2 needs extra setup and gives nothing here.
- Drag and drop: keep Tauri's default handler on. With it off, a file dropped on the webview navigates the page away. The page registers no drop listener, so a drop does nothing.
- Build from the `run` task, never from a synchronous command on the main thread (that deadlocks on Windows).
- `window.hwnd()` gives a `windows` 0.61 `HWND`, the same crate version this crate uses (§4.1). Store it as `isize` (`hwnd.0 as isize`).

### 3.5 The tracker

Loop:

```text
loop {
    select! { child.wait() => break,  sleep(TRACK_INTERVAL) => {} }
    if app.get_webview_window(&label).is_none() { break }   // closed by the user
    match apply(&app, &label, tools_hwnd, &mut last) { Stop => break, Continue => {} }
}
```

`tokio::process::Child::wait` is cancel-safe, so `select!` in a loop is correct. `apply`:

1. `snapshot(scrcpy_hwnd)`. `None` (the window is gone): return `Stop`.
2. `size = tools_size(entry.expanded, snap.scale, snap.work_area)`; `gap = (DOCK_GAP * snap.scale).round() as i32`; `dock = dock_position(snap.frame, size, snap.work_area, gap)`.
3. `visible = tools_visible(VisibilityInput { scrcpy_exists: true, scrcpy_minimized: snap.minimized, ready: entry.ready, fits: dock.is_some(), foreground: foreground(scrcpy_hwnd, tools_hwnd) }, last.visible)`.
4. Build `Placement { visible, x, y, width, height }`. Call `place` only when it differs from `last`. That keeps the idle cost near zero.
5. If `dock` is `Some` and its side differs from `entry.side`: store it, then `app.emit_to(label.as_str(), "mirror-tools-side", side)` (`tauri::Emitter`). Tauri delivers it only to that webview's listeners.

Timing: the scrcpy window closes, then the process exits or `IsWindow` turns false. The tools window closes within one tick (about 100 ms, under 200 ms).

## 4. Win32 wrappers (`mirror_tools_win32.rs`, `#[cfg(windows)]`)

`lib.rs` declares `#[cfg(windows)] pub mod mirror_tools_win32;`. All handles cross the API as `isize`. Convert with `HWND(v as *mut core::ffi::c_void)`. Every function is safe to call from a tokio worker thread.

### 4.1 `Cargo.toml`

Change only the existing line under `[target.'cfg(windows)'.dependencies]`:

```toml
windows = { version = "0.61", features = [
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
    "Win32_Graphics_Dwm",
    "Win32_Graphics_Gdi",
    "Win32_UI_HiDpi",
] }
```

Add a comment line that names the new use. `Cargo.lock` already resolves exactly one `windows 0.61.3`, and `tauri 2.11.6` depends on `windows 0.61`, so this downloads nothing. Confirm with `cargo tree -i windows@0.61.3 --target x86_64-pc-windows-msvc` and report it. If cargo resolves a second `windows` version or downloads a crate, stop and report.

Verified locations in `windows-0.61.3`: `FindWindowW`, `GetWindowRect`, `IsIconic`, `IsWindow(Option<HWND>)`, `GetForegroundWindow`, `GetWindow`, `SetWindowPos(hwnd, Option<HWND>, …)` are in `Win32::UI::WindowsAndMessaging`. `DwmGetWindowAttribute` is in `Win32::Graphics::Dwm`. `MonitorFromWindow` and `GetMonitorInfoW` are in `Win32::Graphics::Gdi`. `GetDpiForMonitor` is in `Win32::UI::HiDpi`.

### 4.2 Functions

```rust
/// The first visible top-level window whose title is exactly `title` AND whose process id is `pid`.
pub fn find_window(title: &str, pid: u32) -> Option<isize>
pub struct Snapshot { pub frame: Rect, pub minimized: bool, pub work_area: Rect, pub scale: f64 }
/// None when `IsWindow` is false.
pub fn snapshot(scrcpy: isize) -> Option<Snapshot>
pub fn foreground(scrcpy: isize, tools: isize) -> Foreground
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Placement { pub visible: bool, pub x: i32, pub y: i32, pub width: i32, pub height: i32 }
pub fn place(tools: isize, p: Placement)
```

- `find_window`: `EnumWindows` with a callback. For each window compare `GetWindowThreadProcessId` with `pid`, then `GetWindowTextW` with `title`. Why the pid check: scrcpy survives a Cowbell restart (it is a detached child). An old scrcpy window with the same title can therefore still exist. `FindWindowW` alone would return whichever match comes first. The title stays the main key: an SDL window name from the device model is ambiguous when two phones of one model are connected.
- `snapshot`:
  - `frame`: `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`, with a fallback to `GetWindowRect`. On Windows 10 and 11, `GetWindowRect` includes an invisible resize border of about 7 px. With it, the gap would look wider on one side.
  - `minimized`: `IsIconic`.
  - `work_area`: `MonitorFromWindow(scrcpy, MONITOR_DEFAULTTONEAREST)`, then `GetMonitorInfoW(...).rcWork`.
  - `scale`: `GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI)` x-value `/ 96.0`. Use `1.0` on error.
- `foreground`: null gives `None`; equal to `scrcpy` gives `Scrcpy`; equal to `tools` gives `Tools`; `GetWindow(fg, GW_OWNER) == tools` gives `ToolsOwned`; else `Other`.
- `place` (§4.3).

### 4.3 Show, hide, move: Win32 only

For the tools window, never call Tauri's `show`, `hide`, `set_position`, `set_size`, `set_always_on_top` or `set_focus`. Reason: tao's `WindowFlags::apply_diff` calls `ShowWindow(SW_SHOW)` whenever a flag changes on a visible window (`tao-0.35.3/src/platform_impl/windows/window_state.rs:324-336`). `SW_SHOW` activates the window and steals the focus from scrcpy. Use one call:

- Visible: `SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS)`.
- Hidden: `SetWindowPos(hwnd, Some(HWND_NOTOPMOST), 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_HIDEWINDOW | SWP_ASYNCWINDOWPOS)`.

`SWP_ASYNCWINDOWPOS`: the tools window belongs to the main UI thread and the tracker runs on a worker thread. The flag stops the tracker from blocking on the UI thread. wry resizes the WebView2 controller on `WM_SIZE` (`wry-0.55.1/src/webview2/mod.rs:1224`), so a Win32 resize also resizes the page. Tauri's `is_visible()` for this window is stale after this. Nothing reads it.

### 4.4 Units (DPI)

- Everything in Rust is physical px: the DWM frame, `rcWork` and `SetWindowPos` all use physical coordinates for a per-monitor-DPI-aware process, and Tauri makes the process per-monitor aware. There is no conversion step between them.
- Logical px exist only in the constants in §2. `tools_size` and the gap multiply them by the scale of **the monitor that holds scrcpy**.
- The window docks only on scrcpy's monitor. It never spills onto a neighbour monitor, even when that one has room. This keeps one scale for one placement. A window that crosses to a monitor with another DPI gets `WM_DPICHANGED`. tao then resizes it once, and the next tick corrects the size.
- The Tauri builder's `inner_size` is logical, but the first tick replaces it, so the builder value only matters while the window is hidden.

## 5. Changes in existing Rust files

### 5.1 `android.rs`

```rust
/// Spawns scrcpy and waits out the early-exit window. `Ok(None)`: scrcpy
/// exited cleanly inside it (the user closed it at once).
async fn start_scrcpy(device_id: &str) -> Result<Option<tokio::process::Child>, ApiError>

#[tauri::command]
pub async fn android_mirror(
    app: tauri::AppHandle,
    device_id: String,
    device_name: Option<String>,
) -> Result<(), ApiError>
```

- `start_scrcpy` holds the current body of `android_mirror`, unchanged except for 2 things. It adds `cmd.args(["--window-title", &mirror_tools::scrcpy_window_title(device_id)])` after `-s <id>` (scrcpy 4.1 supports `--window-title=text`; checked with `scrcpy --help` on this machine). On a timeout it returns the still-running child.
- Map the early-exit results like this: timeout gives `Ok(Some(child))`; exit success gives `Ok(None)`; exit failure and wait error keep today's `scrcpy_failed` errors.
- `android_mirror`: `check_device_id` runs first inside `start_scrcpy`. On `Some(child)`, `name = sanitize_device_name(device_name.as_deref().unwrap_or(""), &device_id)`, then `tauri::async_runtime::spawn(mirror_tools::run(app, child, device_id, name))`, then return `Ok(())`. The command still returns after about 1.5 s, so the frontend's `mirrorBusy` flow is unchanged.
- **Test update (the only existing test you change):** `mirror_rejects_an_unsafe_device_id` cannot build an `AppHandle`. Change it to `start_scrcpy("x; rm -rf").await.unwrap_err()` and keep the `bad_device_id` assertion.

### 5.2 `screenshot_save`: dialog owner

Add a `window: tauri::WebviewWindow` parameter (Tauri injects it; the frontend call does not change) and `.set_parent(&window)` on the dialog builder (`tauri-plugin-dialog-2.7.3/src/lib.rs:466-485`).

Reason: without an owner, the Save as… dialog becomes the foreground window, `foreground()` returns `Other`, and the tools window hides under the open dialog. With the owner, `foreground()` returns `ToolsOwned` and the strip stays. The same change makes the main modal's dialog modal to the main window. That is a small deliberate change (see §9).

### 5.3 Shared `ScreenshotSlot`

The tools window uses `android_screenshot`, `screenshot_copy` and `screenshot_save` unchanged. `ScreenshotSlot` holds one PNG for the whole app, protected by the capture ticket. Two windows that both capture share it: a Copy in the main modal after a newer capture in the tools window copies the newer image. **Accepted, no fix:** one user drives one phone, and the ticket already stops an older capture from replacing a newer one. Do not change `ScreenshotSlot`.

### 5.4 `lib.rs`

- `pub mod mirror_tools;` and `#[cfg(windows)] pub mod mirror_tools_win32;` in alphabetical order.
- `.manage(mirror_tools::MirrorToolsState::default())` next to the `ScreenshotSlot` line.
- Register `mirror_tools::mirror_tools_resize` after `android::screenshot_save`.
- In `app.run`: on `RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. }` with `label == "main"`, call `app_handle.exit(0)`. Rename `_app_handle` to `app_handle`. Keep the `RunEvent::Exit` branch. Reason: today closing `main` ends the app because it is the last window. With a tools window open, Tauri would keep the process alive with only the strip. After `exit(0)` scrcpy keeps running (it is detached) and the strip goes away. That matches "Cowbell is closed".

## 6. Frontend

### 6.1 `vite.config.ts`

Add a `build.rollupOptions.input` with two entries:

```ts
import { fileURLToPath } from "node:url";
// …
build: {
  rollupOptions: {
    input: {
      main: fileURLToPath(new URL("./index.html", import.meta.url)),
      mirrorTools: fileURLToPath(new URL("./mirror-tools.html", import.meta.url)),
    },
  },
},
```

`tsconfig.json` includes `vite.config.ts`, and `node_modules/@types/node` exists, so `node:url` type-checks. `tauri build` embeds everything in `frontendDist` (`../dist`), so `dist/mirror-tools.html` ships with no config change. `tauri dev` serves it from the Vite dev server at `/mirror-tools.html`.

### 6.2 `mirror-tools.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Cowbell mirror tools</title>
  </head>
  <body class="mirror-tools">
    <div id="mt-root" class="mt-root"></div>
    <script type="module" src="/src/mirrorTools.ts"></script>
  </body>
</html>
```

No `data-tauri-drag-region`: dragging would need `core:window:allow-start-dragging`, and the window follows scrcpy anyway.

### 6.3 `src/mirrorTools.ts`

Imports: `./style.css`; `listen` from `@tauri-apps/api/event`; `invoke` from `@tauri-apps/api/core`; `ThemeRegistry`, `applyThemeById`, `importedThemeId` from `./themes/index`; `mountScreenshotPanel`; the §6.4 helpers; `mirrorToolsResize`; `errorMessage` from `./appApi`.

Do not import `appState`, `appLookups`, `appWorkspaceFlows`, `main.ts` or `dragDropFiles.ts`: they pull in the main window's world. Do not call `invokeSafe`, `invokeOk` or `showErrorNotice`: they write to `#error-notices`, which does not exist on this page. Importing `appApi` for `errorMessage` is safe: `appDom` only runs `getElementById`, and a missing element gives `null`, not an error.

Startup, in order:

1. `params = parseMirrorToolsParams(location.search)`. `null`: put the text "Invalid mirror tools parameters" into `#mt-root` and stop. The window never calls the command, so it never becomes ready and never shows.
2. Theme, the simplest correct approach, with no new theme system. `invoke("settings_get")` gives `{ settings }`, and `invoke("list_imported_themes")` gives the imported themes. Build a `ThemeRegistry` and `setImported` with the same mapping as `refreshImportedThemes` (`src/appWorkspaceFlows.ts:41-51`; inline it here, this is its second use). Then `applyThemeById(registry, settings.theme, document.documentElement.style)`. On any error, apply `"dark-modern"`. A theme change in the main window reaches a tools window only when the next one opens. That is accepted.
3. Build the DOM (below).
4. `await listen<unknown>("mirror-tools-side", (e) => { const s = dockSideFrom(e.payload); if (s) setSide(s); })`.
5. `setSide(await mirrorToolsResize(false))`. This is the ready signal. On error: `console.warn`.

DOM (all through `createElement` and `textContent`, never `innerHTML`):

```text
#mt-root.mt-root            (.mt-root--left when side is "left": flex row-reverse)
  .mt-strip
    button.mt-btn  codicon device-camera   aria-label "Screenshot"  title "Screenshot <device name>"
    button.mt-btn  codicon record          aria-label "Record"      title "Record (coming soon)"
    p.mt-note      hidden
    div.shot-sr    aria-live="polite"
  .mt-panel        hidden while collapsed; the panel mounts into it
```

Behaviour:

- **Screenshot, collapsed:** ignore the click while a resize is in flight. Otherwise `side = await mirrorToolsResize(true)`. On `no_room`: note "No room" for 2 s. On other errors: note "Failed", with `errorMessage(err)` in the note's `title`. On success: `setSide(side)`, set `aria-pressed="true"` on Screenshot, unhide `.mt-panel`, then `panel = mountScreenshotPanel(panelEl, { deviceId, deviceName, layout: "stacked", onClose: collapse })` and `window.setTimeout(() => panel.focusInitial(), 0)`. Expand before mounting, so the panel never renders into a 52 px window.
- **Screenshot, expanded:** `panel.capture()` (a fresh capture into the open panel).
- **collapse():** `panel.dispose()`, empty and hide `.mt-panel`, `aria-pressed="false"`, then `await mirrorToolsResize(false)` (`console.warn` on error).
- **Esc** (a `keydown` on `document`): when expanded, `preventDefault` and `collapse()`. When collapsed, it does nothing.
- **Record:** show `.mt-note` with the text "Coming soon". Put "Recording is coming soon" in the live region. Hide the note after 2000 ms. A second click restarts the timer. Nothing else happens.
- `setSide(side)` toggles `.mt-root--left`. The strip is always the inner column, next to scrcpy.

### 6.4 `src/android/mirrorToolsParams.ts` (pure, no DOM)

```ts
export const DEVICE_NAME_MAX_CHARS = 80;
export interface MirrorToolsParams { deviceId: string; deviceName: string }
/** `search` is `location.search`. `null` unless `device` passes `isValidDeviceId`. */
export function parseMirrorToolsParams(search: string): MirrorToolsParams | null
/** "left" | "right" from an event payload, else null. */
export function dockSideFrom(payload: unknown): "left" | "right" | null
```

`parseMirrorToolsParams` uses `URLSearchParams`, which decodes `+` to a space. It validates the id with `isValidDeviceId` from `../flutter/runState` (same rule as Rust). The name follows the Rust rule in §2.3: remove `/[\u0000-\u001f\u007f-\u009f]/g`, trim, keep the first 80 chars (`Array.from(name).slice(0, 80).join("")`), and use the device id when the result is empty. Both sides validate: Rust builds the URL, and the page does not trust it.

### 6.5 Capabilities

- **Custom commands need no entry.** Tauri 2 checks the ACL for a local-origin app command only when the app defines an app ACL manifest (`tauri-2.11.6/src/webview/mod.rs:1819-1826`). `build.rs` calls plain `tauri_build::build()`, so there is none. `capabilities/default.json:4` states the same for the main window. `android_screenshot`, `screenshot_copy`, `screenshot_save`, `settings_get`, `list_imported_themes` and `mirror_tools_resize` therefore work from the new window with no change.
- **The event listener needs one.** `listen()` calls the `core:event` plugin. `default.json:5` limits its capability to `"windows": ["main"]`. Add `src-tauri/capabilities/mirror-tools.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "mirror-tools",
  "description": "Mirror tools windows (docs/mirror-toolbar-spec.md): core:event:allow-listen for the `mirror-tools-side` event only. All other calls are the app's own commands, which need no ACL entry.",
  "windows": ["mirror-tools-*"],
  "permissions": ["core:event:allow-listen"]
}
```

Do not edit `default.json`. `tauri-build` loads every file in `capabilities/`. Do not add any `core:window:*` permission.

- CSP (`tauri.conf.json:30`): `img-src 'self' data:`. The panel already shows the PNG as a `data:` URL (`toDataUrl` in `screenshotModal.ts:21-29`). Keep that code; do not use `blob:`. Inline `style` attributes are allowed (`style-src 'unsafe-inline'`).
- Drag and drop: `wireDragDropFiles` is wired only in `src/main.ts:130`. The new page must not call it.

### 6.6 Panel refactor (`screenshotPanel.ts`, `screenshotModal.ts`)

Move everything from `screenshotModal.ts` except `openModal` into `src/ui/screenshotPanel.ts`:

```ts
export interface ScreenshotPanelOptions {
  deviceName: string;
  deviceId: string;
  /** The Close button calls this. */
  onClose: () => void;
  /** "side": preview left, actions right (the modal). "stacked": actions under the preview (the tools window). */
  layout?: "side" | "stacked";
}
export interface ScreenshotPanel {
  /** Starts a new capture (Capturing state). The mount also calls it once. */
  capture(): void;
  /** Focuses Close (Copy is disabled while capturing). */
  focusInitial(): void;
  /** Sets `closed`, clears both timers, removes the document key listener. Safe to call twice. */
  dispose(): void;
}
/** Adds `shot-body` (and `shot-body--stacked` for "stacked") to `container`, appends the preview and the actions, and starts the first capture. */
export function mountScreenshotPanel(container: HTMLElement, opts: ScreenshotPanelOptions): ScreenshotPanel
```

The panel adds the Ctrl+C and Ctrl+S `document` listener on mount and removes it in `dispose`. `toDataUrl`, `clock`, the states, the generation counter, the `closed` checks and all copy strings move unchanged.

`openScreenshotModal` keeps its signature and behaviour:

```ts
export function openScreenshotModal(opts: { deviceName: string; deviceId: string }): () => void {
  let panel: ScreenshotPanel | undefined;
  const dispose = openModal(
    "Screenshot",
    (body) => {
      panel = mountScreenshotPanel(body, { ...opts, onClose: () => dispose() });
      window.setTimeout(() => panel?.focusInitial(), 0);
    },
    { className: "modal--shot", onClose: () => panel?.dispose() },
  );
  return dispose;
}
```

No behaviour change for the modal: the same DOM, classes, focus and states. `screenshotPanel.ts` must not import `./modal`, because that pulls in the overlay and keyboard modules.

### 6.7 `flutterApi.ts` and `appFlutterRun.ts`

```ts
export function androidMirror(deviceId: string, deviceName?: string): Promise<void>  // invoke("android_mirror", { deviceId, deviceName })
export function mirrorToolsResize(expanded: boolean): Promise<"left" | "right">       // invoke("mirror_tools_resize", { expanded })
```

In `appFlutterRun.ts` `mirror()`, pass `device.name` to both `androidMirror` calls. Change nothing else there.

### 6.8 `style.css`

Use only existing tokens. Add no new colours, fonts or shadows.

- `body.mirror-tools`: `display: block; background: var(--menu-background); color: var(--menu-foreground)`. `style.css:29-36` makes `body` a 3-row grid for the main window; this rule overrides it. Keep `overflow: hidden`.
- `.mt-root`: `display: flex; height: 100vh; border: 1px solid var(--menu-border)`. `.mt-root--left`: `flex-direction: row-reverse`.
- `.mt-strip`: `width: 52px; flex: none; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0`.
- `.mt-btn`: `36px` square, radius 4px, `display: grid; place-items: center`; hover `var(--list-hoverBackground)` (as `.icon-btn`); `:focus-visible` `outline: 1px solid var(--focusBorder)`; `[aria-pressed="true"]` uses `var(--list-hoverBackground)`. Icon 20px.
- `.mt-note`: `font-size: 11px; text-align: center; color: var(--descriptionForeground); padding: 0 4px`.
- `.mt-panel`: `width: 320px; padding: 12px; border-left: 1px solid var(--menu-border)`. In `.mt-root--left .mt-panel`, use `border-right` instead. `[hidden]` gives `display: none`.
- `.shot-body--stacked`: `flex-direction: column; gap: 8px`. `.shot-body--stacked .shot-actions`: `width: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px`. `.shot-body--stacked .shot-meta, .shot-body--stacked .shot-failure`: `grid-column: 1 / -1; order: 1`. `.shot-body--stacked .shot-btn--close`: `margin-top: 0`. `.shot-body--stacked .shot-img`: `max-width: 296px; max-height: min(640px, calc(100vh - 170px))`. `.shot-body--stacked .shot-placeholder`: `width: auto; height: min(444px, calc(100vh - 170px))`. `.shot-body--stacked .shot-hint`: `max-width: 296px`.

The stacked layout is the fallback that the design names in `screenshot-design.md` §6 ("Falsifiable"). At 820 px the preview shows at 640 px high, as in the modal. A shorter work area shrinks the preview through `100vh`.

## 7. Tests

Rust, in `mirror_tools.rs` `mod tests` (table-driven where the list is long):

- `dock_position` with work area `(0,0,1920,1040)`, gap 6, strip `52×132`:
  - scrcpy `(100,50,500,900)` gives `(506, 50, Right)`.
  - scrcpy `(1400,50,1900,900)` flips: `(1342, 50, Left)`.
  - Exact fit on the right (`x + width == work.right`) stays `Right`.
  - scrcpy `(0,0,1920,1040)` (maximized or fullscreen) gives `None`.
  - Top `-20` clamps to `0`. Top `1000` clamps to `1040 - 132 = 908`. A tools height above the work height gives `work.top`.
  - Expanded `372×820` next to `(1400,50,1900,900)` gives `(1022, …, Left)`.
  - A left monitor with negative coordinates, work `(-1920,0,0,1040)` and scrcpy `(-1000,100,-500,900)`, gives `(-494, 100, Right)`.
- `tools_visible`: each false precondition (`scrcpy_exists`, minimized, not ready, not fits) gives false for every foreground. `Scrcpy`, `Tools` and `ToolsOwned` give true; `Other` gives false; `None` returns `was_visible` for both values.
- `tools_size`: strip at scale 1.0 and 1.5 (`78×198`); expanded height capped by a 700 px work area.
- `tools_label`: `RF8W3085JEW` and `192.168.1.5:5555` (gives `mirror-tools-192_168_1_5:5555`). Every output char is in `[a-zA-Z0-9-/:_]`.
- `scrcpy_window_title`, `sanitize_device_name` (control chars removed, 100 chars cut to 80, empty gives the id), `tools_url` (a space, `&` and `:` round-trip through `tauri::Url` query parsing).
- `MirrorToolsState`: a second `claim` of one label gives false; `release`, then `claim`, gives true; `update` on a missing label gives `None`.

Vitest, `tests/unit/mirrorToolsParams.test.ts`: a valid query; `+` and `%20` decode to a space; a missing or unsafe `device` (`x;rm`, `-s`) gives `null`; control chars are removed; the name is cut to 80 chars; an empty name falls back to the id; `dockSideFrom` accepts `"left"` and `"right"` and rejects `"up"`, `1`, `null` and `{}`.

There is no DOM test for the panel. `vitest.config.ts` uses the `node` environment, and the modal has none today.

### 7.1 Acceptance, offline (run these yourself; report raw output)

Run from `gui/`:

1. `cargo test --lib -p herdr-gui mirror_tools` gives 0 failures and lists the new tests by name.
2. `cargo test --lib -p herdr-gui android` gives 18 passes, including the changed `mirror_rejects_an_unsafe_device_id`.
3. `cargo fmt --check` prints diffs for `src-tauri/src/flutter.rs` only.
4. `cargo clippy --workspace -- -D warnings` reports errors in `flutter.rs` only (the 2 known spots).
5. `cargo tree -i windows@0.61.3 --target x86_64-pc-windows-msvc` shows one `windows` version, and the build downloads nothing.
6. `npx tsc --noEmit` is clean.
7. `npx vitest run` passes: the 730 existing tests plus the new ones.
8. `npm run build`, then `Test-Path dist/mirror-tools.html` gives `True`, and the file references a `/assets/*.js` bundle.

**Not verifiable offline:** anything in §7.2, and a `cfg(not(windows))` build. Only `x86_64-pc-windows-msvc` is installed (`rustup target list --installed`). Review the stubs by eye, and let the first macOS build confirm them.

### 7.2 Live checklist (owner)

The executor does not run these. Start Cowbell with `npm run tauri dev`, open a Flutter workspace, and connect the phone.

1. Mirror: the strip appears on the right of scrcpy, top-aligned, with a small gap, and scrcpy keeps the keyboard focus.
2. Drag and resize scrcpy: the strip follows within about 0.1 s.
3. Alt+Tab to another app: the strip hides. Click scrcpy: it comes back.
4. Minimize scrcpy: the strip hides. Restore: it comes back.
5. Screenshot on the strip: the window grows to the right, and Capturing, then Ready, shows the preview. Copy pastes into Paint. Save as… opens a dialog, and the strip stays visible behind it. Close shrinks the window back to the strip. Esc also closes the panel.
6. Record: "Coming soon" shows for about 2 s.
7. Move scrcpy against the right edge of the monitor: the strip flips to the left, and the panel grows to the left.
8. Maximize scrcpy (or F11): the strip hides. Restore: it returns.
9. Close scrcpy: the strip closes within about 0.2 s.
10. Alt+F4 on the focused strip while scrcpy runs: the strip closes and does not come back.
11. Close Cowbell while a mirror runs: Cowbell exits, and scrcpy stays open.
12. The main toolbar Screenshot modal still works as before.
13. If a second monitor with another scale is available: move scrcpy there. The strip follows at the right size.

## 8. Edge cases

| Case | Behaviour | Source |
|---|---|---|
| scrcpy window not found in 5 s | `warn!` in the log, no tools window, no notice | §3.2 |
| scrcpy exits inside 1.5 s with success | No tools window (the user closed it) | §5.1 |
| Second mirror for the same device | No second tools window | §3.1 |
| Old scrcpy window with the same title (before a Cowbell restart) | Ignored by the pid check | §4.2 |
| User closes scrcpy | Tools window closes within about 100 ms | §3.5 |
| scrcpy minimized | Hidden | §2.2 |
| scrcpy maximized or fullscreen, or no room on either side | Hidden until it fits again | §2.1 |
| Expanded panel has no room | `no_room`, strip shows "No room", nothing expands | §3.3 |
| Room disappears while expanded (scrcpy dragged) | Hidden until it fits again; the panel stays open inside | §3.5 |
| Foreground is another app | Hidden, not topmost | §2.2 |
| Save as… dialog open | Stays visible (`ToolsOwned`) | §5.2 |
| Alt+Tab (null foreground) | Keeps the last state | §2.2 |
| Tools window closed with Alt+F4 | Not reopened; the tracker stops | §3.5 |
| Main window closed | App exits, and scrcpy keeps running | §5.4 |
| Main modal and tools panel both capture | They share `ScreenshotSlot`; accepted | §5.3 |
| Bad query parameters | Error text, never shown | §6.3 |
| Monitors with different DPI | Scale of scrcpy's monitor; docks on that monitor only | §4.4 |

## 9. Deviations from the lead's brief and the design doc

1. **`dock_position` returns `Option<Dock>`, not a point.** When neither side fits, a clamp into the work area would cover the phone image. `None` hides the window.
2. **Window lookup matches title AND pid (`EnumWindows`), not `FindWindowW` alone.** A detached scrcpy from before a Cowbell restart can carry the same title.
3. **One new capability file** (`core:event:allow-listen` for `mirror-tools-*`). The page must know the dock side to keep the strip as the inner column, and the side can change without any page action. Custom commands still need no entry.
4. **`screenshot_save` sets the calling window as the dialog owner.** Without it, the strip hides under its own Save dialog. Side effect: the main modal's Save dialog becomes modal to the main window. This is standard behaviour, and it has no visual change.
5. **Visibility rule additions:** `ToolsOwned` (the dialog) counts as foreground, and a null foreground keeps the last state (no Alt+Tab flicker).
6. **Show, hide and move go through `SetWindowPos`, not the Tauri window API** (§4.3), because tao re-shows with `SW_SHOW` and would steal the focus.
7. **Record note text is "Coming soon", not "Recording is coming soon".** The full sentence does not fit a 52 px strip. The full sentence goes to the live region.
8. **`android_mirror` gains `device_name: Option<String>`**, and one existing test changes (§5.1).
9. **Closing the main window now calls `exit(0)`** (§5.4). Before, it was implicit because main was the only window.
10. **Design doc:** the tools window uses the stacked layout from `screenshot-design.md` §6. The modal keeps the side-by-side layout.

## 10. Risks and how this could be wrong

- **The SDL title is not applied, or scrcpy runs through a shim.** Then `find_window` never matches. The symptom is `scrcpy window not found` in `%LOCALAPPDATA%\herdr-gui\logs\herdr-gui.log`. Check: while mirroring, run `Get-Process scrcpy | Select Id, MainWindowTitle` and compare the pid with the one Cowbell spawned. Fallback: drop the pid check and keep the title only.
- **DPI:** the DWM frame and `rcWork` are assumed to be physical px for this per-monitor-aware process. If the gap or the size looks scaled on a 150% monitor, this assumption is wrong. Log `snapshot` at `debug` level to compare.
- **WebView2 cold start:** a second webview can take 0.3 to 1 s. The strip then appears late, but never blank, because it shows only after the page's first `mirror_tools_resize`.
- **Focus stealing:** if the strip takes the focus from scrcpy when it appears, some path activates it. Suspects: `focused(false)` ignored at creation, or a stray Tauri `show()`. Checklist step 1 catches it.
- **The foreground rule feels too strict** (the strip hides while the user looks at the Cowbell main window next to scrcpy). The rule is one pure function. Adding the main window as an allowed foreground is a one-line change.
- **A cross-thread dialog owner:** `blocking_save_file` runs on a tokio worker with an owner window on the UI thread. If the dialog hangs or does not disable the owner, revert §5.2 and add "a window of this process" to `Foreground` instead.
- **Browser-args mismatch:** if the tools window fails to build with a WebView2 environment error, `main_browser_args` did not return the main window's string.

## 11. Effort and order

Effort: about 1 to 1.5 days for the executor, plus 30 minutes for the owner's live check.

Each slice builds, passes §7.1, and can be reverted alone:

1. **Pure functions and state:** `mirror_tools.rs` (§2, §3.1) with tests, plus `pub mod mirror_tools;`. No behaviour change.
2. **Win32 wrappers:** `mirror_tools_win32.rs` and the `Cargo.toml` features. Not called yet.
3. **Rust wiring:** `run`, the tracker, window creation, `mirror_tools_resize`, the `android.rs` changes (title, `start_scrcpy`, dialog owner, test update), and the `lib.rs` changes. The window would load a missing page and never become ready, so nothing shows yet.
4. **Panel refactor:** `screenshotPanel.ts`, the thin `screenshotModal.ts`, and the `.shot-body--stacked` CSS. The modal behaves the same.
5. **The page:** `vite.config.ts`, `mirror-tools.html`, `mirrorTools.ts`, `mirrorToolsParams.ts` with its test, the `flutterApi.ts` and `appFlutterRun.ts` changes, the capability file, and the `.mt-*` CSS. The feature is now live.
