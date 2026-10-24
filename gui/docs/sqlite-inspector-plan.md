# Spec: Android SQLite inspector (copy mode), revision 2

Status: plan only. I edited no files; I ran read-only adb commands on RF8W3085JEW. Scope: `gui/` only; do not change herdr core (`src/`, `crates/` at the repo root). Do not commit. Paths are relative to `C:\Users\Reinaldo\Backend\herdr\gui\`. This text replaces `docs/sqlite-inspector-plan.md`.

## Revision 2 changes
- **R2-1 Discovery.** The database list now comes from the files the app holds open now: `/proc/<pid>/fd` for every process of the package. It no longer comes from a listing of `databases/`. Only files with the SQLite magic are listed. The identity of a database is now its path relative to the app data folder. The contract field changes from `db_name`/`dbName` to `db_path`/`dbPath`, and the error code from `bad_db_name` to `bad_db_path`. A new error code is `not_running`.
- **R2-2 Android workspaces.**
  - `flutter_project` now also detects native Android projects and returns `kind: "flutter" | "android"`.
  - In an Android workspace the run toolbar shows the device picker, Mirror and the database button. Play and flavors stay hidden.
  - New step 6 adds the detection to `flutter.rs`.
- **R2-3 Renumbering.** Steps are renumbered (16 steps). The live check is now step 16, and it tests the WAL path on `com.simplr.rad.dev`.

## Header

**goal**: The run toolbar gets a database button in Flutter and native Android workspaces. It opens a window for the selected adb device. The window does these things:
- It lists the apps that are running now.
- It lists the SQLite databases that the chosen app holds open now.
- It pulls one database, with its `-wal` and `-shm`, to a temp copy.
- It browses tables in 100-row pages and runs one read-only SQL statement at a time on that copy.
- Refresh pulls again.

**Your calls (kept as you gave them)**
- **U1 Copy mode.** The device gets no agent, and Refresh pulls again.
- **U2 "Active" databases**, the same approach as Android Studio. The list is the open fds of every process of the package, under `/data/data/<pkg>/` or `/data/user/0/<pkg>/`. It leaves out `-wal`, `-shm` and `-journal` files, removes duplicates, and keeps only files whose first 16 bytes are `SQLite format 3\0`.
  - The magic is checked on the device in one `head` call, so the list shows only SQLite databases.
  - The magic is checked again at pull time.
- **U3** Always pull `-wal` and `-shm` with the database. `-shm` has no effect (C5), but it costs nothing.
- **U4** Read-only on the local copy. Nothing is written back to the device.
- **App not running**: an error `not_running` with the message "`<pkg>` is not running. Start the app, then press Refresh".
  - This is the smallest option, and it matches "active".
  - Rejected: a folder-scan fallback. It is a second discovery path, and it lists closed databases.

**Home**: A separate Tauri window for each device, opened from the run toolbar.
- Why not a modal: `openModal` joins the single-overlay registry. When an agent finishes, `appDoneNotifications.ts:44` opens the agent popover with no "is an overlay open" check. That would close an inspector modal every time any agent finishes.
- A window also leaves the terminal usable beside it.
- Pattern reused: the mirror tools window (`mirror-tools.html`, `mirror_tools.rs:255-280`, `mirrorTools.ts`).

**Entry (Change 2)**: The run toolbar, for Flutter and native Android workspaces.
- GUI before this change: no native Android detection existed. Only `find_flutter_project` (pubspec with `sdk: flutter`) existed, in `flutter.rs:325-370`.
- Step 6 adds the minimal detection: `settings.gradle` or `settings.gradle.kts` next to `app/src/main/AndroidManifest.xml`. It uses the same search as Flutter: cwd and its ancestors, then the immediate subfolders. Flutter is searched first, so a Flutter project's own `android/` folder still reports Flutter.
- Why the toolbar and not a View-menu item:
  - The toolbar already owns the device list, the device picker, the saved device per project (`settings.flutterDevices[project.dir]`), and the adb-missing and unauthorized states.
  - A menu item would need its own device choice, which is a second picker.

**Intended side effects in native Android workspaces** (decisions, not accidents):
- Mirror starts working, and APK drag-and-drop also works, because `installApks` uses the same selected device. Its message changes to "…in a Flutter or Android workspace".
- `flutter devices` is not loaded there.
- The picker lists adb devices only; Windows, Chrome and web entries do not apply.

**Success criterion**: A1 to A9 pass, and the live check in step 16 passes on RF8W3085JEW.

**New dependency**: `rusqlite` with the `bundled` feature.
- It is not in `Cargo.lock` and not in the local cargo cache, so the first build needs the network.
- `bundled` compiles SQLite C with `cc`. It needs MSVC `cl.exe` on Windows or Xcode CLT on macOS; Tauri already needs both to link.
- Use whatever version `cargo add` resolves, and record it.
- No new npm package.

### Deliverables
| File | Change |
|---|---|
| `src-tauri/Cargo.toml`, `Cargo.lock` | `rusqlite` (bundled) plus a 2-line comment |
| `src-tauri/src/android_db.rs` | new: 5 commands, pure helpers, 16 tests |
| `src-tauri/src/lib.rs` | `pub mod android_db;` and 5 handler entries |
| `src-tauri/src/mirror_tools.rs` | `main_browser_args` becomes `pub(crate)` (one word) |
| `src-tauri/src/flutter.rs` | project detection only: `ProjectKind`, `match_android_dir`, `find_project`, `find_run_project`, 4 tests |
| `src/flutter/flutterApi.ts` | `FlutterProject.kind`, 5 wrappers, 2 interfaces |
| `src/android/dbFormat.ts` | new: `PAGE_ROWS`, `tableSql`, `rowRange` |
| `tests/unit/dbFormat.test.ts` | new |
| `src/themes/savedTheme.ts` | new: `applyTheme` moved word for word out of `mirrorTools.ts` |
| `src/mirrorTools.ts` | import `applySavedTheme`; drop the moved function and 2 imports |
| `db-inspector.html` | new page |
| `vite.config.ts` | third rollup input |
| `src/dbInspector.ts` | new: the page |
| `src/style.css` | `body.db-inspector` and the `.db-*` classes |
| `src/ui/runToolbar.ts` | database button; view fields `dbDisabled`, `dbTitle`, `playVisible`; handler `onDatabase` |
| `src/appFlutterRun.ts` | `isAdbDevice`, `openDbInspector`, Android-kind rules, view fields in both `toolbar.render` calls |
| `public/THIRD-PARTY-NOTICES.txt` | regenerated by `npm run notices` |

**Do not touch:**
- In `flutter.rs`, anything outside project detection. Two clippy errors and two fmt hunks already exist there (C15). Leave them as they are. Do not run `cargo fmt`, because it rewrites those hunks. Hand-format the new code and check it with `cargo fmt --check`.
- `android.rs`, `modal.ts`, `appDoneNotifications.ts`.
- `capabilities/*.json`. No new capability is needed (C10).
- Existing tests, `package.json`, the herdr root.

### Contracts
Tauri maps camelCase arguments to snake_case, as the `android_mirror` wrapper already does. Rejections are `ApiError { code, message }` (`commands.rs:183`).

| Rust command (`android_db.rs`) | TS wrapper (`flutterApi.ts`) | Returns |
|---|---|---|
| `android_db_window(app, device_id: String, device_name: Option<String>)` | `androidDbWindow(deviceId, deviceName?)` | `()` |
| `android_running_apps(device_id: String)` | `androidRunningApps(deviceId)` | `Vec<String>` / `string[]` |
| `android_app_databases(device_id, package_name)` | `androidAppDatabases(deviceId, packageName)` | relative paths: `Vec<String>` / `string[]` |
| `android_pull_database(device_id, package_name, db_path)` | `androidPullDatabase(deviceId, packageName, dbPath)` | `PulledDatabase` |
| `android_db_query(device_id, package_name, db_path, sql, offset: usize)` | `androidDbQuery(deviceId, packageName, dbPath, sql, offset)` | `QueryPage` |
| `flutter_project(cwd)` (existing, `flutter.rs`) | `flutterProject(cwd)` (existing) | `FlutterProject` gains `kind` |

```rust
#[derive(Debug, Clone, PartialEq, Serialize)] #[serde(rename_all = "camelCase")]
pub struct PulledDatabase { pub path: String, pub tables: Vec<String> }
#[derive(Debug, Clone, PartialEq, Serialize)] #[serde(rename_all = "camelCase")]
pub struct QueryPage { pub columns: Vec<String>, pub rows: Vec<Vec<Option<String>>>, pub has_more: bool }
// flutter.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)] #[serde(rename_all = "camelCase")]
pub enum ProjectKind { Flutter, Android }   // "flutter" | "android"
```
```ts
export interface PulledDatabase { path: string; tables: string[] }
export interface QueryPage { columns: string[]; rows: (string | null)[][]; hasMore: boolean }
export interface FlutterProject { dir: string; name: string; kind: "flutter" | "android" }
```

**`db_path` rule.** `/`-separated segments of `[A-Za-z0-9._-]`. No segment may be empty, be `.` or `..`, or start with `-`. Maximum length 1024. This rule rejects absolute paths, escapes, options and shell metacharacters. Example: `files/databases/salesdb_20261021094851.sqlite`.

**Device commands.** Every argument is validated first. adb gets them as argv, but the device runs them through `sh -c` (C3).
- **Running apps**: `adb -s <id> shell ps -A -o PID,NAME` and `adb -s <id> shell pm list packages -3`, in parallel, through `flutter::run_capture` (10 s, codes `adb_timeout`/`adb_failed`).
- **Open databases**:
  1. `shell ps -A -o PID,NAME` gives the pids whose name is `<pkg>` or starts with `<pkg>:`.
  2. For each pid, `shell run-as <pkg> ls -l /proc/<pid>/fd`.
  3. One call, `exec-out run-as <pkg> head -v -c 16 <candidates…>`, keeps the candidates with the SQLite magic.
- **Pull**: `exec-out run-as <pkg> cat <db_path>`, with stdout going to a file. Do this for `<db_path>`, `<db_path>-wal` and `<db_path>-shm`, 120 s each. `run-as` runs in the app data folder (`pwd` on the device gives `/data/user/0/com.simplr.rad.dev`), so a relative path works.

**Local copy**: `std::env::temp_dir()/cowbell-sqlite/<device>/<pkg>/<db_path segments…>`, plus `-wal` and `-shm` beside it. `<device>` is the id with every character outside `[A-Za-z0-9-]` replaced by `_`. The segments are already safe because of the `db_path` rule.

**Window**
- Label: `db-inspector-<id with . replaced by _>`. Tauri's label character set does not allow `.`; this is the same rule as `mirror_tools::tools_label`.
- URL: `db-inspector.html?device=<id>&name=<name>`, form-encoded. The page parses it with the existing `parseMirrorToolsParams`.
- Title `SQLite — <name>`, size 1000×680, minimum 640×400.

**Error codes**: `bad_device_id` (existing), `bad_package`, `bad_db_path`, `adb_not_found`, `adb_timeout`, `adb_failed`, `not_running`, `not_debuggable`, `pull_timeout`, `pull_failed`, `not_sqlite`, `not_pulled`, `sql_error`, `read_only`, `io_error`, `window_failed`.

**Constants**: `ADB_TIMEOUT` 10 s, `PULL_TIMEOUT` 120 s, `PAGE_ROWS` 100 (the same value is in `dbFormat.ts`), `CELL_MAX_CHARS` 500, `HEAD_BYTES` 256, `MAX_CANDIDATES` 200.

### Edge cases
1. **Non-debuggable app.** `run-as` writes `run-as: package not debuggable: com.anydesk.anydeskandroid` to stderr and exits 1 (live). Result: `not_debuggable`, message "`<pkg>` is not debuggable. Only debug builds can be inspected". As the shell user, `ls /proc/2359/fd` gives `Permission denied` (live), which is why `run-as` is needed.
2. **The same app through `exec-out`.** Exit 0, and the error text becomes the file content (live). The pull's header check maps it to `not_debuggable`.
3. **App not running.** No matching process in `ps`. Result: `not_running`.
4. **Multi-process app.** `pidof com.google.android.googlequicksearchbox` printed nothing, while `ps` showed `:googleapp`, `:interactor` and `:search` processes (live). So pids come from `ps`, and the fd lists of all pids are combined. A per-pid `ls` failure (an isolated process, or a pid that has exited) is skipped. If every pid gave no stdout, the result is `adb_failed` with the last stderr.
5. **Open files that are not SQLite.** On `com.simplr.rad.dev` there are about 20 `.hive` files, about 13 `.lock` files and `code_cache` directories (live). The one `head -v -c 16` call filters them out. A directory or a missing file has no magic after its marker (live output shape in step 3).
6. **Open siblings.** The live fd list includes `…-wal` and `…-shm`. They are dropped from the list.
7. **Two path prefixes.** fd targets use `/data/data/<pkg>/` (live), while `run-as` runs in `/data/user/0/<pkg>` (live `pwd`). Both prefixes are stripped. Other targets are dropped: `/dev/null`, `/apex/…`, and another package whose name starts with this one (`/data/data/com.simplr.rad.devx/`), because the prefix ends with `/`.
8. **Deleted file still open.** The fd target ends in ` (deleted)`. It is dropped.
9. **A database that exists but is not open.** `databases/google_app_measurement_local.db` was left out (live). This is intended.
10. **No `-wal` on the device** (a rollback-journal database, such as `databases/com.google.android.datatransport.events`). `cat` writes its error text and exits 0 (live, 78 bytes). The WAL magic check fails, and the local `-wal` is removed.
11. **Stale local `-wal`/`-shm`.** Deleted before each pull. Otherwise old WAL frames replay onto the new copy.
12. **Device id with `:` or `..`.** Wi-Fi adb ids contain `:`, and `..` passes `is_valid_device_id` (`flutter.rs:54`). The path component is sanitized.
13. **`ps` output quirks** (live). The header `PID NAME` and lines have leading and trailing spaces, and a terminal adds CRLF. The parser splits on whitespace and drops lines whose pid does not parse.
14. **The chosen app stops.** It stays in the app list, and the database list returns `not_running`.
15. **A Flutter-only device selected** (Windows, Chrome). The database button is disabled (`isAdbDevice`).
16. **Integers above 2^53.** Sent as strings so no digits are lost.
17. **Write statements and `VACUUM INTO`.** Rejected with `read_only` before they run.
18. **Trailing `;` and whitespace in typed SQL.** Works (test).
19. **Torn copy** (a checkpoint between the database and `-wal` pulls). SQLite's error shows in the status line; Refresh again.
20. **Double click on the button.** The second window build fails with a duplicate label, so the code focuses the open window and returns Ok.
21. **Pull fails partway.** The local database, `-wal` and `-shm` are removed, so the next query returns `not_pulled`.
22. **Workspace opened at a Flutter project's `android/` folder.** It reports Flutter (test).

### Counterintuitive (verified)
- **C1** `adb exec-out` has no stderr channel and always exits 0. The `run-as`/`cat` error text lands in stdout. So: check content, not exit codes. The database must start with `SQLite format 3\0`. The `-wal` must start with `37 7f 06 82` or `37 7f 06 83`; the live `logdb.sqlite-wal` starts with `37 7f 06 82`.
- **C2** `adb shell` (shell protocol) keeps `run-as`'s stderr separate and returns its exit code 1 (live). Use `shell` for `ps`/`pm`/`ls`, and `exec-out` for binary output (`head`, `cat`).
- **C3** `adb shell` and `adb exec-out` both run the command through the device's `sh -c`. The Rust validators are the injection guard.
- **C4 Databases live outside `databases/`.** On `com.simplr.rad.dev` the app's own databases are `files/databases/{salesdb_20261021094851,syscondb_20261021094853,logdb}.sqlite`, all in WAL mode. `databases/` holds only Firebase's databases (live). This is why discovery uses open fds.
- **C5 The WAL matters; the `-shm` does not.**
  - Live: `files/databases/logdb.sqlite`, pulled and opened read-only, has 18237 rows in `simplr_log` with its `-wal` and 18104 without it. So 133 rows exist only in the WAL.
  - Python sqlite 3.35.5 trial: a random-garbage `-shm` changes nothing, because SQLite truncates the `-shm` when it opens it as the only connection.
- **C6** A device id can contain `:`, which Windows forbids in a path, and `..` passes `is_valid_device_id`. Sanitize the path component.
- **C7** A JS number loses i64 precision above 2^53. Cells travel as display strings.
- **C8** `package` is a reserved word in strict-mode JS, and ES modules are strict. Name the parameter `packageName`.
- **C9** `tsconfig.json:6` sets `"lib": ["ES2020","DOM"]`, so there is no `replaceAll`. Use `.replace(/"/g, '""')`.
- **C10** App commands need no capability for the new window. Tauri checks the ACL only for plugin commands, apps with an app manifest, or remote origins (`tauri-2.11.6/src/webview/mod.rs:1819-1826`). `build.rs` is a plain `tauri_build::build()`.
- **C11** A new webview must get the main window's `additional_browser_args`, or WebView2 fails to create it (`mirror_tools.rs:239-241`). Build the window in an `async` command; a synchronous one deadlocks on Windows (`mirror_tools.rs:252-253`).
- **C12** Do not write `let mut builder` and then change it only under `#[cfg(windows)]`; macOS then reports `unused_mut`. Shadow the variable instead.
- **C13** A read-only connection still runs `VACUUM INTO '<path>'`, which writes a file. Gate every statement with `Statement::readonly()`; a test proves the gate.
- **C14** Do not reuse `android.rs` `run_capture_bytes`. It holds everything in memory, caps it at 32 MiB and has hard-wired `screenshot_*` codes. Do not use `flutter::run_capture` for `ls`/`head` either, because it drops stdout on a non-zero exit. `ls` exits 1 when one fd closes during the listing, but its stdout still counts.
- **C15 Existing `flutter.rs` failures move.** Step 6 inserts code above them, so match them by text, not by line:
  - The clippy errors are "called `Iterator::last` on a `DoubleEndedIterator`" and "this `map_or` can be simplified".
  - The fmt hunks are the `.take(GRADLE_MAX_BYTES)` one and the `"flutter_alive_timeout"` one.
- **C16 `pidof` misses `:suffix` processes** (live, edge case 4). Use `ps -A -o PID,NAME`.
- **C17 `head -v` is needed.** Without `-v`, `head` prints no `==> path <==` marker for a single file (live). Toybox `file` reports `data` for SQLite files (live), so it cannot be the filter.

### Rejected alternative
A modal (`openModal`) opened from a View-menu item, with a device `<select>`. It lost for four reasons:
- The agent popover's auto-open closes the active overlay (`appDoneNotifications.ts:44`, then `openOverlay` in `overlay.ts`).
- Esc or a backdrop click loses the state.
- It blocks the terminal.
- The `<select>` duplicates the run-toolbar device picker.

### Acceptance
Run from `gui/` in Git Bash. `HERDR_ENV=1`, so run the slow ones in a Herdr pane. Baselines I measured: `cargo test -p herdr-gui --lib` 338 passed, 0 failed; vitest 73 files, 917 tests passed; tsc clean.

- **A1** `cargo test -p herdr-gui --lib android_db`: 16 passed, 0 failed.
- **A2** `cargo test -p herdr-gui --lib`: 358 passed (338 + 16 + 4 detection tests), 0 failed.
- **A3** `cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^error: |^\s+--> '`. Expected exactly:
  - "called `Iterator::last` on a `DoubleEndedIterator`…" with a `--> src-tauri\src\flutter.rs:N` line
  - "this `map_or` can be simplified" with a `--> …flutter.rs:M` line
  - `could not compile … due to 2 previous errors`
  - nothing else.
- **A4** `cargo fmt --check 2>&1 | grep -c '^Diff in'` gives 2, both in `flutter.rs`. `cargo fmt --check 2>&1 | grep -cE 'GRADLE_MAX_BYTES|flutter_alive_timeout'` gives at least 2.
- **A5** `npx tsc --noEmit`: exit 0, no output.
- **A6** `npx vitest run`: 74 files, 0 failed.
- **A7** `cargo tree -p herdr-gui -i libsqlite3-sys`: one `libsqlite3-sys` version.
- **A8** `npm run build && test -f dist/db-inspector.html && echo OK`: prints `OK`.
- **A9** `npm run notices && grep -c rusqlite public/THIRD-PARTY-NOTICES.txt`: exit 0, count at least 1.

The live check is step 16.

### Smallest-change check
- **S1 (rusqlite)**: SQL on a local file needs an engine; the tree has none. The alternative, sql.js, adds an npm package and a CSP change.
- **S2 (`pub(crate)`)**: one word, so the helper is reused instead of copied.
- **S3–S5 (Rust module)**: no module lists processes or open files, pulls files or reads SQLite. It reuses `run_capture`, `check_device_id`, `resolve_adb_from_env`, `apply_no_window`, `api_error` and `sanitize_device_name`. Discovery takes 3 adb calls: `ps`, `ls` per pid, and one `head` for all candidates. Checking each file separately would take about 40 calls on this app.
- **S6 (detection)**: no native Android detection exists. It reuses the Flutter search shape by passing a matcher, so the walk is not duplicated, and it keeps `FlutterProject` and `flutter_project` rather than renaming them across 4 files.
- **S7 (wrappers)**: the house rule is one `invoke` wrapper per command in `flutterApi.ts`.
- **S8 (`dbFormat.ts`)**: the quoting and pager math are the only pure logic on the TS side.
- **S9 (theme move)**: the new page needs the saved theme. Moving the function is smaller than copying it, and `mirrorTools.ts` is an entry script, so other code cannot import from it.
- **S10 (page entry)**: a new window needs an HTML entry and a Vite input.
- **S11, S12 (page and CSS)**: no table or grid UI exists to reuse.
- **S13, S14 (toolbar)**: they reuse the device picker and its error states, and they add one visibility flag for Play rather than a second toolbar.

---

## Phase 1: Backend, adb and pull

### step 1 [haiku]: add rusqlite
- **files**: `src-tauri/Cargo.toml`, `Cargo.lock`
- **edit**:
  - In `gui/`, run `cargo add rusqlite --features bundled -p herdr-gui`.
  - The new line should sit right after `png = "0.17"` in `[dependencies]`. If cargo put it anywhere else, move it there.
  - Put these two lines directly above it:
    ```
    # SQLite inspector (`android_db.rs`): reads the pulled database copy
    # read-only. `bundled` compiles SQLite from source; no system library.
    ```
  - Record the version cargo resolved.
- **lines**: about 3, plus the generated lock file.
- **exec**: mechanical. One command and a fixed comment.
- **verify**: `cargo tree -p herdr-gui -i libsqlite3-sys`. Expected: one `libsqlite3-sys vX`, with `rusqlite` under it.

### step 2 [haiku]: expose the browser-args helper
- **files**: `src-tauri/src/mirror_tools.rs`
- **edit**: at line 243, change `fn main_browser_args(app: &tauri::AppHandle) -> Option<String> {` to `pub(crate) fn main_browser_args(app: &tauri::AppHandle) -> Option<String> {`. Keep `#[cfg(windows)]` above it.
- **lines**: 2
- **exec**: mechanical. Exact text.
- **verify**: `grep -n "pub(crate) fn main_browser_args" src-tauri/src/mirror_tools.rs`. Expected: one line.

### step 3 [sonnet]: `android_db.rs`, adb part and its 10 tests
- **files**: `src-tauri/src/android_db.rs` (new), `src-tauri/src/lib.rs`
- **edit, lib.rs**: change `pub mod android;\npub mod clipboard;` to `pub mod android;\npub mod android_db;\npub mod clipboard;`.
- **edit, new file**: a module doc comment, then the reference code below. Make it compile and keep its behaviour.
  - The doc comment says: copy mode with no agent on the device; the list shows the SQLite databases the app holds open now; `run-as`, so debuggable apps only; nothing written to the device.

  ```rust
  use std::collections::HashSet;
  use std::io::Read;
  use std::path::{Path, PathBuf};
  use std::process::{Output, Stdio};
  use std::time::Duration;
  use serde::Serialize;
  use tokio::process::Command as AsyncCommand;
  use crate::android::{check_device_id, resolve_adb_from_env};
  use crate::commands::ApiError;
  use crate::engine::apply_no_window;
  use crate::flutter::{api_error, run_capture};

  const ADB_TIMEOUT: Duration = Duration::from_secs(10);
  const PULL_TIMEOUT: Duration = Duration::from_secs(120);
  const HEAD_BYTES: u64 = 256;
  const STDERR_MAX_CHARS: usize = 2000;
  // shortcut: at most 200 open files go to one `head` argv; split into batches if an app holds more.
  const MAX_CANDIDATES: usize = 200;
  const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";
  const WAL_MAGIC: [[u8; 4]; 2] = [[0x37, 0x7f, 0x06, 0x82], [0x37, 0x7f, 0x06, 0x83]];
  const SIBLINGS: [&str; 3] = ["-wal", "-shm", "-journal"];

  /// Two or more dot-separated segments, each a letter then [A-Za-z0-9_].
  /// The name reaches the device's `sh -c`, so this is the injection guard.
  pub fn is_valid_package(name: &str) -> bool {
      let mut segments = 0;
      for segment in name.split('.') {
          let mut chars = segment.chars();
          let Some(first) = chars.next() else { return false };
          if !first.is_ascii_alphabetic() || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
              return false;
          }
          segments += 1;
      }
      segments >= 2
  }

  /// A path relative to the app data folder: `/`-separated segments of
  /// [A-Za-z0-9._-], none empty, `.`, `..` or starting with `-`. So no
  /// absolute path, no escape, no option, no shell metacharacter.
  pub fn is_valid_rel_path(rel: &str) -> bool {
      rel.len() <= 1024
          && rel.split('/').all(|s| {
              !s.is_empty() && s != "." && s != ".." && !s.starts_with('-')
                  && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
          })
  }

  /// `ps -A -o PID,NAME` lines as (pid, name). The header does not parse.
  pub fn processes(ps: &str) -> Vec<(u32, &str)> {
      ps.lines()
          .filter_map(|l| {
              let mut fields = l.split_whitespace();
              Some((fields.next()?.parse().ok()?, fields.next()?))
          })
          .collect()
  }

  /// `pm list packages -3` names with a running process (`com.x:remote`
  /// counts for `com.x`). Sorted, unique, valid only.
  pub fn running_packages(ps: &str, pm: &str) -> Vec<String> {
      let running: HashSet<&str> = processes(ps).into_iter().map(|(_, n)| n.split(':').next().unwrap_or(n)).collect();
      let mut out: Vec<String> = pm.lines()
          .filter_map(|l| l.trim().strip_prefix("package:"))
          .filter(|p| running.contains(p) && is_valid_package(p))
          .map(String::from).collect();
      out.sort();
      out.dedup();
      out
  }

  /// Every process of `package`: `pidof` misses `com.x:remote`, so read `ps`.
  pub fn package_pids(ps: &str, package: &str) -> Vec<u32> {
      processes(ps).into_iter()
          .filter(|(_, n)| *n == package || n.strip_prefix(package).is_some_and(|r| r.starts_with(':')))
          .map(|(pid, _)| pid).collect()
  }

  /// Open files under the app data folder from `ls -l /proc/<pid>/fd`,
  /// relative to that folder. fd targets use `/data/data/<pkg>/`, while
  /// run-as runs in `/data/user/0/<pkg>`, so both prefixes count. Drops
  /// -wal/-shm/-journal, deleted files and unsafe paths. May repeat.
  pub fn open_paths(ls: &str, package: &str) -> Vec<String> {
      let prefixes = [format!("/data/data/{package}/"), format!("/data/user/0/{package}/")];
      ls.lines()
          .filter_map(|l| l.split_once(" -> ").map(|(_, t)| t.trim()))
          .filter(|t| !t.ends_with(" (deleted)"))
          .filter_map(|t| prefixes.iter().find_map(|p| t.strip_prefix(p.as_str())))
          .filter(|rel| is_valid_rel_path(rel) && !SIBLINGS.iter().any(|s| rel.ends_with(s)))
          .map(String::from).collect()
  }

  /// The candidates whose first bytes are the SQLite magic, from
  /// `head -v -c 16 <paths…>` output: `==> <path> <==\n` then the bytes.
  /// A directory or a missing file has no magic after its marker (or no marker).
  pub fn sqlite_paths(out: &[u8], candidates: &[String]) -> Vec<String> {
      candidates.iter()
          .filter(|c| {
              let marker = format!("==> {c} <==\n");
              out.windows(marker.len()).position(|w| w == marker.as_bytes())
                  .is_some_and(|i| out[i + marker.len()..].starts_with(SQLITE_MAGIC))
          })
          .cloned().collect()
  }

  /// `<temp>/cowbell-sqlite/<device>/<package>/<rel segments>`. `:` (Wi-Fi adb)
  /// is not allowed in a Windows path, and `..` passes `is_valid_device_id`.
  // shortcut: never cleaned up; the OS temp cleanup removes old copies.
  pub fn local_db_path(device_id: &str, package: &str, rel: &str) -> PathBuf {
      let device: String = device_id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
      let base = std::env::temp_dir().join("cowbell-sqlite").join(device).join(package);
      rel.split('/').fold(base, |path, segment| path.join(segment))
  }

  fn sibling(db_path: &Path, suffix: &str) -> PathBuf {
      let mut os = db_path.as_os_str().to_owned();
      os.push(suffix);
      PathBuf::from(os)
  }

  pub fn is_wal(head: &[u8]) -> bool { WAL_MAGIC.iter().any(|m| head.starts_with(m)) }

  fn not_debuggable(package: &str) -> ApiError {
      api_error("not_debuggable", format!("{package} is not debuggable. Only debug builds can be inspected"))
  }

  /// The pulled database does not start with the SQLite magic. A run-as or
  /// cat error arrives as the file's text (see `pull_file`).
  pub fn bad_pull_error(package: &str, rel: &str, head: &[u8]) -> ApiError {
      let text = String::from_utf8_lossy(head);
      let line = text.lines().next().unwrap_or("").trim();
      if line.contains("not debuggable") { not_debuggable(package) }
      else if line.starts_with("run-as:") || line.starts_with("cat:") { api_error("pull_failed", line.to_string()) }
      else { api_error("not_sqlite", format!("{rel} is not a SQLite database")) }
  }

  fn check_target(device_id: &str, package: &str, rel: Option<&str>) -> Result<(), ApiError> {
      check_device_id(device_id)?;
      if !is_valid_package(package) { return Err(api_error("bad_package", format!("Unsafe package name: {package}"))); }
      if let Some(rel) = rel.filter(|r| !is_valid_rel_path(r)) { return Err(api_error("bad_db_path", format!("Unsafe database path: {rel}"))); }
      Ok(())
  }

  fn adb_path() -> Result<PathBuf, ApiError> {
      resolve_adb_from_env().ok_or_else(|| api_error("adb_not_found", "adb was not found; install Android SDK platform-tools"))
  }

  fn remove_if_present(path: &Path) -> Result<(), ApiError> {
      match std::fs::remove_file(path) {
          Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(api_error("io_error", e.to_string())),
          _ => Ok(()),
      }
  }

  /// Runs an adb command and returns all its output, whatever the exit code.
  /// Unlike `flutter::run_capture`, stdout stays raw bytes and survives a
  /// non-zero exit (`ls` exits 1 when one fd closes during the listing).
  async fn adb_output(mut cmd: AsyncCommand, timeout: Duration) -> Result<Output, ApiError> {
      cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
      apply_no_window(&mut cmd);
      let child = cmd.spawn().map_err(|e| api_error("adb_failed", e.to_string()))?;
      match tokio::time::timeout(timeout, child.wait_with_output()).await {
          Ok(result) => result.map_err(|e| api_error("adb_failed", e.to_string())),
          Err(_) => Err(api_error("adb_timeout", format!("timed out after {}s", timeout.as_secs()))),
      }
  }
  ```

  Then add these items with the behaviour stated:
  - **`android_running_apps(device_id)`**: `check_device_id`, then `adb_path`. Build `-s id shell ps -A -o PID,NAME` and `-s id shell pm list packages -3`, and run both with `tokio::try_join!` through `run_capture(cmd, ADB_TIMEOUT, "adb_timeout", "adb_failed")`. Return `running_packages(..)`.
  - **`android_app_databases(device_id, package_name)`**:
    1. `check_target(.., None)`, then `adb_path`.
    2. Run `shell ps -A -o PID,NAME` through `run_capture`. Take `package_pids`. If there are none, return `api_error("not_running", format!("{package_name} is not running. Start the app, then press Refresh"))`.
    3. For each pid, run `shell run-as <pkg> ls -l /proc/<pid>/fd` through `adb_output`:
       - If stderr contains `not debuggable`, return `not_debuggable` at once.
       - If stdout is empty, remember the trimmed stderr as `last_error`.
       - Extend the candidates with `open_paths(stdout, pkg)`.
    4. If there are no candidates and `last_error` is not empty, return `adb_failed` with `last_error`.
    5. Sort and dedup the candidates, then truncate to `MAX_CANDIDATES`. If none remain, return `Ok(vec![])`.
    6. Run `exec-out run-as <pkg> head -v -c 16` with the candidates appended as args, through `adb_output`. Add the comment `// one call for all heads; exec-out is binary-safe, and its merged stderr cannot fake a marker plus magic`.
    7. A non-zero exit with empty stdout means adb itself failed (device gone): return `adb_failed` with stderr cut to `STDERR_MAX_CHARS`.
    8. Return `sqlite_paths(&out.stdout, &candidates)`.
  - **`async fn pull_file(adb, device_id, package, rel, dest) -> Result<Vec<u8>, ApiError>`**:
    1. `File::create(dest)` (failure gives `io_error`).
    2. Run `adb -s id exec-out run-as <pkg> cat <rel>` with `.stdin(Stdio::null()).stdout(file).stderr(Stdio::piped()).kill_on_drop(true)`, then `apply_no_window`.
    3. Wait with `timeout(PULL_TIMEOUT, child.wait_with_output())`.
    4. Timeout gives `pull_timeout`. A non-zero exit gives `pull_failed` with stderr cut to `STDERR_MAX_CHARS`.
    5. Return the first `HEAD_BYTES` bytes of `dest`.
  - **`android_pull_database(device_id, package_name, db_path) -> Result<PulledDatabase, ApiError>`**:
    1. `check_target(.., Some(&db_path))`, then `adb_path`.
    2. `dest = local_db_path(..)`; `create_dir_all(dest.parent())`.
    3. `remove_if_present` on `-wal` and `-shm`, with the comment `// a stale -wal would replay old pages onto the new copy`.
    4. Run `pull_all(..)`.
    5. On `Err`, remove `dest`, `-wal` and `-shm` (ignore errors) and return the error, with the comment `// never leave a torn copy for android_db_query`.
    6. Otherwise return `PulledDatabase { path, tables }`. `tables` comes from `spawn_blocking(read_tables)`; until step 4 exists, `read_tables` may be a `todo!()`.

    `pull_all` does three pulls in order:
    1. The database. Return `bad_pull_error` unless the head starts with `SQLITE_MAGIC`.
    2. `<db_path>-wal`. Call `remove_if_present` unless `is_wal(head)`, with the comment `// no -wal on the device: cat wrote its error text`.
    3. `<db_path>-shm`, with no check, and the comment `// the user's call; SQLite rebuilds the -shm on open, so it is not checked`.
  - **Tests** (10) go in `#[cfg(test)] mod tests`, with a `scratch(name)` helper like `android.rs` (`temp_dir()/cowbell-android-db-<pid>-<name>`):
    1. `package_names_follow_android_rules`: accepts `com.x`, `com.simplr.rad.dev`, `a_b.c1`. Rejects `com`, `com..x`, `1com.x`, `.com.x`, `com.x;rm`, `-com.x`, `com.x y`, and the empty string.
    2. `rel_paths_reject_escapes_options_and_shell_chars`:
       - Accepts `files/databases/salesdb_20261021094851.sqlite`, `databases/com.google.android.datatransport.events`, `logdb.sqlite`.
       - Rejects `../x`, `files/../x`, `/data/x`, `a//b`, `a/./b`, `a/`, `-x`, `a/-x`, `a b`, `a/b;rm`, `$(x)`, `a\b`, and the empty string.
    3. `running_packages_intersects_ps_and_pm`: `ps = "  PID NAME   \r\n    1 init\n    2 [kthreadd]\n12530 com.a:remote\n12531 com.b\n"` and `pm = "package:com.a\r\npackage:com.c\npackage:com.b\n"` give `["com.a","com.b"]`.
    4. `package_pids_include_suffixed_processes`: `ps = "  PID NAME\n12279 com.g:googleapp\n14748 com.g:interactor\n500 com.gx\n501 com.g\n"` gives `package_pids(ps, "com.g") == [12279, 14748, 501]`.
    5. `open_paths_keep_data_folder_files_only`. Input, live-shaped:
       ```
       total 0
       lrwx------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 1 -> /dev/null
       lr-x------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 10 -> /apex/com.android.art/javalib/bouncycastle.jar
       lr-x------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 100 -> /data/data/com.simplr.rad.dev/app_flutter/shared.hive
       lrwx------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 118 -> /data/data/com.simplr.rad.dev/databases/com.google.android.datatransport.events
       lrwx------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 228 -> /data/data/com.simplr.rad.dev/files/databases/syscondb_20261021094853.sqlite-wal
       lrwx------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 229 -> /data/data/com.simplr.rad.dev/files/databases/salesdb_20261021094851.sqlite
       lrwx------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 239 -> /data/data/com.simplr.rad.dev/files/databases/syscondb_20261021094853.sqlite-shm
       lrwx------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 259 -> /data/user/0/com.simplr.rad.dev/files/databases/logdb.sqlite
       lrwx------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 300 -> /data/data/com.simplr.rad.dev/files/old.db (deleted)
       lrwx------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 301 -> /data/data/com.simplr.rad.devx/files/x.db
       lrwx------ 1 u0_a826 u0_a826 64 2026-10-21 14:01 302 -> /data/data/com.simplr.rad.dev/files/my db.sqlite
       ```
       Expected: `["app_flutter/shared.hive", "databases/com.google.android.datatransport.events", "files/databases/salesdb_20261021094851.sqlite", "files/databases/logdb.sqlite"]`. The `devx` line proves the trailing `/` in the prefix.
    6. `sqlite_paths_reads_head_markers`. Input, live-shaped: `b"==> files/databases/logdb.sqlite <==\nSQLite format 3\0\n==> app_flutter/local.hive <==\n!\0\0\0\x01\x0cPROJECT_CO\n==> code_cache <==\nhead: code_cache: Is a directory\n\n==> databases/com.google.android.datatransport.events <==\nSQLite format 3\0head: app_flutter/nope.x: No such file or directory\n"`.
       - With candidates `[logdb, local.hive, code_cache, datatransport, app_flutter/nope.x]`, the result is `[logdb, datatransport]`.
       - Single file: `b"==> logdb.sqlite <==\nSQLite format 3\0"` with candidate `logdb.sqlite` keeps it.
    7. `local_db_path_mirrors_the_relative_path`: `local_db_path("192.168.1.5:5555", "com.x", "files/databases/a.sqlite")` ends with the components `cowbell-sqlite`, `192_168_1_5_5555`, `com.x`, `files`, `databases`, `a.sqlite`. Device `..` gives `__`.
    8. `bad_pull_error_maps_device_text`:
       - `b"run-as: package not debuggable: com.x\n"` gives `not_debuggable`.
       - `b"cat: files/x: No such file or directory\n"` gives `pull_failed`.
       - `[0u8, 1, 2]` gives `not_sqlite`.
    9. `wal_magic_is_recognized`: both magics are true; `b"cat: ..."` and the empty slice are false.
    10. `commands_reject_unsafe_input_before_adb` (tokio test):
        - `android_app_databases("RF8W3085JEW", "com.x;rm")` gives `bad_package`.
        - `android_pull_database("RF8W3085JEW", "com.x", "../x")` gives `bad_db_path`.
        - `android_running_apps("x; rm")` gives `bad_device_id`.
- **lines**: about 290 (code about 170, tests about 120), plus 1 in lib.rs.
- **exec**: judgment. A new file, the parallel join, partial-failure handling, and binary parsing.
- **verify**: `cargo test -p herdr-gui --lib android_db`. Expected: 10 passed, 0 failed.

## Phase 2: Backend, SQLite read, query and window

### step 4 [sonnet]: read-only reader, query command and SQLite tests
- **files**: `src-tauri/src/android_db.rs`
- **edit**: add `use rusqlite::{types::ValueRef, Connection, OpenFlags};`, the `PulledDatabase` and `QueryPage` structs, and the code below. Replace any `todo!()` from step 3.

  ```rust
  /// Rows per page. Same value as `PAGE_ROWS` in `src/android/dbFormat.ts`.
  const PAGE_ROWS: usize = 100;
  const CELL_MAX_CHARS: usize = 500;

  fn sql_error(err: rusqlite::Error) -> ApiError { api_error("sql_error", err.to_string()) }

  /// A fresh read-only connection per call: nothing holds the files open
  /// when Refresh deletes and pulls them (Windows file locks).
  fn open_copy(path: &Path) -> Result<Connection, ApiError> {
      if !path.is_file() { return Err(api_error("not_pulled", "Pull the database first")); }
      Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(sql_error)
  }

  pub fn read_tables(path: &Path) -> Result<Vec<String>, ApiError> {
      let conn = open_copy(path)?;
      let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name COLLATE NOCASE").map_err(sql_error)?;
      let names = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(sql_error)?
          .collect::<Result<Vec<_>, _>>().map_err(sql_error)?;
      Ok(names)
  }

  /// Display text; integers as strings so 64-bit values keep every digit in JS.
  fn cell(value: ValueRef<'_>) -> Option<String> {
      match value {
          ValueRef::Null => None,
          ValueRef::Integer(i) => Some(i.to_string()),
          ValueRef::Real(f) => Some(f.to_string()),
          ValueRef::Text(t) => {
              let text = String::from_utf8_lossy(t);
              Some(if text.chars().count() > CELL_MAX_CHARS {
                  format!("{}…", text.chars().take(CELL_MAX_CHARS).collect::<String>())
              } else { text.into_owned() })
          }
          ValueRef::Blob(b) => Some(format!("<BLOB {} bytes>", b.len())),
      }
  }

  // shortcut: deep pages step through every earlier row, and a runaway query cannot be cancelled; add a progress handler if users hit it.
  pub fn query_page(path: &Path, sql: &str, offset: usize) -> Result<QueryPage, ApiError> {
      let sql = sql.trim();
      if sql.is_empty() { return Err(api_error("sql_error", "Enter a statement")); }
      let conn = open_copy(path)?;
      let mut stmt = conn.prepare(sql).map_err(sql_error)?;
      // The connection is read-only, but VACUUM INTO still writes a new file.
      if !stmt.readonly() { return Err(api_error("read_only", "Only read-only statements run on the copy")); }
      let columns: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
      let mut rows = stmt.query([]).map_err(sql_error)?;
      let (mut page, mut index, mut has_more) = (Vec::new(), 0usize, false);
      while let Some(row) = rows.next().map_err(sql_error)? {
          if index >= offset {
              if page.len() == PAGE_ROWS { has_more = true; break; }
              page.push((0..columns.len()).map(|i| row.get_ref(i).map(cell)).collect::<Result<Vec<_>, _>>().map_err(sql_error)?);
          }
          index += 1;
      }
      Ok(QueryPage { columns, rows: page, has_more })
  }
  ```

  Command `android_db_query(device_id, package_name, db_path, sql: String, offset: usize)`:
  1. `check_target(.., Some(&db_path))`.
  2. `path = local_db_path(..)`.
  3. `spawn_blocking(move || query_page(&path, &sql, offset))`. A join error gives `sql_error`.

  **Tests** (6):
  1. `a_copied_wal_shows_uncheckpointed_rows_after_reopen`:
     ```rust
     let (src, dst, only) = (scratch("wal-src"), scratch("wal-dst"), scratch("wal-db-only"));
     let db = src.join("t.db");
     let writer = Connection::open(&db).unwrap();
     let mode: String = writer.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0)).unwrap();
     assert_eq!(mode, "wal");
     writer.execute("CREATE TABLE t(x)", []).unwrap();
     writer.execute("INSERT INTO t VALUES (1), (2), (3)", []).unwrap();
     // Copy while the writer is open: closing it would checkpoint the WAL.
     std::fs::copy(&db, dst.join("t.db")).unwrap();
     std::fs::copy(src.join("t.db-wal"), dst.join("t.db-wal")).unwrap();
     std::fs::copy(&db, only.join("t.db")).unwrap();
     drop(writer);
     for _ in 0..2 { assert_eq!(query_page(&dst.join("t.db"), "SELECT x FROM t", 0).unwrap().rows.len(), 3); }
     assert!(dst.join("t.db-wal").is_file(), "a read-only close must not checkpoint or delete the -wal");
     assert_eq!(query_page(&only.join("t.db"), "SELECT x FROM t", 0).unwrap_err().code, "sql_error");
     ```
  2. `query_page_pages_by_100`: `CREATE TABLE t AS WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 250) SELECT x FROM c`.
     - Offset 0: 100 rows, `has_more`.
     - Offset 100: 100 rows, `has_more`, first cell `"101"`.
     - Offset 200: 50 rows, not `has_more`.
     - Offset 250: 0 rows.
  3. `query_page_formats_cells`: `SELECT NULL AS n, 9007199254740993 AS i, 1.5 AS r, x'010203' AS b, printf('%0600d', 0) AS t`.
     - Columns are `[n,i,r,b,t]`.
     - Cells are `None`, `"9007199254740993"`, `"1.5"`, `"<BLOB 3 bytes>"`, and 500 `0`s followed by `…`.
  4. `query_page_refuses_writes_and_keeps_reads`:
     - `DELETE FROM t` gives `read_only`.
     - `VACUUM INTO '<scratch>/x.db'` gives `read_only`, and the file does not exist afterwards.
     - `PRAGMA table_info(t)` succeeds.
     - `"  SELECT * FROM t;  "` succeeds.
     - `SELEC 1` gives `sql_error`.
     - An empty string gives `sql_error`.
     - If the VACUUM INTO assertion fails, add a rejection for statements that start with `VACUUM` (any case) and report it.
  5. `read_tables_lists_tables_and_views_sorted`: tables `b`, `A` and view `v` give `["A","b","v"]`.
  6. `query_without_a_pull_is_not_pulled` (tokio test): `android_db_query("RF8W3085JEW", "com.never.pulled", "files/none.db", "SELECT 1", 0)` gives `not_pulled`.
- **lines**: about 170.
- **exec**: judgment. It uses the rusqlite API of the resolved version, and the borrow order matters.
- **verify**: `cargo test -p herdr-gui --lib android_db`. Expected: 16 passed, 0 failed.

### step 5 [sonnet]: window command and registration
- **files**: `src-tauri/src/android_db.rs`, `src-tauri/src/lib.rs`
- **edit, android_db.rs**: add `use tauri::Manager;` and `use crate::mirror_tools;`, then:
  ```rust
  fn focus_window(app: &tauri::AppHandle, label: &str) -> bool {
      let Some(window) = app.get_webview_window(label) else { return false };
      let _ = window.unminimize();
      let _ = window.set_focus();
      true
  }

  /// Opens the inspector window for `device_id`, or focuses the open one.
  /// `async`: building a window from a sync command deadlocks on Windows.
  #[tauri::command]
  pub async fn android_db_window(app: tauri::AppHandle, device_id: String, device_name: Option<String>) -> Result<(), ApiError> {
      check_device_id(&device_id)?;
      let label = format!("db-inspector-{}", device_id.replace('.', "_"));
      if focus_window(&app, &label) { return Ok(()); }
      let name = mirror_tools::sanitize_device_name(device_name.as_deref().unwrap_or(""), &device_id);
      let mut url = tauri::Url::parse("http://x/db-inspector.html").expect("static url");
      url.query_pairs_mut().append_pair("device", &device_id).append_pair("name", &name);
      let page = format!("db-inspector.html?{}", url.query().unwrap_or(""));
      let builder = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(page.into()))
          .title(format!("SQLite — {name}"))
          .inner_size(1000.0, 680.0)
          .min_inner_size(640.0, 400.0)
          .background_color(tauri::window::Color(0x1f, 0x1f, 0x1f, 0xff));
      // One WebView2 environment for all webviews: other browser args fail to create (mirror_tools.rs).
      #[cfg(windows)]
      let builder = match mirror_tools::main_browser_args(&app) {
          Some(args) => builder.additional_browser_args(&args),
          None => builder,
      };
      match builder.build() {
          Ok(_) => Ok(()),
          // A double click: the first call built it meanwhile.
          Err(_) if focus_window(&app, &label) => Ok(()),
          Err(err) => Err(api_error("window_failed", err.to_string())),
      }
  }
  ```
- **edit, lib.rs**: after `            android::screenshot_save,` add these lines:
  ```
              android_db::android_db_window,
              android_db::android_running_apps,
              android_db::android_app_databases,
              android_db::android_pull_database,
              android_db::android_db_query,
  ```
- **lines**: about 40, plus 5.
- **exec**: judgment. The cfg shadowing (C12) and the Tauri builder API.
- **verify**: `cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^error: |^\s+--> '`. Expected: only the two `flutter.rs` lints (C15).

### step 6 [sonnet]: native Android project detection (`flutter.rs`)
- **files**: `src-tauri/src/flutter.rs`
- **edit** (hand-format; do not run `cargo fmt`, C15):
  - (a) Replace the `FlutterProject` struct (`#[derive(Debug, Clone, PartialEq, Eq, Serialize)]` … `pub name: String,\n}`) with:
    ```rust
    /// What the run toolbar shows: Flutter gets Play and flavors; a native
    /// Android project gets the device picker, Mirror and the SQLite inspector.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub enum ProjectKind {
        Flutter,
        Android,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct FlutterProject {
        pub dir: String,
        pub name: String,
        pub kind: ProjectKind,
    }
    ```
  - (b) In `match_flutter_dir`, change `    Some(FlutterProject {\n        dir: dir.to_string_lossy().into_owned(),\n        name,\n    })` to add `        kind: ProjectKind::Flutter,` after `name,`.
  - (c) Replace
    ```
    /// `cwd` and each ancestor first, then each immediate subfolder of `cwd`
    /// sorted by name.
    pub fn find_flutter_project(cwd: &Path) -> Option<FlutterProject> {
        if let Some(found) = cwd.ancestors().find_map(match_flutter_dir) {
    ```
    with:
    ```rust
    /// A native Android project: `settings.gradle(.kts)` beside
    /// `app/src/main/AndroidManifest.xml`. The name is the folder name.
    // shortcut: only the `app` module is checked; read settings.gradle's includes if other module names show up.
    fn match_android_dir(dir: &Path) -> Option<FlutterProject> {
        let settings = ["settings.gradle", "settings.gradle.kts"]
            .iter()
            .any(|f| dir.join(f).is_file());
        let manifest = dir
            .join("app")
            .join("src")
            .join("main")
            .join("AndroidManifest.xml");
        if !settings || !manifest.is_file() {
            return None;
        }
        Some(FlutterProject {
            dir: dir.to_string_lossy().into_owned(),
            name: dir
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            kind: ProjectKind::Android,
        })
    }

    /// A Flutter project, else a native Android one. Flutter is searched
    /// first, so a Flutter project's own `android/` folder reports Flutter.
    pub fn find_run_project(cwd: &Path) -> Option<FlutterProject> {
        find_project(cwd, match_flutter_dir)
            .or_else(|| find_project(cwd, match_android_dir))
    }

    pub fn find_flutter_project(cwd: &Path) -> Option<FlutterProject> {
        find_project(cwd, match_flutter_dir)
    }

    /// `cwd` and each ancestor first, then each immediate subfolder of `cwd`
    /// sorted by name.
    fn find_project(
        cwd: &Path,
        matcher: fn(&Path) -> Option<FlutterProject>,
    ) -> Option<FlutterProject> {
        if let Some(found) = cwd.ancestors().find_map(matcher) {
    ```
  - (d) Change `    subfolders.iter().find_map(|dir| match_flutter_dir(dir))` to `    subfolders.iter().find_map(|dir| matcher(dir))`.
  - (e) In `flutter_project`, change `find_flutter_project(Path::new(&cwd))` to `find_run_project(Path::new(&cwd))`.
  - (f) Add tests after `strips_quotes_from_the_name`, using the existing `scratch`, `write_pubspec` and `FLUTTER_PUBSPEC`:
    ```rust
        fn write_android(dir: &Path, settings: &str) {
            let main = dir.join("app").join("src").join("main");
            std::fs::create_dir_all(&main).unwrap();
            std::fs::write(main.join("AndroidManifest.xml"), b"<manifest/>").unwrap();
            std::fs::write(dir.join(settings), b"").unwrap();
        }

        #[test]
        fn detects_a_native_android_project_from_a_module_folder() {
            let root = scratch("android");
            write_android(&root, "settings.gradle.kts");
            let found = find_run_project(&root.join("app")).unwrap();
            assert_eq!(found.kind, ProjectKind::Android);
            assert_eq!(found.dir, root.to_string_lossy());
            let _ = std::fs::remove_dir_all(&root);
        }

        #[test]
        fn a_groovy_settings_file_also_matches() {
            let root = scratch("android-groovy");
            write_android(&root, "settings.gradle");
            assert_eq!(find_run_project(&root).unwrap().kind, ProjectKind::Android);
            let _ = std::fs::remove_dir_all(&root);
        }

        #[test]
        fn flutter_wins_over_its_own_android_folder() {
            let root = scratch("flutter-android");
            write_pubspec(&root, FLUTTER_PUBSPEC);
            write_android(&root.join("android"), "settings.gradle");
            let found = find_run_project(&root.join("android")).unwrap();
            assert_eq!(found.kind, ProjectKind::Flutter);
            assert_eq!(found.dir, root.to_string_lossy());
            let _ = std::fs::remove_dir_all(&root);
        }

        #[test]
        fn gradle_without_an_app_manifest_does_not_match() {
            let root = scratch("gradle-only");
            std::fs::write(root.join("settings.gradle"), b"").unwrap();
            assert!(find_run_project(&root).is_none());
            let _ = std::fs::remove_dir_all(&root);
        }
    ```
- **lines**: about 95.
- **exec**: judgment. Hand-formatting next to existing fmt failures, and the `fn` pointer matcher.
- **verify**: `cargo test -p herdr-gui --lib flutter && cargo fmt --check 2>&1 | grep -c '^Diff in'`. Expected: all `flutter` tests pass, including the 4 new ones, and the count is 2 (the existing hunks only).

## Phase 3: Frontend API

### step 7 [haiku]: wrappers and `kind`
- **files**: `src/flutter/flutterApi.ts`
- **edit**:
  - (a) Replace `export interface FlutterProject {\n  dir: string;\n  name: string;\n}` with:
    ```ts
    export interface FlutterProject {
      dir: string;
      name: string;
      /** "android": a native Android project. The run toolbar then hides Play and flavors. */
      kind: "flutter" | "android";
    }
    ```
  - (b) After the `screenshotSave` function, add:
    ```ts
    /** Opens the SQLite inspector window for an adb device, or focuses the open one. */
    export function androidDbWindow(deviceId: string, deviceName?: string): Promise<void> {
      return invoke<void>("android_db_window", { deviceId, deviceName });
    }

    /** Third-party packages with a running process on the device, sorted. */
    export function androidRunningApps(deviceId: string): Promise<string[]> {
      return invoke<string[]>("android_running_apps", { deviceId });
    }

    /** Paths, relative to the app data folder, of the SQLite databases the app holds open now. Rejects `not_running` and `not_debuggable`. */
    export function androidAppDatabases(deviceId: string, packageName: string): Promise<string[]> {
      return invoke<string[]>("android_app_databases", { deviceId, packageName });
    }

    export interface PulledDatabase {
      /** The local copy, for a tooltip. */
      path: string;
      tables: string[];
    }

    /** Pulls the database with its `-wal` and `-shm` to a temp copy (replacing the last one) and lists its tables and views. */
    export function androidPullDatabase(deviceId: string, packageName: string, dbPath: string): Promise<PulledDatabase> {
      return invoke<PulledDatabase>("android_pull_database", { deviceId, packageName, dbPath });
    }

    export interface QueryPage {
      columns: string[];
      /** Display text per cell; `null` is SQL NULL. Integers are strings, so 64-bit values keep every digit. */
      rows: (string | null)[][];
      hasMore: boolean;
    }

    /** Runs one read-only statement on the local copy. Up to 100 rows from `offset`. */
    export function androidDbQuery(deviceId: string, packageName: string, dbPath: string, sql: string, offset: number): Promise<QueryPage> {
      return invoke<QueryPage>("android_db_query", { deviceId, packageName, dbPath, sql, offset });
    }
    ```
- **lines**: 41
- **exec**: mechanical. Exact text.
- **verify**: `npx tsc --noEmit`. Expected: exit 0, no output.

### step 8 [haiku]: pure helpers and their test
- **files**: `src/android/dbFormat.ts` (new), `tests/unit/dbFormat.test.ts` (new)
- **edit, `src/android/dbFormat.ts`**:
  ```ts
  // Pure helpers for the SQLite inspector page (`dbInspector.ts`). No DOM, no Tauri.

  /** Rows per page. Same value as `PAGE_ROWS` in `src-tauri/src/android_db.rs`. */
  export const PAGE_ROWS = 100;

  /** `SELECT * FROM "<name>"` with `"` doubled, so any table name is one identifier. No `replaceAll`: tsconfig lib is ES2020. */
  export function tableSql(name: string): string {
    return `SELECT * FROM "${name.replace(/"/g, '""')}"`;
  }

  /** "Rows 101–200", or "No rows". */
  export function rowRange(offset: number, count: number): string {
    return count === 0 ? "No rows" : `Rows ${offset + 1}–${offset + count}`;
  }
  ```
- **edit, `tests/unit/dbFormat.test.ts`**:
  ```ts
  import { describe, expect, it } from "vitest";
  import { rowRange, tableSql } from "../../src/android/dbFormat";

  describe("tableSql", () => {
    it("quotes a plain name", () => expect(tableSql("users")).toBe('SELECT * FROM "users"'));
    it("doubles embedded quotes", () => expect(tableSql('a"b')).toBe('SELECT * FROM "a""b"'));
    it("keeps a hostile name inside the identifier", () =>
      expect(tableSql('x"; DROP TABLE y; --')).toBe('SELECT * FROM "x""; DROP TABLE y; --"'));
  });

  describe("rowRange", () => {
    it("is No rows for an empty page", () => expect(rowRange(0, 0)).toBe("No rows"));
    it("is one-based and inclusive", () => {
      expect(rowRange(0, 100)).toBe("Rows 1–100");
      expect(rowRange(100, 37)).toBe("Rows 101–137");
    });
  });
  ```
- **lines**: 34
- **exec**: mechanical. Exact text.
- **verify**: `npx vitest run tests/unit/dbFormat.test.ts`. Expected: 5 passed.

## Phase 4: UI

### step 9 [haiku]: move the theme loader
- **files**: `src/themes/savedTheme.ts` (new), `src/mirrorTools.ts`
- **edit, new file**: write this header, then the body of `applyTheme` from `mirrorTools.ts:36-57` word for word, renamed and exported:
  ```ts
  // The saved theme for a secondary window (mirror tools, SQLite inspector).
  // Those pages do not load `appState`, so they read the setting from Rust.

  import { invoke } from "@tauri-apps/api/core";
  import { ThemeRegistry, applyThemeById, importedThemeId } from "./index";

  /** Applies the saved theme once, at startup. A later change in the main window reaches the page when it opens again. */
  export async function applySavedTheme(): Promise<void> {
    // ...body of applyTheme, word for word...
  }
  ```
- **edit, mirrorTools.ts**:
  - (a) Delete `import { invoke } from "@tauri-apps/api/core";`. It is used only at lines 40 and 42.
  - (b) Replace `import { ThemeRegistry, applyThemeById, importedThemeId } from "./themes/index";` with `import { applySavedTheme } from "./themes/savedTheme";`.
  - (c) Delete the block from `/** Applies the saved theme once, at startup. A later change in the main window reaches this page with the next tools window. */` through the `}` that closes `applyTheme`, and the blank line after it.
  - (d) Replace `  await applyTheme();` with `  await applySavedTheme();`.
- **lines**: about 30 added, 26 removed.
- **exec**: mechanical. A word-for-word move.
- **verify**: `npx tsc --noEmit && grep -c "applyTheme()" src/mirrorTools.ts`. Expected: tsc clean, count 0.

### step 10 [haiku]: page entry
- **files**: `db-inspector.html` (new), `vite.config.ts`
- **edit, `db-inspector.html`**:
  ```html
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Cowbell SQLite</title>
    </head>
    <body class="db-inspector">
      <div id="db-root" class="db-root"></div>
      <script type="module" src="/src/dbInspector.ts"></script>
    </body>
  </html>
  ```
- **edit, vite.config.ts**:
  - Replace `  // 4. Two pages: the app, and the mirror tools window (docs/mirror-toolbar-spec.md).` with these two lines:
    ```
      // 4. Three pages: the app, the mirror tools window (docs/mirror-toolbar-spec.md)
      // and the SQLite inspector window (src/dbInspector.ts).
    ```
  - After `        mirrorTools: fileURLToPath(new URL("./mirror-tools.html", import.meta.url)),`, add `        dbInspector: fileURLToPath(new URL("./db-inspector.html", import.meta.url)),`.
