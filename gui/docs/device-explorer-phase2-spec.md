Mr.Tjhay — the phase 2 spec for the device explorer is below: upload files or a folder, sync a PC folder to the device (one way), and delete one item after a confirm. I changed nothing in the repo. The only device probes were read-only `ls`/`rm --help` calls and `adb push -n` dry runs; a later `ls -d` showed nothing landed. Scratch probe files are in `C:\Users\Reinaldo\AppData\Local\Temp\claude\C--Users-Reinaldo-Backend-herdr\a665484b-73a3-46f8-a191-7868b0925429\scratchpad\cowbell-probe`.

**Two places where I go beyond your brief:**
- **Delete guard.** Your "fewer than 3 segments" rule still allows `rm -rf /storage/emulated/0` and `/storage/self/primary`. Each of those is the whole internal storage. I replaced it with a rule based on depth below the storage volume. It refuses everything your rule refuses, plus those two paths, plus `/sdcard/Android/{data,obb,media}`.
- **Window size.** I raised the explorer window's size so the three new text buttons fit.

# Spec: Device explorer phase 2 (upload, sync, delete)

## Header

**goal**: The explorer window gets three toolbar buttons that copy PC items into the folder on screen through native dialogs: "Upload files", "Upload folder" and "Sync folder here". Each row also gets a delete icon that always asks for confirmation.

