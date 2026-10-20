//! File viewer spec §3: read-only file commands, confined to a workspace root.

use crate::commands::ApiError;
use crate::flutter::api_error;
use crate::git::{run_git, GIT_TIMEOUT};
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
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
    TooLarge,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub kind: ReadKind,
    pub content: Option<String>,
    pub size: u64,
}

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

fn read_text(root: &str, rel: &str) -> Result<ReadResult, ApiError> {
    let path = confine(root, rel)?;
    let meta = std::fs::metadata(&path).map_err(io_error)?;
    // A FIFO open blocks on Unix; a folder or a submodule is not a file.
    if !meta.is_file() {
        return Err(api_error(
            "not_a_file",
            format!("Not a regular file: {rel}"),
        ));
    }
    let size = meta.len();
    let mut bytes = Vec::new();
    std::fs::File::open(&path)
        .map_err(io_error)?
        .take(MAX_READ_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > MAX_READ_BYTES {
        return Ok(ReadResult {
            kind: ReadKind::TooLarge,
            content: None,
            size,
        });
    }
    if bytes[..bytes.len().min(BINARY_SNIFF_BYTES)].contains(&0) {
        return Ok(ReadResult {
            kind: ReadKind::Binary,
            content: None,
            size,
        });
    }
    Ok(ReadResult {
        kind: ReadKind::Text,
        content: Some(String::from_utf8_lossy(&bytes).into_owned()),
        size,
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
    fn read_text_over_max_is_too_large() {
        let n = MAX_READ_BYTES as usize + 1;
        let r = read_bytes("toolarge", &vec![b'a'; n]).unwrap();
        assert_eq!(r.kind, ReadKind::TooLarge);
        assert_eq!(r.content, None);
        assert_eq!(r.size, MAX_READ_BYTES + 1);
    }

    #[test]
    fn read_text_exactly_max_is_text() {
        let r = read_bytes("exactmax", &vec![b'a'; MAX_READ_BYTES as usize]).unwrap();
        assert_eq!(r.kind, ReadKind::Text);
        assert_eq!(r.size, MAX_READ_BYTES);
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
            serde_json::to_string(&ReadKind::TooLarge).unwrap(),
            "\"tooLarge\""
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
}
