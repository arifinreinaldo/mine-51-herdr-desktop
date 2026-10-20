//! Git MVP spec: the Source Control commands (`git_status`, `git_diff`, ...).
//! Every git call runs through one private runner; see `docs/git-mvp-spec.md`.

use crate::commands::ApiError;
use crate::engine::apply_no_window;
use crate::flutter::api_error;
use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command as AsyncCommand;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub orig_path: Option<String>,
    pub kind: ChangeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Untracked,
    Conflicted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub repo: Option<String>,
    pub branch: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub unborn: bool,
    pub staged: Vec<FileChange>,
    pub unstaged: Vec<FileChange>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    pub text: String,
    pub truncated: bool,
    pub binary: bool,
}

const DIFF_CAP_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const GIT_TIMEOUT: Duration = Duration::from_secs(15);
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
const STDERR_MAX_CHARS: usize = 2000;

/// Rejects a path that is empty, holds NUL, is absolute (`/x`, `\x`, `C:x`),
/// or has a `..` segment. The caller sends repo-relative paths only.
fn validate_path(path: &str) -> Result<(), ApiError> {
    let bytes = path.as_bytes();
    let bad = path.is_empty()
        || path.contains('\0')
        || path.starts_with('/')
        || path.starts_with('\\')
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
        || path.split(['/', '\\']).any(|seg| seg == "..");
    if bad {
        return Err(api_error("invalid_path", format!("invalid path: {path:?}")));
    }
    Ok(())
}

/// `line` is the text after `## ` in the porcelain v1 branch record.
fn parse_branch_line(line: &str, status: &mut GitStatus) {
    let name_of = |s: &str| s.split_once("...").map_or(s, |(a, _)| a).to_string();
    if let Some(rest) = line
        .strip_prefix("No commits yet on ")
        .or_else(|| line.strip_prefix("Initial commit on "))
    {
        status.unborn = true;
        status.branch = Some(name_of(rest));
        return;
    }
    if line == "HEAD (no branch)" {
        status.branch = None;
        return;
    }
    let (name_part, bracket) = match line.split_once(" [") {
        Some((n, b)) => (n, Some(b)),
        None => (line, None),
    };
    status.branch = Some(name_of(name_part));
    if let Some(b) = bracket {
        for item in b.trim_end_matches(']').split(", ") {
            if let Some(n) = item.strip_prefix("ahead ") {
                status.ahead = n.trim().parse().unwrap_or(0);
            } else if let Some(n) = item.strip_prefix("behind ") {
                status.behind = n.trim().parse().unwrap_or(0);
            }
        }
    }
}

fn kind_of(code: u8) -> ChangeKind {
    match code {
        b'A' => ChangeKind::Added,
        b'D' => ChangeKind::Deleted,
        b'R' => ChangeKind::Renamed,
        b'C' => ChangeKind::Copied,
        b'T' => ChangeKind::TypeChanged,
        _ => ChangeKind::Modified,
    }
}

fn parse_porcelain(stdout: &[u8]) -> GitStatus {
    let mut status = GitStatus::default();
    let fields: Vec<String> = stdout
        .split(|b| *b == 0)
        .filter(|f| !f.is_empty())
        .map(|f| String::from_utf8_lossy(f).into_owned())
        .collect();
    let mut i = 0;
    while i < fields.len() {
        let field = &fields[i];
        i += 1;
        if let Some(branch) = field.strip_prefix("## ") {
            parse_branch_line(branch, &mut status);
            continue;
        }
        if field.len() < 4 {
            continue;
        }
        let (x, y) = (field.as_bytes()[0], field.as_bytes()[1]);
        let Some(path) = field.get(3..) else { continue };
        // The original path of a rename or copy is the NEXT record.
        let orig = if matches!(x, b'R' | b'C') || matches!(y, b'R' | b'C') {
            let next = fields.get(i).cloned();
            if next.is_some() {
                i += 1;
            }
            next
        } else {
            None
        };
        let entry = |kind: ChangeKind, code: u8| FileChange {
            path: path.to_string(),
            orig_path: if matches!(code, b'R' | b'C') {
                orig.clone()
            } else {
                None
            },
            kind,
        };
        match (x, y) {
            (b'?', b'?') => status.unstaged.push(entry(ChangeKind::Untracked, y)),
            (b'!', b'!') => {}
            (b'D', b'D')
            | (b'A', b'U')
            | (b'U', b'D')
            | (b'U', b'A')
            | (b'D', b'U')
            | (b'A', b'A')
            | (b'U', b'U') => status.unstaged.push(entry(ChangeKind::Conflicted, y)),
            _ => {
                if x != b' ' {
                    status.staged.push(entry(kind_of(x), x));
                }
                if y != b' ' {
                    status.unstaged.push(entry(kind_of(y), y));
                }
            }
        }
    }
    status.staged.sort_by(|a, b| a.path.cmp(&b.path));
    status.unstaged.sort_by(|a, b| a.path.cmp(&b.path));
    status
}

