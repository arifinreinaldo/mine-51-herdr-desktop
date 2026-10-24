//! File viewer spec §3: read-only file commands, confined to a workspace root.

use crate::commands::ApiError;
use crate::flutter::api_error;
use crate::git::{run_git, GIT_TIMEOUT};
use serde::Serialize;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

/// A file of this size or more opens in paged mode: the viewer reads its lines with `fs_read_lines`.
/// The frontend keeps no copy of this value; it reacts to `ReadKind::Paged`.
const PAGED_THRESHOLD_BYTES: u64 = 8 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
/// The line index keeps the byte offset of every `INDEX_STEP`-th line.
const INDEX_STEP: u64 = 256;
/// Line indexes kept in memory, most recently used first. A bounded map needs no close call from the viewer.
const MAX_INDEXES: usize = 8;
/// The first bytes kept per index. A rotated log that regrew past its old size has a different head.
const HEAD_BYTES: usize = 4096;
const MAX_READ_LINES: u64 = 1000;
/// Paged mode cuts a longer line here, so one giant line cannot fill memory (a 500-line page stays under 32 MiB).
const MAX_LINE_BYTES: u64 = 64 * 1024;
const IO_BUF_BYTES: usize = 64 * 1024;
const MAX_FILES: usize = 50_000;
const LS_FILES_CAP_BYTES: usize = 16 * 1024 * 1024;
const SKIP_DIRS: [&str; 6] = [
    ".git",
    "node_modules",
    "build",
    "target",
    ".dart_tool",
    "vendor",
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReadKind {
    Text,
    Binary,
    Paged,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub kind: ReadKind,
    pub content: Option<String>,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub mtime_ms: u64,
    pub size: u64,
}

/// The byte offset of every `INDEX_STEP`-th line of one file, for the file's `stat`.
#[derive(Debug)]
struct LineIndex {
    stat: FileStat,
    line_count: u64,
    offsets: Vec<u64>,
    head: Vec<u8>,
}

type IndexList = Vec<(PathBuf, Arc<LineIndex>)>;

/// Tauri state: the line indexes of paged files, keyed by canonical path, most recently used first.
#[derive(Default, Clone)]
pub struct PagedIndexes(Arc<Mutex<IndexList>>);

/// `col` counts UTF-16 code units, the unit of a JS string index and a DOM range offset.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub line: u64,
    pub col: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
}

/// Each `fs_search` call bumps it, an empty query too. An older scan sees the change and stops: one find bar searches at a time.
static SEARCH_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileList {
    pub files: Vec<String>,
    pub truncated: bool,
}

fn io_error(e: std::io::Error) -> ApiError {
    if e.kind() == std::io::ErrorKind::NotFound {
        api_error("not_found", e.to_string())
    } else {
        api_error("io_error", e.to_string())
    }
}

fn canonical_root(root: &str) -> Result<PathBuf, ApiError> {
    let invalid = |why: &str| api_error("invalid_root", format!("Invalid workspace root: {why}"));
    if root.is_empty() || !Path::new(root).is_absolute() {
        return Err(invalid("not an absolute path"));
    }
    let base = std::fs::canonicalize(root).map_err(|e| invalid(&e.to_string()))?;
    if !base.is_dir() {
        return Err(invalid("not a directory"));
    }
    Ok(base)
}

fn confine(root: &str, rel: &str) -> Result<PathBuf, ApiError> {
    let base = canonical_root(root)?;
    // Join onto the original root: a verbatim `\\?\` path does not normalize `/` or `..`.
    let target = std::fs::canonicalize(Path::new(root).join(rel)).map_err(io_error)?;
    if !target.starts_with(&base) {
        return Err(api_error(
            "outside_root",
            format!("Path is outside the workspace: {rel}"),
        ));
    }
    Ok(target)
}

fn list_dir(root: &str, rel: &str) -> Result<Vec<DirEntry>, ApiError> {
    let dir = confine(root, rel)?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let is_dir = entry.path().is_dir();
        entries.push(DirEntry { name, is_dir });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// The confined path and the metadata of a regular file.
fn regular_file(root: &str, rel: &str) -> Result<(PathBuf, std::fs::Metadata), ApiError> {
    let path = confine(root, rel)?;
    let meta = std::fs::metadata(&path).map_err(io_error)?;
    // A FIFO open blocks on Unix; a folder or a submodule is not a file.
    if !meta.is_file() {
        return Err(api_error(
            "not_a_file",
            format!("Not a regular file: {rel}"),
        ));
    }
    Ok((path, meta))
}

fn stat_of(meta: &std::fs::Metadata) -> FileStat {
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX));
    FileStat {
        mtime_ms,
        size: meta.len(),
    }
}

