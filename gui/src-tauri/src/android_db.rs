//! SQLite inspector for adb devices, in copy mode: no agent runs on the
//! device. The list shows the SQLite databases the app holds open now, found
//! through `run-as`, so only debuggable apps work. The database, its `-wal`
//! and `-shm` are pulled to a temp copy. Write mode changes only that copy;
//! `android_push_database` is the one command that writes to the device.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::Duration;

use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde::Serialize;
use sha1::{Digest, Sha1};
use tauri::Manager;
use tokio::process::Command as AsyncCommand;

use crate::android::{check_device_id, resolve_adb_from_env};
use crate::commands::ApiError;
use crate::engine::apply_no_window;
use crate::flutter::{api_error, run_capture};
use crate::mirror_tools;

const ADB_TIMEOUT: Duration = Duration::from_secs(10);
const PULL_TIMEOUT: Duration = Duration::from_secs(120);
const HEAD_BYTES: u64 = 256;
const STDERR_MAX_CHARS: usize = 2000;
// shortcut: at most 200 open files go to one `head` argv; split into batches if an app holds more.
const MAX_CANDIDATES: usize = 200;
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\0";
const WAL_MAGIC: [[u8; 4]; 2] = [[0x37, 0x7f, 0x06, 0x82], [0x37, 0x7f, 0x06, 0x83]];
const JOURNAL_MAGIC: [u8; 8] = [0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7];
const SIBLINGS: [&str; 3] = ["-wal", "-shm", "-journal"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PulledDatabase {
    pub path: String,
    pub tables: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPage {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub has_more: bool,
    /// True when write mode ran a statement that changes the copy.
    pub wrote: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushedDatabase {
    pub backup_path: String,
}

/// Two or more dot-separated segments, each a letter then [A-Za-z0-9_].
/// The name reaches the device's `sh -c`, so this is the injection guard.
pub fn is_valid_package(name: &str) -> bool {
    let mut segments = 0;
    for segment in name.split('.') {
        let mut chars = segment.chars();
        let Some(first) = chars.next() else {
            return false;
        };
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
// shortcut: names with spaces or non-ASCII are rejected, not quoted; quote them for the device sh if users hit it.
pub fn is_valid_rel_path(rel: &str) -> bool {
    rel.len() <= 1024
        && rel.split('/').all(|s| {
            !s.is_empty()
                && s != "."
                && s != ".."
                && !s.starts_with('-')
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
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
    let running: HashSet<&str> = processes(ps)
        .into_iter()
        .map(|(_, n)| n.split(':').next().unwrap_or(n))
        .collect();
    let mut out: Vec<String> = pm
        .lines()
        .filter_map(|l| l.trim().strip_prefix("package:"))
        .filter(|p| running.contains(p) && is_valid_package(p))
        .map(String::from)
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Every process of `package`: `pidof` misses `com.x:remote`, so read `ps`.
pub fn package_pids(ps: &str, package: &str) -> Vec<u32> {
    processes(ps)
        .into_iter()
        .filter(|(_, n)| {
            *n == package || n.strip_prefix(package).is_some_and(|r| r.starts_with(':'))
        })
        .map(|(pid, _)| pid)
        .collect()
}

/// Open files under the app data folder from `ls -l /proc/<pid>/fd`,
/// relative to that folder. fd targets use `/data/data/<pkg>/`, while
/// run-as runs in `/data/user/0/<pkg>`, so both prefixes count. Drops
/// -wal/-shm/-journal, deleted files and unsafe paths. May repeat.
pub fn open_paths(ls: &str, package: &str) -> Vec<String> {
    let prefixes = [
        format!("/data/data/{package}/"),
        format!("/data/user/0/{package}/"),
    ];
    ls.lines()
        .filter_map(|l| l.split_once(" -> ").map(|(_, t)| t.trim()))
        .filter(|t| !t.ends_with(" (deleted)"))
        .filter_map(|t| prefixes.iter().find_map(|p| t.strip_prefix(p.as_str())))
        .filter(|rel| is_valid_rel_path(rel) && !SIBLINGS.iter().any(|s| rel.ends_with(s)))
        .map(String::from)
        .collect()
}

/// The candidates whose first bytes are the SQLite magic, from
/// `head -v -c 16 <paths…>` output: `==> <path> <==\n` then the bytes.
/// A directory or a missing file has no magic after its marker (or no marker).
pub fn sqlite_paths(out: &[u8], candidates: &[String]) -> Vec<String> {
    candidates
        .iter()
        .filter(|c| {
            let marker = format!("==> {c} <==\n");
            out.windows(marker.len())
                .position(|w| w == marker.as_bytes())
                .is_some_and(|i| out[i + marker.len()..].starts_with(SQLITE_MAGIC))
        })
        .cloned()
        .collect()
}

/// The failure text of an `adb shell` command that prints nothing on success,
/// or `None`. Old adb merges stderr into stdout and always exits 0, so any
/// output counts as a failure too.
pub fn shell_failure(success: bool, stdout: &[u8], stderr: &[u8]) -> Option<String> {
    let text = format!(
        "{} {}",
        String::from_utf8_lossy(stderr).trim(),
        String::from_utf8_lossy(stdout).trim()
    );
    let text: String = text.trim().chars().take(STDERR_MAX_CHARS).collect();
    match (success, text.is_empty()) {
        (true, true) => None,
        (false, true) => Some("adb shell failed".to_string()),
        _ => Some(text),
    }
}

/// The lower-case digest from toybox `sha1sum <file>` output (`<40 hex>  <file>`).
pub fn parse_sha1sum(out: &str) -> Option<String> {
    let token = out.split_whitespace().next()?;
    (token.len() == 40 && token.chars().all(|c| c.is_ascii_hexdigit()))
        .then(|| token.to_ascii_lowercase())
}

/// `run-as <package> <cmd…>` for `adb shell`. Every part is a validated name
/// or a fixed word, so the device `sh` sees no metacharacter.
pub fn run_as<'a>(package: &'a str, cmd: &[&'a str]) -> Vec<&'a str> {
    let mut argv = vec!["run-as", package];
    argv.extend_from_slice(cmd);
    argv
}

/// adb push cannot write into the app folder; `run-as cp` copies from here.
pub fn device_tmp_path(package: &str) -> String {
    format!("/data/local/tmp/cowbell-{package}.sqlite")
}

/// `<base>/Cowbell/sqlite-backups/<device>/<package>/<file name>-<YYYYMMDD-HHMMSS>`,
/// the time in UTC like the statusline.rs backups. Its `-wal` and `-shm` sit beside it.
// shortcut: backups are never pruned; add a keep-last-N if the folder grows.
pub fn backup_path(
    base: &Path,
    device_id: &str,
    package: &str,
    rel: &str,
    epoch_secs: i64,
) -> PathBuf {
    let (year, month, day, hour, minute, second) =
        crate::statusline::civil_from_unix_utc(epoch_secs);
    let name = rel.rsplit('/').next().unwrap_or(rel);
    base.join("Cowbell")
        .join("sqlite-backups")
        .join(device_dir_name(device_id))
        .join(package)
        .join(format!(
            "{name}-{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}"
        ))
}

/// `<temp>/cowbell-sqlite`: every pulled copy lives under it.
fn local_root() -> PathBuf {
    std::env::temp_dir().join("cowbell-sqlite")
}

/// The device id as a folder name. `:` (Wi-Fi adb) is not allowed in a
/// Windows path, and `..` passes `is_valid_device_id`.
fn device_dir_name(device_id: &str) -> String {
    device_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// `<temp>/cowbell-sqlite/<device>`.
fn local_device_dir(device_id: &str) -> PathBuf {
    local_root().join(device_dir_name(device_id))
}

/// `<temp>/cowbell-sqlite/<device>/<package>/<rel segments>`.
pub fn local_db_path(device_id: &str, package: &str, rel: &str) -> PathBuf {
    let base = local_device_dir(device_id).join(package);
    rel.split('/')
        .fold(base, |path, segment| path.join(segment))
}

/// Deletes every pulled copy. Called at startup: an app exit or a crash
/// skips the per-window cleanup in `android_db_window`.
pub fn clear_local_copies() {
    let _ = std::fs::remove_dir_all(local_root());
}

fn sibling(db_path: &Path, suffix: &str) -> PathBuf {
    let mut os = db_path.as_os_str().to_owned();
    os.push(suffix);
    PathBuf::from(os)
}

pub fn is_wal(head: &[u8]) -> bool {
    WAL_MAGIC.iter().any(|m| head.starts_with(m))
}

fn not_debuggable(package: &str) -> ApiError {
    api_error(
        "not_debuggable",
        format!("{package} is not debuggable. Only debug builds can be inspected"),
    )
}

/// The pulled database does not start with the SQLite magic. A run-as or
/// cat error arrives as the file's text (see `pull_file`).
pub fn bad_pull_error(package: &str, rel: &str, head: &[u8]) -> ApiError {
    let text = String::from_utf8_lossy(head);
    let line = text.lines().next().unwrap_or("").trim();
    if line.contains("not debuggable") {
        not_debuggable(package)
    } else if line.starts_with("run-as:") || line.starts_with("cat:") {
        api_error("pull_failed", line.to_string())
    } else {
        api_error("not_sqlite", format!("{rel} is not a SQLite database"))
    }
}

fn check_target(device_id: &str, package: &str, rel: Option<&str>) -> Result<(), ApiError> {
    check_device_id(device_id)?;
    if !is_valid_package(package) {
        return Err(api_error(
            "bad_package",
            format!("Unsafe package name: {package}"),
        ));
    }
    if let Some(rel) = rel.filter(|r| !is_valid_rel_path(r)) {
        return Err(api_error(
            "bad_db_path",
            format!("Unsafe database path: {rel}"),
        ));
    }
    Ok(())
}

pub(crate) fn adb_path() -> Result<PathBuf, ApiError> {
    resolve_adb_from_env().ok_or_else(|| {
        api_error(
            "adb_not_found",
            "adb was not found; install Android SDK platform-tools",
        )
    })
}

fn remove_if_present(path: &Path) -> Result<(), ApiError> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(api_error("io_error", e.to_string()))
        }
        _ => Ok(()),
    }
}

/// Runs an adb command and returns all its output, whatever the exit code.
/// Unlike `flutter::run_capture`, stdout stays raw bytes and survives a
/// non-zero exit (`ls` exits 1 when one fd closes during the listing).
pub(crate) async fn adb_output(
    mut cmd: AsyncCommand,
    timeout: Duration,
) -> Result<Output, ApiError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_no_window(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|e| api_error("adb_failed", e.to_string()))?;
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(result) => result.map_err(|e| api_error("adb_failed", e.to_string())),
        Err(_) => Err(api_error(
            "adb_timeout",
            format!("timed out after {}s", timeout.as_secs()),
        )),
    }
}

pub(crate) fn adb_command(adb: &Path, device_id: &str) -> AsyncCommand {
    let mut cmd = AsyncCommand::new(adb);
    cmd.args(["-s", device_id]);
    cmd
}

pub(crate) fn trimmed_stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr)
        .trim()
        .chars()
        .take(STDERR_MAX_CHARS)
        .collect()
}

/// Runs `adb shell <args>` for a command that prints nothing on success.
async fn adb_shell(
    adb: &Path,
    device_id: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<(), ApiError> {
    let mut cmd = adb_command(adb, device_id);
    cmd.arg("shell").args(args);
    let out = adb_output(cmd, timeout).await?;
    match shell_failure(out.status.success(), &out.stdout, &out.stderr) {
        Some(text) => Err(api_error("push_failed", text)),
        None => Ok(()),
    }
}

/// Packages with a running process, third-party only, sorted.
#[tauri::command]
pub async fn android_running_apps(device_id: String) -> Result<Vec<String>, ApiError> {
    check_device_id(&device_id)?;
    let adb = adb_path()?;
    let mut ps = adb_command(&adb, &device_id);
    ps.args(["shell", "ps", "-A", "-o", "PID,NAME"]);
    let mut pm = adb_command(&adb, &device_id);
    pm.args(["shell", "pm", "list", "packages", "-3"]);
    let (ps, pm) = tokio::try_join!(
        run_capture(ps, ADB_TIMEOUT, "adb_timeout", "adb_failed"),
        run_capture(pm, ADB_TIMEOUT, "adb_timeout", "adb_failed"),
    )?;
    Ok(running_packages(&ps, &pm))
}

/// Paths, relative to the app data folder, of the SQLite databases the app
/// holds open now.
#[tauri::command]
pub async fn android_app_databases(
    device_id: String,
    package_name: String,
) -> Result<Vec<String>, ApiError> {
    check_target(&device_id, &package_name, None)?;
    let adb = adb_path()?;
    let mut ps = adb_command(&adb, &device_id);
    ps.args(["shell", "ps", "-A", "-o", "PID,NAME"]);
    let ps = run_capture(ps, ADB_TIMEOUT, "adb_timeout", "adb_failed").await?;
    let pids = package_pids(&ps, &package_name);
    if pids.is_empty() {
        return Err(api_error(
            "not_running",
            format!("{package_name} is not running. Start the app, then press Refresh"),
        ));
    }
    let mut candidates: Vec<String> = Vec::new();
    let mut last_error: Option<ApiError> = None;
    let mut saw_stdout = false;
    for pid in pids {
        let mut ls = adb_command(&adb, &device_id);
        ls.args(["shell", "run-as", &package_name, "ls", "-l"])
            .arg(format!("/proc/{pid}/fd"));
        // One failing process (exited, timed out, isolated uid) must not hide the others.
        let out = match adb_output(ls, ADB_TIMEOUT).await {
            Ok(out) => out,
            Err(err) => {
                last_error = Some(err);
                continue;
            }
        };
        let stderr = trimmed_stderr(&out);
        if stderr.contains("not debuggable") {
            return Err(not_debuggable(&package_name));
        }
        if out.stdout.is_empty() {
            last_error = Some(api_error("adb_failed", stderr));
            continue;
        }
        saw_stdout = true;
        candidates.extend(open_paths(
            &String::from_utf8_lossy(&out.stdout),
            &package_name,
        ));
    }
    if !saw_stdout {
        if let Some(err) = last_error {
            return Err(err);
        }
    }
    candidates.sort();
    candidates.dedup();
    candidates.truncate(MAX_CANDIDATES);
    if candidates.is_empty() {
        return Ok(vec![]);
    }
    // one call for all heads; exec-out is binary-safe, and its merged stderr cannot fake a marker plus magic
    let mut head = adb_command(&adb, &device_id);
    head.args([
        "exec-out",
        "run-as",
        &package_name,
        "head",
        "-v",
        "-c",
        "16",
    ])
    .args(&candidates);
    let out = adb_output(head, ADB_TIMEOUT).await?;
    if !out.status.success() && out.stdout.is_empty() {
        return Err(api_error("adb_failed", trimmed_stderr(&out)));
    }
    Ok(sqlite_paths(&out.stdout, &candidates))
}

/// Copies one device file to `dest` and returns its first `HEAD_BYTES` bytes.
/// `exec-out` has no stderr channel and exits 0, so a `run-as` or `cat` error
/// lands in `dest` as text; the caller checks the content.
pub(crate) async fn pull_file(
    adb: &Path,
    device_id: &str,
    package: &str,
    rel: &str,
    dest: &Path,
) -> Result<Vec<u8>, ApiError> {
    let file = std::fs::File::create(dest).map_err(|e| api_error("io_error", e.to_string()))?;
    let mut cmd = adb_command(adb, device_id);
    cmd.args(["exec-out", "run-as", package, "cat", rel]);
    cmd.stdin(Stdio::null())
        .stdout(file)
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_no_window(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|e| api_error("pull_failed", e.to_string()))?;
    let output = match tokio::time::timeout(PULL_TIMEOUT, child.wait_with_output()).await {
        Ok(result) => result.map_err(|e| api_error("pull_failed", e.to_string()))?,
        Err(_) => {
            return Err(api_error(
                "pull_timeout",
                format!("timed out after {}s", PULL_TIMEOUT.as_secs()),
            ))
        }
    };
    if !output.status.success() {
        return Err(api_error("pull_failed", trimmed_stderr(&output)));
    }
    let mut head = Vec::new();
    std::fs::File::open(dest)
        .and_then(|f| f.take(HEAD_BYTES).read_to_end(&mut head))
        .map_err(|e| api_error("io_error", e.to_string()))?;
    Ok(head)
}

async fn pull_all(
    adb: &Path,
    device_id: &str,
    package: &str,
    rel: &str,
    dest: &Path,
) -> Result<(), ApiError> {
    let head = pull_file(adb, device_id, package, rel, dest).await?;
    if !head.starts_with(SQLITE_MAGIC) {
        return Err(bad_pull_error(package, rel, &head));
    }
    let wal = sibling(dest, "-wal");
    let head = pull_file(adb, device_id, package, &format!("{rel}-wal"), &wal).await?;
    if !is_wal(&head) {
        // no -wal on the device: cat wrote its error text
        remove_if_present(&wal)?;
    }
    // a hot journal (rollback mode, app stopped mid-transaction) undoes torn pages
    let journal = sibling(dest, "-journal");
    let head = pull_file(adb, device_id, package, &format!("{rel}-journal"), &journal).await?;
    if !head.starts_with(&JOURNAL_MAGIC) {
        remove_if_present(&journal)?;
    }
    // the user's call; SQLite rebuilds the -shm on open, so it is not checked
    pull_file(
        adb,
        device_id,
        package,
        &format!("{rel}-shm"),
        &sibling(dest, "-shm"),
    )
    .await?;
    Ok(())
}

/// Pulls the database with its `-wal` and `-shm` to the temp copy, replacing
/// the last copy, and lists its tables and views.
#[tauri::command]
pub async fn android_pull_database(
    device_id: String,
    package_name: String,
    db_path: String,
) -> Result<PulledDatabase, ApiError> {
    check_target(&device_id, &package_name, Some(&db_path))?;
    let adb = adb_path()?;
    let dest = local_db_path(&device_id, &package_name, &db_path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| api_error("io_error", e.to_string()))?;
    }
    // a stale -wal would replay old pages onto the new copy
    for suffix in SIBLINGS {
        remove_if_present(&sibling(&dest, suffix))?;
    }
    if let Err(err) = pull_all(&adb, &device_id, &package_name, &db_path, &dest).await {
        // never leave a torn copy for android_db_query
        let _ = std::fs::remove_file(&dest);
        for suffix in SIBLINGS {
            let _ = std::fs::remove_file(sibling(&dest, suffix));
        }
        return Err(err);
    }
    let path = dest.to_string_lossy().into_owned();
    let tables = tokio::task::spawn_blocking(move || read_tables(&dest))
        .await
        .map_err(|e| api_error("sql_error", e.to_string()))??;
    Ok(PulledDatabase { path, tables })
}

/// Rows per page. Same value as `PAGE_ROWS` in `src/android/dbFormat.ts`.
const PAGE_ROWS: usize = 100;
const CELL_MAX_CHARS: usize = 500;

fn sql_error(err: rusqlite::Error) -> ApiError {
    api_error("sql_error", err.to_string())
}

/// A fresh connection per call, read-only unless `write` (never CREATE):
/// nothing holds the files open when Refresh deletes and pulls them (Windows file locks).
fn open_copy(path: &Path, write: bool) -> Result<Connection, ApiError> {
    if !path.is_file() {
        return Err(api_error("not_pulled", "Pull the database first"));
    }
    let mode = if write {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    } else {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    };
    Connection::open_with_flags(path, mode | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(sql_error)
}

pub fn read_tables(path: &Path) -> Result<Vec<String>, ApiError> {
    let conn = open_copy(path, false)?;
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name COLLATE NOCASE")
        .map_err(sql_error)?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    Ok(names)
}

/// Folds the `-wal` into the database file, so the one file holds every
/// change. The header keeps WAL mode; the close deletes the emptied `-wal`.
fn checkpoint(path: &Path) -> Result<(), ApiError> {
    let busy: i64 = open_copy(path, true)?
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))
        .map_err(sql_error)?;
    if busy != 0 {
        // frames left in the -wal would not reach the device: the push hashes the main file only
        return Err(api_error(
            "io_error",
            "The local copy is busy; try the push again",
        ));
    }
    Ok(())
}

/// Lower-case hex SHA-1 of a local file: the same text as toybox `sha1sum`.
fn file_sha1(path: &Path) -> Result<String, ApiError> {
    let io = |e: std::io::Error| api_error("io_error", e.to_string());
    let mut hasher = Sha1::new();
    std::io::copy(&mut std::fs::File::open(path).map_err(io)?, &mut hasher).map_err(io)?;
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
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
            } else {
                text.into_owned()
            })
        }
        ValueRef::Blob(b) => Some(format!("<BLOB {} bytes>", b.len())),
    }
}