**deliverables**
- Edit:
  - `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
  - `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\lib.rs` (2 lines; hand edit only)
  - `C:\Users\Reinaldo\Backend\herdr\gui\src\flutter\flutterApi.ts`
  - `C:\Users\Reinaldo\Backend\herdr\gui\src\android\deviceFiles.ts`
  - `C:\Users\Reinaldo\Backend\herdr\gui\tests\unit\deviceFiles.test.ts`
  - `C:\Users\Reinaldo\Backend\herdr\gui\src\deviceExplorer.ts`
- The caller edits the wiki pages listed in step 10.
- Must stay untouched:
  - `commands.rs`, `appTerminalMouse.ts`, `links.ts`, `mirror_tools.rs`, `mirrorTools.ts`, `flutter.rs`, `fuzzy.ts`, `quickOpen.ts`, `files.rs`.
  - Also `src/ui/confirmPopover.ts`, `src/style.css` (no new CSS is needed), `capabilities/*` and `android_db.rs`.
- Never run `cargo fmt`, never run rustfmt on `lib.rs`, never run `npm run check`. Do not commit.

**contracts**
- `ApiError {code, message}` comes from `commands.rs:182-186`.
- Tauri maps snake_case args to camelCase, as the existing `androidPullPath` does (`flutterApi.ts:160-162`).

| Rust command (`device_explorer.rs`) | TS wrapper (`flutterApi.ts`) | Ok | Error codes |
|---|---|---|---|
| `android_push_paths(app, window: WebviewWindow, device_id: String, dir: String, kind: PushKind)` | `androidPushPaths(deviceId, dir, kind: PushKind): Promise<PushedPaths \| null>` | `Option<PushedPaths { names: Vec<String>, summary: String }>`. `None` means the user cancelled. | `bad_device_id`, `bad_device_path`, `adb_not_found`, `bad_local_name`, `list_failed` (dest folder gone), `dest_exists` (Files/Folder only), `push_failed` (adb stderr + "Files that adb copied before the error stay on the device"), `adb_failed`, `adb_timeout` (1 h) |
| `android_delete_path(device_id: String, path: String, is_dir: bool)` | `androidDeletePath(deviceId, path, isDir): Promise<void>` | `()` | `bad_device_id`, `bad_device_path`, `protected_path`, `adb_not_found`, `delete_failed` (rm text, a failed recheck, or "still on the device"), `adb_failed`, `adb_timeout` (1 h) |

- `PushKind` is a Rust `#[derive(Deserialize)] #[serde(rename_all = "lowercase")] enum { Files, Folder, Sync }`. In TS it is `type PushKind = "files" | "folder" | "sync"`.
- The existing enums only derive `Serialize`. This is the first `Deserialize` enum used as a command argument. A test pins the wire names.
- Push argv: `adb -s <id> push [--sync] <abs local path…> <dir>/`.
  - The device folder is **raw**, not `sh_quote`d. The sync protocol has no shell, and quoting breaks it (phase 1 counterintuitive #2).
  - The trailing `/` is always appended.
- Delete argv: `adb -s <id> shell rm -f|-rf <sh_quote(path)>`.
  - The quoted path is one argv element.
  - `-rf` is used only when `is_dir`.
- Delete guard `is_deletable_path`, mirrored in TS as `isDeletablePath`:
  - The path must pass `is_valid_device_path`.
  - It must have at least 2 segments below its volume, or 3 when the first segment below the volume is `Android` (any case).
  - Volume roots: `/sdcard` (1 segment); `/storage/emulated/<user>` and `/storage/self/primary` (3); `/storage/<uuid>` (2).
- Local-name decision (your "refuse odd names?"): refuse with `bad_local_name` when any of these is true:
  - `file_name()` is `None`. A drive root `D:\` has no name, and adb would push the whole drive. With Sync, that means the whole of `D:` goes to the phone.
  - The path is not absolute. This keeps "a local argv element never starts with `-`" true by construction.
  - The name is not valid Unicode.
  - `<dir>/<name>` fails `is_valid_device_path`: a control char such as DEL, or more than 4096 bytes.
  - Why: the explorer must be able to list and delete what it pushes. Shell metacharacters, a leading `-`, spaces and non-ASCII are all accepted. Push uses the sync protocol, which has no shell, and Windows already forbids `<>:"/\|?*`, the characters Android's shared storage rejects.
- Timeout: `PULL_TIMEOUT` is renamed to `TRANSFER_TIMEOUT` (1 h). Pull, push, sync and `rm` all use it. The listing keeps `LIST_TIMEOUT` (30 s).

**edge cases** (live = probed today on RF8W3085JEW, Android 15, adb 1.0.41 / 36.0.2)
- Shared storage ignores case. Live: `ls -d '/sdcard/download'` printed `/sdcard/download`, exit 0. So `dest_exists` compares lowercase names (`existing_name`), and the `Android` check ignores case. Without this, `readme.txt` would silently overwrite `README.txt`.
- `rm -f` on a missing path prints nothing and exits 0 (live). So the exit code cannot prove a delete. The backend lists the parent again and checks that the name is gone.
  - A name that `ls` printed lossily (U+FFFD) makes `rm` match nothing, silently. The recheck then reports `delete_failed: … is still on the device`.
- Old adb merges stderr into stdout and exits 0 (`android_db.rs:165-180`). So any `rm` output counts as failure (`shell_failure`).
- Toybox `rm` (live `rm --help`: `usage: rm [-fiRrv]`). Toybox source says "Intentionally fail non-recursive attempts to remove even an empty dir". So a file row (`-f`) whose name is now a folder fails with `Is a directory` instead of deleting a tree.
- `/storage/self/primary -> /storage/emulated/0` (live). `/storage/emulated` holds `0` and `obb` (live). Every alias of the whole storage is refused.
- A piped `adb push` writes one line per item plus a total line to **stderr**; stdout is empty and the exit code is 0. Live dry run: `…\a b.txt: 1 file pushed…`, `…\it's.txt: 1 file pushed…`, `2 files pushed, 0 skipped. 0.0 MB/s (8 bytes in 0.013s)`.
  - The existing `pull_summary` returns the last line, which is the total.
- A folder push prints `…\cowbell-probe\: 3 files pushed, 0 skipped…` (live, `-n --sync`).
- A non-ASCII local path (`日本語 ü.txt`) passes through adb.exe argv (live dry run, exit 0).
- A missing local path gives `adb: error: cannot stat '…nope.txt': No such file or directory`, exit 1 (live). This gives `push_failed`.
- A dry run to unwritable `/storage/` reports success (live). Dry run writes to /dev/null, so the permission-denied push text is **not** verified.
- Destination folder deleted or missing before the push: adb would copy a folder's content *into* the missing dest instead of `<dest>/<name>` (from adb's `do_sync_push` source, not run live). So every push, Sync included, calls `list_entries(dir)` first. `list_failed` stops it.
- The dest folder holds more than 5000 entries: `list_entries` is uncapped. Only `android_list_dir` truncates.
- A folder push that fails part way leaves the files copied so far. The `push_failed` message says so. The UI does not refresh on failure, because `list()` would hide the error bar. Refresh shows the state.
- Closing the window during a push or delete does not stop it. This is the same as phase 1 pull.
- Every new string is set through `textContent` or the popover's DOM text. `innerHTML` stays at 0.

**risks: injection and wrong target (delete is the dangerous one)**
1. Shell injection through the path. The path is one argv element `sh_quote(path)`, and `'` becomes `'\''`. Control characters are rejected, so no newline or NUL reaches adb. The existing test covers `$( )`, backticks, `;`, `|`, `*`, and the new `rm_args` test pins it.
2. Option injection.
   - The device path always starts with `/`, so `rm` never reads it as an option. `rm`, `-f` and `-rf` are fixed literals.
   - Local push paths are absolute (checked), so they start with `C:\` or `\\`, never `-`. The device dest starts with `/`.
3. Traversal and links. `.`, `..`, empty segments and a trailing `/` are rejected. So `/sdcard/x/..` cannot become `/sdcard`, and `rm -r link/` cannot follow a link: `rm -r link` without the slash removes only the link.
4. **The whole storage through an alias.** `/storage/emulated/0` and `/storage/self/primary` have 3 segments, so the requested rule allows them. The volume-aware rule refuses them, and also their top-level folders (`/storage/emulated/0/Download`, `/storage/ABCD-1234/DCIM`). The test table first lists every path the requested rule refuses, then the extra ones.
5. **`/sdcard/Android/data|obb|media`** pass a 2-deep rule. `rm -rf` on one of them wipes every app's external files.
   - Decision: refuse them (3 segments are needed below `Android`, any case).
   - One app's folder `/sdcard/Android/data/<pkg>` stays deletable. A developer needs that.
6. Stale UI target. The popover is attached to `#fx-root`, so it survives a `renderList` re-render.
   - The full target path and `isDir` are fixed when the row is drawn, never rebuilt from `path` in `onConfirm`.
   - The popover shows the full path. Otherwise a listing that lands while the popover is open would retarget the delete to the same name in another folder.
7. Type flip (a file row that is now a folder): `-f` fails safe. The reverse flip deletes the file the user named.
8. Device mix-up. The window is bound to one id (`-s <id>`, `check_device_id`), and the popover names the device.
9. Concurrency. One device write at a time (`writing`), and delete icons are disabled while listing or writing. Delete during a pull of the same item is not blocked; the pull then fails.
10. Timeout. After 1 h, the kill stops only the adb client, and `rm` may go on, on the device (not verified). The recheck does not run, and `adb_timeout` is returned.
11. The Rust guards are the authority. The TS mirror only hides the trash icon on rows that the backend would refuse.

**counterintuitive** (each verified, or marked)
1. The requested "≥3 segments" rule lets the whole storage through (live symlink `/storage/self/primary -> /storage/emulated/0`).
2. Storage ignores case (live), so name checks must ignore case.
3. `adb push --sync` means "different timestamps", not "newer". Live help text: `--sync: only push files that have different timestamps on the host than the device`.
   - An older PC copy replaces a newer device copy.
   - The Sync tooltip says "Files whose time differs replace the device copy".
4. `rm -f` success tells you nothing (live).
5. `adb push -n` is a dry run that stores nothing (live). It is the safe live argv check.
6. TS narrowing of `root`/`params` (after `if (!root) return`) is not kept inside hoisted `function` declarations. So `confirmDelete` must be an arrow `const`, like `confirmDiscard` in `dbInspector.ts:347`. The existing function declarations in `deviceExplorer.ts` only use `id`, never `root`/`params`. Not compiled yet: tsc catches it.
7. `.db-btn` has `flex-shrink: 0` (`style.css:2026`), so the bar cannot shrink. By CSS arithmetic, 6 text buttons + Up + gaps ≈ 750 px. At the old 560 px minimum, Sync and the status would fall off-screen. Estimate only; live check 7 confirms it.

**rejected alternative**: three commands (`android_upload_files`, `android_upload_folder`, `android_sync_folder`). They lost because they repeat the same guard chain three times (check, dialog, name rules, dest listing, argv, error mapping) and add a lib.rs line and a wrapper each. One command with a `PushKind` enum keeps the guards in one place, and the "skip `dest_exists` for Sync" rule is one `if`.

**acceptance**
- Offline: the overall verify at the end. Expected:
  - Rust `device_explorer` tests go from 7 to 14 (+7).
  - `deviceFiles.test.ts` goes from 4 to 7 (+3, baseline run today).
  - tsc exit 0.
  - The clippy grep prints nothing.
  - No `innerHTML`.
- adb-level, runnable now, writes nothing:
  - `MSYS_NO_PATHCONV=1 "C:/Users/Reinaldo/AppData/Local/Android/sdk/platform-tools/adb.exe" -s RF8W3085JEW push -n --sync "C:\Users\Reinaldo\AppData\Local\Temp\claude\C--Users-Reinaldo-Backend-herdr\a665484b-73a3-46f8-a191-7868b0925429\scratchpad\cowbell-probe" /sdcard/Download/` should print `…cowbell-probe\: 4 files pushed, 0 skipped…`, exit 0.
  - Then `… shell ls -d "'/sdcard/Download/cowbell-probe'"` should print `No such file or directory`.
- Live, user-run (writes to the phone; about 10 min). Run `cd C:/Users/Reinaldo/Backend/herdr/gui && npm run tauri dev` and open Explorer on the phone:
  1. In `/sdcard/Download`, click "Upload files" and pick 2 small files. The status shows `Uploaded 2 files to /sdcard/Download`, and both rows appear.
  2. Upload one of them again, then a copy whose name differs only in case. Both times the error bar shows `/sdcard/Download/<name> already exists on the device. Delete or rename it first`.
  3. Click "Upload folder" with a small folder `T`. The status shows `Uploaded to /sdcard/Download/T`, and opening `T` shows its files. This verifies that a folder lands at `<dir>/<name>`.
  4. Edit one file in the PC copy of `T`. In `/sdcard/Download`, click "Sync folder here" and pick `T`.
     - The status shows `Synced into /sdcard/Download/T. Nothing on the device was deleted`.
     - The tooltip should show `1 file pushed, N skipped`. If all files are pushed again, FUSE did not keep the mtime: note it (slow, still correct).
  5. Click the trash icon on one uploaded file. The popover shows `Delete <name>?` and the full path, and a bare Enter cancels. Click Delete: the row disappears. Then delete `T`: the title says `… and everything inside it?`.
  6. At `/sdcard` no row has a trash icon. In `/sdcard/Android`, `data`, `obb` and `media` have none either.
  7. Make the window as narrow as it goes. All buttons and part of the status stay visible. Otherwise, adjust step 5's numbers.

**not verified**
- A folder lands at `<dir>/<name>` (adb source; live check 3).
- `--sync` skipping on FUSE mtimes (live check 4).
- The push permission-denied text (dry run cannot show it).
- `rm -f <dir>` → `Is a directory` (toybox source only; I did not run rm on a real folder).
- Whether `rm` continues on the device after a timeout kill.
- Non-UTF-8 Windows names giving `bad_local_name` (no portable test).
- The window width numbers.

**smallest-change check**
- Step 1: a rename plus a doc fix. The header now says "Nothing writes to the device", which becomes false. A push using a constant named `PULL_TIMEOUT` would mislead the reader.
- Step 2: no existing helper covers the delete guard, the argv builders, the name rule or the case-insensitive clash check. Each is pure, so it is testable without adb, as you asked.
- Step 3: the listing now has 3 users (list, push dest check, delete recheck). Per your preference, 3 or more uses means extract, and this is a move with no new logic.
- Step 4: two commands are the minimum. One push command covers 3 buttons.
- Step 5: the bar cannot shrink (`flex-shrink: 0`), so the labels you named need room. Changing two numbers is the smallest fix.
- Steps 6-7: registration and typed wrappers are required by the conventions (`conventions.md:5-6`).
- Step 8: the TS mirror stops a trash icon from showing on rows the backend refuses. `pushStatus` is the branchy status text, kept pure and tested.
- Step 9: it reuses `openConfirmPopover` (already used in a secondary window by `dbInspector.ts:352,393`), `el`, `button`, the error bar, `.db-*` classes and the codicons. No CSS is added.
- Step 10: the wiki rules require it.

---

## Steps

### step 1: rename the long timeout and fix the module doc
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**:
  - Lines 1-3. Old:
    ```
    //! Device explorer: a read-only browser for the shared storage of an adb
    //! device (`/sdcard`, `/storage`), and `adb pull` of one file or folder to a
    //! place that the user picks in a native dialog. Nothing writes to the device.
    ```
    New:
    ```
    //! Device explorer: browse the shared storage of an adb device (`/sdcard`,
    //! `/storage`), `adb pull` an item to a place picked in a native dialog,
    //! `adb push` picked PC files or a folder into it, and delete one item.
    ```
  - Lines 21-22. Old:
    ```
    // shortcut: one fixed 1 h timeout for every pull and no Cancel; scale it by size or add Cancel if users pull bigger trees.
    const PULL_TIMEOUT: Duration = Duration::from_secs(60 * 60);
    ```
    New:
    ```
    // shortcut: one fixed 1 h timeout for every pull, push and delete, and no Cancel; scale it by size or add Cancel if users move bigger trees.
    const TRANSFER_TIMEOUT: Duration = Duration::from_secs(60 * 60);
    ```
  - `    let out = match adb_output(cmd, PULL_TIMEOUT).await {` → `    let out = match adb_output(cmd, TRANSFER_TIMEOUT).await {`
- **lines**: 6 + 4 + 2 = 12.
- **exec**: mechanical. Exact text, no line shift.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && grep -c PULL_TIMEOUT src/device_explorer.rs; cargo test device_explorer 2>&1 | grep "test result: ok. 7"`. Expected: `0`, then `test result: ok. 7 passed`.

### step 2: push types, pure helpers and their tests
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**:
  - `use std::path::{Path, PathBuf};` → `use std::ffi::OsString;\nuse std::path::{Path, PathBuf};`
  - `use serde::Serialize;` → `use serde::{Deserialize, Serialize};`
  - After the `PulledPath` struct (anchor: its last 3 lines `    /// adb's summary line: \`<path>: 1 file pulled, 0 skipped. 36.0 MB/s (...)\`.\n    pub summary: String,\n}`), insert:
```rust

/// What `android_push_paths` picks in its dialog, and how adb copies it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PushKind {
    /// One or more files.
    Files,
    /// One folder.
    Folder,
    /// One folder with `push --sync`: only files whose time differs go, and
    /// nothing on the device is deleted.
    Sync,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushedPaths {
    /// The pushed names. Each one is at `<dir>/<name>` on the device.
    pub names: Vec<String>,
    /// adb's summary line: `2 files pushed, 0 skipped. 0.0 MB/s (...)`.
    pub summary: String,
}
```
  - After `pull_summary` (anchor: `        .find(|l| !l.is_empty())\n        .unwrap_or("")\n        .to_string()\n}`), insert:
```rust

/// A device path that `android_delete_path` may remove: valid, and at least
/// two segments below its storage volume. The volume is `/sdcard`,
/// `/storage/emulated/<user>`, `/storage/self/primary` (all three are the
/// same storage) or `/storage/<uuid>` (an SD card). So a volume and its
/// top-level folders (`Download`, `DCIM`) are refused. Below `Android` (any
/// case: shared storage ignores case) it needs three, so `Android/data`,
/// `Android/obb` and `Android/media` stay, while one app's folder can go.
pub fn is_deletable_path(path: &str) -> bool {
    let segments: Vec<&str> = path.split('/').skip(1).collect();
    let volume = match segments.as_slice() {
        ["sdcard", ..] => 1,
        ["storage", "emulated" | "self", ..] => 3,
        _ => 2,
    };
    let below = segments.get(volume..).unwrap_or_default();
    let needed = if below
        .first()
        .is_some_and(|s| s.eq_ignore_ascii_case("Android"))
    {
        3
    } else {
        2
    };
    is_valid_device_path(path) && below.len() >= needed
}

/// `adb shell` arguments for a delete. The quoted path is one element. It
/// starts with `/` and never ends with `/` (`is_valid_device_path`), so `rm`
/// never reads it as an option and never follows a link to a folder. A file
/// gets `-f` only: if the row is stale and the name is now a folder, toybox
/// `rm` fails with `Is a directory` instead of removing a tree.
pub fn rm_args(path: &str, is_dir: bool) -> [String; 3] {
    [
        "rm".to_string(),
        if is_dir { "-rf" } else { "-f" }.to_string(),
        sh_quote(path),
    ]
}

/// The device name for a picked local path: its last part. `None` for a
/// drive root such as `D:\` (adb would push the whole drive), a relative
/// path (it could start with `-`), a name that is not valid Unicode, or a
/// name that makes `<dir>/<name>` an invalid device path. The explorer must
/// be able to list and delete what it pushes.
pub fn push_name(dir: &str, local: &Path) -> Option<String> {
    let name = local.file_name()?.to_str()?;
    (local.is_absolute() && is_valid_device_path(&format!("{dir}/{name}")))
        .then(|| name.to_string())
}

/// `adb push` arguments after `-s <id>`: `push [--sync] <local…> <dir>/`.
/// The device folder goes raw: the sync protocol runs no device shell, and
/// a quoted path would fail. `<dir>` exists (the caller lists it first), so
/// adb puts a pushed folder at `<dir>/<name>`, not in place of `<dir>`.
pub fn push_args(kind: PushKind, locals: &[PathBuf], dir: &str) -> Vec<OsString> {
    let mut args = vec![OsString::from("push")];
    if kind == PushKind::Sync {
        args.push("--sync".into());
    }
    args.extend(locals.iter().map(|p| p.as_os_str().to_owned()));
    args.push(format!("{dir}/").into());
    args
}

/// The first of `names` that `entries` already holds, compared without
/// case: shared storage ignores case (live: `/sdcard/download` resolves), so
/// a push of `readme.txt` would overwrite `README.txt`.
pub fn existing_name<'a>(names: &'a [String], entries: &[DeviceEntry]) -> Option<&'a str> {
    names
        .iter()
        .find(|n| {
            entries
                .iter()
                .any(|e| e.name.to_lowercase() == n.to_lowercase())
        })
        .map(String::as_str)
}
```
  - Tests: the file ends with `            assert_eq!(err.code, "bad_device_path", "{path:?}");\n        }\n    }\n}`. Insert the following before the final `}`, after the 3 lines above it:
```rust

    #[test]
    fn deletable_paths_keep_two_segments_below_the_volume() {
        for ok in [
            "/sdcard/Download/a.txt",
            "/sdcard/Download/.nearby",
            "/sdcard/Download/-rf",
            "/sdcard/DCIM/Camera",
            "/sdcard/Android/data/com.example.app",
            "/storage/emulated/0/Download/a.txt",
            "/storage/self/primary/DCIM/Camera",
            "/storage/1234-ABCD/DCIM/Camera",
        ] {
            assert!(is_deletable_path(ok), "{ok}");
        }
        // The requested rule (4 roots, fewer than 3 segments) first, then what it lets through.
        for bad in [
            "/sdcard",
            "/storage",
            "/storage/emulated",
            "/storage/self",
            "/sdcard/Download",
            "/storage/1234-ABCD",
            "/storage/emulated/0",
            "/storage/self/primary",
            "/storage/emulated/0/Download",
            "/storage/self/primary/DCIM",
            "/storage/1234-ABCD/DCIM",
            "/sdcard/Android",
            "/sdcard/Android/data",
            "/sdcard/android/obb",
            "/storage/emulated/0/Android/media",
            "/sdcard/Download/x/..",
            "/sdcard/Download/",
            "/sdcard/Download/a\nb",
            "/data/local/tmp/x",
        ] {
            assert!(!is_deletable_path(bad), "{bad:?}");
        }
    }

    #[test]
    fn rm_args_quote_the_path_as_one_element() {
        assert_eq!(
            rm_args("/sdcard/Download/a b.txt", false),
            ["rm", "-f", "'/sdcard/Download/a b.txt'"]
        );
        assert_eq!(
            rm_args("/sdcard/Download/it's $(id);*", true),
            ["rm", "-rf", r"'/sdcard/Download/it'\''s $(id);*'"]
        );
    }

    #[test]
    fn push_args_end_with_the_raw_device_folder() {
        let locals = [PathBuf::from(r"C:\a b\x.txt"), PathBuf::from(r"C:\y.txt")];
        assert_eq!(
            push_args(PushKind::Files, &locals, "/sdcard/Simplr APK"),
            ["push", r"C:\a b\x.txt", r"C:\y.txt", "/sdcard/Simplr APK/"].map(OsString::from)
        );
        assert_eq!(
            push_args(PushKind::Folder, &locals[..1], "/sdcard/it's"),
            ["push", r"C:\a b\x.txt", "/sdcard/it's/"].map(OsString::from)
        );
        assert_eq!(
            push_args(PushKind::Sync, &locals[..1], "/sdcard"),
            ["push", "--sync", r"C:\a b\x.txt", "/sdcard/"].map(OsString::from)
        );
    }

    #[test]
    fn push_names_refuse_drive_roots_relative_paths_and_long_names() {
        let base = std::env::temp_dir();
        assert_eq!(
            push_name("/sdcard/Download", &base.join("a b.txt")).as_deref(),
            Some("a b.txt")
        );
        assert_eq!(push_name("/sdcard", &base.join("-rf")).as_deref(), Some("-rf"));
        assert_eq!(
            push_name("/sdcard", &base.join("日本語 it's $(x)")).as_deref(),
            Some("日本語 it's $(x)")
        );
        let root = base.ancestors().last().unwrap();
        assert_eq!(push_name("/sdcard", root), None);
        assert_eq!(push_name("/sdcard", Path::new("a.txt")), None);
        assert_eq!(
            push_name("/sdcard", &base.join("x".repeat(PATH_MAX_BYTES))),
            None
        );
    }

    #[test]
    fn existing_names_ignore_case() {
        let entries =
            parse_ls("total 1\n-rw-rw---- 1 u0_a207 media_rw 73 2026-10-26 18:55 README.txt\n")
                .unwrap();
        let names = ["a.txt".to_string(), "readme.txt".to_string()];
        assert_eq!(existing_name(&names, &entries), Some("readme.txt"));
        assert_eq!(existing_name(&names[..1], &entries), None);
    }

    #[test]
    fn push_kind_reads_the_lowercase_names() {
        assert_eq!(serde_json::from_str::<PushKind>(r#""files""#).unwrap(), PushKind::Files);
        assert_eq!(serde_json::from_str::<PushKind>(r#""folder""#).unwrap(), PushKind::Folder);
        assert_eq!(serde_json::from_str::<PushKind>(r#""sync""#).unwrap(), PushKind::Sync);
        assert!(serde_json::from_str::<PushKind>(r#""Sync""#).is_err());
    }
```
  - Then run `rustfmt --edition 2021 src/device_explorer.rs` (only this file).
- **lines**: about 3 + 22 + 80 + 105 = 210 added.
- **exec**: judgment. A large insertion; the executor may need to fix a compile or clippy detail (e.g. `unwrap_or_default` on `Option<&[&str]>`, or array-vs-Vec `assert_eq!`).
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test device_explorer 2>&1 | grep "test result: ok. 13"`. Expected: `test result: ok. 13 passed; 0 failed`.

### step 3: extract `list_entries` (3 users: list, push check, delete recheck)
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**: old (the whole current `android_list_dir`, from `/// Lists a device folder with \`adb shell ls -lAL '<path>/'\`. The trailing \`/\`` through its closing `}` after `Ok(DirListing { entries, truncated })`). New:
```rust
/// Every entry of a device folder, from `adb shell ls -lAL '<path>/'`. The
/// trailing `/` lists the target of a link such as `/sdcard`; `-L` shows
/// linked folders as folders. `path` must pass `check_path` first. No cap:
/// the push and delete checks must see names past `MAX_ENTRIES`.
async fn list_entries(
    adb: &Path,
    device_id: &str,
    path: &str,
) -> Result<Vec<DeviceEntry>, ApiError> {
    let mut cmd = adb_command(adb, device_id);
    cmd.args(["shell", "ls", "-lAL"])
        .arg(sh_quote(&format!("{path}/")));
    // ls exits 1 when one entry cannot be read; the `total` line decides.
    let out = adb_output(cmd, LIST_TIMEOUT).await?;
    parse_ls(&String::from_utf8_lossy(&out.stdout)).ok_or_else(|| {
        let text = shell_failure(false, &out.stdout, &out.stderr).unwrap_or_default();
        api_error("list_failed", text)
    })
}

/// Lists a device folder: at most `MAX_ENTRIES` entries, folders first.
#[tauri::command]
pub async fn android_list_dir(device_id: String, path: String) -> Result<DirListing, ApiError> {
    check_device_id(&device_id)?;
    check_path(&path)?;
    let mut entries = list_entries(&adb_path()?, &device_id, &path).await?;
    let truncated = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);
    Ok(DirListing { entries, truncated })
}
```
- **lines**: 20 removed + 29 added = 49.
- **exec**: mechanical. Exact old block and new text; behavior is unchanged.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test device_explorer 2>&1 | grep "test result: ok. 13"`. Expected: `ok. 13 passed` (`list_rejects_unsafe_input_before_adb` still passes).

### step 4: the two commands and the delete guard test
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**:
  - Insert before the line `/// Opens the device explorer window for \`device_id\`, or focuses the open one.`:
```rust
/// Pushes PC files, or one PC folder, into the device folder `dir`. A native
/// dialog picks them, so the webview never sends a local path. `Ok(None)`
/// when the user cancels. Each item lands at `<dir>/<name>`. Files and
/// Folder refuse a name that `dir` already holds: adb would overwrite a file
/// or merge into a folder without a word. Sync merges by design and deletes
/// nothing on the device.
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
        PushKind::Sync => dialog
            .set_title(format!("Sync a folder into {dir}. Nothing on the device is deleted"))
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
    let mut names = Vec::with_capacity(locals.len());
    for local in &locals {
        let Some(name) = push_name(&dir, local) else {
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
    let entries = list_entries(&adb, &device_id, &dir).await?;
    if kind != PushKind::Sync {
        if let Some(name) = existing_name(&names, &entries) {
            return Err(api_error(
                "dest_exists",
                format!("{dir}/{name} already exists on the device. Delete or rename it first"),
            ));
        }
    }
    let mut cmd = adb_command(&adb, &device_id);
    cmd.args(push_args(kind, &locals, &dir));
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
    Ok(Some(PushedPaths {
        names,
        summary: pull_summary(&out.stdout, &out.stderr),
    }))
}

/// Deletes a device file (`rm -f`) or a folder with everything inside it
/// (`rm -rf`), then lists the parent folder to check that the name is gone.
/// `is_deletable_path` refuses the storage volumes and their top-level folders.
#[tauri::command]
pub async fn android_delete_path(
    device_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), ApiError> {
    check_device_id(&device_id)?;
    check_path(&path)?;
    if !is_deletable_path(&path) {
        return Err(api_error(
            "protected_path",
            format!("Cowbell does not delete {path}: it is a storage root or a top-level folder"),
        ));
    }
    let adb = adb_path()?;
    let mut cmd = adb_command(&adb, &device_id);
    cmd.arg("shell").args(rm_args(&path, is_dir));
    // A big folder can take minutes. A timeout kill stops only adb; rm may go on, on the device.
    let out = adb_output(cmd, TRANSFER_TIMEOUT).await?;
    // rm prints nothing on success. Old adb merges stderr into stdout and exits 0.
    if let Some(text) = shell_failure(out.status.success(), &out.stdout, &out.stderr) {
        let text = if is_dir {
            format!("{text}. Some items inside can be gone already")
        } else {
            text
        };
        return Err(api_error("delete_failed", text));
    }
    // `rm -f` is silent when nothing matches the name (for example a name that
    // `ls` printed lossily), so only a new listing proves the delete.
    let (parent, name) = path
        .rsplit_once('/')
        .expect("a deletable path has at least 3 segments");
    let entries = list_entries(&adb, &device_id, parent)
        .await
        .map_err(|e| api_error("delete_failed", format!("Could not check the delete: {}", e.message)))?;
    if entries.iter().any(|e| e.name == name) {
        return Err(api_error(
            "delete_failed",
            format!("{path} is still on the device"),
        ));
    }
    Ok(())
}

```
  - Append to `mod tests` (before its final `}`):
```rust

    #[tokio::test]
    async fn delete_refuses_unsafe_and_protected_paths_before_adb() {
        let err = android_delete_path("x; rm".into(), "/sdcard/Download/a".into(), false)
            .await
            .unwrap_err();
        assert_eq!(err.code, "bad_device_id");
        for (path, code) in [
            ("/sdcard/Download/x/..", "bad_device_path"),
            ("/sdcard/Download/a\nb", "bad_device_path"),
            ("/sdcard", "protected_path"),
            ("/sdcard/Download", "protected_path"),
            ("/storage/emulated/0", "protected_path"),
            ("/sdcard/Android/data", "protected_path"),
        ] {
            let err = android_delete_path("RF8W3085JEW".into(), path.into(), true)
                .await
                .unwrap_err();
            assert_eq!(err.code, code, "{path:?}");
        }
    }
```
  - Then run `rustfmt --edition 2021 src/device_explorer.rs`.
- **lines**: about 125 + 20 = 145 added.
- **exec**: judgment. New command bodies; there may be a clippy detail. With edition 2021, `collapsible_if` should not fire on `if … { if let … }`; if it does, merge the `if`s with a `match` guard.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test device_explorer 2>&1 | grep "test result: ok. 14"`. Expected: `ok. 14 passed`.

### step 5: room for three more text buttons
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\device_explorer.rs`
- **edit**: `            .inner_size(900.0, 640.0)\n            .min_inner_size(560.0, 360.0)` → `            .inner_size(1100.0, 640.0)\n            .min_inner_size(800.0, 360.0)`
- **lines**: 4.
- **exec**: judgment. The numbers are a CSS estimate: about 750 px of buttons that cannot shrink, `.db-btn` `flex-shrink: 0`, `style.css:2020-2027`. Live check 7 decides the final values.
- **verify**: `grep -n "inner_size" C:/Users/Reinaldo/Backend/herdr/gui/src-tauri/src/device_explorer.rs`. Expected: `1100.0, 640.0` and `800.0, 360.0`.

### step 6: register the 2 commands
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\lib.rs`
- **edit**: `            device_explorer::android_pull_path,` → `            device_explorer::android_pull_path,\n            device_explorer::android_push_paths,\n            device_explorer::android_delete_path,`. Hand edit; never rustfmt `lib.rs`.
- **lines**: 2 added.
- **exec**: mechanical. Exact anchor, which occurs once (line 128).
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri && grep -c "device_explorer::android_" src/lib.rs && cargo test device_explorer 2>&1 | grep "test result: ok. 14"`. Expected: `5`, then `ok. 14 passed`. `generate_handler!` type-checks the commands.

### step 7: typed wrappers
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\flutter\flutterApi.ts`
- **edit**: old `export function androidPullPath(deviceId: string, path: string, isDir: boolean): Promise<PulledPath | null> {\n  return invoke<PulledPath | null>("android_pull_path", { deviceId, path, isDir });\n}` → the same 3 lines, followed by:
```ts

/** What `androidPushPaths` picks: files, one folder, or one folder for `adb push --sync`. */
export type PushKind = "files" | "folder" | "sync";