fn read_text(root: &str, rel: &str) -> Result<ReadResult, ApiError> {
    let (path, meta) = regular_file(root, rel)?;
    let size = meta.len();
    let paged = size >= PAGED_THRESHOLD_BYTES;
    // Paged mode reads only the head for the binary check. The limit also bounds a file that grows during the read.
    let limit = if paged {
        BINARY_SNIFF_BYTES as u64
    } else {
        PAGED_THRESHOLD_BYTES
    };
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(io_error)?
        .take(limit)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    let kind = if bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
        ReadKind::Binary
    } else if paged {
        ReadKind::Paged
    } else {
        ReadKind::Text
    };
    let content = (kind == ReadKind::Text).then(|| String::from_utf8_lossy(&bytes).into_owned());
    Ok(ReadResult {
        kind,
        content,
        size,
    })
}

fn stat_file(root: &str, rel: &str) -> Result<FileStat, ApiError> {
    regular_file(root, rel).map(|(_, meta)| stat_of(&meta))
}

/// Counts lines from the last offset in `offsets` (a line start after `newlines` line ends) to the end of the file,
/// and adds the offset of every `INDEX_STEP`-th line. A full build starts with `vec![0]` and 0.
fn scan_index(
    path: &Path,
    stat: FileStat,
    mut offsets: Vec<u64>,
    mut newlines: u64,
) -> Result<LineIndex, ApiError> {
    let mut pos = offsets.last().copied().unwrap_or(0);
    let mut file = std::fs::File::open(path).map_err(io_error)?;
    file.seek(SeekFrom::Start(pos)).map_err(io_error)?;
    let mut buf = vec![0u8; IO_BUF_BYTES];
    let mut last = b'\n';
    loop {
        let n = file.read(&mut buf).map_err(io_error)?;
        if n == 0 {
            break;
        }
        for (i, &b) in buf[..n].iter().enumerate() {
            if b == b'\n' {
                newlines += 1;
                if newlines.is_multiple_of(INDEX_STEP) {
                    offsets.push(pos + i as u64 + 1);
                }
            }
        }
        last = buf[n - 1];
        pos += n as u64;
    }
    // A last line without `\n` counts; a final `\n` adds no empty line (the text-mode split in fileViewer.ts).
    let line_count = (newlines + u64::from(last != b'\n')).max(1);
    Ok(LineIndex {
        stat,
        line_count,
        offsets,
        head: read_head(path)?,
    })
}

/// The first `HEAD_BYTES` bytes of `path`, or the whole file when it is shorter.
fn read_head(path: &Path) -> Result<Vec<u8>, ApiError> {
    let mut head = Vec::with_capacity(HEAD_BYTES);
    std::fs::File::open(path)
        .and_then(|file| file.take(HEAD_BYTES as u64).read_to_end(&mut head))
        .map_err(io_error)?;
    Ok(head)
}

/// True when `offset` is still a line start: offset 0, or a `\n` just before it. An append keeps this; most rewrites do not.
fn line_start_at(path: &Path, offset: u64) -> bool {
    if offset == 0 {
        return true;
    }
    let mut byte = [0u8; 1];
    std::fs::File::open(path)
        .and_then(|mut file| {
            file.seek(SeekFrom::Start(offset - 1))?;
            file.read_exact(&mut byte)
        })
        .is_ok_and(|()| byte[0] == b'\n')
}

/// The index of `path`. With `fresh`, an entry for another mtime or size is updated: extended from its last offset
/// when the file grew and that offset is still a line start (an append), else built again. Without `fresh`, a stale
/// entry serves `fs_read_lines`, so a page read never scans the whole file.
fn index_for(
    indexes: &PagedIndexes,
    path: &Path,
    meta: &std::fs::Metadata,
    fresh: bool,
) -> Result<Arc<LineIndex>, ApiError> {
    let stat = stat_of(meta);
    let cached = {
        let mut list = indexes.0.lock().unwrap_or_else(PoisonError::into_inner);
        match list.iter().position(|(p, _)| p == path) {
            Some(i) => {
                let entry = list.remove(i);
                let index = Arc::clone(&entry.1);
                list.insert(0, entry);
                if !fresh || index.stat == stat {
                    return Ok(index);
                }
                Some(index)
            }
            None => None,
        }
    };
    // Built without the lock: a scan of a large file takes seconds.
    let grown = cached.filter(|old| {
        old.stat.size < stat.size
            && line_start_at(path, old.offsets.last().copied().unwrap_or(0))
            && read_head(path).is_ok_and(|head| head.starts_with(&old.head))
    });
    let index = Arc::new(match grown {
        Some(old) => scan_index(
            path,
            stat,
            old.offsets.clone(),
            (old.offsets.len() as u64 - 1) * INDEX_STEP,
        )?,
        None => scan_index(path, stat, vec![0], 0)?,
    });
    // A slow build of an older version must not replace the index of a newer build that finished first.
    if std::fs::metadata(path).map(|m| stat_of(&m)).ok() != Some(stat) {
        return Ok(index);
    }
    let mut list = indexes.0.lock().unwrap_or_else(PoisonError::into_inner);
    list.retain(|(p, _)| p != path);
    list.insert(0, (path.to_path_buf(), Arc::clone(&index)));
    list.truncate(MAX_INDEXES);
    Ok(index)
}