// shortcut: deep pages step through every earlier row, and a runaway query cannot be cancelled; add a progress handler if users hit it.
pub fn query_page(
    path: &Path,
    sql: &str,
    offset: usize,
    write: bool,
) -> Result<QueryPage, ApiError> {
    let sql = sql.trim();
    if sql.is_empty() {
        return Err(api_error("sql_error", "Enter a statement"));
    }
    let conn = open_copy(path, write)?;
    let mut stmt = conn.prepare(sql).map_err(sql_error)?;
    if !stmt.readonly() {
        // Read mode: the connection is read-only, but VACUUM INTO still writes a new file.
        if !write {
            return Err(api_error(
                "read_only",
                "Only read-only statements run on the copy. Turn on Write mode to change it",
            ));
        }
        // Step to the end so the whole statement runs; RETURNING rows are dropped.
        let mut rows = stmt.query([]).map_err(sql_error)?;
        while rows.next().map_err(sql_error)?.is_some() {}
        return Ok(QueryPage {
            columns: vec!["Rows changed".to_string()],
            rows: vec![vec![Some(conn.changes().to_string())]],
            has_more: false,
            wrote: true,
        });
    }
    let columns: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
    let mut rows = stmt.query([]).map_err(sql_error)?;
    let (mut page, mut index, mut has_more) = (Vec::new(), 0usize, false);
    while let Some(row) = rows.next().map_err(sql_error)? {
        if index >= offset {
            if page.len() == PAGE_ROWS {
                has_more = true;
                break;
            }
            page.push(
                (0..columns.len())
                    .map(|i| row.get_ref(i).map(cell))
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(sql_error)?,
            );
        }
        index += 1;
    }
    Ok(QueryPage {
        columns,
        rows: page,
        has_more,
        wrote: false,
    })
}