fn finish_diff(stdout: &[u8]) -> GitDiff {
    let mut text = String::from_utf8_lossy(stdout).into_owned();
    let mut truncated = false;
    if text.len() > DIFF_CAP_BYTES {
        let cut = match text.as_bytes()[..DIFF_CAP_BYTES]
            .iter()
            .rposition(|b| *b == b'\n')
        {
            Some(p) => p + 1,
            None => {
                let mut c = DIFF_CAP_BYTES;
                while !text.is_char_boundary(c) {
                    c -= 1;
                }
                c
            }
        };
        text.truncate(cut);
        truncated = true;
    }
    let binary = text.lines().any(|l| l.starts_with("Binary files "))
        && !text.lines().any(|l| l.starts_with("@@"));
    GitDiff {
        text,
        truncated,
        binary,
    }
}

pub(crate) struct GitOutput {
    pub(crate) code: Option<i32>,
    pub(crate) stdout: Vec<u8>,
    stderr: String,
    /// The stdout read stopped at its cap.
    pub(crate) capped: bool,
}

/// Reads `pipe` in 64 KiB chunks into a shared buffer. It stops at EOF, at a
/// read error, or (with a cap) once the buffer holds more than `cap` bytes.
/// Returning drops the pipe, so git's next write fails and git exits. The
/// buffer is shared, so the caller keeps the bytes read even after an abort.
fn spawn_reader(
    mut pipe: impl AsyncRead + Unpin + Send + 'static,
    cap: Option<usize>,
) -> (tokio::task::JoinHandle<()>, Arc<Mutex<Vec<u8>>>) {
    let buf = Arc::new(Mutex::new(Vec::new()));
    let shared = Arc::clone(&buf);
    let handle = tokio::spawn(async move {
        let mut chunk = vec![0u8; 64 * 1024];
        loop {
            match pipe.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let mut b = shared.lock().unwrap();
                    b.extend_from_slice(&chunk[..n]);
                    if let Some(c) = cap {
                        if b.len() > c {
                            b.truncate(c + 1);
                            break;
                        }
                    }
                }
            }
        }
    });
    (handle, buf)
}

/// Runs every git call (spec §3.1). A non-zero exit is not an error here;
/// the caller maps it.
pub(crate) async fn run_git(
    dir: &str,
    args: &[&str],
    stdin: Option<&[u8]>,
    stdout_cap: Option<usize>,
    timeout: Duration,
) -> Result<GitOutput, ApiError> {
    let mut cmd = AsyncCommand::new("git");
    cmd.args(["-C", dir, "-c", "core.quotepath=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_LITERAL_PATHSPECS")
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            api_error("git_not_found", "Git is not installed")
        } else {
            api_error("git_failed", format!("failed to start git: {e}"))
        }
    })?;
    if let Some(bytes) = stdin {
        if let Some(mut pipe) = child.stdin.take() {
            let data = bytes.to_vec();
            // A separate task, so a large payload cannot deadlock against full
            // output pipes. Dropping `pipe` at the end closes stdin.
            tokio::spawn(async move {
                let _ = pipe.write_all(&data).await;
            });
        }
    }
    let (Some(out_pipe), Some(err_pipe)) = (child.stdout.take(), child.stderr.take()) else {
        return Err(api_error("git_failed", "git pipes are missing"));
    };
    // The readers start before the wait: output larger than the pipe buffer
    // would otherwise block git until the timeout.
    let (mut out_task, out_buf) = spawn_reader(out_pipe, stdout_cap);
    let (mut err_task, err_buf) = spawn_reader(err_pipe, None);
    // The timeout covers the exit only, never the pipes. A hook's background
    // child can hold the pipes open after git has succeeded.
    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Err(_) => {
            out_task.abort();
            err_task.abort();
            // shortcut: kill_on_drop ends git but not hook grandchildren; use a job object if hooks hang in practice.
            // shortcut: a timeout kill can leave .git/index.lock behind; git names the lock in its next error and the user removes it. Report the lock path here if users hit it.
            return Err(api_error(
                "git_timeout",
                format!("git timed out after {}s", timeout.as_secs()),
            ));
        }
        Ok(Err(e)) => {
            out_task.abort();
            err_task.abort();
            return Err(api_error(
                "git_failed",
                format!("failed to wait for git: {e}"),
            ));
        }
        Ok(Ok(status)) => status,
    };
    // git has exited, so its output is complete; only EOF can be missing, when a hook's background child still holds the pipe.
    let deadline = tokio::time::Instant::now() + DRAIN_TIMEOUT;
    if tokio::time::timeout_at(deadline, &mut out_task)
        .await
        .is_err()
    {
        out_task.abort();
    }
    if tokio::time::timeout_at(deadline, &mut err_task)
        .await
        .is_err()
    {
        err_task.abort();
    }
    let stdout = std::mem::take(&mut *out_buf.lock().unwrap());
    let stderr_bytes = std::mem::take(&mut *err_buf.lock().unwrap());
    let capped = stdout_cap.is_some_and(|c| stdout.len() > c);
    Ok(GitOutput {
        code: status.code(),
        stdout,
        stderr: String::from_utf8_lossy(&stderr_bytes).trim().to_string(),
        capped,
    })
}