fn open_paged(indexes: &PagedIndexes, root: &str, rel: &str) -> Result<u64, ApiError> {
    let (path, meta) = regular_file(root, rel)?;
    Ok(index_for(indexes, &path, &meta, true)?.line_count)
}

/// Skips the rest of a cut line, one buffer at a time. Returns early when `stop` says so (a newer search).
fn skip_rest(reader: &mut impl BufRead, stop: &dyn Fn() -> bool) -> std::io::Result<()> {
    loop {
        let (newline, len) = {
            let chunk = reader.fill_buf()?;
            (chunk.iter().position(|&b| b == b'\n'), chunk.len())
        };
        if len == 0 {
            return Ok(());
        }
        if let Some(i) = newline {
            reader.consume(i + 1);
            return Ok(());
        }
        reader.consume(len);
        if stop() {
            return Ok(());
        }
    }
}

/// Reads one line into `buf` without its `\n` or `\r\n`, cut at MAX_LINE_BYTES. Returns false at the end of the file.
fn next_line(
    reader: &mut impl BufRead,
    buf: &mut Vec<u8>,
    stop: &dyn Fn() -> bool,
) -> std::io::Result<bool> {
    buf.clear();
    let n = reader
        .by_ref()
        .take(MAX_LINE_BYTES)
        .read_until(b'\n', buf)?;
    if n == 0 {
        return Ok(false);
    }
    if buf.last() == Some(&b'\n') {
        buf.pop();
    } else if n as u64 == MAX_LINE_BYTES {
        skip_rest(reader, stop)?;
    }
    if buf.last() == Some(&b'\r') {
        buf.pop();
    }
    Ok(true)
}

fn read_lines(
    indexes: &PagedIndexes,
    root: &str,
    rel: &str,
    start: u64,
    count: u64,
) -> Result<Vec<String>, ApiError> {
    let (path, meta) = regular_file(root, rel)?;
    let index = index_for(indexes, &path, &meta, false)?;
    let mut lines = Vec::new();
    let Some(&offset) = index.offsets.get((start / INDEX_STEP) as usize) else {
        return Ok(lines); // past the end
    };
    let mut reader =
        BufReader::with_capacity(IO_BUF_BYTES, std::fs::File::open(&path).map_err(io_error)?);
    reader.seek(SeekFrom::Start(offset)).map_err(io_error)?;
    for _ in 0..start % INDEX_STEP {
        reader.skip_until(b'\n').map_err(io_error)?;
    }
    let mut buf = Vec::new();
    while (lines.len() as u64) < count.min(MAX_READ_LINES)
        && next_line(&mut reader, &mut buf, &|| false).map_err(io_error)?
    {
        lines.push(String::from_utf8_lossy(&buf).into_owned());
    }
    Ok(lines)
}

