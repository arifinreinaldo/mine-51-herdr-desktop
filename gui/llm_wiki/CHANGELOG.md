# llm_wiki changelog

> One line per wiki update. Newest on top.

## 2026-10-30 - device explorer: tree, app data, device root, drop
- `areas/device-explorer.md`: rewritten for the tree with three roots; new commands `android_debuggable_apps`, `android_push_dropped`; new Limits (two path rules, `permission_denied`, app-data pull, `not_pullable`, drop); fresh line refs.
- `map.md` and `code_map.md`: new route text; added `capabilities/device-explorer.json`.
- `shortcut-markers.md`: added `APP_PULL_MAX_ITEMS` (`device_explorer.rs:27`); `TRANSFER_TIMEOUT` is now `:23`, `MAX_ENTRIES` `:25`; 24 markers.
- `areas/sqlite-inspector.md`: `lib.rs:184` to `:186`; noted that the device explorer shares `pull_file`.
- `areas/usage-statusline.md`: `lib.rs` refs +2 (`:264`, `:279`, `:275`).
- `doc-mismatches.md`: `docs/device-explorer-spec.md` is read-only; phases 2 and 3 superseded it.

## 2026-10-29 - device explorer: upload, sync, delete
- `areas/device-explorer.md`: new commands `android_push_paths`, `android_delete_path`; refreshed its line refs and the Limits.
- Renamed marker `PULL_TIMEOUT` to `TRANSFER_TIMEOUT` (`device_explorer.rs:22`); `MAX_ENTRIES` is now `:24`.
- Moved `lib.rs` refs by +3 in `sqlite-inspector.md` and `usage-statusline.md`.

## 2026-10-29 - smart Find File
- `fuzzy.ts`: a multi-word query ("rad page") matches the file name word by word, and a word can match a folder name. One word must hit the name.
- Added the command `fs_grep` (`git grep`, git roots only, 3+ characters). `quickOpen.ts` lists the hits under "In files", and `onOpenAt` opens the file at the line.
- Moved line refs in `areas/files.md` and the `fuzzy.ts` marker row (`:42` to `:72`).

## 2026-10-29 - device explorer
- Added the room `areas/device-explorer.md` for the Explorer button, `device_explorer.rs` and `device-explorer.html`.
- Added rows to map, code_map and shortcut-markers (`PULL_TIMEOUT`, `MAX_ENTRIES`; 23 markers). Added the room to index.
- Moved line refs: `lib.rs` (+1 after `mod device_explorer`), `android_db.rs` (+3 after line 331, rustfmt), `vite.config.ts` (now 13-24), `createRunToolbar`, `wireFlutterRun`, `mirror-install` listener, `flutterApi.ts` db wrappers.
- Fixed `lib.rs:3-26` to `4-31` (module list) and the `cfg(windows)` range to `19-24`. Both were stale before this change.

## 2026-10-28 - APK installs only on the scrcpy window
- Removed the APK install from the Cowbell window (`android_install_apk`, `installApks`, `splitApks`). A dropped file is pasted like any file.
- The strip now reads the install status from the stdout and stderr log of scrcpy (`follow_scrcpy_log`). Updated flutter-android, doc-mismatches, shortcut-markers (21 markers), map.

## 2026-10-27 - file-path links
- Added the Ctrl+click file-path link to `code_map` and one `shortcut-markers` row (19 markers).

## 2026-10-24 - wiki scaffolded and seeded
- Created map, index, code_map, architecture, conventions, protocol, doc-mismatches, shortcut-markers, build-test, settings and the feature rooms in `areas/`.