fn require_success(out: GitOutput) -> Result<Vec<u8>, ApiError> {
    if out.code == Some(0) {
        return Ok(out.stdout);
    }
    let message = if out.stderr.is_empty() {
        match out.code {
            Some(n) => format!("git exited with code {n}"),
            None => "git was terminated".to_string(),
        }
    } else {
        out.stderr.chars().take(STDERR_MAX_CHARS).collect()
    };
    Err(api_error("git_failed", message))
}

/// `repo` must equal the canonical `rev-parse --show-toplevel` of itself.
/// Re-run on every call, never cached.
async fn check_repo(repo: &str) -> Result<(), ApiError> {
    let invalid = || api_error("invalid_repo", format!("not a git repository root: {repo}"));
    let out = run_git(
        repo,
        &["rev-parse", "--show-toplevel"],
        None,
        None,
        GIT_TIMEOUT,
    )
    .await?;
    if out.code != Some(0) {
        return Err(invalid());
    }
    if String::from_utf8_lossy(&out.stdout).trim_end_matches(['\r', '\n']) != repo {
        return Err(invalid());
    }
    Ok(())
}

/// Status of the repo that holds `cwd`; `repo: None` outside a repository.
/// `GIT_OPTIONAL_LOCKS=0` (set by `run_git`) matters: without it `git status`
/// takes `index.lock` to refresh the index, and the 3 s poll then races with
/// an agent that runs `git commit` in a terminal pane.
#[tauri::command]
pub async fn git_status(cwd: String) -> Result<GitStatus, ApiError> {
    if cwd.is_empty() || !Path::new(&cwd).is_absolute() {
        return Err(api_error("invalid_path", format!("invalid cwd: {cwd:?}")));
    }
    let top = run_git(
        &cwd,
        &["rev-parse", "--show-toplevel"],
        None,
        None,
        GIT_TIMEOUT,
    )
    .await?;
    if top.code != Some(0) && top.stderr.contains("not a git repository") {
        return Ok(GitStatus::default());
    }
    let top = require_success(top)?;
    let repo = String::from_utf8_lossy(&top)
        .trim_end_matches(['\r', '\n'])
        .to_string();
    // Accepted risk (spec §3.7): core.fsmonitor is off for status and diff, but repo-configured clean filters (filter.*.clean) still run, exactly as in a terminal.
    let stdout = require_success(
        run_git(
            &repo,
            &[
                "-c",
                "core.fsmonitor=false",
                "status",
                "--porcelain=v1",
                "-z",
                "--branch",
                "--untracked-files=all",
            ],
            None,
            None,
            GIT_TIMEOUT,
        )
        .await?,
    )?;
    let mut status = parse_porcelain(&stdout);
    status.repo = Some(repo);
    Ok(status)
}

