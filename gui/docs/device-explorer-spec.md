# Spec: Device explorer (Cowbell GUI)

## Header

**goal**: an "Explorer" button in the run toolbar opens a separate window per adb device. The window browses `/sdcard` (and `/storage`) read-only and saves a device file or folder to the PC with `adb pull`.

**deliverables**
- New files:
  - `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
  - `C:\Users\Reinaldo\Backend\herdr\gui\device-explorer.html`
  - `C:\Users\Reinaldo\Backend\herdr\gui\src\deviceExplorer.ts`
  - `C:\Users\Reinaldo\Backend\herdr\gui\src\android\deviceFiles.ts`
  - `C:\Users\Reinaldo\Backend\herdr\gui\tests\unit\deviceFiles.test.ts`
  - `C:\Users\Reinaldo\Backend\herdr\gui\llm_wiki\areas\device-explorer.md`
- Files to edit:
  - `gui/src-tauri/src/android_db.rs`: visibility changes only, on the same lines.
  - `gui/src-tauri/src/lib.rs`
  - `gui/src/flutter/flutterApi.ts`
  - `gui/vite.config.ts`
  - `gui/src/style.css`
  - `gui/src/ui/runToolbar.ts`
  - `gui/src/appFlutterRun.ts`
  - `gui/llm_wiki/`: `map.md`, `code_map.md`, `CHANGELOG.md`, `index.md`, `architecture.md`, `conventions.md`, `shortcut-markers.md`, `areas/flutter-android.md`, `areas/macos-port.md`, `areas/sqlite-inspector.md`, `areas/usage-statusline.md`. Only `map`, `code_map` and `CHANGELOG` were asked for. The others are line-reference fixes and marker rows that the wiki's own rules require.
- Must stay untouched:
  - The 4 uncommitted files: `gui/src-tauri/src/commands.rs`, `gui/src/appTerminalMouse.ts`, `gui/src/links.ts`, `gui/tests/unit/links.test.ts`.
  - `gui/src-tauri/src/flutter.rs`: leave its existing fmt and clippy problems alone.
  - `gui/src-tauri/capabilities/*`: no new capability is needed.
  - `src/dbInspector.ts`.
- Never run `cargo fmt`, `cargo clippy --fix` or `npm run check`. Do not commit.

**contracts** (`ApiError` = `{ code, message }`, source `src-tauri/src/commands.rs:182-186`. Tauri maps snake_case args to camelCase, as in `flutterApi.ts:104` `{ deviceId, packageName, dbPath }`.)

| Rust command (`device_explorer.rs`) | TS wrapper (`flutterApi.ts`) | Ok | Error codes |
|---|---|---|---|
| `android_explorer_window(app, device_id: String, device_name: Option<String>)` | `androidExplorerWindow(deviceId, deviceName?) : Promise<void>` | `()` | `bad_device_id`, `window_failed` |
| `android_list_dir(device_id: String, path: String)` | `androidListDir(deviceId, path) : Promise<DirListing>` | `DirListing { entries: DeviceEntry[], truncated: bool }`, where `DeviceEntry { name: String, isDir: bool, size: u64, modified: String /* "YYYY-MM-DD HH:MM" device local */ }` | `bad_device_id`, `bad_device_path`, `adb_not_found`, `adb_failed` (spawn), `adb_timeout` (30 s), `list_failed` (adb or ls text) |
| `android_pull_path(app, window: WebviewWindow, device_id: String, path: String, is_dir: bool)` | `androidPullPath(deviceId, path, isDir) : Promise<PulledPath \| null>` | `Option<PulledPath { path: String /* local file or created folder */, summary: String /* adb's last line */ }>`; `None` = the user cancelled | `bad_device_id`, `bad_device_path`, `bad_local_name`, `adb_not_found`, `save_failed`, `dest_exists`, `pull_failed`, `adb_failed`, `adb_timeout` (1 h), `io_error` |

- Window: the label is `device-explorer-<id with . → _>`. The URL is `device-explorer.html?device=<id>&name=<sanitized>` and the title is `Files — <name>`. This copies the pattern of `android_db_window` (`android_db.rs:916-962`), including the `#[cfg(windows)] main_browser_args` block. Leave out its temp-copy cleanup.
- Device shell argv: `adb -s <id> shell ls -lAL <sh_quote(path + "/")>`. The quoted path is one argv element.
- Pull argv: `adb -s <id> pull <raw device path> <local target>`. The device path is **not quoted**.
- Path rule (`is_valid_device_path`, mirrored in TS as `isValidDevicePath`):
  - At most 4096 bytes.
  - No `char::is_control` character (U+0000–001F, U+007F–009F).
  - It splits on `/` into `""`, then exactly `sdcard` or `storage`, then segments that are not empty, not `.` and not `..`. So `/sdcardx`, a trailing `/` and `//` all fail.
  - Spaces, quotes, `$`, backticks, `;`, non-ASCII and a leading `-` in a segment all pass.
- How `adb shell ls` is made safe:
  1. The path must pass the rule above, in Rust, before adb runs.
  2. `sh_quote(s) = "'" + s.replace("'", "'\\''") + "'"` is passed as one argv element. In POSIX sh, only `'` is special inside single quotes, so every other byte is literal.
  3. Control characters are rejected, so no newline or NUL reaches adb's protocol.
  4. The path always starts with `/`, so it can never be read as an `ls` option.
- Pull safety: the remote path goes through adb's sync protocol (no shell). The local path never crosses IPC: Rust gets it from the native dialog.