/// Runs one statement on the local copy, up to `PAGE_ROWS` rows from `offset`. Read-only unless `write`.
#[tauri::command]
pub async fn android_db_query(
    device_id: String,
    package_name: String,
    db_path: String,
    sql: String,
    offset: usize,
    write: bool,
) -> Result<QueryPage, ApiError> {
    check_target(&device_id, &package_name, Some(&db_path))?;
    let path = local_db_path(&device_id, &package_name, &db_path);
    tokio::task::spawn_blocking(move || query_page(&path, &sql, offset, write))
        .await
        .map_err(|e| api_error("sql_error", e.to_string()))?
}

/// The device SHA-1 of `rel` must equal `local_sum`.
async fn check_device_sum(
    adb: &Path,
    device_id: &str,
    package: &str,
    rel: &str,
    local_sum: &str,
) -> Result<(), ApiError> {
    let mut sum = adb_command(adb, device_id);
    sum.arg("shell").args(run_as(package, &["sha1sum", rel]));
    let out = adb_output(sum, PULL_TIMEOUT).await?;
    let text = String::from_utf8_lossy(&out.stdout);
    match parse_sha1sum(&text) {
        Some(device_sum) if device_sum == local_sum => Ok(()),
        Some(_) => Err(api_error(
            "push_mismatch",
            "The copy on the device does not match the local copy",
        )),
        None => Err(api_error(
            "push_failed",
            format!("sha1sum failed: {} {}", text.trim(), trimmed_stderr(&out))
                .trim()
                .to_string(),
        )),
    }
}