/// Diff of one path. `untracked` uses `--no-index` against `/dev/null`.
#[tauri::command]
pub async fn git_diff(
    repo: String,
    path: String,
    staged: bool,
    untracked: bool,
) -> Result<GitDiff, ApiError> {
    validate_path(&path)?;
    check_repo(&repo).await?;
    let literal = format!(":(literal){path}");
    let args: Vec<&str> = if untracked {
        // --no-index takes file paths, not pathspecs.
        vec![
            "-c",
            "core.fsmonitor=false",
            "diff",
            "--no-index",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--",
            "/dev/null",
            &path,
        ]
    } else if staged {
        vec![
            "-c",
            "core.fsmonitor=false",
            "diff",
            "--cached",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "-U3",
            "--",
            &literal,
        ]
    } else {
        vec![
            "-c",
            "core.fsmonitor=false",
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "-U3",
            "--",
            &literal,
        ]
    };
    let out = run_git(&repo, &args, None, Some(DIFF_CAP_BYTES), GIT_TIMEOUT).await?;
    // The read stopped at the cap and closed the pipe, so git's exit code means nothing here.
    if out.capped {
        return Ok(finish_diff(&out.stdout));
    }
    let stdout = if untracked && out.code == Some(1) && out.stdout.starts_with(b"diff --git") {
        out.stdout
    } else {
        require_success(out)?
    };
    // shortcut: a staged rename shows only the new path's diff; pass orig_path too if users ask.
    Ok(finish_diff(&stdout))
}

// Hooks and GPG signing can be slow, so a commit gets a longer timeout.
const COMMIT_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_PATHS_BYTES: usize = 16 * 1024 * 1024;
const MAX_MESSAGE_BYTES: usize = 64 * 1024;

// shortcut: one global lock for stage/unstage/commit; use per-repo locks if multi-repo throughput ever matters.
static WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub hash: String,
    pub summary: String,
}

fn validate_paths(paths: &[String]) -> Result<(), ApiError> {
    if paths.is_empty() {
        return Err(api_error("invalid_path", "no paths given"));
    }
    if paths.iter().map(|p| p.len() + 1).sum::<usize>() > MAX_PATHS_BYTES {
        return Err(api_error("invalid_path", "too many paths"));
    }
    paths.iter().try_for_each(|p| validate_path(p))
}

fn validate_message(message: &str) -> Result<(), ApiError> {
    if message.trim().is_empty() || message.len() > MAX_MESSAGE_BYTES {
        return Err(api_error(
            "invalid_message",
            "commit message is empty or longer than 64 KiB",
        ));
    }
    Ok(())
}

// --pathspec-from-file entries still get pathspec magic; :(literal) turns it off per path, without an env var that hooks would inherit.
fn literal_pathspecs(paths: &[String]) -> Vec<u8> {
    let mut out = Vec::new();
    for p in paths {
        out.extend_from_slice(b":(literal)");
        out.extend_from_slice(p.as_bytes());
        out.push(0);
    }
    out
}

/// Stages `paths` (repo-relative) with `git add`.
#[tauri::command]
pub async fn git_stage(repo: String, paths: Vec<String>) -> Result<(), ApiError> {
    validate_paths(&paths)?;
    check_repo(&repo).await?;
    let _guard = WRITE_LOCK.lock().await;
    require_success(
        run_git(
            &repo,
            &["add", "--pathspec-from-file=-", "--pathspec-file-nul"],
            Some(&literal_pathspecs(&paths)),
            None,
            GIT_TIMEOUT,
        )
        .await?,
    )?;
    Ok(())
}

/// Unstages `paths` (repo-relative) with `git reset -q`.
#[tauri::command]
pub async fn git_unstage(repo: String, paths: Vec<String>) -> Result<(), ApiError> {
    validate_paths(&paths)?;
    check_repo(&repo).await?;
    let _guard = WRITE_LOCK.lock().await;
    // reset works with and without commits; rm --cached exits 1 on a staged-then-edited file (AM), and restore --staged fails with no HEAD.
    require_success(
        run_git(
            &repo,
            &[
                "reset",
                "-q",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
            ],
            Some(&literal_pathspecs(&paths)),
            None,
            GIT_TIMEOUT,
        )
        .await?,
    )?;
    Ok(())
}