**edge cases** (live = probed on RF8W3085JEW today)
- `/sdcard` is a symlink. `ls -la /sdcard` → `lrw-r--r-- 1 root root 21 2022-01-01 08:00 /sdcard -> /storage/self/primary` (live). Fix: always list `<path>/`.
- `-L` lists links as their targets. `ls -lAL /storage/self/` → `drwxrws--- 24 media_rw media_rw 3452 2026-10-01 14:55 primary` (live). Fix: use `-lAL`. A broken link can still print `name -> target`, so cut the name at ` -> ` when the mode starts with `l`.
- Spaces split without quotes. `ls -lA /sdcard/Simplr APK/` → `ls: /sdcard/Simplr: No such file or directory` + `ls: APK/: …` (live). The single-quoted form listed 1 apk.
- Apostrophe: `'/sdcard/it'\''s/'` reached the device as `ls: /sdcard/it's/: No such file or directory` (live).
- A leading `-` is real: `/sdcard/Download/.nearby/-5034958385594290967` (live). `is_valid_rel_path` (`android_db.rs:80`) would reject it, so do not reuse it.
- Empty folder: `ls -lA /sdcard/Alarms/` → `total 0`, exit 0 (live). An empty listing is OK.
- Missing folder, or a file listed as a folder: stderr `ls: /sdcard/nope/: No such file or directory` and `ls: /sdcard/Download/small.txt/: Not a directory`, exit 1 (live). There is no `total` line, so the result is `list_failed`.
- Column padding: `drwxrwx---  2 media_rw media_rw 3452 2023-04-25 17:11 obb` (live). The parser skips runs of spaces between fields, and exactly one space before the name.
- Old adb merges stderr into stdout and exits 0 (`android_db.rs:165-180`). So the `total` line decides, not the exit code. `ls` also exits 1 when only one child fails to stat, so use `adb_output` (raw, any exit code), not `run_capture`.
- `/sdcard/Android/data/` listed on this Android 15 device (live). On other devices it can be denied, which gives `list_failed` with the `ls:` text.
- Folder pull into a picked folder `P` creates `P\<name>`. A second pull exits 0 and silently merges into the same folder (live, `.nearby` pulled twice). Guard: `dest_exists` when `P\<name>` exists.
- A folder name like `C:` or `a:b` makes `PathBuf::join` leave `P`. Guard: `bad_local_name` when `local_file_name(name) != name`.
- Pull failure: `adb: error: failed to stat remote object '/sdcard/Download/nope.txt': No such file or directory`, exit 1 (live). This gives `pull_failed` with the stderr text.
- Piped `adb pull` prints no `[xx%]` lines. It writes its summary to stderr: stdout 0 bytes, stderr `/sdcard/SimplrLSHDebug.4.2.5.6.apk: 1 file pulled, 0 skipped. 36.0 MB/s (74479389 bytes in 1.975s)` (live, 74 MB).
- A file pull writes `<dest>.cowbell-part` and renames it only on success, so a failed pull never destroys the file the user chose to overwrite. After a timeout kill, Windows may still hold the handle, so a `.cowbell-part` can remain.
- A failed or timed-out folder pull leaves a partial `P\<name>`. The error message names it.
- Huge folders: sort, then cap at 5000 entries (`truncated`), and show a "Showing the first 5000 items" row.
- Device offline, unauthorized or unplugged mid-browse: adb's stderr text goes into `list_failed` or `pull_failed`, and Refresh recovers. Not tested live: I did not unplug the device.
- A device node line (`crw-rw-rw- 1 root root 1, 3 2022-01-01 08:00 null`) shifts the columns. The date-shape check skips it.

**counterintuitive** (each verified)
1. `adb shell` does not escape its args: the adb client joins argv with spaces and the device `sh -c` parses them again. Verified live by the `Simplr APK` split.
2. `adb pull` must get the **raw** path. Quoting breaks it: `adb: error: failed to stat remote object ''/sdcard/Simplr APK/SIMPLR_SALESSTD_DEBUG.4.2.44.1.apk''`. The raw form pulled 55 MB (live).
3. Listing `/sdcard` without a trailing `/` lists the link, not the folder (live).
4. The pull summary is on stderr, not stdout (live). So `pull_summary` reads both, and the UI progress is an indeterminate bar.
5. Baseline gates already fail outside this task:
   - `cargo fmt --check` fails in `commands.rs` (uncommitted) and `flutter.rs:570,600`.
   - `cargo clippy -D warnings` fails at `flutter.rs:498` (`Iterator::last`) and `:604` (`map_or`).
   - So the gates are scoped. Use `.rev().find()`, not `.last()`: clippy's `double_ended_iterator_last` is active.
6. The new window needs no capability file. `db-inspector` has none, and `build.rs` defines no app ACL manifest, so app commands work in every window.
7. Gate the button with `isAdbDevice(device)` (`appFlutterRun.ts:92`), not `device?.state === "device"`. The mirror gate lets flutter-only entries (Windows, Chrome) through.
8. The `/sdcard` and `/storage` allowlist guards against injection and keeps the scope. It is not a sandbox: the adb shell user can already read these paths.