- **lines**: 15
- **exec**: mechanical. Exact text.
- **verify**: `grep -n "db-inspector.html" vite.config.ts`. Expected: 1 line.

### step 11 [sonnet]: the inspector page `src/dbInspector.ts`
- **files**: `src/dbInspector.ts` (new)
- **edit**: a new entry script, about 190 lines. Header comment: errors show inline (`#error-notices` does not exist here); every name, path and cell comes from the device and is set with `textContent`, never `innerHTML`.
  - **Imports**: `./style.css`, `errorMessage` from `./appApi`, `parseMirrorToolsParams` from `./android/mirrorToolsParams`, `PAGE_ROWS, rowRange, tableSql` from `./android/dbFormat`, the 4 data wrappers and `QueryPage` from `./flutter/flutterApi`, and `applySavedTheme` from `./themes/savedTheme`.
  - **Startup**:
    1. `root = #db-root`.
    2. `params = parseMirrorToolsParams(location.search)`. If it is null, set `root.textContent = "Invalid inspector parameters"` and return.
    3. `await applySavedTheme()`.
    4. `document.title = "SQLite — " + deviceName`.
    5. Build the DOM, then call `refresh()`.
  - **DOM**:
    ```
    .db-bar
      select.db-select (aria-label "App")
      select.db-select (aria-label "Database"; option text = the relative path)
      button.btn [codicon refresh] "Refresh" (title "Pull the database again")
      span.db-status (aria-live polite)
    .db-main
      ul.db-tables (aria-label "Tables")
        li > button.db-table   (is-active when sql === tableSql(name))
      .db-work
        .db-query
          textarea.db-sql (spellcheck false, rows 3, aria-label "SQL", placeholder "SELECT …")
          button.btn.btn--primary "Run"
        .db-grid > table.db-result
          thead: th per column
          tbody: td per cell; NULL gives td.db-null "NULL"; td.title = the text
        .db-pager
          button.btn "‹ Prev"
          span.db-range
          button.btn "Next ›"
    ```
  - **State** (module-level variables): `apps`, `app: string|null`, `dbs`, `dbPath: string|null`, `tables`, `sql` (empty means no view), `offset`, `hasMore`, `busy`, `pulledText`.
  - **Rules**:
    - **R1 `run(task)`**: return at once if busy. Set busy, call `renderControls()`, run the task. On an error, show `errorMessage(err)` in the status line with `db-status--error`. In `finally`, clear busy and call `renderControls()`. Every async action goes through `run`.
    - **R2 `renderControls()`**:
      - Everything is disabled while busy.
      - The database select is also disabled with no app.
      - Run is also disabled with no `dbPath` or an empty textarea; update this on `input`.
      - Prev is also disabled when `offset === 0` or `sql` is empty.
      - Next is also disabled when `!hasMore`.
    - **R3 `refresh()`** runs on load, on Refresh, and on app or database change. Inside `run`:
      1. Status "Loading apps…". `apps = await androidRunningApps(id)`. If the chosen app is not in the list, add it back, so a stopped app stays selectable and the next call explains it with `not_running`.
      2. Fill the app select. The first option has value `""`, with text "Choose an app", or "No running apps" when the list is empty. Then select `app ?? ""`.
      3. With no app: the status is empty, or "No running apps. Start the app on the phone, then press Refresh". Stop here.
      4. Status "Finding open databases…". `dbs = await androidAppDatabases(id, app)`. An error such as `not_running` or `not_debuggable` goes to R1. Clear `dbPath` if the list lacks it. Fill the database select ("Choose a database", or "No open databases").
      5. With no `dbPath`: the status is empty, or "No open SQLite databases right now. Use the app, then press Refresh". Stop here.
      6. Status `Pulling <dbPath>…`. `pulled = await androidPullDatabase(id, app, dbPath)`. Set `tables = pulled.tables` and render the table list.
      7. `pulledText = "Pulled " + new Date().toLocaleTimeString()`. Set the status to it, with `title = pulled.path`.
      8. If `sql` is not empty, `await showPage(offset)`.
    - **R4 app change**: `app = value || null`, then `dbPath = null`, `tables = []`, `sql = ""`, clear the grid and range, then `refresh()`.
    - **R5 database change**: the same as R4 for `dbPath`, then `refresh()`.
    - **R6 table click**: `run(() => { sql = tableSql(name); textarea.value = sql; return showPage(0); })`.
    - **R7 Run**: `run(() => { sql = textarea.value.trim(); return showPage(0); })`.
    - **R8 paging**: Prev is `run(() => showPage(Math.max(0, offset - PAGE_ROWS)))`; Next is `run(() => showPage(offset + PAGE_ROWS))`.
    - **R9 `showPage(off)`**:
      1. `page = await androidDbQuery(id, app!, dbPath!, sql, off)`.
      2. `offset = off`; `hasMore = page.hasMore`.
      3. Render the grid; set the range with `rowRange(off, page.rows.length)`; re-render the tables.
      4. Set the status to `pulledText`.
  - Skipped: Ctrl+Enter to run, row counts, column sort.