export interface PushedPaths {
  /** The pushed names. Each one is at `<dir>/<name>` on the device. */
  names: string[];
  /** adb's summary line, for a tooltip. */
  summary: string;
}

/** A native picker, then `adb push` into the device folder `dir`. Resolves `null` when cancelled. Rejects `bad_local_name`, `dest_exists` (files and folder only), `list_failed`, `push_failed`, `adb_timeout`. */
export function androidPushPaths(deviceId: string, dir: string, kind: PushKind): Promise<PushedPaths | null> {
  return invoke<PushedPaths | null>("android_push_paths", { deviceId, dir, kind });
}

/** `rm -f` (file) or `rm -rf` (folder) on the device, then a check that the name is gone. Rejects `protected_path` and `delete_failed`. */
export function androidDeletePath(deviceId: string, path: string, isDir: boolean): Promise<void> {
  return invoke<void>("android_delete_path", { deviceId, path, isDir });
}
```
- **lines**: 21 added.
- **exec**: mechanical. Exact anchor and text.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit`. Expected: exit 0.

### step 8: TS mirror of the delete guard, the status text, and tests
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\android\deviceFiles.ts`, `C:\Users\Reinaldo\Backend\herdr\gui\tests\unit\deviceFiles.test.ts`
- **edit**:
  - `deviceFiles.ts`: old `// The path rule is the same as \`is_valid_device_path\` in \`src-tauri/src/device_explorer.rs\`.\n\nexport const SDCARD_PATH = "/sdcard";` → `// The path rules are the same as \`is_valid_device_path\` and \`is_deletable_path\` in \`src-tauri/src/device_explorer.rs\`.\n\nimport type { PushKind } from "../flutter/flutterApi";\n\nexport const SDCARD_PATH = "/sdcard";`. The type import is erased at runtime, so the file still loads no Tauri code.
  - `deviceFiles.ts`: append at the end of the file:
```ts

/** Same rule as `is_deletable_path`: at least two segments below the storage volume (`/sdcard`, `/storage/emulated/<user>`, `/storage/self/primary`, `/storage/<uuid>`), three below `Android` in any case. */
export function isDeletablePath(path: string): boolean {
  const segments = path.split("/").slice(1);
  const volume = segments[0] === "sdcard" ? 1 : segments[1] === "emulated" || segments[1] === "self" ? 3 : 2;
  const below = segments.slice(volume);
  return isValidDevicePath(path) && below.length >= (below[0]?.toLowerCase() === "android" ? 3 : 2);
}

/** The status line after `androidPushPaths`. Each pushed name is at `<dir>/<name>`. */
export function pushStatus(kind: PushKind, dir: string, names: string[]): string {
  if (kind === "sync") return `Synced into ${dir}/${names[0]}. Nothing on the device was deleted`;
  return names.length === 1 ? `Uploaded to ${dir}/${names[0]}` : `Uploaded ${names.length} files to ${dir}`;
}
```
  - Test file: `import { isValidDevicePath, parentPath } from "../../src/android/deviceFiles";` → `import { isDeletablePath, isValidDevicePath, parentPath, pushStatus } from "../../src/android/deviceFiles";`. Then append at the end of the file:
```ts

describe("isDeletablePath", () => {
  it("accepts items two segments below a storage volume", () => {
    for (const ok of ["/sdcard/Download/a.txt", "/sdcard/Download/-rf", "/sdcard/Android/data/com.example.app", "/storage/emulated/0/Download/a.txt", "/storage/self/primary/DCIM/Camera", "/storage/1234-ABCD/DCIM/Camera"])
      expect(isDeletablePath(ok), ok).toBe(true);
  });
  it("refuses volumes, top-level folders, Android/data and invalid paths", () => {
    for (const bad of ["/sdcard", "/storage", "/storage/emulated", "/storage/self", "/sdcard/Download", "/storage/emulated/0", "/storage/self/primary", "/storage/emulated/0/Download", "/storage/1234-ABCD/DCIM", "/sdcard/Android/data", "/sdcard/android/obb", "/sdcard/Download/x/..", "/sdcard/Download/"])
      expect(isDeletablePath(bad), bad).toBe(false);
  });
});

describe("pushStatus", () => {
  it("names where the push landed, and says that sync deletes nothing", () => {
    expect(pushStatus("files", "/sdcard/Download", ["a.txt"])).toBe("Uploaded to /sdcard/Download/a.txt");
    expect(pushStatus("files", "/sdcard/Download", ["a.txt", "b.txt"])).toBe("Uploaded 2 files to /sdcard/Download");
    expect(pushStatus("folder", "/sdcard", ["Photos"])).toBe("Uploaded to /sdcard/Photos");
    expect(pushStatus("sync", "/sdcard", ["Photos"])).toBe("Synced into /sdcard/Photos. Nothing on the device was deleted");
  });
});
```
- **lines**: about 18 + 22 = 40.
- **exec**: mechanical. Exact anchors and text.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx vitest run tests/unit/deviceFiles.test.ts 2>&1 | grep "Tests "`. Expected: `Tests  7 passed (7)`.

### step 9: the explorer page
- **files**: `C:\Users\Reinaldo\Backend\herdr\gui\src\deviceExplorer.ts`
- **edit** (anchors from the current file):
  - Lines 1-5 (header). Replace with:
    ```
    // The device explorer page: browse the shared storage of an adb device
    // (`/sdcard`, `/storage`), save a file or folder to this PC, upload or sync
    // PC files into the folder on screen, and delete an item after a confirm.
    // Errors show inline (`#error-notices` does not exist on this page). Every
    // name comes from the device, so the page sets text with `textContent` and
    // never uses `innerHTML`.
    ```
  - `import { DOWNLOAD_PATH, SDCARD_PATH, parentPath } from "./android/deviceFiles";` → `import { DOWNLOAD_PATH, SDCARD_PATH, isDeletablePath, parentPath, pushStatus } from "./android/deviceFiles";`
  - `import { androidListDir, androidPullPath, type DeviceEntry } from "./flutter/flutterApi";` → `import { androidDeletePath, androidListDir, androidPullPath, androidPushPaths, type DeviceEntry, type PushKind } from "./flutter/flutterApi";`
  - `import { applySavedTheme } from "./themes/savedTheme";` → that line + `\nimport { openConfirmPopover } from "./ui/confirmPopover";`
  - `  // Two flags: a long pull must not lock browsing.\n  let listing = false;\n  let pulling = false;` → `  // Three flags: a long pull or push must not lock browsing. \`writing\` keeps\n  // one upload, sync or delete at a time.\n  let listing = false;\n  let pulling = false;\n  let writing = false;`
  - `  refreshBtn.title = "List the folder again";` → that line + `\n  const uploadFilesBtn = button("btn db-btn", "Upload files", "cloud-upload");\n  const uploadFolderBtn = button("btn db-btn", "Upload folder", "cloud-upload");\n  const syncBtn = button("btn db-btn", "Sync folder here", "sync");`
  - `  bar.append(upBtn, sdcardBtn, downloadBtn, refreshBtn, pathText, status, progress);` → `  bar.append(upBtn, sdcardBtn, downloadBtn, refreshBtn, uploadFilesBtn, uploadFolderBtn, syncBtn, pathText, status, progress);`
  - `    sdcardBtn.disabled = downloadBtn.disabled = refreshBtn.disabled = listing;` → that line + :
    ```
        uploadFilesBtn.disabled = uploadFolderBtn.disabled = syncBtn.disabled = !loaded || writing;
        uploadFilesBtn.title = `Copy files from this PC into ${path}`;
        uploadFolderBtn.title = `Copy a folder from this PC into ${path}`;
        syncBtn.title = `Copy a PC folder into ${path}/<folder name>. Files whose time differs replace the device copy. Nothing on the device is deleted`;
    ```
  - `    progress.classList.toggle("is-busy", listing || pulling);` → `    progress.classList.toggle("is-busy", listing || pulling || writing);`
  - `    for (const btn of Array.from(table.querySelectorAll<HTMLButtonElement>("button[data-save]"))) btn.disabled = pulling;` → that line + `\n    for (const btn of Array.from(table.querySelectorAll<HTMLButtonElement>("button[data-delete]"))) btn.disabled = listing || writing;`
  - `    head.append(el("th", undefined, "Name"), el("th", "db-num", "Size"), el("th", undefined, "Modified"), el("th"));` → the same with one more `, el("th")` before `);`
  - Old `      const saveCell = el("td");\n      saveCell.append(save);\n      const tr = el("tr");\n      tr.append(nameCell, size, el("td", undefined, entry.modified), saveCell);`. New:
    ```
          const saveCell = el("td");
          saveCell.append(save);
          // Fixed here: a listing that lands while the confirm is open must not retarget the delete.
          const target = `${path}/${entry.name}`;
          const deleteCell = el("td");
          if (isDeletablePath(target)) {
            const del = button("icon-btn db-page-btn", "", "trash");
            del.dataset.delete = "";
            del.title = `Delete ${entry.name} from the device`;
            del.setAttribute("aria-label", del.title);
            del.addEventListener("click", () => confirmDelete(del, target, entry.isDir));
            deleteCell.append(del);
          }
          const tr = el("tr");
          tr.append(nameCell, size, el("td", undefined, entry.modified), saveCell, deleteCell);
    ```
  - `      td.colSpan = 4;` → `      td.colSpan = 5;`
  - After the `pull` function (anchor `    } finally {\n      pulling = false;\n      renderControls();\n    }\n  }`), insert:
```ts

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

  /** `rm` on the device; the backend checks that the name is gone. One device write at a time. */
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
      if (path === target.slice(0, slash)) void list(path);
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
    if (writing) return;
    writing = true;
    const dir = path;
    errorBar.hidden = true;
    status.textContent = kind === "sync" ? `Syncing into ${dir}…` : `Uploading to ${dir}…`;
    status.title = "";
    renderControls();
    try {
      const pushed = await androidPushPaths(id, dir, kind);
      status.textContent = pushed ? pushStatus(kind, dir, pushed.names) : "";
      status.title = pushed ? `${status.textContent}\n${pushed.summary}` : "";
      if (pushed && path === dir) void list(dir);
    } catch (err) {
      status.textContent = "";
      showError(errorMessage(err));
    } finally {
      writing = false;
      renderControls();
    }
  }
```
  - `  refreshBtn.addEventListener("click", () => void list(path));` → that line + `\n  uploadFilesBtn.addEventListener("click", () => void push("files"));\n  uploadFolderBtn.addEventListener("click", () => void push("folder"));\n  syncBtn.addEventListener("click", () => void push("sync"));`
  - Notes for the executor:
    - `deleteItem` begins with `if (writing) return`, which is the `onConfirm` busy guard, as in `dbInspector.ts:400`.
    - `list()` silently skips a call while a listing runs. That is accepted, and Refresh recovers.
    - The icon choice (`cloud-upload` twice, `sync`) is free.