**rejected alternative**: two commands, one for the dialog that returns a local path and one for the pull. It lost because the webview would then send a local write path back over IPC. `folder_picker.rs:6-11` (finding #13) folds "pick and act" into one Rust command for exactly this reason, and it would also add a command.

**acceptance**
- Baselines, recorded 2026-10-27 before any edit: `cargo test --workspace` all ok (378 lib tests); `npx tsc --noEmit` exit 0; `npx vitest run` 76 files, 953 tests passed; `npx vite build` ok; fmt and clippy fail only as in counterintuitive #5.
- Offline (Git Bash): the overall verify at the end. Expected: Rust lib tests 385 passed (+7); vitest 77 files, 957 tests (+4); `device-explorer.html` present in the build output; the clippy grep prints nothing.
- Live check (the user runs `cd C:/Users/Reinaldo/Backend/herdr/gui && npm run tauri dev` in their own terminal, about 5 min):
  1. Open a Flutter or Android workspace with the phone selected, then click the folder icon after the DB icon. The window `Files — SM A145F` opens on `/sdcard`, folders first.
  2. Click `Download`, then click the save icon on `small.txt`. A save dialog opens in Downloads; save it and check that the status shows `Saved small.txt`.
  3. Save the folder `.nearby` into a folder, then save it into the same folder again. The second save shows the error bar `…\.nearby already exists. Choose another folder`.
  4. Open `/sdcard/Simplr APK` (space in the name). It lists the apk. Up is disabled at `/sdcard`.
  5. Unplug the phone and press Refresh. The error bar shows adb's `device … not found` text, and the old list stays.
- adb-level check, runnable now: `MSYS_NO_PATHCONV=1 "C:/Users/Reinaldo/AppData/Local/Android/sdk/platform-tools/adb.exe" -s RF8W3085JEW shell ls -lAL "'/sdcard/Simplr APK/'"` → `total 54092` + 1 apk line.

**smallest-change check**
- Step 1: the helpers already exist (`adb_output`, `adb_command`, `adb_path`, `trimmed_stderr`, `focus_window`). Making them `pub(crate)` beats copying them.
- Step 2: no existing validator fits (`is_valid_rel_path` rejects spaces and `-`). `shell_failure`, `check_device_id`, `api_error`, `sanitize_device_name` and `main_browser_args` are reused. The window fn is copied (2 uses means inline, per your preferences), not extracted.
- Step 3: registration is required. There are 2 edits.
- Step 4: the typed-wrapper convention (`conventions.md:6`) puts the wrappers in the same file as their sibling commands.
- Step 5: the pure path rule and `parentPath` are needed for the Up button and are testable without a DOM. `formatBytes` is reused from `recordFormat.ts`.
- Step 6: a window needs an html entry and a rollup input. The html is a copy of `db-inspector.html`.
- Step 7: all `db-*` styles are reused through `body class="db-inspector"`. Only 2 tiny classes are new.
- Step 8: the page is new. It follows `dbInspector.ts` (`el`, `button`, error bar, progress bar).
- Steps 9-10: they mirror the existing DB button. `dbDisabled` is reused, and only `explorerTitle` is added.
- Step 11: wiki rules require it.

---

## Steps

### step 1 — expose 5 adb helpers to the crate
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\android_db.rs`
- **edit** (each on the same line, so no line shifts):
  - `fn adb_path() -> Result<PathBuf, ApiError> {` → `pub(crate) fn adb_path() -> Result<PathBuf, ApiError> {`
  - `async fn adb_output(mut cmd: AsyncCommand, timeout: Duration) -> Result<Output, ApiError> {` → `pub(crate) async fn adb_output(mut cmd: AsyncCommand, timeout: Duration) -> Result<Output, ApiError> {`
  - `fn adb_command(adb: &Path, device_id: &str) -> AsyncCommand {` → `pub(crate) fn adb_command(adb: &Path, device_id: &str) -> AsyncCommand {`
  - `fn trimmed_stderr(output: &Output) -> String {` → `pub(crate) fn trimmed_stderr(output: &Output) -> String {`
  - `fn focus_window(app: &tauri::AppHandle, label: &str) -> bool {` → `pub(crate) fn focus_window(app: &tauri::AppHandle, label: &str) -> bool {`
- **lines**: 2 per edit, 10 total.
- **exec**: mechanical. Exact text, visibility only.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && grep -c "^pub(crate) \(async \)\?fn \(adb_path\|adb_output\|adb_command\|trimmed_stderr\|focus_window\)" src/android_db.rs && rustfmt --check --edition 2021 src/android_db.rs`. Expected: `5`, then exit 0.

### step 2 — the backend module
- **files**: new `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**: create it with this text, then run `rustfmt --edition 2021 src/device_explorer.rs` (only this file).
```rust
//! Device explorer: a read-only browser for the shared storage of an adb
//! device (`/sdcard`, `/storage`), and `adb pull` of one file or folder to a
//! place that the user picks in a native dialog. Nothing writes to the device.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::android::check_device_id;
use crate::android_db::{
    adb_command, adb_output, adb_path, focus_window, shell_failure, trimmed_stderr,
};
use crate::commands::ApiError;
use crate::flutter::api_error;
use crate::mirror_tools;

const LIST_TIMEOUT: Duration = Duration::from_secs(30);
// shortcut: one fixed 1 h timeout for every pull and no Cancel; scale it by size or add Cancel if users pull bigger trees.
const PULL_TIMEOUT: Duration = Duration::from_secs(60 * 60);
// shortcut: a folder shows at most 5000 entries, folders first; add paging if users browse bigger folders.
const MAX_ENTRIES: usize = 5000;
const PATH_MAX_BYTES: usize = 4096;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEntry {
    pub name: String,
    pub is_dir: bool,
    /// Bytes. For a folder `ls` prints its block size, so the page shows it for files only.
    pub size: u64,
    /// `YYYY-MM-DD HH:MM` in the device's local time, as `ls -l` prints it.
    pub modified: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub entries: Vec<DeviceEntry>,
    /// True when the folder holds more than `MAX_ENTRIES` entries.
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PulledPath {
    /// The local file, or the local folder that adb made.
    pub path: String,
    /// adb's summary line: `<path>: 1 file pulled, 0 skipped. 36.0 MB/s (...)`.
    pub summary: String,
}

/// An absolute device path under `/sdcard` or `/storage`: no empty, `.` or
/// `..` segment (so no trailing `/`), no control character, at most 4096
/// bytes. Spaces, quotes and a leading `-` in a name pass: `sh_quote` makes
/// them literal, and the path always starts with `/`.
pub fn is_valid_device_path(path: &str) -> bool {
    let mut segments = path.split('/');
    path.len() <= PATH_MAX_BYTES
        && !path.chars().any(char::is_control)
        && segments.next() == Some("")
        && matches!(segments.next(), Some("sdcard" | "storage"))
        && segments.all(|s| !s.is_empty() && s != "." && s != "..")
}

/// `s` in single quotes for the device `sh`. adb joins its arguments with
/// spaces and the device shell parses the result again. Inside single quotes
/// only `'` is special, so each `'` becomes `'\''`.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// `s` has the shape of `pattern`, where `9` is any ASCII digit.
fn shaped(s: &str, pattern: &str) -> bool {
    s.len() == pattern.len()
        && s.bytes()
            .zip(pattern.bytes())
            .all(|(c, p)| if p == b'9' { c.is_ascii_digit() } else { c == p })
}

/// One `ls -lAL` line: mode, links, owner, group, size, date, time, one
/// space, then the name with its own spaces. `None` for any other line
/// (`total`, an `ls:` error, a device node with `major, minor`).
pub fn parse_ls_line(line: &str) -> Option<DeviceEntry> {
    let line = line.strip_suffix('\r').unwrap_or(line);
    let mut fields = [""; 7];
    let mut rest = line;
    for field in &mut fields {
        rest = rest.trim_start_matches(' ');
        let end = rest.find(' ')?;
        *field = &rest[..end];
        rest = &rest[end..];
    }
    let [mode, _, _, _, size, date, time] = fields;
    let mut name = rest.strip_prefix(' ')?;
    if mode.starts_with('l') {
        // -L follows links; a broken one still prints `name -> target`
        name = name.split(" -> ").next().unwrap_or(name);
    }
    let known_mode = mode.len() >= 10
        && matches!(mode.as_bytes()[0], b'-' | b'd' | b'l' | b'c' | b'b' | b'p' | b's');
    if !known_mode
        || !shaped(date, "9999-99-99")
        || !shaped(time, "99:99")
        || name.is_empty()
        || name == "."
        || name == ".."
    {
        return None;
    }
    Some(DeviceEntry {
        name: name.to_string(),
        is_dir: mode.starts_with('d'),
        size: size.parse().ok()?,
        modified: format!("{date} {time}"),
    })
}

/// Entries of a `ls -lAL <dir>/` listing, folders first, then by name
/// (case-insensitive). `None` without a `total` line: the listing failed.
/// Old adb merges stderr into stdout and exits 0, so the exit code cannot tell.
pub fn parse_ls(stdout: &str) -> Option<Vec<DeviceEntry>> {
    if !stdout.lines().any(|l| l.starts_with("total ")) {
        return None;
    }
    let mut entries: Vec<DeviceEntry> = stdout.lines().filter_map(parse_ls_line).collect();
    entries.sort_by_cached_key(|e| (!e.is_dir, e.name.to_lowercase()));
    Some(entries)
}

/// A Windows-safe name for the save dialog: `<>:"/\|?*` and control
/// characters become `_`, and trailing dots and spaces go. Empty gives `download`.
pub fn local_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim_end_matches(|c| c == '.' || c == ' ');
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

/// adb's last non-empty output line. A piped `adb pull` prints no progress,
/// and it writes its summary to stderr.
pub fn pull_summary(stdout: &[u8], stderr: &[u8]) -> String {
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    );
    text.lines()
        .map(str::trim)
        .rev()
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string()
}

/// `<dest>.cowbell-part`: a file pull lands here first, so a failed pull
/// never replaces a file that the user chose to overwrite.
fn part_path(dest: &Path) -> PathBuf {
    let mut os = dest.as_os_str().to_owned();
    os.push(".cowbell-part");
    PathBuf::from(os)
}

fn check_path(path: &str) -> Result<(), ApiError> {
    if is_valid_device_path(path) {
        Ok(())
    } else {
        Err(api_error(
            "bad_device_path",
            format!("Unsafe device path: {path:?}"),
        ))
    }
}

/// Lists a device folder with `adb shell ls -lAL '<path>/'`. The trailing `/`
/// lists the target of a link such as `/sdcard`; `-L` shows linked folders as folders.
#[tauri::command]
pub async fn android_list_dir(device_id: String, path: String) -> Result<DirListing, ApiError> {
    check_device_id(&device_id)?;
    check_path(&path)?;
    let adb = adb_path()?;
    let mut cmd = adb_command(&adb, &device_id);
    cmd.args(["shell", "ls", "-lAL"])
        .arg(sh_quote(&format!("{path}/")));
    // ls exits 1 when one entry cannot be read; the `total` line decides.
    let out = adb_output(cmd, LIST_TIMEOUT).await?;
    let Some(mut entries) = parse_ls(&String::from_utf8_lossy(&out.stdout)) else {
        let text = shell_failure(false, &out.stdout, &out.stderr).unwrap_or_default();
        return Err(api_error("list_failed", text));
    };
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);
    Ok(DirListing { entries, truncated })
}

/// Pulls a device file or folder to a place that the user picks. `Ok(None)`
/// when the user cancels. A file goes through a save dialog; a folder goes
/// into a picked folder as `<picked>\<name>`, never into one that exists (adb
/// would merge into it). The webview never sends a local path.
#[tauri::command]
pub async fn android_pull_path(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    device_id: String,
    path: String,
    is_dir: bool,
) -> Result<Option<PulledPath>, ApiError> {
    check_device_id(&device_id)?;
    check_path(&path)?;
    let adb = adb_path()?;
    let name = path.rsplit('/').next().unwrap_or_default();
    // `C:` or `a:b` would make `join` leave the picked folder.
    if is_dir && local_file_name(name) != name {
        return Err(api_error(
            "bad_local_name",
            format!("{name} is not a valid folder name on this PC"),
        ));
    }
    let mut dialog = app.dialog().file().set_parent(&window);
    if let Ok(dir) = app.path().download_dir() {
        dialog = dialog.set_directory(dir);
    }
    let picked = if is_dir {
        dialog
            .set_title(format!("Choose a folder for {name}"))
            .blocking_pick_folder()
    } else {
        dialog.set_file_name(local_file_name(name)).blocking_save_file()
    };
    let Some(picked) = picked else {
        return Ok(None);
    };
    let picked = picked
        .into_path()
        .map_err(|e| api_error("save_failed", e.to_string()))?;
    let (pull_to, saved) = if is_dir {
        let saved = picked.join(name);
        if saved.exists() {
            return Err(api_error(
                "dest_exists",
                format!("{} already exists. Choose another folder", saved.display()),
            ));
        }
        (picked, saved)
    } else {
        (part_path(&picked), picked)
    };
    let mut cmd = adb_command(&adb, &device_id);
    // The sync protocol takes the device path as is: no device shell, so no quoting.
    cmd.arg("pull").arg(&path).arg(&pull_to);
    let out = match adb_output(cmd, PULL_TIMEOUT).await {
        Ok(out) if out.status.success() => out,
        result => {
            if !is_dir {
                // after a timeout kill Windows can still hold the file, so this may fail
                let _ = std::fs::remove_file(&pull_to);
            }
            let err = match result {
                Ok(out) => {
                    let text = trimmed_stderr(&out);
                    let text = if text.is_empty() { "adb pull failed".to_string() } else { text };
                    api_error("pull_failed", text)
                }
                Err(err) => err,
            };
            if is_dir && saved.exists() {
                return Err(api_error(
                    &err.code,
                    format!("{}. The files copied so far are in {}", err.message, saved.display()),
                ));
            }
            return Err(err);
        }
    };
    if !is_dir {
        if let Err(e) = std::fs::rename(&pull_to, &saved) {
            let _ = std::fs::remove_file(&pull_to);
            return Err(api_error("io_error", e.to_string()));
        }
    }
    Ok(Some(PulledPath {
        path: saved.to_string_lossy().into_owned(),
        summary: pull_summary(&out.stdout, &out.stderr),
    }))
}

/// Opens the device explorer window for `device_id`, or focuses the open one.
/// `async`: building a window from a sync command deadlocks on Windows.
#[tauri::command]
pub async fn android_explorer_window(
    app: tauri::AppHandle,
    device_id: String,
    device_name: Option<String>,
) -> Result<(), ApiError> {
    check_device_id(&device_id)?;
    let label = format!("device-explorer-{}", device_id.replace('.', "_"));
    if focus_window(&app, &label) {
        return Ok(());
    }
    let name = mirror_tools::sanitize_device_name(device_name.as_deref().unwrap_or(""), &device_id);
    let mut url = tauri::Url::parse("http://x/device-explorer.html").expect("static url");
    url.query_pairs_mut()
        .append_pair("device", &device_id)
        .append_pair("name", &name);
    let page = format!("device-explorer.html?{}", url.query().unwrap_or(""));
    let builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(page.into()))
            .title(format!("Files — {name}"))
            .inner_size(900.0, 640.0)
            .min_inner_size(560.0, 360.0)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_paths_stay_under_shared_storage() {
        for ok in [
            "/sdcard",
            "/sdcard/Download",
            "/sdcard/Simplr APK",
            "/sdcard/Download/.nearby/-5034958385594290967",
            "/storage",
            "/storage/emulated/0",
            "/sdcard/it's",
            "/sdcard/$(x);`y`",
            "/sdcard/日本語",
        ] {
            assert!(is_valid_device_path(ok), "{ok}");
        }
        let long = format!("/sdcard/{}", "x".repeat(PATH_MAX_BYTES));
        for bad in [
            "", "/", "sdcard", "/sdcardx", "/sdcard2/x", "/data/local/tmp", "/sdcard/../data",
            "/sdcard/x/..", "/sdcard/./x", "/sdcard/", "/sdcard//x", "/sdcard/a\nb",
            "/sdcard/a\u{7f}b", "/sdcard/a\0b", long.as_str(),
        ] {
            assert!(!is_valid_device_path(bad), "{bad:?}");
        }
    }

    #[test]
    fn sh_quote_makes_every_char_literal() {
        assert_eq!(sh_quote("/sdcard/Simplr APK/"), "'/sdcard/Simplr APK/'");
        assert_eq!(sh_quote("/sdcard/it's/"), r"'/sdcard/it'\''s/'");
        assert_eq!(
            sh_quote("/sdcard/$(rm -rf x);`id`|&>\"\\*"),
            "'/sdcard/$(rm -rf x);`id`|&>\"\\*'"
        );
        assert_eq!(sh_quote("/sdcard/日本語"), "'/sdcard/日本語'");
    }

    #[test]
    fn parse_ls_reads_toybox_lines_and_sorts_folders_first() {
        let out = "\
total 420865
drwxrws--- 2 u0_a207  media_rw      3452 2023-04-25 17:13 Alarms
drwxrws--- 2 u0_a207  media_rw      3452 2025-08-07 14:31 Simplr APK
-rw-rw---- 1 u0_a207  media_rw  36286255 2025-08-28 14:00 Simplr SALES V.6.1.2.12.19.apk
drwxrws--- 2 u0_a207 media_rw     3452 2025-06-10 15:26 .nearby
-rw-rw---- 1 u0_a207 media_rw  1838042 2025-06-10 15:26 -5034958385594290967
-rw-rw---- 1 u0_a207 media_rw       73 2026-10-26 18:55  a  b.txt\r
drwxrwx---  2 media_rw media_rw 3452 2023-04-25 17:11 obb
lrwxrwxrwx 1 root root 19 2026-07-15 11:54 primary -> /storage/emulated/0
ls: /sdcard/x: Permission denied
crw-rw-rw- 1 root root 1, 3 2022-01-01 08:00 null
";
        let entries = parse_ls(out).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            [
                ".nearby", "Alarms", "obb", "Simplr APK", " a  b.txt",
                "-5034958385594290967", "primary", "Simplr SALES V.6.1.2.12.19.apk",
            ]
        );
        assert_eq!(
            entries[1],
            DeviceEntry {
                name: "Alarms".into(),
                is_dir: true,
                size: 3452,
                modified: "2023-04-25 17:13".into()
            }
        );
        let apk = entries.iter().find(|e| e.name.ends_with(".apk")).unwrap();
        assert_eq!((apk.is_dir, apk.size), (false, 36_286_255));
    }

    #[test]
    fn parse_ls_needs_a_total_line() {
        assert_eq!(parse_ls("total 0\n"), Some(vec![]));
        assert_eq!(parse_ls("ls: /sdcard/nope/: No such file or directory\n"), None);
        assert_eq!(parse_ls(""), None);
    }

    #[test]
    fn local_file_names_are_windows_safe() {
        assert_eq!(local_file_name("Simplr APK.apk"), "Simplr APK.apk");
        assert_eq!(local_file_name("a:b?c*.txt"), "a_b_c_.txt");
        assert_eq!(local_file_name("x. "), "x");
        assert_eq!(local_file_name("..."), "download");
        assert_ne!(local_file_name("C:"), "C:");
    }

    #[test]
    fn pull_summary_is_the_last_output_line() {
        let stderr = b"/sdcard/x.apk: 1 file pulled, 0 skipped. 36.0 MB/s (74479389 bytes in 1.975s)\r\n";
        assert_eq!(
            pull_summary(b"", stderr),
            "/sdcard/x.apk: 1 file pulled, 0 skipped. 36.0 MB/s (74479389 bytes in 1.975s)"
        );
        assert_eq!(pull_summary(b"", b""), "");
    }

    #[tokio::test]
    async fn list_rejects_unsafe_input_before_adb() {
        let err = android_list_dir("x; rm".into(), "/sdcard".into()).await.unwrap_err();
        assert_eq!(err.code, "bad_device_id");
        for path in ["/data", "/sdcard/../data", "/sdcard/a\nb"] {
            let err = android_list_dir("RF8W3085JEW".into(), path.into())
                .await
                .unwrap_err();
            assert_eq!(err.code, "bad_device_path", "{path:?}");
        }
    }
}
```
- **lines**: about 390 added.
- **exec**: judgment. It is a new file, and the executor must fix any compile or clippy detail. The text is a complete reference.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && rustfmt --check --edition 2021 src/device_explorer.rs`. Expected: exit 0, no output. It compiles in step 3.

### step 3 — register the module and the 3 commands
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\lib.rs`
- **edit**:
  - `pub mod conn;\npub mod dispatch;` → `pub mod conn;\npub mod device_explorer;\npub mod dispatch;`
  - `            android_db::android_push_database,` → `            android_db::android_push_database,\n            device_explorer::android_explorer_window,\n            device_explorer::android_list_dir,\n            device_explorer::android_pull_path,`
  - Hand-format these lines. Do not run rustfmt on `lib.rs`: it follows `mod` children into `commands.rs`.
- **lines**: 1 + 3 = 4.
- **exec**: mechanical. Exact anchors.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test device_explorer 2>&1 | grep "test result"`. Expected: `test result: ok. 7 passed; 0 failed` (other test binaries 0 run).

### step 4 — typed wrappers
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\flutter\flutterApi.ts`
- **edit**: old `export function androidPushDatabase(deviceId: string, packageName: string, dbPath: string): Promise<PushedDatabase> {\n  return invoke<PushedDatabase>("android_push_database", { deviceId, packageName, dbPath });\n}` → the same 3 lines, followed by:
```ts

/** Opens the device explorer window for an adb device, or focuses the open one. */
export function androidExplorerWindow(deviceId: string, deviceName?: string): Promise<void> {
  return invoke<void>("android_explorer_window", { deviceId, deviceName });
}

export interface DeviceEntry {
  name: string;
  isDir: boolean;
  /** Bytes. Files only: for a folder `ls` prints its block size. */
  size: number;
  /** `YYYY-MM-DD HH:MM` in the device's local time. */
  modified: string;
}

export interface DirListing {
  /** Folders first, then by name. */
  entries: DeviceEntry[];
  /** The folder holds more entries than the backend sends (5000). */
  truncated: boolean;
}

/** `ls -lAL` of a folder under `/sdcard` or `/storage`. Rejects `bad_device_path` and `list_failed`. */
export function androidListDir(deviceId: string, path: string): Promise<DirListing> {
  return invoke<DirListing>("android_list_dir", { deviceId, path });
}

export interface PulledPath {
  /** The local file, or the local folder that adb made. */
  path: string;
  /** adb's summary line, for a tooltip. */
  summary: string;
}

/** A save dialog (file) or folder picker (folder), then `adb pull`. Resolves `null` when cancelled. Rejects `dest_exists`, `bad_local_name`, `pull_failed`, `adb_timeout`. */
export function androidPullPath(deviceId: string, path: string, isDir: boolean): Promise<PulledPath | null> {
  return invoke<PulledPath | null>("android_pull_path", { deviceId, path, isDir });
}
```
- **lines**: about 37 added.
- **exec**: mechanical. Exact anchor and text.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit`. Expected: exit 0.

### step 5 — pure path helpers and their tests
- **files**: new `C:\Users\Reinaldo\Backend\herdr\gui\src\android\deviceFiles.ts`, new `C:\Users\Reinaldo\Backend\herdr\gui\tests\unit\deviceFiles.test.ts`
- **edit**: `deviceFiles.ts`:
```ts
// Pure helpers for the device explorer page (`deviceExplorer.ts`). No DOM, no Tauri.
// The path rule is the same as `is_valid_device_path` in `src-tauri/src/device_explorer.rs`.

export const SDCARD_PATH = "/sdcard";
export const DOWNLOAD_PATH = "/sdcard/Download";

const PATH_MAX_BYTES = 4096;

/** An absolute device path under `/sdcard` or `/storage`: no empty, `.` or `..` segment, no control character, at most 4096 bytes. */
export function isValidDevicePath(path: string): boolean {
  if (new TextEncoder().encode(path).length > PATH_MAX_BYTES || /[\u0000-\u001f\u007f-\u009f]/.test(path)) return false;
  const [first, root, ...rest] = path.split("/");
  return first === "" && (root === "sdcard" || root === "storage") && rest.every((s) => s !== "" && s !== "." && s !== "..");
}

/** The parent folder, or `null` at `/sdcard` and `/storage`: their parent `/` is out of bounds. */
export function parentPath(path: string): string | null {
  const parent = path.slice(0, path.lastIndexOf("/"));
  return isValidDevicePath(parent) ? parent : null;
}
```
`deviceFiles.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { isValidDevicePath, parentPath } from "../../src/android/deviceFiles";

describe("isValidDevicePath", () => {
  it("accepts shared storage paths with spaces, quotes and dashes", () => {
    for (const ok of ["/sdcard", "/sdcard/Download", "/sdcard/Simplr APK", "/sdcard/Download/.nearby/-5034958385594290967", "/storage/emulated/0", "/sdcard/it's", "/sdcard/日本語"])
      expect(isValidDevicePath(ok), ok).toBe(true);
  });
  it("rejects other roots, escapes, empty segments and control characters", () => {
    for (const bad of ["", "/", "sdcard", "/sdcardx", "/data/local/tmp", "/sdcard/../data", "/sdcard/./x", "/sdcard/", "/sdcard//x", "/sdcard/a\nb", "/sdcard/a\u007fb", "/sdcard/" + "x".repeat(4096)])
      expect(isValidDevicePath(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe("parentPath", () => {
  it("goes up one folder", () => {
    expect(parentPath("/sdcard/Download")).toBe("/sdcard");
    expect(parentPath("/storage/emulated/0")).toBe("/storage/emulated");
  });
  it("stops at the roots", () => {
    expect(parentPath("/sdcard")).toBeNull();
    expect(parentPath("/storage")).toBeNull();
  });
});
```
- **lines**: about 22 + 24 = 46 added.
- **exec**: judgment. New files.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx vitest run tests/unit/deviceFiles.test.ts`. Expected: `Tests 4 passed (4)`.

### step 6 — window entry page and build input
- **files**: new `C:\Users\Reinaldo\Backend\herdr\gui\device-explorer.html`; `C:\Users\Reinaldo\Backend\herdr\gui\vite.config.ts`
- **edit**: `device-explorer.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Cowbell Files</title>
  </head>
  <body class="db-inspector">
    <div id="fx-root" class="db-root"></div>
    <script type="module" src="/src/deviceExplorer.ts"></script>
  </body>
</html>
```
`vite.config.ts`:
  - `  // 4. Three pages: the app, the mirror tools window (docs/mirror-toolbar-spec.md)\n  // and the SQLite inspector window (src/dbInspector.ts).` → `  // 4. Four pages: the app, the mirror tools window (docs/mirror-toolbar-spec.md),\n  // the SQLite inspector window (src/dbInspector.ts) and the device explorer window (src/deviceExplorer.ts).`
  - `        dbInspector: fileURLToPath(new URL("./db-inspector.html", import.meta.url)),` → the same line + `\n        deviceExplorer: fileURLToPath(new URL("./device-explorer.html", import.meta.url)),`
- **lines**: 11 (html) + 4 + 1 = 16.
- **exec**: judgment. It has a new file, although the text is exact.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && grep -c "device-explorer.html" vite.config.ts device-explorer.html`. Expected: `vite.config.ts:1`, `device-explorer.html:0`. The build itself is checked in the overall verify, after step 8.

### step 7 — two small style classes
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\style.css`
- **edit**:
  - `/* SQLite inspector window (src/dbInspector.ts). */` → `/* SQLite inspector window (src/dbInspector.ts). The device explorer (src/deviceExplorer.ts) uses these classes too. */`
  - `.db-grid::-webkit-scrollbar-corner {\n  background: transparent;\n}` → the same 3 lines, followed by:
```css

/* Device explorer: the current folder in the toolbar, and file rows (only folder rows are buttons). */
.fx-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
}

.fx-file {
  cursor: default;
}
```
- **lines**: 2 + 13 = 15.
- **exec**: mechanical. Exact anchors.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && grep -c "^\.fx-path {\|^\.fx-file {" src/style.css`. Expected: `2`.

### step 8 — the explorer page
- **files**: new `C:\Users\Reinaldo\Backend\herdr\gui\src\deviceExplorer.ts`
- **edit**: create it. The reference below follows `dbInspector.ts`.
```ts
// The device explorer page: browse the shared storage of an adb device
// (`/sdcard`, `/storage`) and save a file or folder to this PC. Nothing
// writes to the device. Errors show inline (`#error-notices` does not exist
// on this page). Every name comes from the device, so the page sets text
// with `textContent` and never uses `innerHTML`.

import "./style.css";
import { DOWNLOAD_PATH, SDCARD_PATH, parentPath } from "./android/deviceFiles";
import { parseMirrorToolsParams } from "./android/mirrorToolsParams";
import { formatBytes } from "./android/recordFormat";
import { errorMessage } from "./appApi";
import { androidListDir, androidPullPath, type DeviceEntry } from "./flutter/flutterApi";
import { applySavedTheme } from "./themes/savedTheme";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, icon?: string): HTMLButtonElement {
  const btn = el("button", className);
  btn.type = "button";
  if (icon) btn.append(el("i", `codicon codicon-${icon}`));
  if (text) btn.append(el("span", undefined, text));
  return btn;
}

async function main(): Promise<void> {
  const root = document.getElementById("fx-root");
  if (!root) return;
  const params = parseMirrorToolsParams(location.search);
  if (!params) {
    root.textContent = "Invalid explorer parameters";
    return;
  }
  const id = params.deviceId;
  await applySavedTheme();
  document.title = "Files — " + params.deviceName;

  let path = SDCARD_PATH;
  let entries: DeviceEntry[] = [];
  let truncated = false;
  let loaded = false;
  // Two flags: a long pull must not lock browsing.
  let listing = false;
  let pulling = false;

  const upBtn = button("icon-btn db-page-btn", "", "arrow-up");
  upBtn.title = "Up one folder";
  upBtn.setAttribute("aria-label", "Up one folder");
  const sdcardBtn = button("btn db-btn", "SD card", "device-mobile");
  sdcardBtn.title = SDCARD_PATH;
  const downloadBtn = button("btn db-btn", "Download", "folder");
  downloadBtn.title = DOWNLOAD_PATH;
  const refreshBtn = button("btn db-btn", "Refresh", "refresh");
  refreshBtn.title = "List the folder again";
  const pathText = el("span", "fx-path");
  const status = el("span", "db-status");
  status.setAttribute("aria-live", "polite");
  const progress = el("div", "db-progress");
  progress.setAttribute("aria-hidden", "true");
  const bar = el("div", "db-bar");
  bar.append(upBtn, sdcardBtn, downloadBtn, refreshBtn, pathText, status, progress);

  const errorText = el("span", "db-error__text");
  const errorBar = el("div", "db-error");
  errorBar.setAttribute("role", "alert");
  errorBar.append(el("i", "codicon codicon-error"), errorText);
  errorBar.hidden = true;

  const table = el("table", "db-result");
  const emptyText = el("p", "db-empty");
  const grid = el("div", "db-grid");
  grid.append(table, emptyText);
  root.append(bar, errorBar, grid);

  function showError(text: string): void {
    errorText.textContent = text;
    errorBar.hidden = false;
  }

  function renderControls(): void {
    upBtn.disabled = listing || parentPath(path) === null;
    sdcardBtn.disabled = downloadBtn.disabled = refreshBtn.disabled = listing;
    pathText.textContent = path;
    pathText.title = path;
    progress.classList.toggle("is-busy", listing || pulling);
    for (const btn of Array.from(table.querySelectorAll<HTMLButtonElement>("button[data-open]"))) btn.disabled = listing;
    for (const btn of Array.from(table.querySelectorAll<HTMLButtonElement>("button[data-save]"))) btn.disabled = pulling;
    const empty = !loaded ? (listing ? "Loading…" : "") : entries.length === 0 ? "This folder is empty" : "";
    emptyText.textContent = empty;
    emptyText.hidden = empty === "";
  }

  function renderList(): void {
    table.replaceChildren();
    if (entries.length === 0) return;
    const head = el("tr");
    head.append(el("th", undefined, "Name"), el("th", "db-num", "Size"), el("th", undefined, "Modified"), el("th"));
    const thead = el("thead");
    thead.append(head);
    const body = el("tbody");
    for (const entry of entries) {
      const nameCell = el("td");
      nameCell.title = entry.name;
      if (entry.isDir) {
        const open = button("db-table", entry.name, "folder");
        open.dataset.open = "";
        open.addEventListener("click", () => void list(`${path}/${entry.name}`));
        nameCell.append(open);
      } else {
        const file = el("div", "db-table fx-file");
        file.append(el("i", "codicon codicon-file"), el("span", undefined, entry.name));
        nameCell.append(file);
      }
      const size = el("td", "db-num", entry.isDir ? "" : formatBytes(entry.size));
      if (!entry.isDir) size.title = `${entry.size} bytes`;
      const save = button("icon-btn db-page-btn", "", "cloud-download");
      save.dataset.save = "";
      save.title = `Save ${entry.name} to this PC`;
      save.setAttribute("aria-label", save.title);
      save.addEventListener("click", () => void pull(entry));
      const saveCell = el("td");
      saveCell.append(save);
      const tr = el("tr");
      tr.append(nameCell, size, el("td", undefined, entry.modified), saveCell);
      body.append(tr);
    }
    if (truncated) {
      const td = el("td", "db-null", `Showing the first ${entries.length} items`);
      td.colSpan = 4;
      const tr = el("tr");
      tr.append(td);
      body.append(tr);
    }
    table.append(thead, body);
  }

  /** Lists `target`. The page moves there only when the listing works. */
  async function list(target: string): Promise<void> {
    if (listing) return;
    listing = true;
    renderControls();
    try {
      const result = await androidListDir(id, target);
      if (target !== path) grid.scrollTop = 0;
      path = target;
      entries = result.entries;
      truncated = result.truncated;
      loaded = true;
      errorBar.hidden = true;
      renderList();
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      listing = false;
      renderControls();
    }
  }

  /** A save dialog or folder picker, then `adb pull`. One pull at a time. */
  async function pull(entry: DeviceEntry): Promise<void> {
    if (pulling) return;
    pulling = true;
    errorBar.hidden = true;
    status.textContent = `Saving ${entry.name}…`;
    status.title = "";
    renderControls();
    try {
      const saved = await androidPullPath(id, `${path}/${entry.name}`, entry.isDir);
      status.textContent = saved ? `Saved ${entry.name}` : "";
      status.title = saved ? `${saved.path}\n${saved.summary}` : "";
    } catch (err) {
      status.textContent = "";
      showError(errorMessage(err));
    } finally {
      pulling = false;
      renderControls();
    }
  }

  upBtn.addEventListener("click", () => {
    const up = parentPath(path);
    if (up) void list(up);
  });
  sdcardBtn.addEventListener("click", () => void list(SDCARD_PATH));
  downloadBtn.addEventListener("click", () => void list(DOWNLOAD_PATH));
  refreshBtn.addEventListener("click", () => void list(path));

  renderControls();
  void list(SDCARD_PATH);
}

void main();
```
- **lines**: about 190 added.
- **exec**: judgment. It is a new file with DOM wiring, and the executor may adjust layout details.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && grep -c "innerHTML" src/deviceExplorer.ts`. Expected: tsc exit 0, then `0`.

### step 9 — the toolbar button
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\ui\runToolbar.ts`
- **edit**:
  - `  /** The SQLite inspector button. Disabled unless the device is an adb device in state "device". */\n  dbDisabled: boolean;\n  dbTitle: string;` → `  /** The SQLite inspector and Explorer buttons. Disabled unless the device is an adb device in state "device". */\n  dbDisabled: boolean;\n  dbTitle: string;\n  explorerTitle: string;`
  - `  onDatabase: () => void;` → `  onDatabase: () => void;\n  onExplorer: () => void;`
  - `  const db = makeButton("run-btn--db", "database", "Inspect SQLite databases", handlers.onDatabase);` → that line + `\n  const explorer = makeButton("run-btn--explorer", "folder-opened", "Browse device files", handlers.onExplorer);`
  - `  root.append(deviceBtn, flavorBtn, mirror, db, play, reload, restart, stop);` → `  root.append(deviceBtn, flavorBtn, mirror, db, explorer, play, reload, restart, stop);`
  - `      db.title = view.dbTitle;` → `      db.title = view.dbTitle;\n      explorer.disabled = view.dbDisabled;\n      explorer.title = view.explorerTitle;`
- **lines**: 4 + 3 + 3 + 2 + 3 = 15.
- **exec**: mechanical. Exact anchors. tsc fails until step 10, as expected.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && grep -c "explorer" src/ui/runToolbar.ts`. Expected: `7`.

### step 10 — wire the button
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\appFlutterRun.ts`
- **edit**:
  - `  androidDevices,\n  androidInstallApk,` → `  androidDevices,\n  androidExplorerWindow,\n  androidInstallApk,`
  - `  onDatabase: () => void openDbInspector(),` → that line + `\n  onExplorer: () => void openExplorer(),`
  - `      dbTitle: "",` → `      dbTitle: "",\n      explorerTitle: "",`
  - ``    dbTitle: `Inspect SQLite databases on ${device?.name ?? "the device"}`,`` → that line + ``\n    explorerTitle: `Browse files on ${device?.name ?? "the device"}`,``
  - `/** Installs dropped APKs on the selected device, one after the other. */` → insert this block before it:
```ts
/** Opens (or focuses) the device explorer window for the selected adb device. */
async function openExplorer(): Promise<void> {
  const device = selectedDevice();
  if (!isAdbDevice(device)) return;
  // Settings are editable on disk; the backend checks this id again.
  if (!isValidDeviceId(device.id)) {
    showErrorNotice(`Unsafe device id: ${device.id}`);
    return;
  }
  try {
    await androidExplorerWindow(device.id, device.name);
  } catch (err) {
    showErrorNotice(errorMessage(err));
  }
}

```
- **lines**: 1 + 1 + 1 + 1 + 16 = 20.
- **exec**: mechanical. Exact anchors. Each anchor occurs once.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit`. Expected: exit 0.

### step 11 — llm_wiki
- **files**: everything under `C:\Users\Reinaldo\Backend\herdr\gui\llm_wiki\` that is listed in deliverables.
- **edit**:
  - New `areas/device-explorer.md` in the style of `areas/sqlite-inspector.md`. Sections: Purpose; Key files (with fresh `grep -n` line numbers for the 3 commands); Limits; Edges.
    - Limits: the `sh_quote` rule; pull is unquoted; the `total` rule; list 30 s and pull 1 h; at most 5000 entries; `.cowbell-part`; `dest_exists`.
    - Edges: toybox `ls` only (Android 6+); closing the window does not stop a pull; the Rust tests and `tests/unit/deviceFiles.test.ts`.
  - `map.md`: after the SQLite row, add `| Device explorer: browse an Android device's /sdcard, save files to the PC | [[device-explorer]] |`.
  - `code_map.md`: after row 16, add ``| `src/deviceExplorer.ts`, `device-explorer.html`, `src/android/deviceFiles.ts`, `src-tauri/src/device_explorer.rs` | device explorer | [[device-explorer]] |``.
  - `index.md`: add `[[device-explorer]]` to the feature rooms.
  - `shortcut-markers.md`: add 2 rows for `device_explorer.rs` (`PULL_TIMEOUT`: one 1 h timeout, no Cancel, so scale by size or add Cancel; `MAX_ENTRIES`: 5000 entries per folder, so add paging). Change `19 markers` to `21 markers`.
  - `CHANGELOG.md`: a new top entry `## 2026-10-27 - device explorer`, with lines for the new room, the map, index, code_map and marker rows, and the moved line refs.
  - `areas/flutter-android.md:10`: name the Explorer button and link `[[device-explorer]]`.
  - Line refs: re-grep every hit and change it to the fresh number. The expected new values are:
    - `lib.rs:46→47`, `:83→84`, `:18-22→19-23`, `:3-26→3-27`, `:177→181`, `:255→259`; the usage loop `line 270→274` and `line 266→270`.
    - `vite.config.ts:14-21` → new range.
    - `createRunToolbar (line 61)` and `wireFlutterRun (line 618)` → fresh numbers.
    - The `android_db.rs` refs stay valid only because step 1 kept each edit on its line.
  - Use STE prose: short active sentences, and identifiers verbatim.
- **lines**: about 45.
- **exec**: judgment. It needs fresh line numbers and prose.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && grep -rn "lib\.rs:[0-9]\|vite\.config\.ts:[0-9]\|(line [0-9]" llm_wiki && grep -c "device-explorer" llm_wiki/map.md llm_wiki/code_map.md llm_wiki/index.md`. Expected: every listed ref matches a fresh `grep -n` of the cited file, and each count is ≥ 1.

---

## Open questions (each has a default; the spec builds on the default)
1. "Shown only when a device is connected" vs. "the same gating those buttons use". The DB button is **disabled**, not hidden, when `!isAdbDevice`. Default: disabled, like DB.
2. A physical SD card lives at `/storage/XXXX-XXXX`. Up stops at `/sdcard` because `/` is invalid, so `/storage` is reachable from the UI only through folders. Default: no `/storage` quick link, because scope is locked. If you want a removable card, one more button with `list("/storage")` does it.
3. Pull timeout: default 1 h, fixed, with no Cancel. Should it be longer, or have a Cancel?
4. Closing the explorer window mid-pull does not stop the pull: the command future is not tied to the window. The file still lands, but no UI reports it. Default: accept this.
5. Progress is an indeterminate bar plus adb's final summary in the status tooltip. Piped adb prints no percentages (live), and streaming would need a new capability file. Default: accept this.
6. `reveal_in_folder` accepts only Cowbell recordings (`record.rs:883-907`), and `open_local_path` uses an extension allowlist. So there is no reveal; the saved path is in the status tooltip.

## Overall verify (Git Bash)
```bash
cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri \
 && rustfmt --check --edition 2021 src/device_explorer.rs src/android_db.rs \
 && cargo test --workspace 2>&1 | grep -E "^test result|FAILED" \
 && ! cargo clippy --workspace -- -D warnings 2>&1 | grep -E "device_explorer\.rs|android_db\.rs|lib\.rs" \
 && cd .. && npx tsc --noEmit && npx vitest run 2>&1 | grep -E "Test Files|Tests " \
 && npx vite build --outDir "$TEMP/cowbell-vite-check" --emptyOutDir >/dev/null && ls "$TEMP/cowbell-vite-check/device-explorer.html"
```
Expected:
- rustfmt is silent.
- All `test result: ok`, with the lib count at 385 and no `FAILED`.
- The clippy grep prints nothing. Clippy itself still fails on the 2 existing `flutter.rs` lints.
- tsc exit 0.
- `Test Files 77 passed`, `Tests 957 passed`.
- The `device-explorer.html` path is printed.

The live check is the 5-step list under acceptance (user-run `npm run tauri dev`).

---
Skipped:
- Clickable breadcrumb segments: Up plus the path text cover "breadcrumb/up".
- Byte-level progress, Cancel, reveal-in-folder.
- A device-state error-code mapping: adb's own text reaches the error bar.

Not verified:
- Non-ASCII device paths through the Windows argv to adb.exe: it needs a test file written on the phone.
- The error text after a device unplug mid-browse.
- Android 5 and older (toolbox `ls`). Those devices would see `list_failed`.
