# Device explorer (Android)

## Purpose
A separate window browses an adb device as a tree with three roots. The pane lists the selected folder, and every item can be saved to the PC.
- Shared storage `/sdcard`: read and write (upload, sync, drop, delete).
- App data of debug builds, through `run-as`: read-only.
- Device root `/`: read-only.

## Key files
- `src-tauri/src/device_explorer.rs` - 7 commands: `android_list_dir` (line 473), `android_debuggable_apps` (490), `android_pull_path` (624), `android_push_paths` (725), `android_push_dropped` (772), `android_delete_path` (850), `android_explorer_window` (902).
- `src-tauri/src/device_explorer.rs` - path rules: `is_readable_device_path` (100), `is_valid_device_path` (112), `is_app_path` (119), `is_kernel_dir` (130). `sh_quote` is at line 140. `check_read_path` (417) applies the read rule.
- `src-tauri/src/device_explorer.rs` - listing: `parse_unstat_line` (159), `list_error` (435), `list_entries` (449), `debuggable_packages` (368).
- `src-tauri/src/device_explorer.rs` - pull: `adb_pull` (506), `pull_app_file` (531), `pull_app_one` (550), `pull_app_dir` (572), `copy_error` (383).
- `src-tauri/src/device_explorer.rs` - write: `is_deletable_path` (279) guards delete, `push_args` (326) builds the push argv, `refused_names` (339) lists the clash names, `push_locals` (794) is the shared push step.
- `src-tauri/capabilities/device-explorer.json` - gives the window `core:event:allow-listen` for the drag-drop events.
- App-data pulls reuse `android_db::pull_file` and `is_valid_package`. See [[sqlite-inspector]].
- `device-explorer.html` and `src/deviceExplorer.ts` - the window (`main`, line 79). `src/android/deviceFiles.ts` exports `SDCARD_PATH`, `isValidDevicePath`, `childPath`, `parentWithin`, `isStatDenied`, `isDeletablePath`, `pushStatus`.
- Typed wrappers in `src/flutter/flutterApi.ts`: `androidExplorerWindow`, `androidListDir`, `androidPullPath`, `androidPushPaths`, `androidDeletePath`, `androidDebuggableApps`, `androidPushDropped`. `androidListDir` and `androidPullPath` take an optional `packageName`.
- The Explorer button is in `src/ui/runToolbar.ts`. `src/appFlutterRun.ts` wires it. See [[flutter-android]].
- `vite.config.ts` builds the page as the `deviceExplorer` entry.

## Limits
- Two path rules exist. The readable rule (`is_readable_device_path`) allows `/` and any absolute path without an empty, `.` or `..` segment. List and pull use it.
- The strict rule (`is_valid_device_path`) allows only `/sdcard` and `/storage`. Push and delete use it.
- `sh_quote` wraps the path in single quotes for the device `sh`, and each `'` becomes `'\''`. `android_list_dir` runs `ls -lAL '<path>/'`.
- A listing needs a `total` line. Old adb exits 0 on error, so the exit code is not enough. Without `total`, the command returns `list_failed`.
- When Android refuses a folder, the command returns `permission_denied`. An entry that `ls` cannot stat has `?` in its mode (`isStatDenied`). The tree shows it with a lock.
- With `packageName`, the listing runs as `adb shell run-as <package> ls -lAL '<path>/'`. `is_app_path` allows only `/data/data/<package>` and below.
- `adb pull` of shared storage and the device root is not quoted. The sync protocol takes the device path as it is, and no device shell runs.
- An app-data pull cannot use `adb pull`. It runs file by file through `exec-out run-as <package> cat <path>` with a raw path. `copy_error` compares the listed size with the copied size.
- An app-data folder holds at most 5000 items (`APP_PULL_MAX_ITEMS`). One file takes at most 120 s. A longer tree returns `too_many_items`.
- `not_pullable` refuses a folder pull of `/`, `/proc`, `/sys`, `/dev` and `/d` (`is_kernel_dir`). A read there can block. A single file can still be saved.
- The scan for debuggable apps runs once, on the first open of the App data section. One shell loop (`DEBUGGABLE_APPS`) tries `run-as` for each third-party package.
- `KNOWN_CHILDREN` (`src/deviceExplorer.ts:50`) lists folders that the shell user can open below a folder it cannot list: `/data/local/tmp`.
- The list timeout is 30 s (`LIST_TIMEOUT`). Pull, push and delete share one 1 h timeout (`TRANSFER_TIMEOUT`). None has a Cancel.
- A folder shows at most 5000 entries (`MAX_ENTRIES`), folders first. `truncated` is true when more exist.
- A file pull lands in `<dest>.cowbell-part` first. A rename gives the final name. A failed pull never replaces a file the user chose.
- A folder pull goes to `<picked>\<name>`. The command returns `dest_exists` when that folder exists, because adb would merge into it.
- Pull and the upload buttons get local paths from a native dialog. A drop sends local paths over IPC. `android_push_dropped` treats them as untrusted: each path must exist and pass `push_name`.
- Upload (`push`) and Sync (`push --sync`, one way, PC to device) copy into the folder on screen. Upload returns an error when a name exists there (case ignored). Sync merges and never deletes on the device.
- Drop (`PushKind::Drop`) uses `push --sync`. A dropped file that exists is refused. A dropped folder merges. The page uses the `writing` flag to allow one write at a time.
- Delete asks for confirmation on every row. `is_deletable_path` refuses a storage volume, its top-level folders, and `Android/data`, `Android/obb`, `Android/media`. A file uses `rm -f`, a folder `rm -rf`. A new listing then proves the name is gone.

## Edges
- Only toybox `ls` works (Android 6 and newer). An older device gets `list_failed`.
- Closing the window does not stop a pull. The file still lands, but no UI reports it.
- Only debug builds open in App data. A release build fails `run-as`.
- Tests: `tests/unit/deviceFiles.test.ts`, Rust tests in `device_explorer.rs`.
- Markers: see [[shortcut-markers]] (`device_explorer.rs:23,25,27`).
- Specs: `docs/device-explorer-spec.md`, `docs/device-explorer-phase2-spec.md`, `docs/device-explorer-phase3-spec.md`.