- **lines**: about 95 changed.
- **exec**: judgment. DOM wiring, and the narrowing detail in counterintuitive #6.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && ! grep -n innerHTML src/deviceExplorer.ts && grep -c "data-delete\|dataset.delete" src/deviceExplorer.ts`. Expected: tsc exit 0, no innerHTML line, `2`.

### step 10: llm_wiki (the caller does this): pages and refs that change
- `llm_wiki/areas/device-explorer.md`:
  - Purpose (line 4): drop "Nothing writes to the device". Say that the window uploads, syncs (one way, PC → device, never deletes) and deletes one item after a confirm.
  - Key files (line 7): add `android_push_paths`, `android_delete_path`. Re-grep the line numbers of all 5 commands.
  - Line 8: re-grep `is_valid_device_path` (+1 from the `OsString` import) and `sh_quote`. Add `is_deletable_path`, `rm_args`, `push_name`, `push_args`, `existing_name`, `list_entries`.
  - Line 9: `main` (now line 31). Add `isDeletablePath` and `pushStatus` to the `deviceFiles.ts` exports.
  - Line 10: add `androidPushPaths`, `androidDeletePath`, `PushKind`.
  - Limits:
    - `PULL_TIMEOUT` → `TRANSFER_TIMEOUT` (pull, push, delete).
    - The push dest is raw `<dir>/`.
    - `dest_exists` ignores case, and applies to files and folder only.
    - Sync merges, copies when timestamps differ, the PC copy wins, and it never deletes.
    - The `bad_local_name` rules.
    - The delete guard (volume-aware, `Android/data|obb|media`), `-f` vs `-rf`, and the recheck listing.
    - `list_entries` is uncapped.
  - Edges:
    - Window 1100×640, min 800.
    - A timeout kill may leave `rm` running.
    - A partial push keeps its files.
    - mtime on FUSE is not verified.
    - Closing the window does not stop a push.
  - Markers line 28: `device_explorer.rs:21,23` → re-grep (expected `22,24`).
  - Spec line: add the phase 2 spec path where the caller saves it.