- **lines**: about 190.
- **exec**: judgment. A new file with DOM and state.
- **verify**: `npx tsc --noEmit && npm run build && test -f dist/db-inspector.html && echo OK`. Expected: `OK`.

### step 12 [sonnet]: styles
- **files**: `src/style.css`
- **edit**: add a block after the find-file dialog styles (`.qo-footer`), headed `/* SQLite inspector window (src/dbInspector.ts). */`. Use only existing tokens: `--menu-border`, `--menu-background`, `--menu-foreground`, `--menu-separatorBackground`, `--descriptionForeground`, `--errorForeground`, `--focusBorder`, `--fs-xs`, `--list-hoverBackground`, `--list-activeSelectionBackground`, `--list-activeSelectionForeground`.
  - `body.db-inspector { display: flex; flex-direction: column; }`: overrides the main window's 3-row grid at `style.css:29`.
  - `.db-root`: flex column, `flex: 1`, `min-height: 0`.
  - `.db-bar`: flex, gap 8px, 8px padding, bottom border.
  - `.db-select`: 180–420px wide (paths are long), menu colours, 1px border, 4px radius, `font: inherit`.
  - `.db-status`: `flex: 1`, ellipsis, `--fs-xs`, muted. `.db-status--error`: error colour, wraps.
  - `.db-main`: flex row, `flex: 1`, `min-height: 0`.
  - `.db-tables`: 220px wide, `overflow-y: auto`, right border, no list style.
  - `.db-table`: full-width left-aligned row button with no border and an ellipsis. Hover uses `--list-hoverBackground`; `.is-active` uses the active-selection tokens.
  - `.db-work`: flex column, `flex: 1`, `min-width: 0`.
  - `.db-query`: flex, gap 8px, 8px padding.
  - `.db-sql`: `flex: 1`, vertical resize, minimum height 54px, transparent background, border; font `12px/1.4 "SF Mono", Menlo, "Cascadia Mono", Consolas, monospace` (the same stack as `FONT_STACK`, `render/renderer.ts:22`). Focus outline uses `--focusBorder`.
  - `.db-grid`: `flex: 1`, `min-height: 0`, `overflow: auto`, top border.
  - `.db-result`: collapsed borders, monospace 12px.
  - `.db-result th, .db-result td`: padding 2px 8px, separator border, `nowrap`, `max-width: 320px`, ellipsis, left-aligned.
  - `.db-result th`: `position: sticky; top: 0`, menu background.
  - `.db-null`: muted, italic.
  - `.db-pager`: flex, gap 8px, padding 6px 8px, top border.
  - `.db-range`: `--fs-xs`, muted.
