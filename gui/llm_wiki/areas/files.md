# File tree, file viewer, Find File

## Purpose
The sidebar shows a file tree per workspace. A viewer shows files over the terminal canvas. Double-Shift opens Find File.

## Key files
- `src-tauri/src/files.rs` - commands: `fs_list_dir` (line 521), `fs_read_text` (528), `fs_stat` (535), `fs_open_paged` (542), `fs_read_lines` (554), `fs_search` (568), `fs_list_files` (585).
- `src-tauri/src/files.rs:127` - `confine` keeps every path inside the workspace root.
- `src/files/filesApi.ts` - typed wrappers (line 44 onward). `fuzzy.ts` - `rankPaths` (line 43), `MAX_RESULTS` = 50 (line 3). `highlight.ts` - lexical tokenizer.
- `src/ui/fileTree.ts` - `renderFileTree` (line 108). `src/ui/fileViewer.ts` - virtual-row viewer. `src/ui/quickOpen.ts` - `openQuickOpen` (line 41). `src/ui/viewerFind.ts` - find bar in the viewer.
- `src/appFiles.ts` - state and wiring: `initFiles` (line 183), `openFindFile` (line 388), `findInFileViewer` (line 382), `fileTabAction` (line 401).

## Limits (Rust)
- Files of 8 MiB or more open in paged mode (`src-tauri/src/files.rs:14`).
- Page reads return at most 1000 lines (line 22). A line is cut at 64 KiB (line 24).
- The file list stops at 50,000 files (line 26). `fs_list_files` uses `git ls-files` (line 591) and falls back to a walk (`walk`, line 478).
- A line index keeps up to 8 files (line 19), one entry per 256 lines (line 17).

## Limits (viewer)
- Row overscan 20 (`src/ui/fileViewer.ts:12`). Page size 500 lines, 8 cached pages (`src/ui/fileViewer.ts:16-17`).
- A file text and name are untrusted. The viewer uses `textContent` only (`src/ui/fileViewer.ts:1-4`).

## Edges
- Open tabs are viewer state in `appFiles.ts`. herdr does not know them.
- Markers: [[shortcut-markers]] (`fuzzy.ts:42`, `highlight.ts:3`, `fileViewer.ts:219`).
- Tests: `tests/unit/files/`, Rust tests in `src-tauri/src/files.rs:618` onward.
- Specs: `docs/file-viewer-spec.md`, `docs/file-viewer-paged-spec.md`.