/// Case-insensitive, non-overlapping matches of `query` in each line, like `findMatches` in viewerFind.ts. Stops with
/// `cancelled` when `cancel` no longer holds `generation`: checked on each line, and on each buffer of a cut line.
fn search_file(
    path: &Path,
    query: &str,
    max_matches: usize,
    cancel: &AtomicU64,
    generation: u64,
) -> Result<SearchResult, ApiError> {
    let needle = query.to_lowercase();
    let mut matches = Vec::new();
    if needle.is_empty() {
        return Ok(SearchResult {
            matches,
            truncated: false,
        });
    }
    let stopped = || cancel.load(Ordering::Relaxed) != generation;
    let mut reader =
        BufReader::with_capacity(IO_BUF_BYTES, std::fs::File::open(path).map_err(io_error)?);
    let mut buf = Vec::new();
    let mut line = 0u64;
    while next_line(&mut reader, &mut buf, &stopped).map_err(io_error)? {
        if stopped() {
            return Err(api_error("cancelled", "A newer search replaced this one"));
        }
        let hay = String::from_utf8_lossy(&buf).to_lowercase();
        let (mut col, mut prev) = (0u64, 0usize);
        for (at, _) in hay.match_indices(needle.as_str()) {
            if matches.len() == max_matches {
                return Ok(SearchResult {
                    matches,
                    truncated: true,
                });
            }
            col += hay[prev..at].encode_utf16().count() as u64;
            prev = at;
            matches.push(SearchMatch { line, col });
        }
        line += 1;
    }
    Ok(SearchResult {
        matches,
        truncated: false,
    })
}

fn parse_ls_files(stdout: &[u8], capped: bool, max: usize) -> FileList {
    let mut files: Vec<String> = stdout
        .split(|b| *b == 0)
        // An untracked nested repo is listed as `dir/` (W6).
        .filter(|p| !p.is_empty() && !p.ends_with(b"/"))
        .map(|p| String::from_utf8_lossy(p).into_owned())
        .collect();
    if capped {
        // The last entry can be partial.
        files.pop();
    }
    // Git lists an unmerged path once per stage.
    files.dedup();
    let truncated = capped || files.len() > max;
    files.truncate(max);
    FileList { files, truncated }
}

fn walk(root: &Path, max: usize) -> FileList {
    let mut files = Vec::new();
    let mut stack = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, prefix)) = stack.pop() {
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if ft.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push((entry.path(), rel));
                }
            } else if ft.is_file() || (ft.is_symlink() && entry.path().is_file()) {
                if files.len() >= max {
                    return FileList {
                        files,
                        truncated: true,
                    };
                }
                files.push(rel);
            }
        }
    }
    FileList {
        files,
        truncated: false,
    }
}

fn join_error(e: tokio::task::JoinError) -> ApiError {
    api_error("fs_failed", e.to_string())
}