- **lines**: about 90.
- **exec**: judgment. Visual layout.
- **verify**: `npm run build && grep -c "\.db-" src/style.css`. Expected: build exit 0, count at least 15.

### step 13 [haiku]: toolbar button and the Play flag
- **files**: `src/ui/runToolbar.ts`
- **edit**:
  - (a) Replace `  mirrorDisabled: boolean;\n  mirrorTitle: string;\n}` with:
    ```ts
      mirrorDisabled: boolean;
      mirrorTitle: string;
      /** The SQLite inspector button. Disabled unless the device is an adb device in state "device". */
      dbDisabled: boolean;
      dbTitle: string;
      /** Play: Flutter projects only; a native Android project hides it. */
      playVisible: boolean;
    }
    ```
  - (b) Replace `  onMirror: () => void;` with `  onMirror: () => void;\n  onDatabase: () => void;`.
  - (c) After `  const mirrorIcon = mirror.querySelector("i") as HTMLElement;`, add `  const db = makeButton("run-btn--db", "database", "Inspect SQLite databases", handlers.onDatabase);`.
  - (d) Replace `  root.append(deviceBtn, flavorBtn, mirror, play, reload, restart, stop);` with `  root.append(deviceBtn, flavorBtn, mirror, db, play, reload, restart, stop);`.
  - (e) After `      mirror.title = view.mirrorTitle;`, add `      db.disabled = view.dbDisabled;\n      db.title = view.dbTitle;`.
  - (f) After `      play.title = view.playTitle;`, add `      play.hidden = !view.playVisible;`. `#run-toolbar [hidden]` already hides it (`style.css:176-177`).
