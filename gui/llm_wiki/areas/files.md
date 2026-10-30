# File tree, file viewer, Find File

## Purpose
The sidebar shows a file tree per workspace. A viewer shows files over the terminal canvas. Double-Shift opens Find File.

## Key files
- `src-tauri/src/files.rs` - commands: `fs_list_dir` (line 566), `fs_read_text` (573), `fs_stat` (580), `fs_open_paged` (587), `fs_read_lines` (599), `fs_search` (613), `fs_list_files` (630), `fs_grep` (659; `git grep` for the content hits, `parse_grep` line 498).
- `src-tauri/src/files.rs:127` - `confine` keeps every path inside the workspace root.
- `src/files/filesApi.ts` - typed wrappers (line 44 onward). `fuzzy.ts` - `rankPaths` (line 73), `MAX_RESULTS` = 50 (line 3). `highlight.ts` - lexical tokenizer.
- `src/ui/fileTree.ts` - `renderFileTree` (line 108). `src/ui/fileViewer.ts` - virtual-row viewer. `src/ui/quickOpen.ts` - `openQuickOpen` (line 47). `src/ui/viewerFind.ts` - find bar in the viewer.
- `src/appFiles.ts` - state and wiring: `initFiles` (line 183), `openFindFile` (line 388), `findInFileViewer` (line 382), `fileTabAction` (line 401).

## Limits (Rust)
- Files of 8 MiB or more open in paged mode (`src-tauri/src/files.rs:14`).
- Page reads return at most 1000 lines (line 22). A line is cut at 64 KiB (line 24).
- The file list stops at 50,000 files (line 26). `fs_list_files` uses `git ls-files` (line 636) and falls back to a walk (`walk`, line 523).
- A line index keeps up to 8 files (line 19), one entry per 256 lines (line 17).

## Content search (Find File)
- With 3 or more characters, `quickOpen.ts` asks `fs_grep` after 200 ms. The list shows at most 50 hits under "In files".
- `fs_grep` runs only in a git work tree. Outside one, it returns no hits. It needs git 2.38 or newer for `--max-count`.
- A hit opens the file with `onOpenAt` (`appFiles.ts`). The viewer scrolls to the line after the read.
- A grep error stays silent. The file-name results still show.

## Limits (viewer)
- Row overscan 20 (`src/ui/fileViewer.ts:12`). Page size 500 lines, 8 cached pages (`src/ui/fileViewer.ts:16-17`).
- A file text and name are untrusted. The viewer uses `textContent` only (`src/ui/fileViewer.ts:1-4`).

## Edges
- Open tabs are viewer state in `appFiles.ts`. herdr does not know them.
- Markers: [[shortcut-markers]] (`fuzzy.ts:72`, `highlight.ts:3`, `fileViewer.ts:219`).
- Tests: `tests/unit/files/`, Rust tests in `src-tauri/src/files.rs:618` onward.
- Specs: `docs/file-viewer-spec.md`, `docs/file-viewer-paged-spec.md`.