- `llm_wiki/shortcut-markers.md:30-31`: the row becomes `TRANSFER_TIMEOUT: one fixed 1 h timeout for every pull, push and delete, no Cancel`, and the refs are re-grepped (`:22`, `:24`). The marker count is unchanged.
- `llm_wiki/map.md:20`: "browse an Android device's /sdcard, save files to the PC" → add "upload, sync and delete".
- `llm_wiki/CHANGELOG.md`: a new top entry for device explorer phase 2, listing the room, map and marker edits and the moved refs.
- `lib.rs` refs after line 128 shift by +2. They are **already 1 stale today**: `clear_local_copies` is at 182, `run_usage_poll_loop` at 260, emit at 271, sleep at 275. Expected after step 6 (re-grep):
  - `areas/sqlite-inspector.md:16` `lib.rs:181` → `184`
  - `areas/usage-statusline.md:8` `lib.rs:259` → `262`, `line 274` → `277`, `line 270` → `273`
- Unchanged:
  - `architecture.md:6` (`lib.rs:47`, `:84`)
  - `conventions.md:4,5,19`
  - `macos-port.md`, `flutter-android.md`
  - `code_map.md:17` (same files)
  - `index.md`
  - `sqlite-inspector.md:11` (`flutterApi.ts:82-122`; the new wrappers come after line 162)
