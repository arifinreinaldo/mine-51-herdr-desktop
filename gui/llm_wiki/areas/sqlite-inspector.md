# SQLite inspector (Android)

## Purpose
A separate window reads SQLite databases of a debuggable app on a device. It works on a local copy. A push writes the copy back.

## Key files
- `src-tauri/src/android_db.rs` - commands: `android_db_window` (line 922), `android_running_apps` (384), `android_app_databases` (401), `android_pull_database` (554), `android_db_query` (724), `android_push_database` (856).
- `src-tauri/src/android_db.rs:1-5` - design note: `run-as`, copy mode, only `android_push_database` writes to the device.
- `src-tauri/src/android_db.rs:34` - sibling files `-wal`, `-shm`, `-journal` travel with the database.
- `db-inspector.html` and `src/dbInspector.ts` - the window (`main`, line 78). `src/android/dbFormat.ts` - cell formatting.
- Typed wrappers: `src/flutter/flutterApi.ts:82-122`.

## Limits
- Timeouts: adb 10 s, pull 120 s (`src-tauri/src/android_db.rs:25-26`).
- Package and path names go through `is_valid_package` (line 61) and `is_valid_rel_path` (line 80).
- Local copies are cleared at start (`src-tauri/src/lib.rs:186`, `clear_local_copies` at `android_db.rs:258`).
- `pull_file` (`android_db.rs:479`) is `pub(crate)`. The device explorer also uses it for app-data pulls, so a change affects both.

## Edges
- Only debuggable apps work (`run-as`).
- Closing the window drops unpushed edits without a confirm. See [[shortcut-markers]] (`dbInspector.ts:100`).
- Other markers: `android_db.rs:29,79,204,665`.
- Tests: `tests/unit/dbFormat.test.ts`, Rust tests in `android_db.rs`.
- Specs: `docs/sqlite-inspector-plan.md`, `docs/sqlite-write-push-spec.md`.