- **lines**: 13
- **exec**: mechanical. Exact text; `codicon-database` exists in `@vscode/codicons` 0.0.36.
- **verify**: `npx tsc --noEmit`. Expected: errors only in `appFlutterRun.ts` (missing view and handler fields); step 14 fixes them.

### step 14 [haiku]: toolbar wiring and Android-kind rules
- **files**: `src/appFlutterRun.ts`
- **edit**:
  - (a) Imports: replace `  androidDevices,\n  androidInstallApk,` with `  androidDbWindow,\n  androidDevices,\n  androidInstallApk,`.
  - (b) Handlers: replace `  onMirror: () => void mirror(),` with `  onMirror: () => void mirror(),\n  onDatabase: () => void openDbInspector(),`.
  - (c) `allDevices`: replace `  return mergeDevices(adbDevices ?? [], flutterList);` with:
    ```ts
      // An Android workspace runs nothing through flutter: desktop and web entries do not apply.
      return project?.kind === "android" ? (adbDevices ?? []) : mergeDevices(adbDevices ?? [], flutterList);
    ```
  - (d) After the closing `}` of `selectedDevice()` (the line before it is `  return devices.find((d) => d.id === saved) ?? devices.find((d) => d.state === "device") ?? null;`), add:
    ```ts

    /** A connected adb device: the SQLite inspector needs adb, so flutter-only entries (Windows, Chrome) do not count. */
    function isAdbDevice(device: AndroidDevice | null): device is AndroidDevice {
      return device?.state === "device" && (adbDevices?.some((d) => d.id === device.id) ?? false);
    }
    ```
  - (e) Hidden view: replace `      mirrorDisabled: true,\n      mirrorTitle: "",\n    });` with `      mirrorDisabled: true,\n      mirrorTitle: "",\n      dbDisabled: true,\n      dbTitle: "",\n      playVisible: false,\n    });`.
  - (f) Visible view: after the line ``    mirrorTitle: mirrorBusy ? "Starting scrcpy…" : `Mirror ${device?.name ?? "the device"} with scrcpy`,``, add:
    ```ts
        dbDisabled: !isAdbDevice(device),
        dbTitle: `Inspect SQLite databases on ${device?.name ?? "the device"}`,
        playVisible: project.kind === "flutter",
    ```
  - (g) `loadAllDevices`: replace `  loadAdb(true);\n  loadFlutter();\n}` with `  loadAdb(true);\n  if (project?.kind !== "android") loadFlutter();\n}`.
  - (h) `activateProject`: replace `  if (flutterList === null && !flutterLoading) loadFlutter();` with `  if (found.kind === "flutter" && flutterList === null && !flutterLoading) loadFlutter();`.
  - (i) `play()`: replace `  if (playing || !project || !activeWorkspaceId || !appState.snapshot) return;` with `  if (playing || !project || project.kind !== "flutter" || !activeWorkspaceId || !appState.snapshot) return;`.
  - (j) `installApks`: replace `"No ready device. Connect one in a Flutter workspace"` with `"No ready device. Connect one in a Flutter or Android workspace"`.
  - (k) Before `/** Installs dropped APKs on the selected device, one after the other. */`, add:
    ```ts
    /** Opens (or focuses) the SQLite inspector window for the selected adb device. */
    async function openDbInspector(): Promise<void> {
      const device = selectedDevice();
      if (!isAdbDevice(device)) return;
      // Settings are editable on disk; the backend checks this id again.
      if (!isValidDeviceId(device.id)) {
        showErrorNotice(`Unsafe device id: ${device.id}`);
        return;
      }
      try {
        await androidDbWindow(device.id, device.name);
      } catch (err) {
        showErrorNotice(errorMessage(err));
      }
    }

    ```