/// Copies the local copy to `<rel>.cowbell-new` in the app folder (through
/// `/data/local/tmp`) and checks its SHA-1. The live database is not touched yet.
async fn stage_on_device(
    adb: &Path,
    device_id: &str,
    package: &str,
    staged: &str,
    local: &Path,
    local_sum: &str,
) -> Result<(), ApiError> {
    let tmp = device_tmp_path(package);
    let mut push = adb_command(adb, device_id);
    push.arg("push").arg(local).arg(&tmp);
    // adb push prints its transfer summary on stdout: only the exit code counts.
    let copied = match adb_output(push, PULL_TIMEOUT).await {
        Ok(out) if out.status.success() => {
            adb_shell(
                adb,
                device_id,
                &run_as(package, &["cp", &tmp, staged]),
                PULL_TIMEOUT,
            )
            .await
        }
        Ok(out) => Err(api_error(
            "push_failed",
            format!("adb push failed: {}", trimmed_stderr(&out)),
        )),
        Err(err) => Err(err),
    };
    // The tmp file is app data in a folder every shell user can read.
    let _ = adb_shell(adb, device_id, &["rm", "-f", &tmp], ADB_TIMEOUT).await;
    copied?;
    check_device_sum(adb, device_id, package, staged, local_sum).await
}