/// Commits the index with `message`; hooks run (no `--no-verify`).
#[tauri::command]
pub async fn git_commit(repo: String, message: String) -> Result<CommitResult, ApiError> {
    validate_message(&message)?;
    check_repo(&repo).await?;
    let _guard = WRITE_LOCK.lock().await;
    require_success(
        run_git(
            &repo,
            &["commit", "-F", "-"],
            Some(message.as_bytes()),
            None,
            COMMIT_TIMEOUT,
        )
        .await?,
    )?;
    let log = require_success(
        run_git(
            &repo,
            &["log", "-1", "--no-show-signature", "--format=%h%x00%s"],
            None,
            None,
            GIT_TIMEOUT,
        )
        .await?,
    )?;
    let text = String::from_utf8_lossy(&log);
    let Some((hash, summary)) = text.trim_end_matches(['\r', '\n']).split_once('\0') else {
        return Err(api_error("git_failed", "unexpected git log output"));
    };
    Ok(CommitResult {
        hash: hash.to_string(),
        summary: summary.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn temp_dir(name: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "cowbell-git-test-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn init_repo(name: &str) -> PathBuf {
        let dir = temp_dir(name);
        git(&dir, &["init", "-b", "main"]);
        git(&dir, &["config", "user.name", "Test"]);
        git(&dir, &["config", "user.email", "test@example.com"]);
        git(&dir, &["config", "commit.gpgsign", "false"]);
        git(&dir, &["config", "core.autocrlf", "false"]);
        // A path that does not exist: the user's global hooks cannot hang a test.
        let hooks = dir.join("no-such-hooks");
        git(&dir, &["config", "core.hooksPath", hooks.to_str().unwrap()]);
        dir
    }

    fn commit_file(dir: &Path, name: &str, content: &str) {
        std::fs::write(dir.join(name), content).unwrap();
        git(dir, &["add", name]);
        git(dir, &["commit", "-q", "-m", &format!("add {name}")]);
    }

    fn s(dir: &Path) -> String {
        dir.to_str().unwrap().to_string()
    }

    fn kinds(list: &[FileChange]) -> Vec<(&str, ChangeKind)> {
        list.iter().map(|c| (c.path.as_str(), c.kind)).collect()
    }

    #[test]
    fn porcelain_staged_unstaged_and_both_columns() {
        let s = parse_porcelain(b"M  a.txt\0 M b.txt\0MM c.txt\0");
        assert_eq!(
            kinds(&s.staged),
            vec![
                ("a.txt", ChangeKind::Modified),
                ("c.txt", ChangeKind::Modified)
            ]
        );
        assert_eq!(
            kinds(&s.unstaged),
            vec![
                ("b.txt", ChangeKind::Modified),
                ("c.txt", ChangeKind::Modified)
            ]
        );
    }

    #[test]
    fn porcelain_added_deleted_untracked() {
        let s = parse_porcelain(b"A  a.txt\0D  b.txt\0?? c.txt\0");
        assert_eq!(
            kinds(&s.staged),
            vec![("a.txt", ChangeKind::Added), ("b.txt", ChangeKind::Deleted)]
        );
        assert_eq!(kinds(&s.unstaged), vec![("c.txt", ChangeKind::Untracked)]);
    }

    #[test]
    fn porcelain_rename_consumes_orig_path_and_next_record_parses() {
        let s = parse_porcelain(b"R  new\0old\0 M other\0");
        assert_eq!(s.staged.len(), 1);
        assert_eq!(s.staged[0].path, "new");
        assert_eq!(s.staged[0].orig_path.as_deref(), Some("old"));
        assert_eq!(s.staged[0].kind, ChangeKind::Renamed);
        assert_eq!(kinds(&s.unstaged), vec![("other", ChangeKind::Modified)]);
        assert_eq!(s.unstaged[0].orig_path, None);
    }

    #[test]
    fn porcelain_unmerged_pairs_are_conflicted_in_unstaged_only() {
        let s = parse_porcelain(b"UU a\0AA b\0DU c\0");
        assert!(s.staged.is_empty());
        assert_eq!(
            kinds(&s.unstaged),
            vec![
                ("a", ChangeKind::Conflicted),
                ("b", ChangeKind::Conflicted),
                ("c", ChangeKind::Conflicted)
            ]
        );
    }

    #[test]
    fn porcelain_ignores_ignored_entries() {
        let s = parse_porcelain(b"!! target/\0?? a.txt\0");
        assert!(s.staged.is_empty());
        assert_eq!(kinds(&s.unstaged), vec![("a.txt", ChangeKind::Untracked)]);
    }

    #[test]
    fn porcelain_keeps_space_and_non_ascii_paths_raw() {
        let s = parse_porcelain("?? my file.txt\0?? über/ß.txt\0".as_bytes());
        assert_eq!(
            kinds(&s.unstaged),
            vec![
                ("my file.txt", ChangeKind::Untracked),
                ("über/ß.txt", ChangeKind::Untracked)
            ]
        );
    }

    #[test]
    fn porcelain_sorts_each_list_by_path() {
        let s = parse_porcelain(b"M  z\0M  a\0 M y\0 M b\0");
        assert_eq!(s.staged[0].path, "a");
        assert_eq!(s.staged[1].path, "z");
        assert_eq!(s.unstaged[0].path, "b");
        assert_eq!(s.unstaged[1].path, "y");
    }

    #[test]
    fn branch_with_upstream_ahead_and_behind() {
        let s = parse_porcelain(b"## main...origin/main [ahead 2, behind 1]\0");
        assert_eq!(s.branch.as_deref(), Some("main"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        assert!(!s.unborn);
    }

    #[test]
    fn branch_without_upstream() {
        let s = parse_porcelain(b"## feature.x\0");
        assert_eq!(s.branch.as_deref(), Some("feature.x"));
        assert_eq!((s.ahead, s.behind), (0, 0));
    }

    #[test]
    fn branch_unborn() {
        let s = parse_porcelain(b"## No commits yet on main\0");
        assert!(s.unborn);
        assert_eq!(s.branch.as_deref(), Some("main"));
    }

    #[test]
    fn branch_detached() {
        let s = parse_porcelain(b"## HEAD (no branch)\0");
        assert_eq!(s.branch, None);
        assert!(!s.unborn);
    }

    #[test]
    fn branch_ahead_only_behind_only_and_gone() {
        let a = parse_porcelain(b"## m...o/m [ahead 3]\0");
        assert_eq!((a.ahead, a.behind), (3, 0));
        let b = parse_porcelain(b"## m...o/m [behind 4]\0");
        assert_eq!((b.ahead, b.behind), (0, 4));
        let g = parse_porcelain(b"## m...o/m [gone]\0");
        assert_eq!(g.branch.as_deref(), Some("m"));
        assert_eq!((g.ahead, g.behind), (0, 0));
    }

    #[test]
    fn validate_path_rejects_unsafe_paths() {
        for p in [
            "", "../x", "a/../b", "a\\..\\b", "/x", "\\x", "C:\\x", "C:x", "a\0b",
        ] {
            let err = validate_path(p).unwrap_err();
            assert_eq!(err.code, "invalid_path", "path {p:?}");
        }
    }

    #[test]
    fn validate_path_accepts_repo_relative_paths() {
        for p in ["a.txt", "dir/sub file.txt", "-rf", "über.txt", "..a/b"] {
            assert!(validate_path(p).is_ok(), "path {p:?}");
        }
    }

    #[test]
    fn finish_diff_truncates_at_last_newline_before_cap() {
        let d = finish_diff("+line\n".repeat(400_000).as_bytes());
        assert!(d.truncated);
        assert!(d.text.ends_with('\n'));
        assert!(d.text.len() <= DIFF_CAP_BYTES);
    }

    #[test]
    fn finish_diff_flags_binary_only_without_hunks() {
        let bin = finish_diff(b"diff --git a/x b/x\nBinary files a/x and b/x differ\n");
        assert!(bin.binary);
        let text = finish_diff(b"@@ -1 +1 @@\n-Binary files are cool\n+Binary files a b\n");
        assert!(!text.binary);
        assert!(!finish_diff(b"").binary);
    }

    #[test]
    fn serializes_camel_case_and_lowercase_kinds() {
        let c = FileChange {
            path: "p".into(),
            orig_path: Some("o".into()),
            kind: ChangeKind::TypeChanged,
        };
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["origPath"], "o");
        assert_eq!(v["kind"], "typechanged");
    }

    #[tokio::test]
    async fn status_outside_a_repo_is_repo_none() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = temp_dir("norepo");
        let st = git_status(s(&dir)).await.unwrap();
        assert_eq!(st.repo, None);
        assert!(st.staged.is_empty() && st.unstaged.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn status_rejects_empty_and_relative_cwd() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        for cwd in ["", "rel/dir"] {
            let err = git_status(cwd.to_string()).await.unwrap_err();
            assert_eq!(err.code, "invalid_path", "cwd {cwd:?}");
        }
    }

    #[tokio::test]
    async fn status_unborn_repo_lists_untracked_file() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("unborn");
        std::fs::write(dir.join("a.txt"), "hi\n").unwrap();
        let st = git_status(s(&dir)).await.unwrap();
        assert!(st.unborn);
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(kinds(&st.unstaged), vec![("a.txt", ChangeKind::Untracked)]);
        assert!(st.staged.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn unstaged_diff_contains_a_hunk() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("unstaged-diff");
        commit_file(&dir, "a.txt", "one\n");
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let d = git_diff(repo, "a.txt".into(), false, false).await.unwrap();
        assert!(d.text.contains("@@") && d.text.contains('+'));
        assert!(!d.truncated && !d.binary);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn staged_diff_after_git_add() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("staged-diff");
        commit_file(&dir, "a.txt", "one\n");
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        git(&dir, &["add", "a.txt"]);
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let d = git_diff(repo, "a.txt".into(), true, false).await.unwrap();
        assert!(d.text.contains("@@"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn untracked_diff_via_no_index_exit_1() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("untracked-diff");
        commit_file(&dir, "a.txt", "one\n");
        std::fs::write(dir.join("b.txt"), "new line\n").unwrap();
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let d = git_diff(repo, "b.txt".into(), false, true).await.unwrap();
        assert!(d.text.lines().any(|l| l.starts_with('+')));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn untracked_diff_of_missing_file_is_git_failed() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("missing-diff");
        commit_file(&dir, "a.txt", "one\n");
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let err = git_diff(repo, "gone.txt".into(), false, true)
            .await
            .unwrap_err();
        assert_eq!(err.code, "git_failed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn diff_rejects_invalid_paths() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("invalid-paths");
        commit_file(&dir, "a.txt", "one\n");
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        for p in ["../x", "C:\\x", "/x"] {
            let err = git_diff(repo.clone(), p.into(), false, false)
                .await
                .unwrap_err();
            assert_eq!(err.code, "invalid_path", "path {p:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn diff_rejects_a_subfolder_as_repo() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("subfolder");
        commit_file(&dir, "a.txt", "one\n");
        std::fs::create_dir(dir.join("sub")).unwrap();
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let err = git_diff(format!("{repo}/sub"), "a.txt".into(), false, false)
            .await
            .unwrap_err();
        assert_eq!(err.code, "invalid_repo");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn diff_over_the_cap_is_truncated_not_failed() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("big-diff");
        commit_file(&dir, "a.txt", "one\n");
        std::fs::write(dir.join("big.txt"), "0123456789abcdef\n".repeat(200_000)).unwrap();
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let d = git_diff(repo, "big.txt".into(), false, true).await.unwrap();
        assert!(d.truncated);
        assert!(d.text.len() <= DIFF_CAP_BYTES);
        assert!(d.text.ends_with('\n'));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn run_git_returns_when_git_exits_even_if_a_child_keeps_the_pipe_open() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("linger");
        // The alias's shell exits at once and `sleep` keeps stdout open, as a
        // hook's background job does. `cd /` lets `remove_dir_all` delete the
        // temp dir. Before the fix, `wait_with_output` returned `git_timeout`
        // after 6 s.
        let started = std::time::Instant::now();
        let out = run_git(
            &s(&dir),
            &[
                "-c",
                "alias.linger=!echo marker; cd / && sleep 8 &",
                "linger",
            ],
            None,
            None,
            Duration::from_secs(6),
        )
        .await
        .unwrap();
        let elapsed = started.elapsed();
        assert_eq!(out.code, Some(0));
        assert!(String::from_utf8_lossy(&out.stdout).contains("marker"));
        // The lower bound proves the drain deadline fired, so the pipe was held.
        assert!(
            elapsed >= Duration::from_millis(1500),
            "elapsed {elapsed:?}"
        );
        assert!(elapsed < Duration::from_secs(5), "elapsed {elapsed:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_paths_rejects_empty_and_oversized_payload() {
        assert_eq!(validate_paths(&[]).unwrap_err().code, "invalid_path");
        // 16 * 1024 * 1025 = 16_793_600 bytes > 16 MiB
        let big = vec!["a".repeat(1024); 16 * 1024];
        assert_eq!(validate_paths(&big).unwrap_err().code, "invalid_path");
        // The old 1000-entry limit is gone.
        assert!(validate_paths(&vec!["a.txt".to_string(); 1001]).is_ok());
    }

    #[test]
    fn validate_message_rejects_blank_and_over_64_kib() {
        for m in ["  \n".to_string(), "x".repeat(65 * 1024)] {
            assert_eq!(validate_message(&m).unwrap_err().code, "invalid_message");
        }
        assert!(validate_message("fix").is_ok());
    }

    #[tokio::test]
    async fn stage_then_unstage_in_unborn_repo() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("stage-unborn");
        std::fs::write(dir.join("b.txt"), "hi\n").unwrap();
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        git_stage(repo.clone(), vec!["b.txt".into()]).await.unwrap();
        let st = git_status(repo.clone()).await.unwrap();
        assert_eq!(kinds(&st.staged), vec![("b.txt", ChangeKind::Added)]);
        git_unstage(repo.clone(), vec!["b.txt".into()])
            .await
            .unwrap();
        let st = git_status(repo).await.unwrap();
        assert!(st.staged.is_empty());
        assert_eq!(kinds(&st.unstaged), vec![("b.txt", ChangeKind::Untracked)]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn unstage_in_unborn_repo_after_editing_the_staged_file() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("unstage-am");
        std::fs::write(dir.join("b.txt"), "hi\n").unwrap();
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        git_stage(repo.clone(), vec!["b.txt".into()]).await.unwrap();
        // Porcelain code is now `AM`; the old `rm --cached -q` exited 1 here.
        std::fs::write(dir.join("b.txt"), "hi\nmore\n").unwrap();
        git_unstage(repo.clone(), vec!["b.txt".into()])
            .await
            .unwrap();
        let st = git_status(repo).await.unwrap();
        assert!(st.staged.is_empty());
        assert_eq!(kinds(&st.unstaged), vec![("b.txt", ChangeKind::Untracked)]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn stage_then_unstage_after_first_commit() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("stage-committed");
        commit_file(&dir, "a.txt", "one\n");
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        git_stage(repo.clone(), vec!["a.txt".into()]).await.unwrap();
        let st = git_status(repo.clone()).await.unwrap();
        assert_eq!(kinds(&st.staged), vec![("a.txt", ChangeKind::Modified)]);
        git_unstage(repo.clone(), vec!["a.txt".into()])
            .await
            .unwrap();
        let st = git_status(repo).await.unwrap();
        assert!(st.staged.is_empty());
        assert_eq!(kinds(&st.unstaged), vec![("a.txt", ChangeKind::Modified)]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn unstage_staged_rename_with_orig_path() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("unstage-rename");
        commit_file(&dir, "old.txt", "one\n");
        git(&dir, &["mv", "old.txt", "new.txt"]);
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        git_unstage(repo.clone(), vec!["new.txt".into(), "old.txt".into()])
            .await
            .unwrap();
        let st = git_status(repo).await.unwrap();
        assert!(st.staged.is_empty());
        assert_eq!(
            kinds(&st.unstaged),
            vec![
                ("new.txt", ChangeKind::Untracked),
                ("old.txt", ChangeKind::Deleted)
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn pathspecs_treat_glob_characters_literally() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        // `*` and `?` are invalid in NTFS file names, so the test uses `[...]`.
        // Without `:(literal)`, the stage step also stages `x.txt` (probe 2026-10-11).
        let dir = init_repo("glob-literal");
        commit_file(&dir, "x.txt", "one\n");
        std::fs::write(dir.join("x.txt"), "one\ntwo\n").unwrap();
        std::fs::write(dir.join("[xy].txt"), "new\n").unwrap();
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        git_stage(repo.clone(), vec!["[xy].txt".into()])
            .await
            .unwrap();
        let st = git_status(repo.clone()).await.unwrap();
        assert_eq!(kinds(&st.staged), vec![("[xy].txt", ChangeKind::Added)]);
        assert_eq!(kinds(&st.unstaged), vec![("x.txt", ChangeKind::Modified)]);
        git(&dir, &["add", "x.txt"]);
        let d = git_diff(repo.clone(), "[xy].txt".into(), true, false)
            .await
            .unwrap();
        assert_eq!(
            d.text
                .lines()
                .filter(|l| l.starts_with("diff --git"))
                .count(),
            1
        );
        git_unstage(repo.clone(), vec!["[xy].txt".into()])
            .await
            .unwrap();
        let st = git_status(repo).await.unwrap();
        assert_eq!(kinds(&st.staged), vec![("x.txt", ChangeKind::Modified)]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn commit_returns_short_hash_and_status_is_clean() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("commit-first");
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        git_stage(repo.clone(), vec!["a.txt".into()]).await.unwrap();
        let r = git_commit(repo.clone(), "first".into()).await.unwrap();
        assert!(r.hash.len() >= 7, "hash {:?}", r.hash);
        assert_eq!(r.summary, "first");
        let st = git_status(repo).await.unwrap();
        assert!(!st.unborn);
        assert!(st.staged.is_empty() && st.unstaged.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn commit_with_nothing_staged_is_git_failed() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("commit-empty");
        commit_file(&dir, "a.txt", "one\n");
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let err = git_commit(repo, "second".into()).await.unwrap_err();
        assert_eq!(err.code, "git_failed");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