- **lines**: about 40.
- **exec**: mechanical. Exact text.
- **verify**: `npx tsc --noEmit`. Expected: exit 0, no output.

## Phase 5: Tests and checks

### step 15 [haiku]: offline acceptance and notices
- **files**: `public/THIRD-PARTY-NOTICES.txt` (regenerated)
- **edit**: run A1 to A9 in a Herdr pane and keep the raw output. Keep the notices file that `npm run notices` rewrites; `scripts/package.mjs:79` regenerates it on every package anyway.
- **lines**: generated.
- **exec**: mechanical. Fixed commands.
- **verify**: A1 to A9.

### step 16 [you, about 20 min, needs RF8W3085JEW with com.simplr.rad.dev running]: live check
Start the app in your own terminal with `cd C:\Users\Reinaldo\Backend\herdr\gui; npm run tauri dev`. The first build compiles SQLite and takes about 2 minutes.

1. **Android workspace.** Open a native Android project folder (`settings.gradle(.kts)` and `app/src/main/AndroidManifest.xml`). The run toolbar shows the device picker, Mirror and the database button. Play and flavor are hidden. The device menu lists adb devices only.
2. **Flutter workspace.** Open the Flutter project for `com.simplr.rad.dev`. Play is back. Choose SM A145F; the database button tooltip reads "Inspect SQLite databases on SM A145F".
3. Click the database button, and the window "SQLite — SM A145F" opens. Click it again: the same window comes to the front.
4. The app list shows the running third-party apps (on 2026-10-21: `com.anydesk.adcontrol.ad1`, `com.anydesk.anydeskandroid`, `com.simplr.rad.dev`).
5. Choose `com.anydesk.anydeskandroid`. The status reads "…is not debuggable. Only debug builds can be inspected".
6. Choose `com.simplr.rad.dev`. The database list is exactly:
   - `databases/com.google.android.datatransport.events`
   - `files/databases/logdb.sqlite`
   - `files/databases/salesdb_<stamp>.sqlite`
   - `files/databases/syscondb_<stamp>.sqlite`

   It does not show `google_app_measurement_local.db` (not open), any `.hive` or `.lock` file, or any `-wal`/`-shm`.