#[tauri::command]
pub async fn fs_list_dir(root: String, rel: String) -> Result<Vec<DirEntry>, ApiError> {
    tokio::task::spawn_blocking(move || list_dir(&root, &rel))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn fs_read_text(root: String, rel: String) -> Result<ReadResult, ApiError> {
    tokio::task::spawn_blocking(move || read_text(&root, &rel))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn fs_stat(root: String, rel: String) -> Result<FileStat, ApiError> {
    tokio::task::spawn_blocking(move || stat_file(&root, &rel))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn fs_open_paged(
    indexes: tauri::State<'_, PagedIndexes>,
    root: String,
    rel: String,
) -> Result<u64, ApiError> {
    let indexes = indexes.inner().clone(); // an Arc: the blocking task owns it, and no lock is held across .await
    tokio::task::spawn_blocking(move || open_paged(&indexes, &root, &rel))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn fs_read_lines(
    indexes: tauri::State<'_, PagedIndexes>,
    root: String,
    rel: String,
    start: u64,
    count: u64,
) -> Result<Vec<String>, ApiError> {
    let indexes = indexes.inner().clone();
    tokio::task::spawn_blocking(move || read_lines(&indexes, &root, &rel, start, count))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn fs_search(
    root: String,
    rel: String,
    query: String,
    max_matches: usize,
) -> Result<SearchResult, ApiError> {
    // Before the query check: an empty query is how the viewer stops a running search.
    let generation = SEARCH_GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    tokio::task::spawn_blocking(move || {
        let (path, _) = regular_file(&root, &rel)?;
        search_file(&path, &query, max_matches, &SEARCH_GENERATION, generation)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn fs_list_files(root: String) -> Result<FileList, ApiError> {
    let base = canonical_root(&root)?;
    // Hand git the original root string, not the canonical `\\?\` form.
    let git = run_git(
        &root,
        &[
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
        ],
        None,
        Some(LS_FILES_CAP_BYTES),
        GIT_TIMEOUT,
    )
    .await;
    if let Ok(out) = git {
        if out.code == Some(0) || out.capped {
            return Ok(parse_ls_files(&out.stdout, out.capped, MAX_FILES));
        }
    }
    tokio::task::spawn_blocking(move || walk(&base, MAX_FILES))
        .await
        .map_err(join_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_dir(name: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "cowbell-files-test-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    fn git_available() -> bool {
        std::process::Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
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

    /// Makes `<temp>/base` (the root) next to `<temp>/base/../outside.txt`.
    fn root_with_outside(name: &str) -> (PathBuf, PathBuf) {
        let parent = temp_dir(name);
        let base = parent.join("base");
        std::fs::create_dir_all(&base).unwrap();
        let outside = parent.join("outside.txt");
        std::fs::write(&outside, "secret").unwrap();
        (base, outside)
    }

    #[test]
    fn dotdot_to_existing_outside_file_is_outside_root() {
        let (base, _) = root_with_outside("dotdot");
        let err = read_text(&s(&base), "../outside.txt").unwrap_err();
        assert_eq!(err.code, "outside_root");
    }

    #[test]
    fn dotdot_to_missing_file_is_not_found() {
        let (base, _) = root_with_outside("dotdot-missing");
        let err = read_text(&s(&base), "../nope.txt").unwrap_err();
        assert_eq!(err.code, "not_found");
    }

    #[test]
    fn absolute_rel_is_outside_root() {
        let (base, outside) = root_with_outside("absolute");
        let err = read_text(&s(&base), &s(&outside)).unwrap_err();
        assert_eq!(err.code, "outside_root");
    }

    #[test]
    fn symlink_out_of_root_is_outside_root() {
        let (base, outside) = root_with_outside("symlink");
        let link = base.join("link.txt");
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside, &link);
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(&outside, &link);
        if let Err(e) = made {
            eprintln!("skipping symlink test: {e}");
            return;
        }
        let err = read_text(&s(&base), "link.txt").unwrap_err();
        assert_eq!(err.code, "outside_root");
    }

    #[test]
    fn bad_roots_are_invalid_root() {
        let missing = temp_dir("missing-root").join("nope");
        for root in ["", "relative/path", &s(&missing)] {
            assert_eq!(
                list_dir(root, "").unwrap_err().code,
                "invalid_root",
                "{root}"
            );
        }
        let dir = temp_dir("file-root");
        std::fs::write(dir.join("f.txt"), "x").unwrap();
        assert_eq!(
            list_dir(&s(&dir.join("f.txt")), "").unwrap_err().code,
            "invalid_root"
        );
    }

    #[test]
    fn list_dir_sorts_folders_first_and_hides_git() {
        let root = temp_dir("list");
        for d in [".git", "b", "A"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        for f in ["c.txt", "B.txt"] {
            std::fs::write(root.join(f), "x").unwrap();
        }
        let entries = list_dir(&s(&root), "").unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        let dirs: Vec<bool> = entries.iter().map(|e| e.is_dir).collect();
        assert_eq!(names, ["A", "b", "B.txt", "c.txt"]);
        assert_eq!(dirs, [true, true, false, false]);
    }

    #[test]
    fn list_dir_accepts_a_slash_in_rel() {
        let root = temp_dir("list-deep");
        std::fs::create_dir_all(root.join("src/deep")).unwrap();
        std::fs::write(root.join("src/deep/x.ts"), "x").unwrap();
        let entries = list_dir(&s(&root), "src/deep").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "x.ts");
    }

    fn read_bytes(name: &str, bytes: &[u8]) -> Result<ReadResult, ApiError> {
        let root = temp_dir(name);
        std::fs::write(root.join("f"), bytes).unwrap();
        read_text(&s(&root), "f")
    }

    #[test]
    fn read_text_returns_text() {
        let r = read_bytes("text", b"hello\n").unwrap();
        assert_eq!(r.kind, ReadKind::Text);
        assert_eq!(r.content.as_deref(), Some("hello\n"));
        assert_eq!(r.size, 6);
    }

    #[test]
    fn read_text_nul_is_binary() {
        let mut bytes = vec![b'a'; 10];
        bytes.push(0);
        bytes.extend_from_slice(b"tail");
        let r = read_bytes("binary", &bytes).unwrap();
        assert_eq!(r.kind, ReadKind::Binary);
        assert_eq!(r.content, None);
    }

    #[test]
    fn read_text_under_the_paged_threshold_is_text() {
        let n = PAGED_THRESHOLD_BYTES as usize - 1; // over the old 2 MiB cap
        let r = read_bytes("under-paged", &vec![b'a'; n]).unwrap();
        assert_eq!(r.kind, ReadKind::Text);
        assert_eq!(r.content.map(|c| c.len()), Some(n));
    }

    #[test]
    fn read_text_at_the_paged_threshold_is_paged_without_content() {
        let r = read_bytes("paged", &vec![b'a'; PAGED_THRESHOLD_BYTES as usize]).unwrap();
        assert_eq!(r.kind, ReadKind::Paged);
        assert_eq!(r.content, None);
        assert_eq!(r.size, PAGED_THRESHOLD_BYTES);
    }

    #[test]
    fn read_text_paged_size_with_a_nul_is_binary() {
        let mut bytes = vec![b'a'; PAGED_THRESHOLD_BYTES as usize];
        bytes[10] = 0;
        assert_eq!(
            read_bytes("paged-binary", &bytes).unwrap().kind,
            ReadKind::Binary
        );
    }

    #[test]
    fn stat_reports_size_and_mtime_and_rejects_non_files() {
        let root = temp_dir("stat");
        std::fs::write(root.join("f.txt"), "hello").unwrap();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let st = stat_file(&s(&root), "f.txt").unwrap();
        assert_eq!(st.size, 5);
        assert!(st.mtime_ms > 0);
        assert_eq!(
            stat_file(&s(&root), "nope.txt").unwrap_err().code,
            "not_found"
        );
        assert_eq!(stat_file(&s(&root), "sub").unwrap_err().code, "not_a_file");
    }

    #[test]
    fn stat_is_confined_to_the_root() {
        let (base, _) = root_with_outside("stat-dotdot");
        assert_eq!(
            stat_file(&s(&base), "../outside.txt").unwrap_err().code,
            "outside_root"
        );
    }

    #[test]
    fn read_text_invalid_utf8_is_lossy() {
        let r = read_bytes("lossy", &[0x66, 0xff, 0x6f]).unwrap();
        assert_eq!(r.content.as_deref(), Some("f\u{fffd}o"));
    }

    #[test]
    fn read_text_missing_file_is_not_found() {
        let root = temp_dir("missing");
        assert_eq!(
            read_text(&s(&root), "nope.txt").unwrap_err().code,
            "not_found"
        );
    }

    #[test]
    fn read_text_folder_and_root_are_not_a_file() {
        let root = temp_dir("notfile");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        assert_eq!(read_text(&s(&root), "sub").unwrap_err().code, "not_a_file");
        assert_eq!(read_text(&s(&root), "").unwrap_err().code, "not_a_file");
    }

    #[test]
    fn serde_shapes_are_camel_case() {
        assert_eq!(
            serde_json::to_string(&ReadKind::Paged).unwrap(),
            "\"paged\""
        );
        assert_eq!(
            serde_json::to_value(FileStat {
                mtime_ms: 1,
                size: 2
            })
            .unwrap(),
            serde_json::json!({ "mtimeMs": 1, "size": 2 })
        );
        let json = serde_json::to_value(DirEntry {
            name: "a".into(),
            is_dir: true,
        })
        .unwrap();
        assert_eq!(json["isDir"], true);
    }

    #[test]
    fn walk_skips_the_skip_list_at_any_depth() {
        let root = temp_dir("walk");
        for d in SKIP_DIRS {
            std::fs::create_dir_all(root.join(d)).unwrap();
            std::fs::write(root.join(d).join("x.txt"), "x").unwrap();
            std::fs::create_dir_all(root.join("src").join(d)).unwrap();
            std::fs::write(root.join("src").join(d).join("y.txt"), "y").unwrap();
        }
        std::fs::write(root.join("src/a.ts"), "x").unwrap();
        std::fs::write(root.join("top.txt"), "x").unwrap();
        let mut list = walk(&root, 100);
        list.files.sort();
        assert_eq!(list.files, ["src/a.ts", "top.txt"]);
        assert!(!list.truncated);
    }

    #[test]
    fn walk_truncates_at_max() {
        let root = temp_dir("walk-max");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/a.ts"), "x").unwrap();
        std::fs::write(root.join("top.txt"), "x").unwrap();
        let list = walk(&root, 1);
        assert_eq!(list.files.len(), 1);
        assert!(list.truncated);
    }

    #[test]
    fn parse_ls_files_drops_the_partial_tail_and_duplicates() {
        let list = parse_ls_files(b"a\0a\0b\0c", true, 10);
        assert_eq!(list.files, ["a", "b"]);
        assert!(list.truncated);
    }

    #[test]
    fn parse_ls_files_truncates_at_max() {
        let list = parse_ls_files(b"a\0b\0c\0", false, 2);
        assert_eq!(list.files, ["a", "b"]);
        assert!(list.truncated);
    }

    #[test]
    fn parse_ls_files_drops_nested_repo_entries() {
        let list = parse_ls_files(b"a\0nested/\0b\0", false, 10);
        assert_eq!(list.files, ["a", "b"]);
        assert!(!list.truncated);
    }

    #[tokio::test]
    async fn fs_list_files_uses_git_and_honors_gitignore() {
        if !git_available() {
            eprintln!("skipping: git is not installed");
            return;
        }
        let root = temp_dir("lsfiles");
        git(&root, &["init"]);
        std::fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();
        std::fs::write(root.join("a.txt"), "a").unwrap();
        git(&root, &["add", "a.txt"]);
        std::fs::write(root.join("b.txt"), "b").unwrap();
        std::fs::write(root.join("ignored.txt"), "i").unwrap();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/c.txt"), "c").unwrap();
        let mut list = fs_list_files(s(&root)).await.unwrap();
        list.files.sort();
        assert_eq!(list.files, [".gitignore", "a.txt", "b.txt", "sub/c.txt"]);
        assert!(!list.truncated);
    }

    fn paged_file(name: &str, bytes: &[u8]) -> PathBuf {
        let root = temp_dir(name);
        std::fs::write(root.join("f"), bytes).unwrap();
        root
    }

    #[test]
    fn index_counts_lines_like_the_text_mode_split() {
        for (i, (text, n)) in [("a\nb\n", 2), ("a\nb", 2), ("a\r\nb\r\n", 2), ("\n", 1)]
            .into_iter()
            .enumerate()
        {
            let root = paged_file(&format!("index-count-{i}"), text.as_bytes());
            assert_eq!(
                open_paged(&PagedIndexes::default(), &s(&root), "f").unwrap(),
                n,
                "{text:?}"
            );
        }
    }

    #[test]
    fn read_lines_seeks_through_the_index_and_strips_line_ends() {
        let text: String = (0..1000).map(|i| format!("line {i}\r\n")).collect();
        let root = paged_file("read-lines", text.as_bytes());
        let ix = PagedIndexes::default();
        let read = |start, count| read_lines(&ix, &s(&root), "f", start, count).unwrap();
        assert_eq!(read(300, 3), ["line 300", "line 301", "line 302"]);
        assert_eq!(read(998, 10), ["line 998", "line 999"]);
        assert!(read(1000, 10).is_empty());
        assert!(read(5000, 10).is_empty());
        assert_eq!(read(0, 5000).len() as u64, MAX_READ_LINES);
    }

    #[test]
    fn read_lines_cuts_a_giant_line_and_decodes_lossy() {
        let mut bytes = vec![b'a'; MAX_LINE_BYTES as usize + 10];
        bytes.extend_from_slice(b"\nf\xffo\n");
        let root = paged_file("long-line", &bytes);
        let lines = read_lines(&PagedIndexes::default(), &s(&root), "f", 0, 10).unwrap();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].len() as u64, MAX_LINE_BYTES);
        assert_eq!(lines[1], "f\u{fffd}o");
    }

    #[test]
    fn index_is_reused_until_the_file_changes_and_the_map_stays_bounded() {
        let root = paged_file("index-lru", b"a\n");
        let ix = PagedIndexes::default();
        let (path, meta) = regular_file(&s(&root), "f").unwrap();
        let first = index_for(&ix, &path, &meta, true).unwrap();
        assert!(Arc::ptr_eq(
            &first,
            &index_for(&ix, &path, &meta, true).unwrap()
        ));
        std::fs::write(root.join("f"), "a\nb\nc\n").unwrap(); // a new size
        let (path, meta) = regular_file(&s(&root), "f").unwrap();
        assert!(Arc::ptr_eq(
            &first,
            &index_for(&ix, &path, &meta, false).unwrap()
        ));
        assert_eq!(index_for(&ix, &path, &meta, true).unwrap().line_count, 3);
        for i in 0..MAX_INDEXES + 2 {
            std::fs::write(root.join(format!("g{i}")), "x").unwrap();
            let (p, m) = regular_file(&s(&root), &format!("g{i}")).unwrap();
            index_for(&ix, &p, &m, true).unwrap();
        }
        assert_eq!(ix.0.lock().unwrap().len(), MAX_INDEXES);
    }

    #[test]
    fn index_extends_an_append_to_what_a_full_build_gives() {
        let head = (0..1000).map(|i| format!("line {i}\n")).collect::<String>() + "partial";
        let root = paged_file("index-append", head.as_bytes());
        let ix = PagedIndexes::default();
        let (path, meta) = regular_file(&s(&root), "f").unwrap();
        let old = index_for(&ix, &path, &meta, true).unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(root.join("f"))
            .unwrap()
            .write_all(b" tail\nmore\n")
            .unwrap();
        let (path, meta) = regular_file(&s(&root), "f").unwrap();
        let extended = scan_index(
            &path,
            stat_of(&meta),
            old.offsets.clone(),
            (old.offsets.len() as u64 - 1) * INDEX_STEP,
        )
        .unwrap();
        let full = scan_index(&path, stat_of(&meta), vec![0], 0).unwrap();
        assert_eq!(
            (extended.line_count, &extended.offsets),
            (full.line_count, &full.offsets)
        );
        assert_eq!(index_for(&ix, &path, &meta, true).unwrap().line_count, 1002);
        assert!(line_start_at(&path, old.offsets[1]));
        assert!(!line_start_at(&path, 3));
    }

    /// Indexes `old`, rewrites the file to `new` (larger), and returns the fresh line count.
    fn line_count_after_rewrite(name: &str, old: &[u8], new: &[u8]) -> u64 {
        let root = paged_file(name, old);
        let ix = PagedIndexes::default();
        let (path, meta) = regular_file(&s(&root), "f").unwrap();
        assert_eq!(
            index_for(&ix, &path, &meta, true).unwrap().offsets,
            vec![0, 512]
        );
        std::fs::write(root.join("f"), new).unwrap();
        let (path, meta) = regular_file(&s(&root), "f").unwrap();
        index_for(&ix, &path, &meta, true).unwrap().line_count
    }

    #[test]
    fn a_grown_file_whose_offset_is_no_line_start_is_built_again() {
        let new = [vec![b'y'; 1000], b"\n".to_vec(), b"z\n".repeat(10)].concat();
        // An extension from offset 512 would give 256 + 11.
        assert_eq!(
            line_count_after_rewrite("index-rewrite", &b"x\n".repeat(300), &new),
            11
        );
    }

    #[test]
    fn a_truncated_and_regrown_file_with_a_new_head_is_built_again() {
        // Byte 511 is still `\n`, so only the head check sees the rewrite.
        let new = [vec![b'h'; 511], b"\n".to_vec(), b"z\n".repeat(200)].concat();
        // An extension from offset 512 would give 256 + 200.
        assert_eq!(
            line_count_after_rewrite("index-rotate", &b"x\n".repeat(300), &new),
            201
        );
    }

    #[test]
    fn skip_rest_stops_between_buffers_when_asked() {
        let data = [vec![b'a'; 100], b"\nb\n".to_vec()].concat();
        let mut reader = BufReader::with_capacity(16, data.as_slice());
        skip_rest(&mut reader, &|| true).unwrap();
        let mut rest = Vec::new();
        reader.read_to_end(&mut rest).unwrap();
        assert_eq!(rest.len(), data.len() - 16); // one buffer, then it stopped
        let mut reader = BufReader::with_capacity(16, data.as_slice());
        skip_rest(&mut reader, &|| false).unwrap();
        let mut buf = Vec::new();
        assert!(next_line(&mut reader, &mut buf, &|| false).unwrap());
        assert_eq!(buf, b"b");
    }

    fn search_bytes(name: &str, bytes: &[u8], query: &str, max: usize) -> SearchResult {
        let root = paged_file(name, bytes);
        search_file(&root.join("f"), query, max, &AtomicU64::new(0), 0).unwrap()
    }

    #[test]
    fn search_is_case_insensitive_without_overlap_with_utf16_columns() {
        let r = search_bytes(
            "search",
            "Foo foo\r\nbar\n\u{e9} FOO\n".as_bytes(),
            "foo",
            100,
        );
        let found: Vec<(u64, u64)> = r.matches.iter().map(|m| (m.line, m.col)).collect();
        assert_eq!(found, [(0, 0), (0, 4), (2, 2)]); // the 2-byte e-acute is 1 UTF-16 unit
        assert!(!r.truncated);
        assert_eq!(
            search_bytes("search-overlap", b"aaaa", "aa", 100)
                .matches
                .len(),
            2
        );
        assert!(search_bytes("search-empty", b"abc", "", 100)
            .matches
            .is_empty());
    }

    #[test]
    fn search_stops_at_max_and_when_a_newer_search_starts() {
        let r = search_bytes("search-max", b"x\nx\nx\n", "x", 2);
        assert_eq!(r.matches.len(), 2);
        assert!(r.truncated);
        let root = paged_file("search-cancel", b"x");
        let newer = AtomicU64::new(1);
        assert_eq!(
            search_file(&root.join("f"), "x", 10, &newer, 0)
                .unwrap_err()
                .code,
            "cancelled"
        );
    }
}
