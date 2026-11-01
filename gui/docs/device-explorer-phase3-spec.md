# Spec: Device explorer phase 3 (tree, app data, device root, drop to upload)

## Header

**goal**: The explorer window shows a lazy folder tree with three roots: Shared storage `/sdcard` (read and write), App data (debug builds, read-only through `run-as`) and Device root `/` (read-only). The right pane lists the selected folder, with name, size, modified, permissions, save and delete. A folder that Android refuses shows a lock and the reason. You can drop PC files or folders on the pane to push them into a writable folder.

**verify commands** (Git Bash, crate `herdr-gui`):
- `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib`
- `cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit`
- `cd C:/Users/Reinaldo/Backend/herdr/gui && npx vitest run`
- `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo clippy -p herdr-gui -- -D warnings`. Clippy already fails outside this work, so grep its output for the touched files only.
- Baselines, run today:
  - Rust lib: 411 tests, 14 of them in `device_explorer`.
  - vitest: 77 files, 974 tests (`deviceFiles.test.ts` has 7).
  - `rustfmt --check --edition 2021 src/device_explorer.rs src/android_db.rs` exits 0.
  - Every touched file uses LF line endings (python byte check).

**deliverables**
- Edit:
  - `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\android_db.rs`: 1 line, visibility only.
  - `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
  - `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\lib.rs`: 2 lines, by hand only.
  - `C:\Users\Reinaldo\Backend\herdr\gui\src\flutter\flutterApi.ts`
  - `C:\Users\Reinaldo\Backend\herdr\gui\src\android\deviceFiles.ts`
  - `C:\Users\Reinaldo\Backend\herdr\gui\src\style.css`
  - `C:\Users\Reinaldo\Backend\herdr\gui\src\deviceExplorer.ts`: full rewrite.
  - `C:\Users\Reinaldo\Backend\herdr\gui\tests\unit\deviceFiles.test.ts`
- New:
  - `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\capabilities\device-explorer.json`
- Wiki (step 14):
  - `llm_wiki/areas/device-explorer.md`
  - `map.md`
  - `code_map.md`
  - `shortcut-markers.md`
  - `CHANGELOG.md`
  - `areas/sqlite-inspector.md`
  - `areas/usage-statusline.md`
  - `doc-mismatches.md`
  - `index.md` needs no change: `[[device-explorer]]` is already listed.
- Must stay untouched:
  - Your uncommitted work: `src-tauri/src/commands.rs`, `src/appTerminalMouse.ts`, `src/links.ts`, `tests/unit/links.test.ts`.
  - Uncommitted changes I must not mix into: `capabilities/mirror-tools.json`. `device-explorer.html`, `vite.config.ts` and `flutter.rs` (its lints are pre-existing) also need no change.
- Never run `cargo fmt`, never run rustfmt on `lib.rs`, never run `npm run check`. Do not commit.

**contracts** (`ApiError {code, message}` is in `commands.rs:182-186`. Tauri maps snake_case arguments to camelCase. An omitted `Option<String>` argument arrives as `None`.)

| Rust command (`device_explorer.rs`) | TS wrapper (`flutterApi.ts`) | Ok | Error codes |
|---|---|---|---|
| `android_list_dir(device_id, path, package_name: Option<String>)` (changed) | `androidListDir(deviceId, path, packageName?)` | `DirListing`. Each `DeviceEntry` now has `mode: String`. | `bad_device_id`, `bad_device_path`, `adb_not_found`, `adb_failed`, `adb_timeout` (30 s), **`permission_denied`** (new; the message is adb's text), `list_failed` |
| `android_pull_path(app, window, device_id, path, is_dir, package_name: Option<String>)` (changed) | `androidPullPath(deviceId, path, isDir, packageName?)` | `Option<PulledPath>` | existing, plus **`not_pullable`**, **`too_many_items`**, `pull_timeout` (120 s per app file, from `android_db::PULL_TIMEOUT`), `permission_denied`/`list_failed` (app listing), `dest_exists` (two names collide on the PC) |
| `android_debuggable_apps(device_id)` (new) | `androidDebuggableApps(deviceId): Promise<string[]>` | `Vec<String>`, sorted | `bad_device_id`, `adb_not_found`, `adb_failed`, `adb_timeout` (30 s), `list_failed` (stderr text when no package came back) |
| `android_push_dropped(device_id, dir, paths: Vec<String>)` (new) | `androidPushDropped(deviceId, dir, paths): Promise<PushedPaths>` | `PushedPaths` | `bad_device_id`, `bad_device_path`, `bad_local_name`, `adb_not_found`, `list_failed`, `permission_denied`, `dest_exists`, `push_failed`, `adb_failed`, `adb_timeout` (1 h) |
| `android_push_paths`, `android_delete_path` | signatures unchanged | — | — |

- Device argv:
  - List: `adb -s <id> shell [run-as <pkg>] ls -lAL <sh_quote(path.trim_end_matches('/') + "/")>`. Root `/` stays `/`. The quoted path is one argv element. `<pkg>` is unquoted, and `is_valid_package` (`android_db.rs:61`) guards it.
  - Debuggable apps: `adb -s <id> shell <DEBUGGABLE_APPS>`. This is one fixed argv element, and no data from the PC is in it.
  - App file: `adb -s <id> exec-out run-as <pkg> cat <raw absolute path>`, through the existing `android_db::pull_file` (`android_db.rs:479`). The path is **raw**, not `sh_quote`d (see counterintuitive #1).
  - Drop: `adb -s <id> push --sync <abs local…> <dir>/`, through `push_args`.
- Path rules:
  - `is_readable_device_path` (list and pull): `/` alone, or `/`-separated segments that are not empty, `.` or `..`; no control characters; at most 4096 bytes.
  - `is_valid_device_path` (push and delete, unchanged meaning): readable, and the first segment is `sdcard` or `storage`.
  - `is_app_path(pkg, path)`: `is_valid_package(pkg)`, readable, and `path == /data/data/<pkg>` or starts with `/data/data/<pkg>/`.
  - `is_deletable_path`: unchanged.
- Window events: `getCurrentWebview().onDragDropEvent` listens to `tauri://drag-enter|over|drop|leave`. It needs `core:event:allow-listen` for windows `device-explorer-*`; the new capability file grants it. Positions are physical px relative to the webview (`dragDropFiles.ts:37-39`).

**edge cases** (live, each with its device tag)
- `ls -lAL '/'` prints items that it cannot stat as `d?????????   ? ?        ?             ?                ? data_mirror` and `l?????????   ? ? … ? init -> ?` **[A15][X16]**.
  - That is 6 tokens before the name, not 7, so today's `parse_ls_line` drops them.
  - [A15] has `data_mirror`, `init`, `linkerconfig`, `metadata`, `postinstall`, `system_dlkm`. [X16] also has `cache ->`, `init.environ.rc`.
  - Fix: `parse_unstat_line`. The UI shows a lock for any `?` in `mode`.
- A refused folder: `ls -lAL '/data/'` gives `ls: /data/: Permission denied` on stderr, exit 1, no `total` line **[A15][X16]**.
  - The same happens for `/data/local/` **[A15][X16]**, `/data_mirror/` **[A15][X16]** and `/cache/` **[X16]**.
  - Fix: `list_error` maps "Permission denied" to `permission_denied`, so the folder is never shown as empty.
- `/data/local/tmp/` lists **[A15][X16]**, but it is only reachable through `/data` and `/data/local`, which are both refused. See D12.
- `ls -lAL '//'` equals `ls -lAL '/'` **[A15][X16]**. The code still trims to `/`, for clean error text.
- `/d/` gives `total 0` (empty) **[X16]**. `/proc/1/` lists **[X16]**.
- `run-as <pkg> ls -lAL '/data/data/<pkg>/'` lists `app_flutter`, `cache`, `code_cache`, `databases`, `files`, `no_backup`, `shared_prefs` **[A15][X16]**.
  - `run-as <pkg> ls -lAL '/data/data/'` gives `Permission denied` **[A15]**.
- Release app: `run-as com.waze …` gives `run-as: package not debuggable: com.waze`, exit 1 **[A15]**. `run-as com.whatsapp …` gives the same **[X16]**.
- Unknown package: `run-as: unknown package: com.nope.nope` **[X16]**.
- The debuggable-apps loop, as one `adb shell` argument:
  - **[A15]**: 34 packages, 12 debuggable, 2.5 s, exit 1, `\r\n` line ends. Verified with the unquoted `$p` form.
  - **[X16]**: 157 packages, 1 debuggable (`com.simplr.rad.dev`), 2.4 s.
- `exec-out run-as com.simplr.rad.dev cat /data/data/…/databases/com.google.android.datatransport.events` gives 57344 bytes. The sha1 is `63609a20…`, equal to the device's `sha1sum` **[A15]**. `da01c8a1…` matches on **[X16]**.
- `adb shell run-as … cat` of the same file gives 57360 bytes and a wrong sha1, with or without `-T` and with stdin null **[X16]**. LF becomes CRLF.
- `exec-out` writes errors into the data stream and exits 0 **[A15]**:
  - `cat: /data/data/com.simplr.rad.dev/no pe: No such file or directory`
  - `run-as: package not debuggable: com.waze`
  - `cat: …/files: Is a directory`
- 0-byte files exist (`*-journal`) **[A15]**. The size check handles them: 0 listed, 0 copied.
- `databases/*-journal` and `-wal` change size while the app runs, so a folder pull of a running app can fail the size check. Not run live. See D7.
- No symlinks inside `/data/data/com.simplr.rad.dev` (`find -type l` is empty) **[X16]**. Other apps can have `lib ->`. See risk 2.

**counterintuitive**
1. **`exec-out` quotes the arguments that come after the first; `adb shell` does not.**
   - Proof: `exec-out echo "'a  b'" '$HOME' "x;y"` printed `'a  b' $HOME x;y` literally. `shell echo` expanded `$HOME` and ran `y` **[X16]**. `exec-out … cat "/data/data/…/no pe"` reached cat as one argument **[A15]**. `exec-out ls -d "'/sdcard/Download'"` failed with the quotes kept.
   - So the app-file pull passes the raw path. `sh_quote` would break it.
   - Listing still uses `adb shell` + `sh_quote`.
   - The one-string form `exec-out "run-as <pkg> cat '<path>'"` (the first argument goes as is, so we quote it ourselves) also matched the sha1 **[A15]**. That is the fallback if an older adb client does not quote `exec-out` arguments (risk 1).
2. `adb shell` is not binary-safe on Windows (CRLF), even with `-T`. Use `exec-out` for bytes.
3. `exec-out` exits 0 on a `run-as`/`cat` error and puts the error text into the file.
   - Per the adb source, it also exits 0 when the stream just stops. Not verified live.
   - So only the listed size proves an app-file copy (`copy_error`).