7. Choose `files/databases/logdb.sqlite`.
   - Tables: `android_metadata`, `simplr_log`, `sqlite_sequence`.
   - The status shows "Pulled HH:MM:SS". The tooltip path is under `%TEMP%\cowbell-sqlite\RF8W3085JEW\com.simplr.rad.dev\files\databases\`.
   - `SELECT count(*) FROM simplr_log;` includes the WAL-only rows. On 2026-10-21 it was 18237 with the WAL and 18104 without.
8. **WAL path.**
   1. Do something in the app that writes a log or sales row.
   2. Press Refresh.
   3. The count rises, and the new row shows in `SELECT * FROM simplr_log ORDER BY rowid DESC` (or in the matching `salesdb` table).
9. **Paging and read-only.**
   - Run `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<250) SELECT x FROM c`. Next shows "Rows 101–200", then "Rows 201–250", then Next is off. Prev goes back.
   - `DELETE FROM simplr_log` shows "Only read-only statements run on the copy".
   - `SELEC` shows a SQLite syntax error.
10. **Not running.** Close the app on the phone (swipe it away), then press Refresh. The status reads "com.simplr.rad.dev is not running. Start the app, then press Refresh".
11. **Exit.** Close the main window. The inspector closes and the app exits.

## Risks and how this plan could be wrong
- **"Active" can be empty.** An app that opens a database only during a query shows nothing between queries. The empty text tells the user to use the app and press Refresh.
- **Some databases are filtered out without notice:**
  - SQLCipher databases have no SQLite magic.
  - Databases outside the data folder (`/storage/emulated/0/…`) or in device-protected storage (`/data/user_de/0/<pkg>/`) do not match the two prefixes.
  - Paths with spaces or non-ASCII characters fail `is_valid_rel_path` (marked `shortcut:` in the code).
- **`head` can block.** A named FIFO under the data folder blocks `head` until the 10 s timeout gives `adb_timeout`.
- **Device coverage is narrow.**
  - `head -v`, the `ls -l /proc/<pid>/fd` format and `ps -A -o PID,NAME` are verified on API 35 only. Android before 8 has no toybox `ps -A`.
  - Work-profile apps fail, because `run-as` uses user 0.
  - An app with more than 200 open files under its data folder has its list cut at 200 (`MAX_CANDIDATES`, `shortcut:`).
- **The copy is not atomic.** A checkpoint between the database and `-wal` pulls can give "malformed" or a mixed snapshot. Press Refresh again.
- **Android detection checks only an `app` module.** A project whose module has another name is not detected (`shortcut:` in `match_android_dir`).
- **`FlutterProject` and `flutter_project` names stay** even though they now cover Android. This avoids a rename across 4 files; `kind` carries the difference.
- **The readonly gate rejects `PRAGMA journal_mode`** even as a query. A runaway query cannot be cancelled. Temp copies stay until the OS cleans its temp folder.
- **`rusqlite` cost.** `bundled` adds about 1 MB and compile time, and the first build needs the network.

## Overall verify
```
cd /c/Users/Reinaldo/Backend/herdr/gui && cargo test -p herdr-gui --lib && npx tsc --noEmit && npx vitest run && npm run build && test -f dist/db-inspector.html && echo BUILD-OK; cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^error: |^\s+--> '; cargo fmt --check 2>&1 | grep '^Diff in'
```
Expected:
- cargo test: 358 passed, 0 failed.
- vitest: 74 files passed.
- `BUILD-OK` is printed.
- clippy prints only the two `flutter.rs` lints named in C15, plus the "could not compile" line.
- fmt prints exactly two `Diff in …flutter.rs` lines.

---
Skipped: a folder-scan fallback for apps that are not running, `/data/user_de/` and external-storage databases, SQLCipher, Ctrl+Enter to run, row counts and column sort.

I checked the formats live on RF8W3085JEW with read-only adb: `ps`/`pidof`, the `/proc/<pid>/fd` lines and both path prefixes, the `head -v` markers, the non-debuggable errors, and a pull of `logdb.sqlite` with its WAL. I have not compiled the Rust or TS reference code, and I have not exercised the Android-workspace toolbar path; step 16 items 1 and 8 are the first real test of the toolbar and the live WAL Refresh.
