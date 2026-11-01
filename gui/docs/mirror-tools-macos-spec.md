# Mirror tools strip on macOS: spec

Status: draft, awaiting approval. Source: Opus planner, saved by the main session.
Run all commands from `gui/src-tauri`.

## Approach

- Find the scrcpy window by owner pid, not by title. Read `CGWindowListCopyWindowInfo(OnScreenOnly | ExcludeDesktopElements)` about once per tick through the `core-graphics` crate.
- The window title (`kCGWindowName`) is blank on macOS 10.15+ without Screen Recording permission. Owner pid, layer, bounds and window number are always readable. Cowbell asks for no permission.
- A window matches when: pid is `child.id()`, `layer == 0`, size is not zero, and the name (if visible) equals `scrcpy_window_title(id)`. Several matches: take the largest.
- A window missing from the on-screen list counts as minimized (Cmd+M, Cmd+H, other Space). The strip hides.
- Front app: owner pid of the first layer-0 window in the list. The focused tools window counts as `Tools`. Own pid in front with the main window unfocused counts as `ToolsOwned` (Save sheet).
- Move the strip with Tauri `set_size(LogicalSize)`, `set_position(LogicalPosition)`, `show()`, `hide()`. Build it with `always_on_top(true)` and `accept_first_mouse(true)`.
- Coordinates: `kCGWindowBounds` is in global points, top-left origin, y down. This equals Tauri `Logical*` on macOS. Run the dock pipeline in points with scale 1.0. Work area in points is `monitor.work_area / monitor.scale_factor()`, using the scrcpy centre's own monitor.
- Reuse `TRACK_INTERVAL` (100 ms), `FIND_TIMEOUT` (5 s) and the Windows `tokio::select!` loop.
- Degrade: window not found in 5 s means a warning log and an info notice. Mirroring keeps working. FFI calls return `Option`; no `unwrap`.

How it could be wrong: (a) `show()` may steal keyboard focus from scrcpy; (b) the front-app guess from list order; (c) a scrcpy wrapper script has a different pid; (d) a later Tauri may change `monitor_from_point` units.

## Steps

1. `src/android.rs` (mechanical): `find_tool` takes several extra dirs. Add `MAC_TOOL_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"]` under `cfg!(target_os = "macos")` in `resolve_scrcpy`. Test `find_tool_checks_every_extra_dir_in_order`. Verify: `cargo test --lib android::tests`.
2. `Cargo.toml` (mechanical): macOS target deps `core-graphics = "0.25"`, `core-foundation = "0.10"` (already in the tree via tao). Verify: `git diff --stat ../Cargo.lock` shows no new `[[package]]`.
3. `src/mirror_tools_macos.rs` new, pure part (mechanical): `WindowInfo`, `bounds_to_rect`, `find_scrcpy`, `front_pid`, `classify_foreground`, `work_area_points`, `Placement`. Verify: `cargo test --lib mirror_tools_macos`.
4. Same file, FFI read (judgment): `on_screen_windows`, `parse_window`.
5. Same file, orchestration (judgment): `build_window`, `snapshot`, `work_area_at`, `place`, `apply`, `find_scrcpy_window`, `run`, `resize`. Verify: `cargo build && cargo test --lib`.
6. Wiring (mechanical): `lib.rs` adds `#[cfg(target_os = "macos")] pub mod mirror_tools_macos;`. `mirror_tools.rs` stub `run` becomes `cfg(not(any(windows, target_os = "macos")))`; add the macOS `pub use` and the macOS `resize` branch. No `#[cfg(windows)]` item changes. Verify: `git diff --exit-code src/mirror_tools_win32.rs`.
7. Notice (mechanical): Rust emits `mirror-tools-notice`; `gui/src/appEvents.ts` shows it with `showInfoNotice`. Verify: `npx tsc --noEmit && npx vitest run`.
8. Docs: `llm_wiki/areas/flutter-android.md`, `areas/macos-port.md` (fix the stale "no mod macos" claim), `code_map.md`, `shortcut-markers.md` (two markers), `docs/mirror-toolbar-spec.md`, `llm_wiki/CHANGELOG.md`.

## Unit tests (no display, no device)

`find_scrcpy`: pid and layer 0 without a title; skips a different title; skips other pids, menu layers and zero size; takes the largest. `front_pid`: first layer-0 window. `classify_foreground`: all branches. `work_area_points`: divides by the monitor scale. `bounds_to_rect`: rounding. `parse_window`: CFDictionary fixture. Docking in points. `android.rs`: `find_tool` order.

## Live check (needs a device)

Launch Cowbell from Finder. Check: strip appears right of scrcpy; no permission prompt; typing in scrcpy still works; strip follows drag and resize; flips at the screen edge; hides on Cmd+M, Cmd+H, another app, Cowbell in front; first click works; APK drop shows the install status; Retina plus 1x screen; close scrcpy removes the strip.

## Deferred

Record on macOS (`record_win32`), brew dirs for `resolve_adb`, the winget wording in `appFlutterRun.ts:470`, following across Spaces or fullscreen, `NSWorkspace` for the front app.
