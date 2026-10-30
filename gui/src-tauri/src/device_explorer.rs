//! Device explorer: browse the shared storage of an adb device (`/sdcard`,
//! `/storage`), `adb pull` an item to a place picked in a native dialog,
//! `adb push` picked PC files or a folder into it, and delete one item.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::android::check_device_id;
use crate::android_db::{
    adb_command, adb_output, adb_path, focus_window, is_valid_package, pull_file, shell_failure,
    trimmed_stderr,
};
use crate::commands::ApiError;
use crate::flutter::api_error;
use crate::mirror_tools;

const LIST_TIMEOUT: Duration = Duration::from_secs(30);
// shortcut: one fixed 1 h timeout for every pull, push and delete, and no Cancel; scale it by size or add Cancel if users move bigger trees.
const TRANSFER_TIMEOUT: Duration = Duration::from_secs(60 * 60);
// shortcut: a folder shows at most 5000 entries, folders first; add paging if users browse bigger folders.
const MAX_ENTRIES: usize = 5000;
// shortcut: an app-data folder copies file by file (one adb call per file and per folder), at most 5000 items; stream `run-as tar` if users copy bigger trees.
const APP_PULL_MAX_ITEMS: usize = 5000;
const PATH_MAX_BYTES: usize = 4096;
/// Third-party packages whose `run-as` works, one per line. A fixed script:
/// nothing from the PC reaches the device `sh`. `run-as` fails for a release
/// build. Live: 34 packages in 2.5 s (SM-A145F), 157 in 2.4 s (2412DPC0AG).
const DEBUGGABLE_APPS: &str =
    "for p in $(pm list packages -3); do p=${p#package:}; run-as $p true 2>/dev/null && echo $p; done";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEntry {
    pub name: String,
    pub is_dir: bool,
    /// Bytes. For a folder `ls` prints its block size, so the page shows it for files only.
    pub size: u64,
    /// `YYYY-MM-DD HH:MM` in the device's local time, as `ls -l` prints it.
    /// Empty when `ls` could not stat the item.
    pub modified: String,
    /// The `ls -l` mode, such as `drwxrws---`. All `?` after the type letter:
    /// `ls` could not stat the item, so Android refuses it to the shell user.
    pub mode: String,
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
    /// Paths dropped on the window (`android_push_dropped` only, never from
    /// the webview's `kind`): `push --sync`, and `refused_names` keeps a
    /// dropped file from replacing a device file.
    #[serde(skip_deserializing)]
    Drop,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushedPaths {
    /// The pushed names. Each one is at `<dir>/<name>` on the device.
    pub names: Vec<String>,
    /// adb's summary line: `2 files pushed, 0 skipped. 0.0 MB/s (...)`.
    pub summary: String,
}

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
                rest.split('/')
                    .all(|s| !s.is_empty() && s != "." && s != "..")
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
    matches!(
        path.split('/').nth(1),
        Some("" | "proc" | "sys" | "dev" | "d")
    )
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
        && s.bytes().zip(pattern.bytes()).all(|(c, p)| {
            if p == b'9' {
                c.is_ascii_digit()
            } else {
                c == p
            }
        })
}

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

/// One `ls -lAL` line: mode, links, owner, group, size, date, time, one
/// space, then the name with its own spaces. `None` for any other line
/// (`total`, an `ls:` error, a device node with `major, minor`).
pub fn parse_ls_line(line: &str) -> Option<DeviceEntry> {
    let line = line.strip_suffix('\r').unwrap_or(line);
    if let Some(entry) = parse_unstat_line(line) {
        return Some(entry);
    }
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
        && matches!(
            mode.as_bytes()[0],
            b'-' | b'd' | b'l' | b'c' | b'b' | b'p' | b's'
        );
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
        mode: mode.to_string(),
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
    let trimmed = cleaned.trim_end_matches(['.', ' ']);
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
    if matches!(kind, PushKind::Sync | PushKind::Drop) {
        args.push("--sync".into());
    }
    args.extend(locals.iter().map(|p| p.as_os_str().to_owned()));
    args.push(format!("{dir}/").into());
    args
}

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

