# Flutter run toolbar, Android mirror, screenshot, record

## Purpose
In a Flutter or native Android workspace, a toolbar lets the user pick a device and flavor, run, and use scrcpy tools.

## Key files
- `src-tauri/src/flutter.rs` - `flutter_project` (line 416), `android_devices` (235, adb), `flutter_devices` (311), `flutter_flavors` (581), `flutter_run_alive` (592). `parse_flavors` (line 463). `is_valid_device_id` (line 65).
- `src-tauri/src/flutter.rs:357-360` - `match_android_dir` detects a native Android project.
- `src/flutter/flutterApi.ts` - all typed wrappers, including mirror, screenshot, record and database calls. `src/flutter/runState.ts` - `onPlay`, `onStop`, `reconcile` (lines 17-29), `isValidFlavor` (line 42).
- `src/appFlutterRun.ts` - `wireFlutterRun` (line 614). `src/ui/runToolbar.ts` - `createRunToolbar` (line 63). The Explorer button (`run-btn--explorer`, "Browse device files") opens [[device-explorer]]. `src/ui/flavorPicker.ts` - flavor menu.
- `src-tauri/src/android.rs` - `android_mirror` (line 125, starts scrcpy), `start_scrcpy` (81, takes an `on_spawn` callback), `install_scrcpy` (144), `android_screenshot` (315), `screenshot_copy` (339), `screenshot_save` (352).
- `src-tauri/src/mirror_tools.rs` - docked tools window; `mirror_tools_resize` (line 690), `InstallEvent` (276), `send_install_status` (286), `follow_scrcpy_log` (435), `install_log_event` (347), `drain_scrcpy_log` (392), `should_show` (374). Win32 calls: `mirror_tools_win32.rs`. Page: `mirror-tools.html`, `src/mirrorTools.ts` (`mirror-install` listener, line 410).
- `src-tauri/src/record.rs` - scrcpy screen recording (`mirror_record_start`, `mirror_record_stop`). Win32 calls: `record_win32.rs`. `reveal_in_folder` also lives here.
- `src-tauri/capabilities/mirror-tools.json` - window ACL for `mirror-tools-*`.
- APK install: Cowbell does not install an APK. scrcpy installs an APK that the user drops on the scrcpy window.
- A file dropped on the Cowbell window is pasted like any file. `wireDragDropFiles()` (`src/dragDropFiles.ts:47`) takes no argument.
- APK install status: `start_scrcpy` pipes the stdout and stderr of scrcpy. `android_mirror` passes `follow_scrcpy_log` as the `on_spawn` callback (`android.rs:131`).
- `follow_scrcpy_log` starts one `drain_scrcpy_log` task for each stream. `LineSplitter` cuts the bytes into lines (max `MAX_LOG_LINE`, 8192).
- `install_log_event` parses the scrcpy 4.1 lines. `INFO: Installing <path>...` is the start. `INFO: <path> successfully installed` is ok. `ERROR: Failed to install <path>` on stderr is failed.
- `should_show` drops a late end of an earlier file when a later file already started.
- `send_install_status` sends the `mirror-install` event (`InstallEvent`, with a `device` filter). The start pin is `SCRCPY_INSTALL_PIN` (300 s). The end pin is `INSTALL_RESULT_PIN` (4 s). The event is always file 1 of 1.
- The strip page shows "Installing <file>" with a bar, then a green "Installed" or a red "Failed" for 4 s. The parser is `installView` (`src/android/mirrorToolsParams.ts:39`). A busy status also hides after `INSTALL_BUSY_MS` (305 s, `src/mirrorTools.ts:28`). The Cowbell main window shows nothing.

## State
- Chosen device and flavor persist per project in settings: `flutterDevices`, `flutterFlavors` ([[settings]]).
- `ToolsEntry.pin_until` is a deadline. `pin_until` keeps the strip on screen and 76 px taller (`STATUS_HEIGHT`) during an install + 4 s.
- The id and flavor are typed into a shell on Play. Both are validated first (`src-tauri/src/settings.rs:58-63`).

## Edges
- The user installs adb, flutter and scrcpy. The app does not bundle them (`PRODUCT.md:30`).
- The mirror tools and record modules have Windows-only parts under `#[cfg(windows)]` (`src-tauri/src/lib.rs:19-24`).
- Markers: [[shortcut-markers]] (`flutter.rs:359`, `mirror_tools.rs:298`, `mirror_tools.rs:434`).
- Known limit: the log text of scrcpy is not a contract. A scrcpy update can change the lines that `install_log_event` parses.
- Tests: `tests/unit/flutterRunState.test.ts`, `mirrorToolsParams.test.ts`, `screenshotFormat.test.ts`, `recordFormat.test.ts`.
- Specs: `docs/flutter-run-spec.md`, `docs/mirror-toolbar-spec.md`, `docs/screenshot-spec.md`, `docs/record-spec.md`.