4. The minimum window width is 800 px, so the mock's 720 px stack breakpoint would never fire. The spec uses 900 px.
5. The explorer window has no capability today. App commands work without one (phase 1 #6), but `onDragDropEvent` calls `listen`, which does need `core:event:allow-listen`.
6. `/sdcard` is a folder under Device root too. Its write state follows the **tree section** (as in the approved mock's `canWrite`), not the path. The backend's path rule stays the authority.
7. The loop's exit code is the last `run-as`'s, so 1 is normal. Errors are read from stderr.
8. The existing test `list_rejects_unsafe_input_before_adb` expects `/data` to give `bad_device_path`. After relaxing the rule it would make a live adb call. That is why the Rust test edits stay inside the backend steps, against your "tests after UI" order. TS tests stay after the UI.

**decisions** (each had two real options; the spec builds on the default)
- D1. **Command shape.** Default: add `package_name: Option<String>` to `android_list_dir`/`android_pull_path`. Alternative: new `android_app_*` commands. The default keeps one guard chain, and old TS calls keep working.
- D2. **App folder download.** Default: file by file, using a depth-first walk over `list_entries(run-as)`, then `pull_file` per file with a size check. The cap is 5000 items, and a `// shortcut:` marker records it. Alternative: a `run-as tar -c` stream; see the rejected alternative.
- D3. **App file mechanism.** Default: the multi-argument raw `exec-out`, reusing `pull_file`. Fallback: the one-string `sh_quote` form (verified).
- D4. **Debuggable detection.** Default: one fixed shell loop (2.5 s). Alternative: N concurrent `run-as` probes, which would be 34–157 adb spawns.
- D5. **When the lock shows.** Default: at once for `?` entries, and after a refused listing for others (the tree keeps the reason). Alternative: guessing from mode bits, which is wrong for `/data/local/tmp` (owner `shell`).
- D6. **A dropped file whose name exists.** Default: refused with `dest_exists`, like Upload files. Dropped folders merge (`--sync`, deletes nothing). Alternative: Sync semantics for files too, which silently replaces a device file when the time differs.
- D7. **Size mismatch during an app pull.** Default: fail with "changed during the copy… stop the app and try again". Alternative: retry once after a fresh listing. A live WAL usually changes again, so the retry gains little.
- D8. **Write state.** Default: by tree section (mock), so `/sdcard` under Device root is read-only. Alternative: by path.
- D9. **Stack breakpoint.** Default: 900 px. The minimum width stays 800×360, as you asked.
- D10. **App data scan.** Default: lazy, on the first open of the section. Alternative: at window start. That costs 2.5 s of device work on every open, even when you never use App data.
- D11. **App path prefix.** Default: only `/data/data/<pkg>`, which is the one the UI builds. `/data/user/0/<pkg>` is refused.
- D12. **Beyond your brief, from the mock:** `KNOWN_CHILDREN = { "/data": ["local"], "/data/local": ["tmp"] }`. Under Device root, a refused `/data` and `/data/local` still expand to these, so `/data/local/tmp` can be reached. Both are refused on [A15] and [X16]. Skipped from the mock: the "Show my debug apps instead" link, and the bottom status bar with the item count.
- D13. **Toolbar.** The SD card and Download quick buttons go (the tree replaces them), and Refresh becomes an icon. This matches the approved toolbar list. `DOWNLOAD_PATH` and `parentPath` are deleted.

**risks**
1. **run-as injection.**
   - The package is validated (`is_valid_package`) before it reaches the device `sh`.
   - The listing path is `sh_quote`d as one argv element.
   - The pull path is raw. It relies on the adb client quoting `exec-out` arguments, which is proven only on adb 36.0.2. `android_db` already relies on the same thing.
   - With a client that does not quote, an app could name its own file `x;cmd`, and `cmd` would run as the shell user. Fallback: the one-string form.
   - Every path is also checked with `check_read_path` (no control characters, `..` or empty segments).
2. **Symlinks during the app walk.**
   - `ls -L` follows links, so `lib -> /data/app/...` takes the walk outside `/data/data/<pkg>`. It stays read-only and runs as the app's own uid.
   - The 5000-item cap and the 4096-byte path rule bound a link loop.
3. **Local paths over IPC (drop).**
   - Earlier phases kept "the webview never sends a local path". The drop command takes paths from the webview.
   - Each path must exist and pass `push_name` (absolute, a usable name, not a drive root). The target folder must pass the strict rule.
   - The command only reads local files, and only into your own `/sdcard`.
   - Alternative: Rust records the `WindowEvent::DragDrop` itself, so no path crosses IPC. That needs per-window state.
4. **Races between listings and the tree.**
   - The single `listing` flag goes. `listings` is a store, `inflight` deduplicates calls per folder, and both panes render `sel` from the store.
   - A late answer only fills the store, so it never shows in the wrong place.
   - Row targets and the root are fixed when the row is drawn.
5. **Large listings.**
   - Up to 5000 folders per listing can become tree rows, and the tree rebuilds after each listing.
   - The `listings` cache grows for the life of the window.
   - The pane rebuilds only when its listing object changes.
6. **Slow app folder pulls**: one adb call per file and per folder.
7. **Running apps**: see D7.
8. **Device root folder pulls**: `/`, `/proc`, `/sys`, `/dev` and `/d` are refused (`not_pullable`), because a read there can block until the 1 h timeout.

**rejected alternative**: `adb exec-out "run-as <pkg> tar -cf - …"`, extracted with Windows `System32\tar.exe` (bsdtar 3.8.9, present). One adb call.
- `exec-out` merges stderr into the data, so one tar warning would corrupt the archive without a word. Only the one-string form can add `2>/dev/null`, and then errors are lost.
- bsdtar on Windows fails on symlink entries without Developer Mode.
- It needs a second tool, plus a guard against Git's GNU `tar` on PATH.
- File by file uses only parts already proven (`list_entries`, `pull_file`, size check), and it gives a real folder, like the `/sdcard` pull.

**acceptance**
- Offline: the overall verify at the end. Expected:
  - Rust lib 420 (device_explorer 14 → 23).
  - vitest 77 files, 977 tests (`deviceFiles` 7 → 10).
  - tsc exit 0, the clippy grep empty, no `innerHTML`, vite builds `device-explorer.html`.
  - The off-limits files keep only their old ` M`.
- adb-level, read-only, runnable now (Git Bash, `export MSYS_NO_PATHCONV=1; ADB=C:/Users/Reinaldo/AppData/Local/Android/sdk/platform-tools/adb.exe`):
  - `"$ADB" -s RF8W3085JEW shell ls -lAL "'/'" | grep '?'` lists the `d?????????` lines.
  - `"$ADB" -s RF8W3085JEW shell ls -lAL "'/data/local/'"` gives `Permission denied`.
  - `"$ADB" -s RF8W3085JEW shell 'for p in $(pm list packages -3); do p=${p#package:}; run-as $p true 2>/dev/null && echo $p; done'` lists 12 packages.
  - `"$ADB" -s RF8W3085JEW exec-out run-as com.simplr.rad.dev cat /data/data/com.simplr.rad.dev/databases/com.google.android.datatransport.events | sha1sum` gives the same hash as `"$ADB" -s RF8W3085JEW shell run-as com.simplr.rad.dev sha1sum "'/data/data/com.simplr.rad.dev/databases/com.google.android.datatransport.events'"`.
- Live, run by you (about 15 min): `cd C:/Users/Reinaldo/Backend/herdr/gui && npm run tauri dev`, then open Explorer on the SM-A145F.
  1. The tree shows Shared storage (`sdcard` open, selected), App data · debug builds (closed) and Device root. The pane lists `/sdcard` with a Permissions column, and the badge says "Read and write" (green).
  2. Open App data. It shows "Looking for debug builds…", then 12 packages. Select `com.simplr.rad.dev`:
     - Its folders list.
     - The badge says "Read-only" (orange).
     - The upload buttons are disabled, and no row has a trash icon.
  3. In `databases`, save `com.google.android.datatransport.events`. Its sha1 equals `run-as … sha1sum`.
  4. Save the folder `shared_prefs` to a PC folder. A folder with the same files appears.
  5. Start the app, then save `databases` again. Expected: success, or the "changed during the copy… stop the app" error. Record which (D7).
  6. Expand Device root:
     - `data_mirror`, `metadata` etc. show a lock.
     - Select `data`: the pane shows "Permission denied" and `ls: /data/: Permission denied`, and the tree row turns into a lock with a chevron.
     - Expand `data` → `local` → `tmp`: `tmp` lists `.studio`, `dalvik-cache`.
  7. Drag a PC file over the pane at `/sdcard/Download`. The overlay says "Drop to upload to /sdcard/Download". Drop it: the row appears, and the status says "Uploaded to …".
  8. Drop the same file again: `dest_exists`. Drop a folder that already exists there: it merges, and the status tooltip shows `N files pushed, M skipped`.
  9. Drag over a folder under Device root or App data. The overlay is orange with the read-only text, and a drop shows the read-only error.
  10. Start a large "Upload folder", then drop a file during it. The error bar shows "Another upload, sync or delete is running…".
  11. Narrow the window to between 800 and 900 px. The tree stacks above the pane.
  12. Unplug the phone and press Refresh. The error bar shows adb's text, and the old rows stay.

**ui direction** (from the approved mock `explorer-layout.html`)
- Skeleton:
  - `.db-bar`: Up (icon), Refresh (icon), `.fx-path`, badge, Upload files, Upload folder, Sync folder here, `.db-status`, `.db-progress`.
  - `.db-error`.
  - `.db-main.fx-main`:
    - `nav.db-side.fx-side` (270 px): `div.db-tables` holding the section heads (`.db-side__head`) and tree rows (`button.db-table.fx-node` with `--depth`, role `treeitem`, `aria-level`, `aria-expanded`, `aria-selected`).
    - `.fx-pane`: `.db-grid` (with `.db-result`, `.db-empty`, `.db-empty.fx-denied`) and the `.fx-drop` overlay.
- Type and color: theme vars only. The badge is `.db-dirty` (orange "Read-only") or `.fx-rw` (green `--charts-green` "Read and write"). The lock is `--charts-orange`. Permissions use a monospace font.
- Pane states:
  - loading: "Loading…" when the folder has no rows yet.
  - empty: "This folder is empty".
  - denied: a lock, "Permission denied" and adb's reason.
  - list error: the error bar. Old rows stay on Refresh.
  - truncated: the "Showing the first 5000 items" row.
- Drop states:
  - over a writable folder: blue dashed overlay, "Drop to upload to <path>".
  - over a read-only folder: orange overlay with the read-only text, and the drop is refused with the same text.
  - while a write runs: the busy text in the error bar.
- App data states: closed (chevron right) / "Looking for debug builds…" / app rows (package icon) / "No debug builds on this device…" / adb error text. When it holds no apps, the next open scans again.
- Keyboard: tree rows are buttons. Enter or Space selects (and opens). → expands, ← collapses. Focus stays on the same row after a re-render.

**smallest-change check**
- Step 1: `pull_file` already streams `exec-out run-as cat` into a file. Visibility beats a copy.
- Step 2: no validator covers "any absolute path". `is_valid_device_path` becomes readable + a root check, so the segment rule lives once. `is_valid_package` is reused.
- Step 3: `list_entries` already has 3 users, and the `package` parameter keeps one listing path. `?` lines need their own small parser.
- Step 4: one command. The script is a constant.
- Step 5: `pull_file`, `list_entries`, `local_file_name`, `part_path` and the existing error handling are reused. `adb_pull` is a move with no new logic.
- Step 6: `push_locals` is the existing tail of `android_push_paths`, moved so the drop command shares the guards. Drop adds one enum variant and `refused_names`.
- Steps 7–8: registration and the capability are required.
- Steps 9–10: the typed-wrapper and pure-helper conventions.
- Step 11: the existing `.db-*` classes are reused. Only the indent, badge, denied panel, drop overlay and breakpoint are new.
- Step 12: the page structure changes (tree + store), so it is a rewrite. Its parts (`el`, `button`, the error bar, the confirm popover, pull/push/delete bodies) are kept.
- Step 13: tests, plus deleting the helpers that are now unused.
- Step 14: the wiki rules require it.

**not verified**
- Anything in the UI: tree, drop, focus, breakpoint. These are live checks 1–12.
- Tauri drop events in a secondary window with the new capability.
- adb client behavior below 36.0.2 for `exec-out` argument quoting.
- Non-ASCII device paths passed as `exec-out` arguments on Windows.
- `exec-out` exiting 0 on an unplug mid-stream. This is from the adb source; the size check covers it either way.
- A debuggable app that has a `lib` symlink.
- An app file whose copy takes longer than 120 s (`pull_timeout`).

---

## Steps

### step 1 — share `pull_file` with the explorer
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\android_db.rs`
- **edit**: `async fn pull_file(` → `pub(crate) async fn pull_file(` (line 479, the same line).
- **lines**: 2.
- **exec**: mechanical. Exact text, no line shift.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && grep -c "^pub(crate) async fn pull_file(" src/android_db.rs && rustfmt --check --edition 2021 src/android_db.rs`. Expected: `1`, then exit 0.

### step 2 — path rules: readable, strict, app, kernel
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**:
  - Imports. Old:
    ```rust
    use crate::android_db::{
        adb_command, adb_output, adb_path, focus_window, shell_failure, trimmed_stderr,
    };
    ```
    New (rustfmt reflows it):
    ```rust
    use crate::android_db::{
        adb_command, adb_output, adb_path, focus_window, is_valid_package, shell_failure,
        trimmed_stderr,
    };
    ```
  - Replace the whole `is_valid_device_path` (from its doc `/// An absolute device path under \`/sdcard\` or \`/storage\`: no empty, \`.\` or` through its closing `}`) with:
```rust
/// An absolute device path that list and pull may read: `/` alone, or
/// segments that are not empty, `.` or `..` (so no trailing `/`), no control
/// character, at most 4096 bytes. Spaces, quotes and a leading `-` in a name
/// pass: `sh_quote` makes them literal, and the path always starts with `/`.
/// Android itself refuses what the adb `shell` user may not read.
pub fn is_readable_device_path(path: &str) -> bool {
    path.len() <= PATH_MAX_BYTES
        && !path.chars().any(char::is_control)
        && (path == "/"
            || path.strip_prefix('/').is_some_and(|rest| {
                rest.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
            }))
}

/// A readable path under `/sdcard` or `/storage`: the only paths that push
/// and delete may write.
pub fn is_valid_device_path(path: &str) -> bool {
    is_readable_device_path(path) && matches!(path.split('/').nth(1), Some("sdcard" | "storage"))
}

/// `path` is the data folder of `package` (`/data/data/<package>`) or inside
/// it. `run-as` gets the package name unquoted, so `is_valid_package`
/// (letters, digits, `_` and dots only) is the injection guard.
pub fn is_app_path(package: &str, path: &str) -> bool {
    is_valid_package(package)
        && is_readable_device_path(path)
        && path
            .strip_prefix(&format!("/data/data/{package}"))
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

/// `/`, and `/proc`, `/sys`, `/dev`, `/d` with every folder below them:
/// kernel file systems where one read can block, so a folder pull could run
/// until the 1 h timeout. A single file there can still be saved.
pub fn is_kernel_dir(path: &str) -> bool {
    matches!(path.split('/').nth(1), Some("" | "proc" | "sys" | "dev" | "d"))
}
```
  - After the `check_path` function (anchor: its last lines `            format!("Unsafe device path: {path:?}"),\n        ))\n    }\n}`), insert:
```rust

/// List and pull: any readable path, or with `package` a path inside that
/// app's data folder (`run-as`).
fn check_read_path(path: &str, package: Option<&str>) -> Result<(), ApiError> {
    let ok = match package {
        Some(package) => is_app_path(package, path),
        None => is_readable_device_path(path),
    };
    if ok {
        Ok(())
    } else {
        Err(api_error(
            "bad_device_path",
            format!("Unsafe device path: {path:?}"),
        ))
    }
}
```
  - Tests: insert before the final `}` of `mod tests`:
```rust

    #[test]
    fn readable_paths_allow_any_absolute_path() {
        for ok in [
            "/",
            "/data",
            "/data/local/tmp",
            "/sdcard/Simplr APK",
            "/proc/1",
            "/d",
            "/data/data/com.simplr.rad.dev/files",
        ] {
            assert!(is_readable_device_path(ok), "{ok}");
        }
        let long = format!("/{}", "x".repeat(PATH_MAX_BYTES));
        for bad in [
            "", "data", "//", "/data/", "/data//x", "/data/../x", "/./data", "/data/.",
            "/a\nb", "/a\u{7f}b", "/a\0b", long.as_str(),
        ] {
            assert!(!is_readable_device_path(bad), "{bad:?}");
        }
        // push and delete keep the shared storage rule
        for strict_bad in ["/", "/data/local/tmp", "/data/data/com.x.y"] {
            assert!(!is_valid_device_path(strict_bad), "{strict_bad}");
        }
    }

    #[test]
    fn app_paths_stay_inside_the_app_data_folder() {
        let pkg = "com.simplr.rad.dev";
        for ok in [
            "/data/data/com.simplr.rad.dev",
            "/data/data/com.simplr.rad.dev/databases",
            "/data/data/com.simplr.rad.dev/files/a b's $(x).json",
        ] {
            assert!(is_app_path(pkg, ok), "{ok}");
        }
        for bad in [
            "/data/data/com.simplr.rad.devx",
            "/data/data/com.simplr.rad.dev/../com.waze",
            "/data/data/com.simplr.rad.dev/",
            "/data/data",
            "/data/user/0/com.simplr.rad.dev",
            "/sdcard",
            "/data/data/com.simplr.rad.dev/a\nb",
        ] {
            assert!(!is_app_path(pkg, bad), "{bad:?}");
        }
        for bad_pkg in ["x; id", "com", "com..x", "com.x/../y", "-com.x", "com.x y", "com.$(id)"] {
            assert!(!is_app_path(bad_pkg, &format!("/data/data/{bad_pkg}")), "{bad_pkg}");
        }
        assert!(check_read_path("/data/local/tmp", None).is_ok());
        assert_eq!(
            check_read_path("/data/local/tmp", Some(pkg)).unwrap_err().code,
            "bad_device_path"
        );
    }

    #[test]
    fn kernel_dirs_are_not_pulled_as_folders() {
        for bad in ["/", "/proc", "/proc/1", "/sys/kernel", "/dev", "/d"] {
            assert!(is_kernel_dir(bad), "{bad}");
        }
        for ok in ["/data/local/tmp", "/sdcard", "/system/etc", "/dev-tools", "/procx"] {
            assert!(!is_kernel_dir(ok), "{ok}");
        }
    }
```
  - Then run `rustfmt --edition 2021 src/device_explorer.rs` (this file only).
- **lines**: about 4 + 45 + 17 + 60 = 126.
- **exec**: judgment. Several insertions plus rustfmt.
  - A non-test `cargo build` warns that `check_read_path` and `is_kernel_dir`'s caller are unused, until steps 3 and 5. This is expected; do not "fix" it.
  - `check_path` stays: push and delete use it.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib device_explorer 2>&1 | grep "test result"`. Expected: `test result: ok. 17 passed; 0 failed`.

### step 3 — listing: `mode`, `?` entries, `permission_denied`, `run-as`
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**:
  - `DeviceEntry`. Old:
    ```rust
        /// `YYYY-MM-DD HH:MM` in the device's local time, as `ls -l` prints it.
        pub modified: String,
    }
    ```
    New:
    ```rust
        /// `YYYY-MM-DD HH:MM` in the device's local time, as `ls -l` prints it.
        /// Empty when `ls` could not stat the item.
        pub modified: String,
        /// The `ls -l` mode, such as `drwxrws---`. All `?` after the type letter:
        /// `ls` could not stat the item, so Android refuses it to the shell user.
        pub mode: String,
    }
    ```
  - Before the doc line `/// One \`ls -lAL\` line: mode, links, owner, group, size, date, time, one`, insert:
```rust
/// A line for an item that `ls` cannot stat. Android 15 and 16 print them at
/// `/` (live): `d?????????   ? ?   ?   ?   ? data_mirror`, five `?` after the
/// mode, and a link ends in ` -> ?`. The type letter is the only fact.
fn parse_unstat_line(line: &str) -> Option<DeviceEntry> {
    let (mode, mut rest) = line.split_once(' ')?;
    if mode.len() != 10 || !mode.bytes().skip(1).all(|b| b == b'?') {
        return None;
    }
    for _ in 0..5 {
        rest = rest.trim_start_matches(' ').strip_prefix('?')?;
    }
    let name = rest.strip_prefix(' ')?;
    let name = name.strip_suffix(" -> ?").unwrap_or(name);
    (!name.is_empty() && name != "." && name != "..").then(|| DeviceEntry {
        name: name.to_string(),
        is_dir: mode.starts_with('d'),
        size: 0,
        modified: String::new(),
        mode: mode.to_string(),
    })
}

```
  - In `parse_ls_line`: old `    let line = line.strip_suffix('\r').unwrap_or(line);\n    let mut fields = [""; 7];` → new `    let line = line.strip_suffix('\r').unwrap_or(line);\n    if let Some(entry) = parse_unstat_line(line) {\n        return Some(entry);\n    }\n    let mut fields = [""; 7];`
  - In `parse_ls_line`: old `        modified: format!("{date} {time}"),\n    })` → new `        modified: format!("{date} {time}"),\n        mode: mode.to_string(),\n    })`
  - Replace everything from `/// Every entry of a device folder, from \`adb shell ls -lAL '<path>/'\`. The` through the end of `android_list_dir` (`    Ok(DirListing { entries, truncated })\n}`) with:
```rust
/// The error for a listing without a `total` line. Android refuses a folder
/// with `ls: <path>: Permission denied` (live, exit 1): the page shows a lock
/// for it, not an empty folder.
pub fn list_error(text: String) -> ApiError {
    let code = if text.contains("Permission denied") {
        "permission_denied"
    } else {
        "list_failed"
    };
    api_error(code, text)
}

/// Every entry of a device folder, from `adb shell [run-as <package>] ls
/// -lAL '<path>/'`. The trailing `/` lists the target of a link such as
/// `/sdcard`; `-L` shows linked folders as folders. `path` and `package`
/// must pass `check_path` or `check_read_path` first. No cap: the push and
/// delete checks must see names past `MAX_ENTRIES`.
async fn list_entries(
    adb: &Path,
    device_id: &str,
    package: Option<&str>,
    path: &str,
) -> Result<Vec<DeviceEntry>, ApiError> {
    let mut cmd = adb_command(adb, device_id);
    cmd.arg("shell");
    if let Some(package) = package {
        cmd.args(["run-as", package]);
    }
    // `/` stays `/`; any other folder gets one trailing `/`.
    cmd.args(["ls", "-lAL"])
        .arg(sh_quote(&format!("{}/", path.trim_end_matches('/'))));
    // ls exits 1 when one entry cannot be read; the `total` line decides.
    let out = adb_output(cmd, LIST_TIMEOUT).await?;
    parse_ls(&String::from_utf8_lossy(&out.stdout)).ok_or_else(|| {
        list_error(shell_failure(false, &out.stdout, &out.stderr).unwrap_or_default())
    })
}

/// Lists a device folder: at most `MAX_ENTRIES` entries, folders first. With
/// `package_name`, a folder inside that app's data, through `run-as`.
#[tauri::command]
pub async fn android_list_dir(
    device_id: String,
    path: String,
    package_name: Option<String>,
) -> Result<DirListing, ApiError> {
    check_device_id(&device_id)?;
    let package = package_name.as_deref();
    check_read_path(&path, package)?;
    let mut entries = list_entries(&adb_path()?, &device_id, package, &path).await?;
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);
    Ok(DirListing { entries, truncated })
}
```
  - Callers:
    - `    let entries = list_entries(&adb, &device_id, &dir).await?;` → `    let entries = list_entries(&adb, &device_id, None, &dir).await?;`
    - `    let entries = list_entries(&adb, &device_id, parent).await.map_err(|e| {` → `    let entries = list_entries(&adb, &device_id, None, parent).await.map_err(|e| {`
  - Test fixes:
    - In `parse_ls_reads_toybox_lines_and_sorts_folders_first`: old `                modified: "2023-04-25 17:13".into()\n            }` → new `                modified: "2023-04-25 17:13".into(),\n                mode: "drwxrws---".into(),\n            }`
    - Replace the whole `list_rejects_unsafe_input_before_adb` test with:
```rust
    #[tokio::test]
    async fn list_rejects_unsafe_input_before_adb() {
        let err = android_list_dir("x; rm".into(), "/sdcard".into(), None)
            .await
            .unwrap_err();
        assert_eq!(err.code, "bad_device_id");
        for (path, package) in [
            ("data", None),
            ("/sdcard/../data", None),
            ("/sdcard/a\nb", None),
            ("/data/", None),
            ("/data/data/com.x.y/files", Some("x; id")),
            ("/data/data/com.other.app", Some("com.x.y")),
            ("/data/data/com.x.y/../com.other.app", Some("com.x.y")),
        ] {
            let err = android_list_dir("RF8W3085JEW".into(), path.into(), package.map(String::from))
                .await
                .unwrap_err();
            assert_eq!(err.code, "bad_device_path", "{path:?}");
        }
    }
```
  - New tests, before the final `}` of `mod tests`:
```rust

    #[test]
    fn parse_ls_keeps_entries_that_ls_cannot_stat() {
        // live: `ls -lAL /` on SM-A145F (Android 15) and 2412DPC0AG (Android 16)
        let out = "\
total 179
d?????????   ? ?        ?             ?                ? data_mirror
l?????????   ? ?        ?             ?                ? init -> ?
-?????????    ? ?        ?            ?                ? init.environ.rc
d?????????    ? ?        ?            ?                ? my dir
drwxrwx--x   68 system   system    4096 2026-10-29 06:11 data
";
        let entries = parse_ls(out).unwrap();
        let rows: Vec<(&str, bool, &str)> = entries
            .iter()
            .map(|e| (e.name.as_str(), e.is_dir, e.mode.as_str()))
            .collect();
        assert_eq!(
            rows,
            [
                ("data", true, "drwxrwx--x"),
                ("data_mirror", true, "d?????????"),
                ("my dir", true, "d?????????"),
                ("init", false, "l?????????"),
                ("init.environ.rc", false, "-?????????"),
            ]
        );
        assert_eq!((entries[1].size, entries[1].modified.as_str()), (0, ""));
    }

    #[test]
    fn a_denied_folder_is_not_an_empty_one() {
        // live: `ls -lAL '/data/'` -> stderr only, exit 1, no `total` line
        assert_eq!(parse_ls("ls: /data/: Permission denied\n"), None);
        assert_eq!(
            list_error("ls: /data/: Permission denied".into()).code,
            "permission_denied"
        );
        assert_eq!(
            list_error("ls: /nope/: No such file or directory".into()).code,
            "list_failed"
        );
    }
```
  - Then run `rustfmt --edition 2021 src/device_explorer.rs`.
- **lines**: about 6 + 20 + 4 + 2 + 50 (replace ~20) + 2 + 3 + 20 + 45 = 150.
- **exec**: judgment. The executor must find exact blocks in a large file, and the test literal changes.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib device_explorer 2>&1 | grep "test result"`. Expected: `ok. 19 passed`.

### step 4 — list the debuggable apps
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**:
  - `const PATH_MAX_BYTES: usize = 4096;` → that line plus:
```rust
/// Third-party packages whose `run-as` works, one per line. A fixed script:
/// nothing from the PC reaches the device `sh`. `run-as` fails for a release
/// build. Live: 34 packages in 2.5 s (SM-A145F), 157 in 2.4 s (2412DPC0AG).
const DEBUGGABLE_APPS: &str =
    "for p in $(pm list packages -3); do p=${p#package:}; run-as $p true 2>/dev/null && echo $p; done";
```
  - After `existing_name` (anchor: `                .any(|e| e.name.to_lowercase() == n.to_lowercase())\n        })\n        .map(String::as_str)\n}`), insert:
```rust

/// Package names from the `DEBUGGABLE_APPS` output: valid names only
/// (`is_valid_package`), sorted, once each. adb on Windows ends lines in `\r\n`.
pub fn debuggable_packages(stdout: &str) -> Vec<String> {
    let mut packages: Vec<String> = stdout
        .lines()
        .map(str::trim)
        .filter(|p| is_valid_package(p))
        .map(String::from)
        .collect();
    packages.sort();
    packages.dedup();
    packages
}
```
  - Before the doc line `/// Pulls a device file or folder to a place that the user picks. \`Ok(None)\``, insert:
```rust
/// Third-party apps installed from a debug build, sorted: their data folder
/// opens through `run-as`. One `adb shell` call for all packages.
#[tauri::command]
pub async fn android_debuggable_apps(device_id: String) -> Result<Vec<String>, ApiError> {
    check_device_id(&device_id)?;
    let mut cmd = adb_command(&adb_path()?, &device_id);
    cmd.args(["shell", DEBUGGABLE_APPS]);
    let out = adb_output(cmd, LIST_TIMEOUT).await?;
    // The exit code is the last run-as's (live: 1), so it says nothing; stderr holds pm or adb errors.
    let packages = debuggable_packages(&String::from_utf8_lossy(&out.stdout));
    let err = trimmed_stderr(&out);
    if packages.is_empty() && !err.is_empty() {
        return Err(api_error("list_failed", err));
    }
    Ok(packages)
}

```
  - Test, before the final `}` of `mod tests`:
```rust

    #[test]
    fn debuggable_packages_keep_valid_names_once() {
        let out = "net.simplr.woosimdp230l\r\ncom.simplr.rad.dev\r\n\r\ncom.simplr.rad.dev\r\nrun-as: package not debuggable: com.waze\r\nx; id\r\n";
        assert_eq!(
            debuggable_packages(out),
            ["com.simplr.rad.dev", "net.simplr.woosimdp230l"]
        );
        assert!(debuggable_packages("").is_empty());
    }
```
  - Then run `rustfmt --edition 2021 src/device_explorer.rs`.
- **lines**: about 5 + 14 + 17 + 10 = 46.
- **exec**: mechanical. Exact anchors and text.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib device_explorer 2>&1 | grep "test result"`. Expected: `ok. 20 passed`.

### step 5 — pull: app data through `run-as`, device root read-only
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**:
  - Import: in the `crate::android_db::{…}` list, add `pull_file` after `is_valid_package`.
  - `const MAX_ENTRIES: usize = 5000;` → that line plus:
    ```rust
    // shortcut: an app-data folder copies file by file (one adb call per file and per folder), at most 5000 items; stream `run-as tar` if users copy bigger trees.
    const APP_PULL_MAX_ITEMS: usize = 5000;
    ```
  - After `debuggable_packages` (anchor: `    packages.dedup();\n    packages\n}`), insert:
```rust

/// The error for an app-file copy whose size differs from the listing, or
/// `None` when it matches. exec-out exits 0 and writes a `run-as` or `cat`
/// error into the file (live), so only the size proves a full copy.
pub fn copy_error(path: &str, listed: u64, copied: u64, head: &[u8]) -> Option<String> {
    if listed == copied {
        return None;
    }
    let text = String::from_utf8_lossy(head);
    let line = text.lines().next().unwrap_or("").trim();
    Some(if line.starts_with("run-as:") || line.starts_with("cat:") {
        line.to_string()
    } else {
        format!("{path} changed during the copy: {copied} bytes arrived, the listing said {listed}. If the app is running, stop it and try again; an unplugged device gives this error too")
    })
}
```
  - Before the doc line `/// Pulls a device file or folder to a place that the user picks. \`Ok(None)\``, insert:
```rust
/// `adb pull` of a path that the shell user can read. The sync protocol
/// takes the device path as is: no device shell, so no quoting.
async fn adb_pull(adb: &Path, device_id: &str, path: &str, dest: &Path) -> Result<String, ApiError> {
    let mut cmd = adb_command(adb, device_id);
    cmd.arg("pull").arg(path).arg(dest);
    let out = adb_output(cmd, TRANSFER_TIMEOUT).await?;
    if !out.status.success() {
        let text = trimmed_stderr(&out);
        let text = if text.is_empty() {
            "adb pull failed".to_string()
        } else {
            text
        };
        return Err(api_error("pull_failed", text));
    }
    Ok(pull_summary(&out.stdout, &out.stderr))
}

/// One app-private file into `dest` with `adb exec-out run-as <package> cat
/// <path>` (`android_db::pull_file`). exec-out keeps the bytes exact, while
/// `adb shell` on Windows turns `\n` into `\r\n`. exec-out quotes each
/// argument after `run-as` itself, so `path` goes raw.
async fn pull_app_file(
    adb: &Path,
    device_id: &str,
    package: &str,
    path: &str,
    size: u64,
    dest: &Path,
) -> Result<(), ApiError> {
    let head = pull_file(adb, device_id, package, path, dest).await?;
    let copied = std::fs::metadata(dest)
        .map_err(|e| api_error("io_error", e.to_string()))?
        .len();
    match copy_error(path, size, copied, &head) {
        Some(text) => Err(api_error("pull_failed", text)),
        None => Ok(()),
    }
}

/// One app-private file. A fresh listing of its folder gives the size.
async fn pull_app_one(
    adb: &Path,
    device_id: &str,
    package: &str,
    path: &str,
    dest: &Path,
) -> Result<String, ApiError> {
    let (dir, name) = path.rsplit_once('/').unwrap_or_default();
    let entries = list_entries(adb, device_id, Some(package), dir).await?;
    let Some(entry) = entries.iter().find(|e| e.name == name) else {
        return Err(api_error(
            "pull_failed",
            format!("{path} is no longer on the device. Press Refresh"),
        ));
    };
    pull_app_file(adb, device_id, package, path, entry.size, dest).await?;
    Ok(format!("{} bytes copied as {package}", entry.size))
}

/// An app-private folder into the new local folder `dest`, file by file.
/// `ls -L` follows links, so a link can lead the walk outside the app
/// folder; `APP_PULL_MAX_ITEMS` and the 4096-byte path rule end it.
async fn pull_app_dir(
    adb: &Path,
    device_id: &str,
    package: &str,
    path: &str,
    dest: &Path,
) -> Result<String, ApiError> {
    let io = |e: std::io::Error| api_error("io_error", e.to_string());
    std::fs::create_dir(dest).map_err(io)?;
    let mut folders = vec![(path.to_string(), dest.to_path_buf())];
    let (mut items, mut bytes) = (0usize, 0u64);
    while let Some((dir, local)) = folders.pop() {
        for entry in list_entries(adb, device_id, Some(package), &dir).await? {
            items += 1;
            if items > APP_PULL_MAX_ITEMS {
                return Err(api_error(
                    "too_many_items",
                    format!("{path} holds more than {APP_PULL_MAX_ITEMS} items. Save its folders one by one"),
                ));
            }
            let device = format!("{dir}/{}", entry.name);
            check_read_path(&device, Some(package))?;
            let target = local.join(local_file_name(&entry.name));
            // Windows ignores case, and `local_file_name` maps `a:b` to `a_b`.
            if target.exists() {
                return Err(api_error(
                    "dest_exists",
                    format!(
                        "{device} and another item get the same name on this PC: {}",
                        target.display()
                    ),
                ));
            }
            if entry.is_dir {
                std::fs::create_dir(&target).map_err(io)?;
                folders.push((device, target));
            } else {
                pull_app_file(adb, device_id, package, &device, entry.size, &target).await?;
                bytes += entry.size;
            }
        }
    }
    Ok(format!("{items} items, {bytes} bytes copied as {package}"))
}

```
  - Replace the whole `android_pull_path` (from `/// Pulls a device file or folder to a place that the user picks. \`Ok(None)\`` through the `Ok(Some(PulledPath { … }))\n}` that closes it) with:
```rust
/// Pulls a device file or folder to a place that the user picks. `Ok(None)`
/// when the user cancels. A file goes through a save dialog; a folder goes
/// into a picked folder as `<picked>\<name>`, never into one that exists (adb
/// would merge into it). The webview never sends a local path here. With
/// `package_name`, the path is inside that app's data folder: `adb pull`
/// cannot read it, so the copy runs through `run-as`.
#[tauri::command]
pub async fn android_pull_path(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    device_id: String,
    path: String,
    is_dir: bool,
    package_name: Option<String>,
) -> Result<Option<PulledPath>, ApiError> {
    check_device_id(&device_id)?;
    let package = package_name.as_deref();
    check_read_path(&path, package)?;
    if is_dir && package.is_none() && is_kernel_dir(&path) {
        return Err(api_error(
            "not_pullable",
            format!("Cowbell does not save {path} as a folder: it is the whole device or a kernel file system, where a read can block. Save single files instead"),
        ));
    }
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
        dialog
            .set_file_name(local_file_name(name))
            .blocking_save_file()
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
    let pulled = match package {
        None => adb_pull(&adb, &device_id, &path, &pull_to).await,
        Some(package) if is_dir => pull_app_dir(&adb, &device_id, package, &path, &saved).await,
        Some(package) => pull_app_one(&adb, &device_id, package, &path, &pull_to).await,
    };
    let summary = match pulled {
        Ok(summary) => summary,
        Err(err) => {
            if !is_dir {
                // after a timeout kill Windows can still hold the file, so this may fail
                let _ = std::fs::remove_file(&pull_to);
            }
            if is_dir && saved.exists() {
                return Err(api_error(
                    &err.code,
                    format!(
                        "{}. The files copied so far are in {}",
                        err.message,
                        saved.display()
                    ),
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
        summary,
    }))
}
```
  - Test, before the final `}` of `mod tests`:
```rust

    #[test]
    fn copy_error_trusts_only_a_matching_size() {
        assert_eq!(copy_error("/d/x", 5, 5, b"hello"), None);
        assert_eq!(copy_error("/d/x", 0, 0, b""), None);
        // live (SM-A145F): exec-out exits 0 and writes the error into the file
        assert_eq!(
            copy_error("/d/no pe", 10, 67, b"cat: /data/data/com.simplr.rad.dev/no pe: No such file or directory\n").as_deref(),
            Some("cat: /data/data/com.simplr.rad.dev/no pe: No such file or directory")
        );
        assert_eq!(
            copy_error("/d/x", 10, 41, b"run-as: package not debuggable: com.waze\n").as_deref(),
            Some("run-as: package not debuggable: com.waze")
        );
        assert!(copy_error("/d/x", 57344, 4096, b"SQLite format 3\0")
            .unwrap()
            .contains("4096 bytes arrived, the listing said 57344"));
    }
```
  - Then run `rustfmt --edition 2021 src/device_explorer.rs`.
- **lines**: about 1 + 3 + 16 + 115 + 95 (replacing ~100) + 18 = about 350 changed.
- **exec**: judgment. New async bodies, and a whole-function replacement inside a large file.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib device_explorer 2>&1 | grep "test result"`. Expected: `ok. 21 passed`.

### step 6 — push: a shared tail and the drop command
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**:
  - `PushKind`. Old:
    ```rust
        /// nothing on the device is deleted.
        Sync,
    }
    ```
    New:
    ```rust
        /// nothing on the device is deleted.
        Sync,
        /// Paths dropped on the window (`android_push_dropped` only, never from
        /// the webview's `kind`): `push --sync`, and `refused_names` keeps a
        /// dropped file from replacing a device file.
        #[serde(skip_deserializing)]
        Drop,
    }
    ```
  - In `push_args`: `    if kind == PushKind::Sync {` → `    if matches!(kind, PushKind::Sync | PushKind::Drop) {`
  - Before the doc line `/// The first of \`names\` that \`entries\` already holds, compared without`, insert:
```rust
/// The names that `dir` must not hold yet. Files and Folder refuse every
/// clash (adb would overwrite without a word); Sync merges; a drop refuses
/// its files and merges its folders. `is_dir` runs beside `names`.
pub fn refused_names(kind: PushKind, names: &[String], is_dir: &[bool]) -> Vec<String> {
    names
        .iter()
        .zip(is_dir)
        .filter(|&(_, &dir)| match kind {
            PushKind::Files | PushKind::Folder => true,
            PushKind::Sync => false,
            PushKind::Drop => !dir,
        })
        .map(|(name, _)| name.clone())
        .collect()
}

```
  - Replace the whole `android_push_paths` (from `/// Pushes PC files, or one PC folder, into the device folder \`dir\`. A native` through its closing `}` after `summary: pull_summary(&out.stdout, &out.stderr),\n    }))\n}`) with:
```rust
/// Pushes PC files, or one PC folder, into the device folder `dir`. A native
/// dialog picks them, so this command takes no local path from the webview.
/// `Ok(None)` when the user cancels. Each item lands at `<dir>/<name>`.
/// Files and Folder refuse a name that `dir` already holds: adb would
/// overwrite a file or merge into a folder without a word. Sync merges by
/// design and deletes nothing on the device.
#[tauri::command]
pub async fn android_push_paths(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    device_id: String,
    dir: String,
    kind: PushKind,
) -> Result<Option<PushedPaths>, ApiError> {
    check_device_id(&device_id)?;
    check_path(&dir)?;
    let adb = adb_path()?;
    let dialog = app.dialog().file().set_parent(&window);
    let picked = match kind {
        PushKind::Files => dialog
            .set_title(format!("Upload files to {dir}"))
            .blocking_pick_files(),
        PushKind::Folder => dialog
            .set_title(format!("Upload a folder to {dir}"))
            .blocking_pick_folder()
            .map(|p| vec![p]),
        // `Drop` never arrives here: serde cannot read it.
        PushKind::Sync | PushKind::Drop => dialog
            .set_title(format!(
                "Sync a folder into {dir}. Nothing on the device is deleted"
            ))
            .blocking_pick_folder()
            .map(|p| vec![p]),
    };
    let Some(picked) = picked else {
        return Ok(None);
    };
    let locals = picked
        .into_iter()
        .map(|p| p.into_path())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| api_error("bad_local_name", e.to_string()))?;
    push_locals(&adb, &device_id, &dir, kind, &locals)
        .await
        .map(Some)
}

/// Pushes PC paths that the user dropped on the window into the device
/// folder `dir` (`push --sync`). The webview sends these paths, so each one
/// is untrusted: it must exist on this PC, and `push_name` wants an absolute
/// path with a usable name. A dropped file that `dir` already holds is
/// refused; a dropped folder merges like Sync, and nothing on the device is
/// deleted.
#[tauri::command]
pub async fn android_push_dropped(
    device_id: String,
    dir: String,
    paths: Vec<String>,
) -> Result<PushedPaths, ApiError> {
    check_device_id(&device_id)?;
    check_path(&dir)?;
    let locals: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    if locals.is_empty() {
        return Err(api_error("bad_local_name", "Nothing to upload"));
    }
    if let Some(gone) = locals.iter().find(|local| !local.exists()) {
        return Err(api_error(
            "bad_local_name",
            format!("{} is not on this PC", gone.display()),
        ));
    }
    push_locals(&adb_path()?, &device_id, &dir, PushKind::Drop, &locals).await
}

/// The shared part of both push commands: a device name for each local
/// path, a fresh listing of `dir`, the clash check, then `adb push`.
async fn push_locals(
    adb: &Path,
    device_id: &str,
    dir: &str,
    kind: PushKind,
    locals: &[PathBuf],
) -> Result<PushedPaths, ApiError> {
    let mut names = Vec::with_capacity(locals.len());
    for local in locals {
        let Some(name) = push_name(dir, local) else {
            return Err(api_error(
                "bad_local_name",
                format!(
                    "{} cannot go to the device. Choose a file or folder with a shorter name, not a drive",
                    local.display()
                ),
            ));
        };
        names.push(name);
    }
    // This also proves that `dir` is still a folder: adb would copy a
    // folder's content into a missing `dir` itself, not into `<dir>/<name>`.
    let entries = list_entries(adb, device_id, None, dir).await?;
    let is_dir: Vec<bool> = locals.iter().map(|local| local.is_dir()).collect();
    let refused = refused_names(kind, &names, &is_dir);
    if let Some(name) = existing_name(&refused, &entries) {
        return Err(api_error(
            "dest_exists",
            format!("{dir}/{name} already exists on the device. Delete or rename it first"),
        ));
    }
    let mut cmd = adb_command(adb, device_id);
    cmd.args(push_args(kind, locals, dir));
    let out = adb_output(cmd, TRANSFER_TIMEOUT).await?;
    if !out.status.success() {
        let text = trimmed_stderr(&out);
        let text = if text.is_empty() {
            "adb push failed".to_string()
        } else {
            text
        };
        return Err(api_error(
            "push_failed",
            format!("{text}. Files that adb copied before the error stay on the device"),
        ));
    }
    Ok(PushedPaths {
        names,
        summary: pull_summary(&out.stdout, &out.stderr),
    })
}
```
  - Tests:
    - In `push_args_end_with_the_raw_device_folder`, after the `PushKind::Sync` assertion (anchor `["push", "--sync", r"C:\a b\x.txt", "/sdcard/"].map(OsString::from)\n        );`), add:
      ```rust
              assert_eq!(
                  push_args(PushKind::Drop, &locals, "/sdcard/Download"),
                  ["push", "--sync", r"C:\a b\x.txt", r"C:\y.txt", "/sdcard/Download/"].map(OsString::from)
              );
      ```
    - In `push_kind_reads_the_lowercase_names`, after `        assert!(serde_json::from_str::<PushKind>(r#""Sync""#).is_err());` add `        assert!(serde_json::from_str::<PushKind>(r#""drop""#).is_err());`
    - In `delete_refuses_unsafe_and_protected_paths_before_adb`, after `            ("/sdcard/Download/a\nb", "bad_device_path"),` add `            ("/data/local/tmp/x", "bad_device_path"),`
    - New, before the final `}` of `mod tests`:
```rust

    #[test]
    fn refused_names_follow_the_push_kind() {
        let names = ["a.txt".to_string(), "Photos".to_string()];
        let is_dir = [false, true];
        assert_eq!(refused_names(PushKind::Files, &names, &is_dir), names);
        assert_eq!(refused_names(PushKind::Folder, &names, &is_dir), names);
        assert!(refused_names(PushKind::Sync, &names, &is_dir).is_empty());
        assert_eq!(refused_names(PushKind::Drop, &names, &is_dir), ["a.txt"]);
    }

    #[tokio::test]
    async fn push_dropped_refuses_unsafe_input_before_adb() {
        let file = std::env::temp_dir().to_string_lossy().into_owned();
        for (id, dir, paths, code) in [
            ("x; rm", "/sdcard/Download", vec![file.clone()], "bad_device_id"),
            ("RF8W3085JEW", "/data/local/tmp", vec![file.clone()], "bad_device_path"),
            ("RF8W3085JEW", "/", vec![file.clone()], "bad_device_path"),
            ("RF8W3085JEW", "/sdcard/Download", vec![], "bad_local_name"),
            (
                "RF8W3085JEW",
                "/sdcard/Download",
                vec![r"C:\cowbell-missing\no such file.txt".to_string()],
                "bad_local_name",
            ),
        ] {
            let err = android_push_dropped(id.into(), dir.into(), paths)
                .await
                .unwrap_err();
            assert_eq!(err.code, code, "{id} {dir}");
        }
    }
```
  - Then run `rustfmt --edition 2021 src/device_explorer.rs`.
- **lines**: about 6 + 2 + 16 + 125 (replacing ~85) + 5 + 1 + 1 + 35 = about 280 changed.
- **exec**: judgment. A function split and an enum variant behind a serde attribute. If clippy objects to the filter closure pattern, use `.filter(|(_, dir)| …)` with `**dir`.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib device_explorer 2>&1 | grep "test result" && grep -c "list_entries(" src/device_explorer.rs`. Expected: `ok. 23 passed`, then `7` (1 definition + 6 calls).

### step 7 — register the two commands
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\lib.rs`
- **edit**: `            device_explorer::android_delete_path,` → `            device_explorer::android_delete_path,\n            device_explorer::android_debuggable_apps,\n            device_explorer::android_push_dropped,`. Hand edit; never run rustfmt on `lib.rs`.
- **lines**: 2 added.
- **exec**: mechanical. The anchor occurs once (line 130).
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && grep -c "device_explorer::android_" src/lib.rs && cargo test -p herdr-gui --lib device_explorer 2>&1 | grep "test result"`. Expected: `7`, then `ok. 23 passed`. `generate_handler!` type-checks both commands.

### step 8 — capability for the drop events
- **files**: new `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\capabilities\device-explorer.json` (LF)
- **edit**:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "device-explorer",
  "description": "Device explorer windows (docs/device-explorer-phase3-spec.md): core:event:allow-listen for the webview drag-drop events (`onDragDropEvent`) that upload dropped PC files. All other calls are the app's own commands, which need no ACL entry.",
  "windows": ["device-explorer-*"],
  "permissions": ["core:event:allow-listen"]
}
```
- **lines**: 7.
- **exec**: judgment. It is a new file. Do not touch `mirror-tools.json`.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && python -c "import json;print(json.load(open('capabilities/device-explorer.json'))['windows'])" && cargo test -p herdr-gui --lib device_explorer 2>&1 | grep "test result"`. Expected: `['device-explorer-*']`, then `ok. 23 passed`. build.rs validates the capability.

### step 9 — typed wrappers
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\flutter\flutterApi.ts`
- **edit**:
  - The `DeviceEntry` interface (lines 131-138) becomes:
```ts
export interface DeviceEntry {
  name: string;
  isDir: boolean;
  /** Bytes. Files only: for a folder `ls` prints its block size. 0 when `ls` could not stat the item. */
  size: number;
  /** `YYYY-MM-DD HH:MM` in the device's local time. Empty when `ls` could not stat the item. */
  modified: string;
  /** The `ls -l` mode, such as `drwxrws---`. `d?????????`: `ls` could not stat it, so Android refuses it. */
  mode: string;
}
```
  - The `androidListDir` doc and function (lines 147-150) become:
```ts
/** `ls -lAL` of a device folder: any absolute path, or with `packageName` a folder in that app's data (through `run-as`). Rejects `bad_device_path`, `permission_denied` (Android refused the folder; the message is adb's reason) and `list_failed`. */
export function androidListDir(deviceId: string, path: string, packageName?: string): Promise<DirListing> {
  return invoke<DirListing>("android_list_dir", { deviceId, path, packageName });
}
```
  - The `androidPullPath` doc and function (lines 159-162) become:
```ts
/** A save dialog (file) or folder picker (folder), then a copy to this PC: `adb pull`, or with `packageName` `run-as cat` file by file. Resolves `null` when cancelled. Rejects `dest_exists`, `bad_local_name`, `not_pullable`, `too_many_items`, `pull_failed`, `pull_timeout`, `adb_timeout`. */
export function androidPullPath(deviceId: string, path: string, isDir: boolean, packageName?: string): Promise<PulledPath | null> {
  return invoke<PulledPath | null>("android_pull_path", { deviceId, path, isDir, packageName });
}
```
  - After `androidDeletePath` (anchor `  return invoke<void>("android_delete_path", { deviceId, path, isDir });\n}`), insert:
```ts

/** Third-party apps installed from a debug build (their data opens through `run-as`), sorted. One adb call, about 2.5 s. */
export function androidDebuggableApps(deviceId: string): Promise<string[]> {
  return invoke<string[]>("android_debuggable_apps", { deviceId });
}

/** `adb push --sync` of PC paths dropped on the window into the shared-storage folder `dir`. A dropped file whose name exists there is refused (`dest_exists`); a folder merges, and nothing on the device is deleted. Rejects `bad_local_name`, `bad_device_path`, `push_failed`. */
export function androidPushDropped(deviceId: string, dir: string, paths: string[]): Promise<PushedPaths> {
  return invoke<PushedPaths>("android_push_dropped", { deviceId, dir, paths });
}
```
- **lines**: 6 + 8 + 8 + 11 = about 33.
- **exec**: mechanical. Exact blocks.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit`. Expected: exit 0. The old page still calls the 2- and 3-argument forms.

### step 10 — pure helpers for the tree
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\android\deviceFiles.ts`
- **edit**:
  - After `parentPath` (anchor `  return isValidDevicePath(parent) ? parent : null;\n}`), insert:
```ts

/** `name` inside the device folder `dir`; the device root `/` gets no second slash. */
export function childPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

/** The parent folder, or `null` at `base` (the root of the tree section: `/sdcard`, `/data/data/<pkg>` or `/`) and outside it. */
export function parentWithin(path: string, base: string): string | null {
  if (path === base || !path.startsWith(base === "/" ? "/" : `${base}/`)) return null;
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

/** `ls` could not stat the item (mode `d?????????`): Android refuses it to the adb shell user. */
export function isStatDenied(entry: { mode: string }): boolean {
  return entry.mode.includes("?");
}
```
  - Replace `pushStatus` (doc + function, the last 5 lines of the file) with:
```ts
/** The status line after `androidPushPaths` or a drop (`androidPushDropped`). Each pushed name is at `<dir>/<name>`. */
export function pushStatus(kind: PushKind | "drop", dir: string, names: string[]): string {
  if (kind === "sync") return `Synced into ${dir}/${names[0]}. Nothing on the device was deleted`;
  if (names.length === 1) return `Uploaded to ${dir}/${names[0]}`;
  return `Uploaded ${names.length} ${kind === "drop" ? "items" : "files"} to ${dir}`;
}
```
  - Keep `parentPath` and `DOWNLOAD_PATH` for now. Step 13 deletes them, once neither the page nor the tests use them.
- **lines**: about 17 + 10 = 27.
- **exec**: mechanical. Exact anchors.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run tests/unit/deviceFiles.test.ts 2>&1 | grep "Tests "`. Expected: exit 0, then `7 passed`.

### step 11 — styles for the tree, badge, denied panel and drop
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\style.css`
- **edit**: `.fx-file {\n  cursor: default;\n}` → the same 3 lines, followed by:
```css

/* Device explorer phase 3: folder tree (left) beside the folder contents (right). */
.fx-side {
  width: 270px;
}

.fx-section {
  width: 100%;
  justify-content: flex-start;
  gap: 4px;
}

.fx-section:focus-visible {
  outline: 1px solid var(--focusBorder);
  outline-offset: -1px;
}

.fx-node {
  gap: 4px;
  padding-left: calc(6px + var(--depth, 0) * 14px);
}

.fx-node .fx-chev {
  opacity: 0.6;
}

.fx-note {
  padding: 0 12px 6px;
  font-size: var(--fs-xs);
  color: var(--descriptionForeground);
}

.fx-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.fx-mode {
  font-family: "SF Mono", Menlo, "Cascadia Mono", Consolas, monospace;
  color: var(--descriptionForeground);
}

/* "Read and write": the shape of .db-dirty ("Read-only" uses .db-dirty itself), in green. */
.fx-rw {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--charts-green);
  border-radius: 4px;
  color: var(--charts-green);
  font-size: var(--fs-xs);
  white-space: nowrap;
}

/* A folder that Android refuses: the lock, a title and adb's reason, centred by .db-empty. */
.fx-denied {
  align-content: center;
  gap: 6px;
}

.fx-denied .codicon-lock {
  font-size: 26px;
  color: var(--charts-orange);
}

.fx-denied strong {
  color: var(--foreground);
}

/* Drop target over the folder contents while PC files are dragged in. */
.fx-drop {
  position: absolute;
  inset: 6px;
  z-index: 2;
  display: grid;
  place-items: center;
  padding: 24px;
  border: 2px dashed var(--focusBorder);
  border-radius: 6px;
  background: color-mix(in srgb, var(--focusBorder) 12%, transparent);
  font-weight: 600;
  text-align: center;
  pointer-events: none;
}

.fx-drop[hidden] {
  display: none;
}

.fx-drop.is-refused {
  border-color: var(--charts-orange);
  background: color-mix(in srgb, var(--charts-orange) 12%, transparent);
}

/* The window's minimum width is 800 px, so the stacked layout needs a breakpoint above it. */
@media (max-width: 900px) {
  .fx-main {
    flex-direction: column;
  }

  .fx-side {
    width: auto;
    max-height: 40%;
    border-right: none;
    border-bottom: 1px solid var(--sideBar-border, var(--menu-separatorBackground));
  }
}
```
- **lines**: about 105 added.
- **exec**: mechanical. Exact anchor and text.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && grep -c "^\.fx-side {\|^\.fx-drop {\|^\.fx-rw {\|max-width: 900px" src/style.css`. Expected: `4`.

### step 12 — the explorer page: tree, pane, drop
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\deviceExplorer.ts` (replace the whole file)
- **edit**: new full text.
```ts
// The device explorer page. A folder tree on the left has three roots:
// Shared storage (`/sdcard`), App data (debug builds, read through
// `run-as`) and Device root (`/`). The pane on the right lists the selected
// folder, and every item there can be saved to this PC. Only Shared storage
// takes writes: upload, sync, drop from the PC and delete. Errors show
// inline (`#error-notices` does not exist on this page). Every name comes
// from the device, so the page sets text with `textContent` and never uses
// `innerHTML`.

import "./style.css";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { SDCARD_PATH, childPath, isDeletablePath, isStatDenied, parentWithin, pushStatus } from "./android/deviceFiles";
import { parseMirrorToolsParams } from "./android/mirrorToolsParams";
import { formatBytes } from "./android/recordFormat";
import { errorMessage } from "./appApi";
import {
  androidDebuggableApps,
  androidDeletePath,
  androidListDir,
  androidPullPath,
  androidPushDropped,
  androidPushPaths,
  type DeviceEntry,
  type DirListing,
  type PushKind,
} from "./flutter/flutterApi";
import { applySavedTheme } from "./themes/savedTheme";
import { openConfirmPopover } from "./ui/confirmPopover";

/** One root of the folder tree. With `pkg`, every call runs as that app (`run-as`). */
interface TreeRoot {
  id: string;
  label: string;
  base: string;
  icon: string;
  pkg?: string;
  /** Upload, sync, drop and delete: Shared storage only. The backend checks every path again. */
  writable: boolean;
}

/** A folder listing, or adb's reason when Android refused the folder. */
type Listed = DirListing | { denied: string };

const SHARED: TreeRoot = { id: "shared", label: "sdcard", base: SDCARD_PATH, icon: "device-mobile", writable: true };
const DEVICE: TreeRoot = { id: "device", label: "/ (device root)", base: "/", icon: "root-folder", writable: false };

// Folders that the adb shell user can open below folders it cannot list
// (live, SM-A145F and 2412DPC0AG: `ls /data` and `ls /data/local` are refused,
// `ls /data/local/tmp` works).
const KNOWN_CHILDREN: Record<string, string[]> = { "/data": ["local"], "/data/local": ["tmp"] };

function appRoot(pkg: string): TreeRoot {
  return { id: `app:${pkg}`, label: pkg, base: `/data/data/${pkg}`, icon: "package", pkg, writable: false };
}

function isDenied(listed: Listed | undefined): listed is { denied: string } {
  return listed !== undefined && "denied" in listed;
}

function readOnlyText(path: string): string {
  return `${path} is read-only. Upload, sync, drop and delete work only in Shared storage`;
}

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

  // One listing per folder feeds the tree and the pane. A late answer only
  // fills this store: the page always renders `sel` from it.
  const listings = new Map<string, Listed>();
  // At most one adb listing per folder at a time; a second caller shares it.
  const inflight = new Map<string, Promise<void>>();
  // Open tree rows. The same folder can sit under two roots, so the key holds the root.
  const open = new Set<string>();
  let sel: { root: TreeRoot; path: string } = { root: SHARED, path: SHARED.base };
  let apps: TreeRoot[] = [];
  let appsOpen = false;
  let appsLoading = false;
  let appsNote = "";
  // A pull never blocks browsing. `writing` keeps one upload, sync, drop or delete at a time.
  let pulling = false;
  let writing = false;
  // What the pane rows show now, so a listing for the tree does not rebuild them.
  let shown: Listed | undefined;
  let shownRoot: TreeRoot | undefined;

  const listKey = (r: TreeRoot, path: string): string => `${r.pkg ?? ""}:${path}`;
  const nodeKey = (r: TreeRoot, path: string): string => `${r.id}:${path}`;

  const upBtn = button("icon-btn db-page-btn", "", "arrow-up");
  upBtn.title = "Up one folder";
  upBtn.setAttribute("aria-label", upBtn.title);
  const refreshBtn = button("icon-btn db-page-btn", "", "refresh");
  refreshBtn.title = "List the folder again";
  refreshBtn.setAttribute("aria-label", refreshBtn.title);
  const pathText = el("span", "fx-path");
  const badge = el("span");
  const uploadFilesBtn = button("btn db-btn", "Upload files", "cloud-upload");
  const uploadFolderBtn = button("btn db-btn", "Upload folder", "cloud-upload");
  const syncBtn = button("btn db-btn", "Sync folder here", "sync");
  const status = el("span", "db-status");
  status.setAttribute("aria-live", "polite");
  const progress = el("div", "db-progress");
  progress.setAttribute("aria-hidden", "true");
  const bar = el("div", "db-bar");
  bar.append(upBtn, refreshBtn, pathText, badge, uploadFilesBtn, uploadFolderBtn, syncBtn, status, progress);

  const errorText = el("span", "db-error__text");
  const errorBar = el("div", "db-error");
  errorBar.setAttribute("role", "alert");
  errorBar.append(el("i", "codicon codicon-error"), errorText);
  errorBar.hidden = true;

  const appsChev = el("i");
  const appsHead = el("button", "db-side__head fx-section");
  appsHead.type = "button";
  appsHead.dataset.key = "apps";
  appsHead.title = "Apps installed from a debug build. Their data is read-only here";
  appsHead.append(appsChev, el("span", undefined, "App data · debug builds"));
  const tree = el("div", "db-tables");
  const side = el("nav", "db-side fx-side");
  side.setAttribute("aria-label", "Device folders");
  side.append(tree);

  const table = el("table", "db-result");
  const emptyText = el("p", "db-empty");
  const deniedText = el("span");
  const deniedPanel = el("div", "db-empty fx-denied");
  deniedPanel.append(el("i", "codicon codicon-lock"), el("strong", undefined, "Permission denied"), deniedText);
  const grid = el("div", "db-grid");
  grid.append(table, emptyText, deniedPanel);
  const dropHint = el("div", "fx-drop");
  dropHint.hidden = true;
  const pane = el("div", "fx-pane");
  pane.append(grid, dropHint);
  const mainEl = el("div", "db-main fx-main");
  mainEl.append(side, pane);
  root.append(bar, errorBar, mainEl);

  function showError(text: string): void {
    errorText.textContent = text;
    errorBar.hidden = false;
  }

  function renderAll(): void {
    renderTree();
    renderPane();
    renderControls();
  }

  /** Rebuilds the tree from `open` and `listings`, and keeps the keyboard focus on the same row. */
  function renderTree(): void {
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && tree.contains(active) ? active.dataset.key : undefined;
    appsHead.setAttribute("aria-expanded", String(appsOpen));
    appsChev.className = `codicon codicon-chevron-${appsOpen ? "down" : "right"}`;
    const parts: HTMLElement[] = [el("div", "db-side__head", "Shared storage"), treeGroup("Shared storage", [SHARED]), appsHead];
    if (appsOpen) parts.push(apps.length > 0 ? treeGroup("App data", apps) : el("p", "fx-note", appsNote));
    parts.push(el("div", "db-side__head", "Device root"), treeGroup("Device root", [DEVICE]));
    tree.replaceChildren(...parts);
    if (focusKey) tree.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  function treeGroup(label: string, roots: TreeRoot[]): HTMLElement {
    const list = el("div");
    list.setAttribute("role", "tree");
    list.setAttribute("aria-label", label);
    for (const r of roots) addNode(list, r, r.base, r.label, 0, false);
    return list;
  }

  /** One tree row, then its folders when open. A folder that Android refuses shows a lock. */
  function addNode(list: HTMLElement, r: TreeRoot, path: string, label: string, depth: number, statDenied: boolean): void {
    const key = nodeKey(r, path);
    const listed = listings.get(listKey(r, path));
    const known = r === DEVICE ? KNOWN_CHILDREN[path] : undefined;
    const locked = statDenied || isDenied(listed);
    const expandable = !locked || known !== undefined;
    const expanded = expandable && open.has(key);
    const selected = sel.root === r && sel.path === path;
    const node = el("button", selected ? "db-table fx-node is-active" : "db-table fx-node");
    node.type = "button";
    node.dataset.key = key;
    node.style.setProperty("--depth", String(depth));
    node.title = locked ? `${path}: Permission denied` : path;
    node.setAttribute("role", "treeitem");
    node.setAttribute("aria-level", String(depth + 1));
    node.setAttribute("aria-selected", String(selected));
    if (expandable) node.setAttribute("aria-expanded", String(expanded));
    const chev = el("i", `codicon codicon-chevron-${expanded ? "down" : "right"} fx-chev`);
    chev.style.visibility = expandable ? "" : "hidden";
    node.append(chev, el("i", `codicon codicon-${locked ? "lock" : depth === 0 ? r.icon : "folder"}`), el("span", undefined, label));
    chev.addEventListener("click", (event) => {
      event.stopPropagation();
      if (expandable) toggle(r, path);
    });
    node.addEventListener("click", () => select(r, path));
    node.addEventListener("keydown", (event) => {
      if ((event.key === "ArrowRight" && expandable && !expanded) || (event.key === "ArrowLeft" && expanded)) {
        event.preventDefault();
        toggle(r, path);
      }
    });
    list.append(node);
    if (!expanded) return;
    if (listed !== undefined && !isDenied(listed)) {
      for (const child of listed.entries) {
        if (child.isDir) addNode(list, r, childPath(path, child.name), child.name, depth + 1, isStatDenied(child));
      }
    } else {
      for (const name of known ?? []) addNode(list, r, childPath(path, name), name, depth + 1, false);
    }
  }

  /** Rebuilds the rows only when the selected folder gets a new listing, so a tree listing keeps the scroll and focus. */
  function renderPane(): void {
    const r = sel.root;
    const dir = sel.path;
    const listed = listings.get(listKey(r, dir));
    if (listed === shown && r === shownRoot) return;
    shown = listed;
    shownRoot = r;
    table.replaceChildren();
    if (listed === undefined || isDenied(listed) || listed.entries.length === 0) return;
    const head = el("tr");
    head.append(el("th", undefined, "Name"), el("th", "db-num", "Size"), el("th", undefined, "Modified"), el("th", undefined, "Permissions"), el("th"), el("th"));
    const thead = el("thead");
    thead.append(head);
    const body = el("tbody");
    for (const entry of listed.entries) {
      // Fixed here: a listing that lands later must not retarget a save or a delete.
      const target = childPath(dir, entry.name);
      const locked = isStatDenied(entry);
      const nameCell = el("td");
      nameCell.title = entry.name;
      if (entry.isDir) {
        const openBtn = button("db-table", entry.name, locked ? "lock" : "folder");
        openBtn.addEventListener("click", () => select(r, target));
        nameCell.append(openBtn);
      } else {
        const file = el("div", "db-table fx-file");
        file.append(el("i", `codicon codicon-${locked ? "lock" : "file"}`), el("span", undefined, entry.name));
        nameCell.append(file);
      }
      const size = el("td", "db-num", entry.isDir || locked ? "" : formatBytes(entry.size));
      if (!entry.isDir && !locked) size.title = `${entry.size} bytes`;
      const saveCell = el("td");
      if (!locked) {
        const save = button("icon-btn db-page-btn", "", "cloud-download");
        save.dataset.save = "";
        save.title = `Save ${entry.name} to this PC`;
        save.setAttribute("aria-label", save.title);
        save.addEventListener("click", () => void pull(r, target, entry));
        saveCell.append(save);
      }
      const deleteCell = el("td");
      if (r.writable && isDeletablePath(target)) {
        const del = button("icon-btn db-page-btn", "", "trash");
        del.dataset.delete = "";
        del.title = `Delete ${entry.name} from the device`;
        del.setAttribute("aria-label", del.title);
        del.addEventListener("click", () => confirmDelete(del, target, entry.isDir));
        deleteCell.append(del);
      }
      const tr = el("tr");
      tr.append(nameCell, size, el("td", undefined, entry.modified), el("td", "fx-mode", entry.mode), saveCell, deleteCell);
      body.append(tr);
    }
    if (listed.truncated) {
      const td = el("td", "db-null", `Showing the first ${listed.entries.length} items`);
      td.colSpan = 6;
      const tr = el("tr");
      tr.append(td);
      body.append(tr);
    }
    table.append(thead, body);
  }

  function renderControls(): void {
    const key = listKey(sel.root, sel.path);
    const listed = listings.get(key);
    const listing = inflight.has(key);
    const canWrite = sel.root.writable && listed !== undefined && !isDenied(listed);
    upBtn.disabled = parentWithin(sel.path, sel.root.base) === null;
    refreshBtn.disabled = listing;
    pathText.textContent = sel.path;
    pathText.title = sel.path;
    badge.className = sel.root.writable ? "fx-rw" : "db-dirty";
    badge.textContent = sel.root.writable ? "Read and write" : "Read-only";
    badge.title = sel.root.writable ? "Upload, sync, drop and delete work in this folder" : readOnlyText(sel.path);
    uploadFilesBtn.disabled = uploadFolderBtn.disabled = syncBtn.disabled = !canWrite || writing;
    uploadFilesBtn.title = sel.root.writable ? `Copy files from this PC into ${sel.path}` : readOnlyText(sel.path);
    uploadFolderBtn.title = sel.root.writable ? `Copy a folder from this PC into ${sel.path}` : readOnlyText(sel.path);
    syncBtn.title = sel.root.writable
      ? `Copy a PC folder into ${sel.path}/<folder name>. Files whose time differs replace the device copy. Nothing on the device is deleted`
      : readOnlyText(sel.path);
    progress.classList.toggle("is-busy", inflight.size > 0 || appsLoading || pulling || writing);
    for (const btn of Array.from(table.querySelectorAll<HTMLButtonElement>("button[data-save]"))) btn.disabled = pulling;
    for (const btn of Array.from(table.querySelectorAll<HTMLButtonElement>("button[data-delete]"))) btn.disabled = listing || writing;
    const empty = listed === undefined ? (listing ? "Loading…" : "") : !isDenied(listed) && listed.entries.length === 0 ? "This folder is empty" : "";
    emptyText.textContent = empty;
    emptyText.hidden = empty === "";
    deniedPanel.hidden = !isDenied(listed);
    deniedText.textContent = isDenied(listed) ? listed.denied : "";
  }

  /** Lists a folder into `listings`. A refused folder is stored with adb's reason; other errors reject. */
  function load(r: TreeRoot, path: string): Promise<void> {
    const key = listKey(r, path);
    const running = inflight.get(key);
    if (running) return running;
    const task = androidListDir(id, path, r.pkg)
      .then(
        (listing) => {
          listings.set(key, listing);
        },
        (err: unknown) => {
          if ((err as { code?: string })?.code !== "permission_denied") throw err;
          listings.set(key, { denied: errorMessage(err) });
        },
      )
      .finally(() => {
        inflight.delete(key);
        renderAll();
      });
    inflight.set(key, task);
    renderAll();
    return task;
  }

  function reload(r: TreeRoot, path: string): void {
    void load(r, path).catch((err) => showError(errorMessage(err)));
  }

  /** Shows `path` in the pane at once (old rows or "Loading…") and lists it again. */
  function select(r: TreeRoot, path: string): void {
    if (sel.root !== r || sel.path !== path) grid.scrollTop = 0;
    sel = { root: r, path };
    open.add(nodeKey(r, path));
    errorBar.hidden = true;
    renderAll();
    void load(r, path).catch((err) => {
      if (sel.root === r && sel.path === path) showError(errorMessage(err));
    });
  }

  function toggle(r: TreeRoot, path: string): void {
    const key = nodeKey(r, path);
    if (!open.delete(key)) {
      open.add(key);
      if (!listings.has(listKey(r, path))) reload(r, path);
    }
    renderAll();
  }

  /** Opens or closes App data. An open with no apps yet scans the device (one adb call, about 2.5 s). */
  async function toggleApps(): Promise<void> {
    appsOpen = !appsOpen;
    renderAll();
    if (!appsOpen || appsLoading || apps.length > 0) return;
    appsLoading = true;
    appsNote = "Looking for debug builds…";
    renderAll();
    try {
      apps = (await androidDebuggableApps(id)).map(appRoot);
      appsNote = apps.length === 0 ? "No debug builds on this device. Install one with flutter run or a debug APK" : "";
    } catch (err) {
      appsNote = errorMessage(err);
    } finally {
      appsLoading = false;
      renderAll();
    }
  }

  /** A save dialog or folder picker, then a copy to this PC. One pull at a time. */
  async function pull(r: TreeRoot, target: string, entry: DeviceEntry): Promise<void> {
    if (pulling) return;
    pulling = true;
    errorBar.hidden = true;
    status.textContent = `Saving ${entry.name}…`;
    status.title = "";
    renderControls();
    try {
      const saved = await androidPullPath(id, target, entry.isDir, r.pkg);
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

  // An arrow, not a function declaration: `root` and `params` keep their non-null narrowing only here.
  /** Always asks first. The popover names the item and shows the full device path. */
  const confirmDelete = (anchor: HTMLButtonElement, target: string, isDir: boolean): void => {
    openConfirmPopover(root, anchor, {
      titlePrefix: "Delete ",
      titleName: target.slice(target.lastIndexOf("/") + 1),
      titleSuffix: isDir ? " and everything inside it?" : "?",
      detail: isDir
        ? `${target} and every file and folder inside it are deleted from ${params.deviceName}. There is no undo.`
        : `${target} is deleted from ${params.deviceName}. There is no undo.`,
      confirmLabel: "Delete",
      onConfirm: () => void deleteItem(target, isDir),
      onCancel: () => anchor.focus(),
    });
  };

  /** `rm` on the device; the backend checks that the name is gone. Only Shared storage rows have a delete icon. */
  async function deleteItem(target: string, isDir: boolean): Promise<void> {
    if (writing) return;
    writing = true;
    const slash = target.lastIndexOf("/");
    const name = target.slice(slash + 1);
    errorBar.hidden = true;
    status.textContent = `Deleting ${name}…`;
    status.title = target;
    renderControls();
    try {
      await androidDeletePath(id, target, isDir);
      status.textContent = `Deleted ${name}`;
      reload(SHARED, target.slice(0, slash));
    } catch (err) {
      status.textContent = "";
      showError(errorMessage(err));
    } finally {
      writing = false;
      renderControls();
    }
  }

  /** A native picker, then `adb push` into the folder on screen. One device write at a time. */
  async function push(kind: PushKind): Promise<void> {
    const r = sel.root;
    const dir = sel.path;
    if (writing || !r.writable) return;
    writing = true;
    errorBar.hidden = true;
    status.textContent = kind === "sync" ? `Syncing into ${dir}…` : `Uploading to ${dir}…`;
    status.title = "";
    renderControls();
    try {
      const pushed = await androidPushPaths(id, dir, kind);
      status.textContent = pushed ? pushStatus(kind, dir, pushed.names) : "";
      status.title = pushed ? `${status.textContent}\n${pushed.summary}` : "";
      if (pushed) reload(r, dir);
    } catch (err) {
      status.textContent = "";
      showError(errorMessage(err));
    } finally {
      writing = false;
      renderControls();
    }
  }

  /** Tauri gives the drag position in physical pixels, relative to the webview. */
  function overPane(position: { x: number; y: number }): boolean {
    const rect = pane.getBoundingClientRect();
    const x = position.x / devicePixelRatio;
    const y = position.y / devicePixelRatio;
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
  }

  /** `adb push --sync` of dropped PC paths into the folder on screen. A file that exists there is refused; a folder merges. */
  async function dropUpload(paths: string[]): Promise<void> {
    const r = sel.root;
    const dir = sel.path;
    if (!r.writable) {
      showError(readOnlyText(dir));
      return;
    }
    if (writing) {
      showError("Another upload, sync or delete is running. Drop again when it ends");
      return;
    }
    writing = true;
    errorBar.hidden = true;
    status.textContent = `Uploading to ${dir}…`;
    status.title = "";
    renderControls();
    try {
      const pushed = await androidPushDropped(id, dir, paths);
      status.textContent = pushStatus("drop", dir, pushed.names);
      status.title = `${status.textContent}\n${pushed.summary}`;
      reload(r, dir);
    } catch (err) {
      status.textContent = "";
      showError(errorMessage(err));
    } finally {
      writing = false;
      renderControls();
    }
  }

  upBtn.addEventListener("click", () => {
    const up = parentWithin(sel.path, sel.root.base);
    if (up) select(sel.root, up);
  });
  refreshBtn.addEventListener("click", () => {
    errorBar.hidden = true;
    reload(sel.root, sel.path);
  });
  appsHead.addEventListener("click", () => void toggleApps());
  uploadFilesBtn.addEventListener("click", () => void push("files"));
  uploadFolderBtn.addEventListener("click", () => void push("folder"));
  syncBtn.addEventListener("click", () => void push("sync"));
  getCurrentWebview()
    .onDragDropEvent((event) => {
      const drag = event.payload;
      if (drag.type === "leave") {
        dropHint.hidden = true;
        return;
      }
      const over = overPane(drag.position);
      if (drag.type === "drop") {
        dropHint.hidden = true;
        if (over && drag.paths.length > 0) void dropUpload(drag.paths);
        return;
      }
      dropHint.hidden = !over;
      dropHint.classList.toggle("is-refused", !sel.root.writable);
      dropHint.textContent = sel.root.writable ? `Drop to upload to ${sel.path}` : readOnlyText(sel.path);
    })
    .catch((err) => showError(`Drop to upload does not work in this window: ${errorMessage(err)}`));

  select(SHARED, SHARED.base);
}

void main();
```
- **lines**: about 285 removed, 470 added.
- **exec**: judgment. A new page structure with DOM wiring. The executor may adjust layout details, but must keep:
  - `textContent` only;
  - the store-based rendering;
  - row targets fixed when a row is drawn;
  - the `confirmDelete` arrow (counterintuitive #6 of phase 2).
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && ! grep -n innerHTML src/deviceExplorer.ts && npx vite build --outDir "$TEMP/cowbell-vite-check" --emptyOutDir >/dev/null && ls "$TEMP/cowbell-vite-check/device-explorer.html"`. Expected: tsc exit 0, no innerHTML line, and the html path is printed.

### step 13 — TS tests, and delete the helpers nothing uses now
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\android\deviceFiles.ts`, `C:\Users\Reinaldo\Backend\herdr\gui\tests\unit\deviceFiles.test.ts`
- **edit**:
  - `deviceFiles.ts`: delete the line `export const DOWNLOAD_PATH = "/sdcard/Download";`. Delete `parentPath` with its doc line (`/** The parent folder, or \`null\` at \`/sdcard\` and \`/storage\`: … */` through `  return isValidDevicePath(parent) ? parent : null;\n}` and the blank line after it).
  - Test file, the import line → `import { childPath, isDeletablePath, isStatDenied, isValidDevicePath, parentWithin, pushStatus } from "../../src/android/deviceFiles";`
  - Test file: replace the whole `describe("parentPath", … });` block with:
```ts
describe("parentWithin", () => {
  it("goes up one folder inside its tree section", () => {
    expect(parentWithin("/sdcard/Download", "/sdcard")).toBe("/sdcard");
    expect(parentWithin("/data/data/com.x.y/files/logs", "/data/data/com.x.y")).toBe("/data/data/com.x.y/files");
    expect(parentWithin("/data/local", "/")).toBe("/data");
    expect(parentWithin("/data", "/")).toBe("/");
  });
  it("stops at the section root and outside it", () => {
    expect(parentWithin("/sdcard", "/sdcard")).toBeNull();
    expect(parentWithin("/", "/")).toBeNull();
    expect(parentWithin("/data/data/com.x.y", "/data/data/com.x.y")).toBeNull();
    expect(parentWithin("/sdcardx/a", "/sdcard")).toBeNull();
  });
});

describe("childPath", () => {
  it("joins without a double slash at the device root", () => {
    expect(childPath("/", "data")).toBe("/data");
    expect(childPath("/sdcard", "Simplr APK")).toBe("/sdcard/Simplr APK");
  });
});

describe("isStatDenied", () => {
  it("is true only for the ? modes that ls prints for an item it cannot stat", () => {
    expect(isStatDenied({ mode: "d?????????" })).toBe(true);
    expect(isStatDenied({ mode: "l?????????" })).toBe(true);
    expect(isStatDenied({ mode: "drwxrws---" })).toBe(false);
  });
});
```
  - Test file: inside `describe("pushStatus", …)`, after the existing `it(…)` block, add:
```ts
  it("counts dropped items, files and folders alike", () => {
    expect(pushStatus("drop", "/sdcard/Download", ["a.txt"])).toBe("Uploaded to /sdcard/Download/a.txt");
    expect(pushStatus("drop", "/sdcard/Download", ["a.txt", "Photos"])).toBe("Uploaded 2 items to /sdcard/Download");
  });
```
- **lines**: about 8 removed + 1 + 40 (replacing 10) + 4 = about 55.
- **exec**: mechanical. Exact anchors and text.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run tests/unit/deviceFiles.test.ts 2>&1 | grep "Tests " && ! grep -rn "parentPath\|DOWNLOAD_PATH" src tests`. Expected: exit 0, `10 passed`, no grep hit.

### step 14 — llm_wiki
- **files**: under `C:\Users\Reinaldo\Backend\herdr\gui\llm_wiki\`
- **edit** (STE prose; identifiers verbatim; fresh `grep -n` for every line number):
  - `areas/device-explorer.md`:
    - Purpose: a tree with three roots.
      - Shared storage `/sdcard`: read and write (upload, sync, drop, delete).
      - App data: debug builds through `run-as`, read-only.
      - Device root `/`: read-only.
      - The pane lists the selected folder, and every item can be saved to the PC.
    - Key files:
      - All 7 commands with fresh lines (`android_debuggable_apps`, `android_push_dropped` are new).
      - The helpers: `is_readable_device_path`, `is_valid_device_path`, `is_app_path`, `is_kernel_dir`, `check_read_path`, `parse_unstat_line`, `list_error`, `list_entries`, `debuggable_packages`, `copy_error`, `pull_app_file`/`pull_app_one`/`pull_app_dir`, `adb_pull`, `refused_names`, `push_locals`.
      - `capabilities/device-explorer.json`.
      - The reuse of `android_db::pull_file` and `is_valid_package`.
      - `deviceFiles.ts` exports: `SDCARD_PATH`, `isValidDevicePath`, `childPath`, `parentWithin`, `isStatDenied`, `isDeletablePath`, `pushStatus`.
      - New wrappers: `androidDebuggableApps`, `androidPushDropped`. `androidListDir`/`androidPullPath` take an optional `packageName`.
    - Limits:
      - Two path rules: readable (list and pull) and strict (push and delete).
      - `permission_denied`, and the `?` entries with their lock.
      - The run-as listing.
      - The app pull: `exec-out` with a raw path, the size check, file by file, 5000 items, 120 s per file.
      - `not_pullable` for `/`, `/proc`, `/sys`, `/dev`, `/d`.
      - The debuggable scan: one shell loop, on the first open.
      - Write state follows the tree section.
      - `KNOWN_CHILDREN`.
    - **Replace** "The webview never sends a local path. A native dialog picks it." with: "Pull and the upload buttons get local paths from a native dialog. A drop sends local paths over IPC. `android_push_dropped` treats them as untrusted: each path must exist and pass `push_name`."
    - Drop: files that exist are refused, folders merge (`--sync`), and drop uses the `writing` flag.
    - Edges: the tests; the Specs line adds `docs/device-explorer-phase3-spec.md`; the markers re-grepped.
  - `map.md:20`: "Device explorer: browse an Android device (shared storage, app data of debug builds, device root), save files to the PC, upload, sync, drop and delete".
  - `code_map.md:17`: add `src-tauri/capabilities/device-explorer.json`.
  - `shortcut-markers.md`:
    - Add a row for `APP_PULL_MAX_ITEMS` ("an app-data folder copies file by file, at most 5000 items" | "stream `run-as tar`").
    - Re-grep the `TRANSFER_TIMEOUT` and `MAX_ENTRIES` rows.
    - `23 markers` → `24 markers`.
  - `areas/sqlite-inspector.md`:
    - `lib.rs:184` → re-grep (expected `186`).
    - Add one line: "`pull_file` (`android_db.rs:479`) is `pub(crate)`. The device explorer also uses it for app-data pulls, so a change affects both."
  - `areas/usage-statusline.md:8`: `lib.rs:262` → re-grep (expected `264`); "line 277" → `279`; "line 273" → `275`.
  - `doc-mismatches.md`: one row. `docs/device-explorer-spec.md` says "/sdcard and /storage, read-only"; phases 2 and 3 superseded it (writes in Shared storage, any readable path, app data).
  - `CHANGELOG.md`: a new top entry `## 2026-10-30 - device explorer: tree, app data, device root, drop`, one line per page above.
  - `index.md`: no change.
  - Run the `karpathy-brain` update operation (`map.md` "Always").
- **lines**: about 50.
- **exec**: judgment. Fresh line numbers and prose.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && grep -c "android_push_dropped\|android_debuggable_apps" llm_wiki/areas/device-explorer.md && grep -n "never sends a local path" llm_wiki/areas/device-explorer.md; grep -n "markers\." llm_wiki/shortcut-markers.md`. Expected: a count ≥ 2; the "never sends" line is gone, or carries the drop exception; `24 markers.`

## Overall verify (Git Bash)
```bash
cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri \
 && rustfmt --check --edition 2021 src/device_explorer.rs src/android_db.rs \
 && cargo test -p herdr-gui --lib 2>&1 | grep -E "^test result|FAILED" \
 && ! cargo clippy -p herdr-gui -- -D warnings 2>&1 | grep -E "device_explorer\.rs|android_db\.rs|src.lib\.rs" \
 && cd .. && npx tsc --noEmit \
 && npx vitest run 2>&1 | grep -E "Test Files|Tests " \
 && ! grep -n innerHTML src/deviceExplorer.ts \
 && npx vite build --outDir "$TEMP/cowbell-vite-check" --emptyOutDir >/dev/null && ls "$TEMP/cowbell-vite-check/device-explorer.html" \
 && git status --short src-tauri/src/commands.rs src/appTerminalMouse.ts src/links.ts tests/unit/links.test.ts src-tauri/capabilities/mirror-tools.json
```
Expected:
- rustfmt is silent.
- `test result: ok. 420 passed` and no `FAILED`.
- The clippy grep is empty. Clippy itself still fails on the known `flutter.rs` lints. The `engine.rs:1410` unused `sh` warning is pre-existing and appears only in test builds.
- tsc exit 0.
- `Test Files 77 passed`, `Tests 977 passed`.
- No innerHTML, and the html path is printed.
- The 5 off-limits or untouched files show only their earlier ` M`.

---
What I left out: the mock's "Show my debug apps instead" link, its bottom status bar with the item count, a typed path box, a retry on a size mismatch, a Cancel button for long pulls, and `/data/user/0/<pkg>` paths.

Risks you must know:
- The app-file pull relies on adb 36.0.2 quoting `exec-out` arguments. The fallback (the one-string `sh_quote` form) is verified but not wired in.
- A folder pull of a running app's `databases/` may fail its size check (D7). Live check 5 decides whether that is acceptable.