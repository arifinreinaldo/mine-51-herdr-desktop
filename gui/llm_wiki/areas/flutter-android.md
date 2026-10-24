# Flutter run toolbar, Android mirror, screenshot, record

## Purpose
In a Flutter or native Android workspace, a toolbar lets the user pick a device and flavor, run, and use scrcpy tools.

## Key files
- `src-tauri/src/flutter.rs` - `flutter_project` (line 416), `android_devices` (235, adb), `flutter_devices` (311), `flutter_flavors` (581), `flutter_run_alive` (592). `parse_flavors` (line 463). `is_valid_device_id` (line 65).
- `src-tauri/src/flutter.rs:357-360` - `match_android_dir` detects a native Android project.
- `src/flutter/flutterApi.ts` - all typed wrappers, including mirror, screenshot, record and database calls. `src/flutter/runState.ts` - `onPlay`, `onStop`, `reconcile` (lines 17-29), `isValidFlavor` (line 42).
- `src/appFlutterRun.ts` - `wireFlutterRun` (line 618). `src/ui/runToolbar.ts` - `createRunToolbar` (line 61). `src/ui/flavorPicker.ts` - flavor menu.
- `src-tauri/src/android.rs` - `android_mirror` (line 129, starts scrcpy), `android_install_apk` (144), `install_scrcpy` (170), `android_screenshot` (341), `screenshot_copy` (365), `screenshot_save` (378).
- `src-tauri/src/mirror_tools.rs` - docked tools window; `mirror_tools_resize` (line 467). Win32 calls: `mirror_tools_win32.rs`. Page: `mirror-tools.html`, `src/mirrorTools.ts`.
- `src-tauri/src/record.rs` - scrcpy screen recording (`mirror_record_start`, `mirror_record_stop`). Win32 calls: `record_win32.rs`. `reveal_in_folder` also lives here.
- `src-tauri/capabilities/mirror-tools.json` - window ACL for `mirror-tools-*`.

## State
- Chosen device and flavor persist per project in settings: `flutterDevices`, `flutterFlavors` ([[settings]]).
- The id and flavor are typed into a shell on Play. Both are validated first (`src-tauri/src/settings.rs:58-63`).

## Edges
- The user installs adb, flutter and scrcpy. The app does not bundle them (`PRODUCT.md:30`).
- The mirror tools and record modules have Windows-only parts under `#[cfg(windows)]` (`src-tauri/src/lib.rs:18-22`).
- Marker: [[shortcut-markers]] (`flutter.rs:359`).
- Tests: `tests/unit/flutterRunState.test.ts`, `mirrorToolsParams.test.ts`, `screenshotFormat.test.ts`, `recordFormat.test.ts`.
- Specs: `docs/flutter-run-spec.md`, `docs/mirror-toolbar-spec.md`, `docs/screenshot-spec.md`, `docs/record-spec.md`.