/// Stages and checks the copy, deletes the stale `-wal`/`-shm`/`-journal`,
/// then renames the staged file over `rel`. The rename is atomic, so a failure
/// at any step leaves the old database file whole (at worst without its `-wal`,
/// which the backup keeps).
async fn replace_device_db(
    adb: &Path,
    device_id: &str,
    package: &str,
    rel: &str,
    local: &Path,
    local_sum: &str,
) -> Result<(), ApiError> {
    let staged = format!("{rel}.cowbell-new");
    let (wal, shm, journal) = (
        format!("{rel}-wal"),
        format!("{rel}-shm"),
        format!("{rel}-journal"),
    );
    let mut result = stage_on_device(adb, device_id, package, &staged, local, local_sum).await;
    if result.is_ok() {
        result = adb_shell(
            adb,
            device_id,
            &run_as(package, &["rm", "-f", &wal, &shm, &journal]),
            ADB_TIMEOUT,
        )
        .await;
    }
    if result.is_ok() {
        result = adb_shell(
            adb,
            device_id,
            &run_as(package, &["mv", &staged, rel]),
            ADB_TIMEOUT,
        )
        .await;
    }
    if result.is_err() {
        let _ = adb_shell(
            adb,
            device_id,
            &run_as(package, &["rm", "-f", &staged]),
            ADB_TIMEOUT,
        )
        .await;
    }
    result?;
    check_device_sum(adb, device_id, package, rel, local_sum).await
}

/// Copies the edited local copy over the app's database and returns the
/// backup path. In order: checkpoint and hash the copy, force-stop the app,
/// back up the device database, then `replace_device_db`.
#[tauri::command]
pub async fn android_push_database(
    device_id: String,
    package_name: String,
    db_path: String,
) -> Result<PushedDatabase, ApiError> {
    check_target(&device_id, &package_name, Some(&db_path))?;
    let local = local_db_path(&device_id, &package_name, &db_path);
    // Local work first: a missing or broken copy fails before the app is stopped.
    let copy = local.clone();
    let local_sum = tokio::task::spawn_blocking(move || {
        checkpoint(&copy)?;
        file_sha1(&copy)
    })
    .await
    .map_err(|e| api_error("io_error", e.to_string()))??;
    let adb = adb_path()?;
    adb_shell(
        &adb,
        &device_id,
        &["am", "force-stop", &package_name],
        ADB_TIMEOUT,
    )
    .await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64);
    let base = crate::android::local_app_data().unwrap_or_else(std::env::temp_dir);
    let backup = backup_path(&base, &device_id, &package_name, &db_path, now);
    if let Some(parent) = backup.parent() {
        std::fs::create_dir_all(parent).map_err(|e| api_error("io_error", e.to_string()))?;
    }
    if let Err(err) = pull_all(&adb, &device_id, &package_name, &db_path, &backup).await {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let _ = std::fs::remove_file(sibling(&backup, suffix));
        }
        return Err(api_error(
            &err.code,
            format!("Backup failed, nothing was pushed: {}", err.message),
        ));
    }
    let saved = backup.to_string_lossy().into_owned();
    replace_device_db(
        &adb,
        &device_id,
        &package_name,
        &db_path,
        &local,
        &local_sum,
    )
    .await
    .map_err(|err| api_error(&err.code, format!("{} (backup: {saved})", err.message)))?;
    Ok(PushedDatabase { backup_path: saved })
}