- **exec**: judgment. Fresh line numbers and STE prose.
- **verify**: `cd C:/Users/Reinaldo/Backend/herdr/gui && grep -rn "PULL_TIMEOUT\|Nothing writes" llm_wiki src src-tauri/src`. Expected: no output.

## Overall verify (Git Bash)
```bash
cd C:/Users/Reinaldo/Backend/herdr/gui/src-tauri \
 && rustfmt --check --edition 2021 src/device_explorer.rs \
 && cargo test device_explorer 2>&1 | grep -E "^test result: ok. 14 passed|FAILED" \
 && ! cargo clippy --workspace -- -D warnings 2>&1 | grep -E "device_explorer\.rs|lib\.rs" \
 && cd .. && npx tsc --noEmit \
 && npx vitest run 2>&1 | grep -E "Test Files|Tests " \
 && ! grep -n innerHTML src/deviceExplorer.ts \
 && git status --short src-tauri/src/commands.rs src/appTerminalMouse.ts src/links.ts src-tauri/src/mirror_tools.rs src/mirrorTools.ts src-tauri/src/flutter.rs src/files/fuzzy.ts src/ui/quickOpen.ts src-tauri/src/files.rs src/ui/confirmPopover.ts
```
Expected:
- rustfmt is silent.
- `test result: ok. 14 passed`, and no `FAILED`.
- The clippy grep is empty. Clippy itself still fails on the known `flutter.rs` lints.
- tsc exit 0.
- vitest: all passed, +3 tests over the pre-change baseline.
- No innerHTML.
- The off-limits files show only the `M` status they had before this work.

---
Skipped:
- A Cancel button for long transfers, and byte-level progress.
- An overwrite-confirm for upload: it is refused instead.
- Two-way sync, or a sync that deletes.
- A trash icon on refused rows: no icon is drawn instead.
- Wrapping long names in the popover.
- Closing the popover when the list re-renders: the target is fixed and shown in full instead.

Not checked: everything under "not verified" above. Main risk: the live check must confirm that a folder push lands at `<dir>/<name>` and that `--sync` skips unchanged files on this phone's FUSE storage, before the UI's summary text can be trusted.