/// `adb pull` of a path that the shell user can read. The sync protocol
/// takes the device path as is: no device shell, so no quoting.
async fn adb_pull(
    adb: &Path,
    device_id: &str,
    path: &str,
    dest: &Path,
) -> Result<String, ApiError> {
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
    let entries = list_entries(&adb, &device_id, None, parent)
        .await
        .map_err(|e| {
            api_error(
                "delete_failed",
                format!("Could not check the delete: {}", e.message),
            )
        })?;
    if entries.iter().any(|e| e.name == name) {
        return Err(api_error(
            "delete_failed",
            format!("{path} is still on the device"),
        ));
    }
    Ok(())
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
            .inner_size(1100.0, 640.0)
            .min_inner_size(800.0, 360.0)
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
            "",
            "/",
            "sdcard",
            "/sdcardx",
            "/sdcard2/x",
            "/data/local/tmp",
            "/sdcard/../data",
            "/sdcard/x/..",
            "/sdcard/./x",
            "/sdcard/",
            "/sdcard//x",
            "/sdcard/a\nb",
            "/sdcard/a\u{7f}b",
            "/sdcard/a\0b",
            long.as_str(),
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
                ".nearby",
                "Alarms",
                "obb",
                "Simplr APK",
                " a  b.txt",
                "-5034958385594290967",
                "primary",
                "Simplr SALES V.6.1.2.12.19.apk",
            ]
        );
        assert_eq!(
            entries[1],
            DeviceEntry {
                name: "Alarms".into(),
                is_dir: true,
                size: 3452,
                modified: "2023-04-25 17:13".into(),
                mode: "drwxrws---".into(),
            }
        );
        let apk = entries.iter().find(|e| e.name.ends_with(".apk")).unwrap();
        assert_eq!((apk.is_dir, apk.size), (false, 36_286_255));
    }

    #[test]
    fn parse_ls_needs_a_total_line() {
        assert_eq!(parse_ls("total 0\n"), Some(vec![]));
        assert_eq!(
            parse_ls("ls: /sdcard/nope/: No such file or directory\n"),
            None
        );
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
        let stderr =
            b"/sdcard/x.apk: 1 file pulled, 0 skipped. 36.0 MB/s (74479389 bytes in 1.975s)\r\n";
        assert_eq!(
            pull_summary(b"", stderr),
            "/sdcard/x.apk: 1 file pulled, 0 skipped. 36.0 MB/s (74479389 bytes in 1.975s)"
        );
        assert_eq!(pull_summary(b"", b""), "");
    }

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
            let err =
                android_list_dir("RF8W3085JEW".into(), path.into(), package.map(String::from))
                    .await
                    .unwrap_err();
            assert_eq!(err.code, "bad_device_path", "{path:?}");
        }
    }

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
        assert_eq!(
            push_args(PushKind::Drop, &locals, "/sdcard/Download"),
            [
                "push",
                "--sync",
                r"C:\a b\x.txt",
                r"C:\y.txt",
                "/sdcard/Download/"
            ]
            .map(OsString::from)
        );
    }

    #[test]
    fn push_names_refuse_drive_roots_relative_paths_and_long_names() {
        let base = std::env::temp_dir();
        assert_eq!(
            push_name("/sdcard/Download", &base.join("a b.txt")).as_deref(),
            Some("a b.txt")
        );
        assert_eq!(
            push_name("/sdcard", &base.join("-rf")).as_deref(),
            Some("-rf")
        );
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
        assert_eq!(
            serde_json::from_str::<PushKind>(r#""files""#).unwrap(),
            PushKind::Files
        );
        assert_eq!(
            serde_json::from_str::<PushKind>(r#""folder""#).unwrap(),
            PushKind::Folder
        );
        assert_eq!(
            serde_json::from_str::<PushKind>(r#""sync""#).unwrap(),
            PushKind::Sync
        );
        assert!(serde_json::from_str::<PushKind>(r#""Sync""#).is_err());
        assert!(serde_json::from_str::<PushKind>(r#""drop""#).is_err());
    }

    #[tokio::test]
    async fn delete_refuses_unsafe_and_protected_paths_before_adb() {
        let err = android_delete_path("x; rm".into(), "/sdcard/Download/a".into(), false)
            .await
            .unwrap_err();
        assert_eq!(err.code, "bad_device_id");
        for (path, code) in [
            ("/sdcard/Download/x/..", "bad_device_path"),
            ("/sdcard/Download/a\nb", "bad_device_path"),
            ("/data/local/tmp/x", "bad_device_path"),
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
            "",
            "data",
            "//",
            "/data/",
            "/data//x",
            "/data/../x",
            "/./data",
            "/data/.",
            "/a\nb",
            "/a\u{7f}b",
            "/a\0b",
            long.as_str(),
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
        for bad_pkg in [
            "x; id",
            "com",
            "com..x",
            "com.x/../y",
            "-com.x",
            "com.x y",
            "com.$(id)",
        ] {
            assert!(
                !is_app_path(bad_pkg, &format!("/data/data/{bad_pkg}")),
                "{bad_pkg}"
            );
        }
        assert!(check_read_path("/data/local/tmp", None).is_ok());
        assert_eq!(
            check_read_path("/data/local/tmp", Some(pkg))
                .unwrap_err()
                .code,
            "bad_device_path"
        );
    }

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

    #[test]
    fn kernel_dirs_are_not_pulled_as_folders() {
        for bad in ["/", "/proc", "/proc/1", "/sys/kernel", "/dev", "/d"] {
            assert!(is_kernel_dir(bad), "{bad}");
        }
        for ok in [
            "/data/local/tmp",
            "/sdcard",
            "/system/etc",
            "/dev-tools",
            "/procx",
        ] {
            assert!(!is_kernel_dir(ok), "{ok}");
        }
    }

    #[test]
    fn debuggable_packages_keep_valid_names_once() {
        let out = "net.simplr.woosimdp230l\r\ncom.simplr.rad.dev\r\n\r\ncom.simplr.rad.dev\r\nrun-as: package not debuggable: com.waze\r\nx; id\r\n";
        assert_eq!(
            debuggable_packages(out),
            ["com.simplr.rad.dev", "net.simplr.woosimdp230l"]
        );
        assert!(debuggable_packages("").is_empty());
    }

    #[test]
    fn copy_error_trusts_only_a_matching_size() {
        assert_eq!(copy_error("/d/x", 5, 5, b"hello"), None);
        assert_eq!(copy_error("/d/x", 0, 0, b""), None);
        // live (SM-A145F): exec-out exits 0 and writes the error into the file
        assert_eq!(
            copy_error(
                "/d/no pe",
                10,
                67,
                b"cat: /data/data/com.simplr.rad.dev/no pe: No such file or directory\n"
            )
            .as_deref(),
            Some("cat: /data/data/com.simplr.rad.dev/no pe: No such file or directory")
        );
        assert_eq!(
            copy_error(
                "/d/x",
                10,
                41,
                b"run-as: package not debuggable: com.waze\n"
            )
            .as_deref(),
            Some("run-as: package not debuggable: com.waze")
        );
        assert!(copy_error("/d/x", 57344, 4096, b"SQLite format 3\0")
            .unwrap()
            .contains("4096 bytes arrived, the listing said 57344"));
    }

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
            (
                "x; rm",
                "/sdcard/Download",
                vec![file.clone()],
                "bad_device_id",
            ),
            (
                "RF8W3085JEW",
                "/data/local/tmp",
                vec![file.clone()],
                "bad_device_path",
            ),
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
}