pub(crate) fn focus_window(app: &tauri::AppHandle, label: &str) -> bool {
    let Some(window) = app.get_webview_window(label) else {
        return false;
    };
    let _ = window.unminimize();
    let _ = window.set_focus();
    true
}

/// Opens the inspector window for `device_id`, or focuses the open one.
/// `async`: building a window from a sync command deadlocks on Windows.
#[tauri::command]
pub async fn android_db_window(
    app: tauri::AppHandle,
    device_id: String,
    device_name: Option<String>,
) -> Result<(), ApiError> {
    check_device_id(&device_id)?;
    let label = format!("db-inspector-{}", device_id.replace('.', "_"));
    if focus_window(&app, &label) {
        return Ok(());
    }
    let name = mirror_tools::sanitize_device_name(device_name.as_deref().unwrap_or(""), &device_id);
    let mut url = tauri::Url::parse("http://x/db-inspector.html").expect("static url");
    url.query_pairs_mut()
        .append_pair("device", &device_id)
        .append_pair("name", &name);
    let page = format!("db-inspector.html?{}", url.query().unwrap_or(""));
    let builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(page.into()))
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
        Ok(window) => {
            // The copies hold app data: delete this device's copies when its window closes.
            let dir = local_device_dir(&device_id);
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Destroyed = event {
                    let _ = std::fs::remove_dir_all(&dir);
                }
            });
            Ok(())
        }
        // A double click: the first call built it meanwhile.
        Err(_) if focus_window(&app, &label) => Ok(()),
        Err(err) => Err(api_error("window_failed", err.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("cowbell-android-db-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn table_db(name: &str, setup: &str) -> PathBuf {
        let db = scratch(name).join("t.db");
        Connection::open(&db).unwrap().execute_batch(setup).unwrap();
        db
    }

    #[test]
    fn package_names_follow_android_rules() {
        for ok in ["com.x", "com.simplr.rad.dev", "a_b.c1"] {
            assert!(is_valid_package(ok), "{ok}");
        }
        for bad in [
            "com", "com..x", "1com.x", ".com.x", "com.x;rm", "-com.x", "com.x y", "",
        ] {
            assert!(!is_valid_package(bad), "{bad}");
        }
    }

    #[test]
    fn rel_paths_reject_escapes_options_and_shell_chars() {
        for ok in [
            "files/databases/salesdb_20261021094851.sqlite",
            "databases/com.google.android.datatransport.events",
            "logdb.sqlite",
        ] {
            assert!(is_valid_rel_path(ok), "{ok}");
        }
        for bad in [
            "../x",
            "files/../x",
            "/data/x",
            "a//b",
            "a/./b",
            "a/",
            "-x",
            "a/-x",
            "a b",
            "a/b;rm",
            "$(x)",
            "a\\b",
            "",
        ] {
            assert!(!is_valid_rel_path(bad), "{bad}");
        }
    }

    #[test]
    fn running_packages_intersects_ps_and_pm() {
        let ps = "  PID NAME   \r\n    1 init\n    2 [kthreadd]\n12530 com.a:remote\n12531 com.b\n";
        let pm = "package:com.a\r\npackage:com.c\npackage:com.b\n";
        assert_eq!(running_packages(ps, pm), ["com.a", "com.b"]);
    }

    #[test]
    fn package_pids_include_suffixed_processes() {
        let ps =
            "  PID NAME\n12279 com.g:googleapp\n14748 com.g:interactor\n500 com.gx\n501 com.g\n";
        assert_eq!(package_pids(ps, "com.g"), [12279, 14748, 501]);
    }

    #[test]
    fn open_paths_keep_data_folder_files_only() {
        let ls = "\
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
";
        assert_eq!(
            open_paths(ls, "com.simplr.rad.dev"),
            [
                "app_flutter/shared.hive",
                "databases/com.google.android.datatransport.events",
                "files/databases/salesdb_20261021094851.sqlite",
                "files/databases/logdb.sqlite",
            ]
        );
    }

    #[test]
    fn sqlite_paths_reads_head_markers() {
        let out = b"==> files/databases/logdb.sqlite <==\nSQLite format 3\0\n==> app_flutter/local.hive <==\n!\0\0\0\x01\x0cPROJECT_CO\n==> code_cache <==\nhead: code_cache: Is a directory\n\n==> databases/com.google.android.datatransport.events <==\nSQLite format 3\0head: app_flutter/nope.x: No such file or directory\n";
        let candidates: Vec<String> = [
            "files/databases/logdb.sqlite",
            "app_flutter/local.hive",
            "code_cache",
            "databases/com.google.android.datatransport.events",
            "app_flutter/nope.x",
        ]
        .map(String::from)
        .to_vec();
        assert_eq!(
            sqlite_paths(out, &candidates),
            [
                "files/databases/logdb.sqlite",
                "databases/com.google.android.datatransport.events"
            ]
        );
        let single = b"==> logdb.sqlite <==\nSQLite format 3\0";
        assert_eq!(
            sqlite_paths(single, &["logdb.sqlite".to_string()]),
            ["logdb.sqlite"]
        );
    }

    #[test]
    fn local_db_path_mirrors_the_relative_path() {
        let path = local_db_path("192.168.1.5:5555", "com.x", "files/databases/a.sqlite");
        let parts: Vec<String> = path
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        let tail = &parts[parts.len() - 6..];
        assert_eq!(
            tail,
            [
                "cowbell-sqlite",
                "192_168_1_5_5555",
                "com.x",
                "files",
                "databases",
                "a.sqlite"
            ]
        );
        let dots = local_db_path("..", "com.x", "a.db");
        assert!(dots.components().any(|c| c.as_os_str() == "__"));
    }

    #[test]
    fn bad_pull_error_maps_device_text() {
        let code = |head: &[u8]| bad_pull_error("com.x", "files/x", head).code;
        assert_eq!(
            code(b"run-as: package not debuggable: com.x\n"),
            "not_debuggable"
        );
        assert_eq!(
            code(b"cat: files/x: No such file or directory\n"),
            "pull_failed"
        );
        assert_eq!(code(&[0u8, 1, 2]), "not_sqlite");
    }

    #[test]
    fn wal_magic_is_recognized() {
        assert!(is_wal(&[0x37, 0x7f, 0x06, 0x82, 0]));
        assert!(is_wal(&[0x37, 0x7f, 0x06, 0x83]));
        assert!(!is_wal(b"cat: ..."));
        assert!(!is_wal(b""));
    }

    #[tokio::test]
    async fn commands_reject_unsafe_input_before_adb() {
        let err = android_app_databases("RF8W3085JEW".into(), "com.x;rm".into())
            .await
            .unwrap_err();
        assert_eq!(err.code, "bad_package");
        let err = android_pull_database("RF8W3085JEW".into(), "com.x".into(), "../x".into())
            .await
            .unwrap_err();
        assert_eq!(err.code, "bad_db_path");
        let err = android_running_apps("x; rm".into()).await.unwrap_err();
        assert_eq!(err.code, "bad_device_id");
        let err = android_push_database("RF8W3085JEW".into(), "com.x".into(), "../x".into())
            .await
            .unwrap_err();
        assert_eq!(err.code, "bad_db_path");
    }

    #[test]
    fn a_copied_wal_shows_uncheckpointed_rows_after_reopen() {
        let (src, dst, only) = (
            scratch("wal-src"),
            scratch("wal-dst"),
            scratch("wal-db-only"),
        );
        let db = src.join("t.db");
        let writer = Connection::open(&db).unwrap();
        let mode: String = writer
            .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        writer.execute("CREATE TABLE t(x)", []).unwrap();
        writer
            .execute("INSERT INTO t VALUES (1), (2), (3)", [])
            .unwrap();
        // Copy while the writer is open: closing it would checkpoint the WAL.
        std::fs::copy(&db, dst.join("t.db")).unwrap();
        std::fs::copy(src.join("t.db-wal"), dst.join("t.db-wal")).unwrap();
        std::fs::copy(&db, only.join("t.db")).unwrap();
        drop(writer);
        for _ in 0..2 {
            assert_eq!(
                query_page(&dst.join("t.db"), "SELECT x FROM t", 0, false)
                    .unwrap()
                    .rows
                    .len(),
                3
            );
        }
        assert!(
            dst.join("t.db-wal").is_file(),
            "a read-only close must not checkpoint or delete the -wal"
        );
        assert_eq!(
            query_page(&only.join("t.db"), "SELECT x FROM t", 0, false)
                .unwrap_err()
                .code,
            "sql_error"
        );
    }

    #[test]
    fn query_page_pages_by_100() {
        let db = table_db(
            "paging",
            "CREATE TABLE t AS WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 250) SELECT x FROM c",
        );
        let page = |offset| query_page(&db, "SELECT x FROM t", offset, false).unwrap();
        let first = page(0);
        assert_eq!((first.rows.len(), first.has_more), (100, true));
        let second = page(100);
        assert_eq!((second.rows.len(), second.has_more), (100, true));
        assert_eq!(second.rows[0][0].as_deref(), Some("101"));
        let third = page(200);
        assert_eq!((third.rows.len(), third.has_more), (50, false));
        assert_eq!(page(250).rows.len(), 0);
    }

    #[test]
    fn query_page_formats_cells() {
        let db = table_db("cells", "CREATE TABLE t(x)");
        let page = query_page(
            &db,
            "SELECT NULL AS n, 9007199254740993 AS i, 1.5 AS r, x'010203' AS b, printf('%0600d', 0) AS t",
            0,
            false,
        )
        .unwrap();
        assert_eq!(page.columns, ["n", "i", "r", "b", "t"]);
        let row = &page.rows[0];
        assert_eq!(row[0], None);
        assert_eq!(row[1].as_deref(), Some("9007199254740993"));
        assert_eq!(row[2].as_deref(), Some("1.5"));
        assert_eq!(row[3].as_deref(), Some("<BLOB 3 bytes>"));
        assert_eq!(
            row[4].as_deref(),
            Some(format!("{}…", "0".repeat(500)).as_str())
        );
    }

    #[test]
    fn query_page_refuses_writes_and_keeps_reads() {
        let db = table_db("writes", "CREATE TABLE t(x); INSERT INTO t VALUES (1)");
        let code = |sql: &str| query_page(&db, sql, 0, false).unwrap_err().code;
        assert_eq!(code("DELETE FROM t"), "read_only");
        let vacuumed = db.with_file_name("x.db");
        let sql = format!("VACUUM INTO '{}'", vacuumed.to_string_lossy());
        assert_eq!(code(&sql), "read_only");
        assert!(!vacuumed.exists());
        assert!(query_page(&db, "PRAGMA table_info(t)", 0, false).is_ok());
        assert!(query_page(&db, "  SELECT * FROM t;  ", 0, false).is_ok());
        assert_eq!(code("SELEC 1"), "sql_error");
        assert_eq!(code(""), "sql_error");
    }

    #[test]
    fn read_tables_lists_tables_and_views_sorted() {
        let db = table_db(
            "tables",
            "CREATE TABLE b(x); CREATE TABLE A(x); CREATE VIEW v AS SELECT x FROM b",
        );
        assert_eq!(read_tables(&db).unwrap(), ["A", "b", "v"]);
    }

    #[tokio::test]
    async fn query_without_a_pull_is_not_pulled() {
        let err = android_db_query(
            "RF8W3085JEW".into(),
            "com.never.pulled".into(),
            "files/none.db".into(),
            "SELECT 1".into(),
            0,
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, "not_pulled");
        let err = android_push_database(
            "RF8W3085JEW".into(),
            "com.never.pulled".into(),
            "files/none.db".into(),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, "not_pulled");
    }

    #[test]
    fn write_mode_changes_the_copy_one_statement_at_a_time() {
        let db = table_db("write", "CREATE TABLE t(x); INSERT INTO t VALUES (1), (2)");
        let page = query_page(&db, "UPDATE t SET x = x + 10", 0, true).unwrap();
        assert_eq!(page.columns, ["Rows changed"]);
        assert_eq!(page.rows, vec![vec![Some("2".to_string())]]);
        assert!(page.wrote);
        let read = query_page(&db, "SELECT x FROM t ORDER BY x", 0, true).unwrap();
        assert!(!read.wrote);
        assert_eq!(
            read.rows,
            vec![vec![Some("11".to_string())], vec![Some("12".to_string())]]
        );
        let code = |sql: &str, write| query_page(&db, sql, 0, write).unwrap_err().code;
        assert_eq!(code("DELETE FROM t", false), "read_only");
        assert_eq!(code("DELETE FROM t; DROP TABLE t", true), "sql_error");
        assert_eq!(
            query_page(&db, "SELECT count(*) FROM t", 0, false)
                .unwrap()
                .rows[0][0]
                .as_deref(),
            Some("2")
        );
    }

    #[test]
    fn shell_failure_treats_any_output_as_an_error() {
        assert_eq!(shell_failure(true, b"", b" \n"), None);
        assert_eq!(
            shell_failure(true, b"run-as: package not debuggable: com.x\n", b"").as_deref(),
            Some("run-as: package not debuggable: com.x")
        );
        assert_eq!(
            shell_failure(false, b"", b"cp: x: Permission denied\n").as_deref(),
            Some("cp: x: Permission denied")
        );
        assert_eq!(
            shell_failure(false, b"", b"").as_deref(),
            Some("adb shell failed")
        );
    }

    #[test]
    fn parse_sha1sum_reads_the_digest_only() {
        assert_eq!(
            parse_sha1sum("A9993E364706816ABA3E25717850C26C9CD0D89D  files/x.db\n").as_deref(),
            Some("a9993e364706816aba3e25717850c26c9cd0d89d")
        );
        assert_eq!(
            parse_sha1sum("run-as: package not debuggable: com.x\n"),
            None
        );
        assert_eq!(
            parse_sha1sum("sha1sum: files/x.db: No such file or directory"),
            None
        );
        assert_eq!(parse_sha1sum(""), None);
    }

    #[test]
    fn push_argv_and_paths_use_validated_names() {
        assert_eq!(
            run_as(
                "com.x",
                &["cp", "/data/local/tmp/cowbell-com.x.sqlite", "files/a.db"]
            ),
            [
                "run-as",
                "com.x",
                "cp",
                "/data/local/tmp/cowbell-com.x.sqlite",
                "files/a.db"
            ]
        );
        assert_eq!(
            device_tmp_path("com.x"),
            "/data/local/tmp/cowbell-com.x.sqlite"
        );
        // 1_792_664_130 = 2026-10-22 10:15:30 UTC
        let path = backup_path(
            Path::new("base"),
            "192.168.1.5:5555",
            "com.x",
            "files/databases/a.sqlite",
            1_792_664_130,
        );
        assert_eq!(
            path,
            Path::new("base")
                .join("Cowbell")
                .join("sqlite-backups")
                .join("192_168_1_5_5555")
                .join("com.x")
                .join("a.sqlite-20261022-101530")
        );
    }

    #[test]
    fn file_sha1_matches_sha1sum() {
        let file = scratch("sha1").join("abc");
        std::fs::write(&file, "abc").unwrap();
        assert_eq!(
            file_sha1(&file).unwrap(),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
    }

    #[test]
    fn checkpoint_folds_the_wal_and_keeps_wal_mode() {
        let (src, dst) = (scratch("ckpt-src"), scratch("ckpt-dst"));
        let db = src.join("t.db");
        let writer = Connection::open(&db).unwrap();
        writer
            .query_row("PRAGMA journal_mode=WAL", [], |r| r.get::<_, String>(0))
            .unwrap();
        writer
            .execute_batch("CREATE TABLE t(x); INSERT INTO t VALUES (1), (2), (3)")
            .unwrap();
        // Copy while the writer is open: closing it would checkpoint the WAL.
        std::fs::copy(&db, dst.join("t.db")).unwrap();
        std::fs::copy(src.join("t.db-wal"), dst.join("t.db-wal")).unwrap();
        drop(writer);
        let copy = dst.join("t.db");
        checkpoint(&copy).unwrap();
        let wal = sibling(&copy, "-wal");
        assert!(!wal.exists() || std::fs::metadata(&wal).unwrap().len() == 0);
        let alone = scratch("ckpt-alone").join("t.db");
        std::fs::copy(&copy, &alone).unwrap();
        assert_eq!(
            &std::fs::read(&alone).unwrap()[18..20],
            &[2u8, 2][..],
            "WAL mode stays in the header"
        );
        assert_eq!(
            query_page(&alone, "SELECT x FROM t", 0, false)
                .unwrap()
                .rows
                .len(),
            3
        );
    }
}
