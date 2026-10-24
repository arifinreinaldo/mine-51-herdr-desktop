# File Viewer — Design Spec

Status: approved in brainstorming on 2026-10-19. Implementation plan: not written yet.

## 1. Goal

The user browses and reads files of the focused workspace without leaving herdr.
The feature has three parts:

1. A file tree in the sidebar, in the JetBrains project-view style.
2. A read-only file viewer over the terminal area, in the JetBrains editor style, with file tabs.
3. A find-file dialog. A double tap on Shift opens it.

Success criterion: the live check in section 9 passes, and all test suites pass.

## 2. Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| D1 | Read-only viewer. No editing in v1. | Light editing with save (dirty state, write conflicts with agents). |
| D2 | The tree is a persistent sidebar section, like Source Control. | Floating dropdown from the tab strip. |
| D3 | The tree shows all entries except `.git`. No `.gitignore` awareness. Folders load lazily. | Dim or hide gitignored entries (new crate or extra git calls). |
| D4 | The finder index uses `git ls-files`; a fallback walk applies outside git. | Finder includes ignored files. |
| D5 | A hand-written, table-driven tokenizer gives syntax highlighting. Git P1 (O2 in `git-p1-plan.md`) reuses it. | No highlighting; highlight.js. |
| D6 | The viewer has its own file-tab row inside the overlay. Terminal tabs do not change. | Single file; file tabs in the main tab strip. |
| D7 | No file watcher. The viewer reads the file again on tab activation, on a click on the active tab, on window focus, and when a 2 s `fs_stat` poll sees a new mtime or size. The tree re-reads on expand and on refresh. | Live watcher (new crate). |
| D8 | UI state lives in memory only. A restart starts clean. | Persist open tabs and expanded folders. |

## 3. Rust backend

New file `gui/src-tauri/src/files.rs`. Register the commands in `lib.rs`.

### 3.1 Path confinement

These are the first general file commands in the app. Every command confines paths to the root:

- Canonicalize `root`. Reject it if it is not a directory.
- Canonicalize `root.join(rel)`. Reject the path if it does not start with the canonical root.
- This check rejects `..` segments and symlinks that point outside the root.
- `rel` uses `/` separators on all platforms.

### 3.2 Commands

`fs_list_dir(root: String, rel: String) -> Vec<DirEntry>`

- `DirEntry` is `{ name: String, isDir: bool }`.
- The command omits the entry `.git`.
- Sort order: folders first, then case-insensitive by name.

`fs_read_text(root: String, rel: String) -> ReadResult`

- `ReadResult` is `{ kind: "text" | "binary" | "paged", content: Option<String>, size: u64 }`.
- A file of 8 MiB or more returns `paged` without content. The viewer then calls `fs_open_paged` (the line count), `fs_read_lines` and `fs_search`. A line index in Rust state (at most 8 files) serves these commands. An append extends the index; any other change builds it again.
- `fs_stat(root, rel) -> { mtimeMs, size }` feeds the freshness poll.
- A NUL byte in the first 8 KB returns `binary` without content.
- Otherwise the command decodes the bytes as lossy UTF-8 and returns `text`.
- A missing file returns an error. The frontend shows the "missing" notice.

`fs_list_files(root: String) -> FileList`

- `FileList` is `{ files: Vec<String>, truncated: bool }`. Paths are relative and use `/`.
- First attempt: `git ls-files --cached --others --exclude-standard` through the existing `run_git` in `git.rs`.
- Fallback when git fails: a recursive walk that skips `.git`, `node_modules`, `build`, `target`, `.dart_tool` and `vendor`.
- Both paths stop at 50,000 files and set `truncated`.

## 4. Frontend modules

| Module | Responsibility |
|---|---|
| `src/files/filesApi.ts` | `invoke` wrappers for the three commands. Follows `src/git/gitApi.ts`. |
| `src/files/fuzzy.ts` | Pure scoring and ranking of paths against a query. |
| `src/files/highlight.ts` | Pure tokenizer and per-language tables. |
| `src/keyboard/doubleShift.ts` | Pure double-Shift state machine. |
| `src/ui/fileTree.ts` | Render of the sidebar tree section. |
| `src/ui/fileViewer.ts` | Render of the viewer overlay: tab row, gutter, lines, breadcrumb. |
| `src/ui/quickOpen.ts` | Finder dialog. Builds on `openModal` (`src/ui/modal.ts`). |
| `src/appFiles.ts` | Wiring and state. Follows `src/appSourceControl.ts`. |

Mount points:

- `<section id="file-tree" hidden>` in `#sidebar`, next to `#source-control`. Refs go in `appDom.ts`.
- `<div id="file-viewer" hidden>` in `#terminal-wrap`, next to `#diff-view`.
- `settings.fileTreeOpen` (default `false`) in `settings.ts` and `settings.rs`, like `sourceControlOpen`.
- A View-menu toggle in `appMenuBar.ts` and `ui/menus.ts`, like the Source Control toggle.

## 5. State and timing

- Truth lives on disk. `appFiles.ts` owns UI state per workspace:
  `Map<workspaceId, { expanded: Set<rel>, children: Map<rel, DirEntry[]>, tabs: rel[], active: rel | null }>`.
- The root is the focused workspace's `new_workspace_cwd` from the snapshot, the same source as Source Control.
- A workspace switch hides the viewer and renders the tree from the state of the new workspace.
- Freshness rules (D7):
  - The viewer calls `fs_read_text` when a tab becomes active, on a click on the active tab, and on window focus. A 2 s `fs_stat` poll reads again when the mtime or the size changes. A refresh keeps the top line, the current line and the find bar.
  - The tree calls `fs_list_dir` each time a folder expands.
  - A ↻ button in the tree section header re-reads all expanded folders.
- The viewer and the diff view share `#terminal-wrap`. Opening one closes the other.
- Esc hides the viewer and keeps its tabs. A file open from the tree or the finder shows the viewer again.
- Each async read carries a request token. The viewer ignores a response for a tab that is no longer active.

## 6. File tree

- The section header shows the root folder name, a ↻ button and a collapse-all button.
- Each row shows: indent, chevron (folders only), icon, name.
- Vertical indent guides mark each depth level.
- Folder icons: codicons `folder` and `folder-opened`.
- File icons: a small extension label (`php`, `ts`, `dart`) in a muted color, because codicons has no per-language icons.
- The row under the mouse gets a hover background. The tooltip shows the absolute path.
- Click on a folder toggles it. Click on a file opens it in the viewer.
- Keyboard: ↑/↓ move, →/← expand/collapse, Enter opens.
- A list error (for example, a deleted folder) shows an inline muted row with the error text.

## 7. Double-Shift and finder

### 7.1 Double-Shift

The shortcut table in `shortcuts.ts` cannot express a modifier-only key. The tracker hooks into the capture-phase listener in `keyboard/routing.ts`, before the table lookup.

- Arm: Shift keydown (`ShiftLeft` or `ShiftRight`), `!e.repeat`, no other modifier held.
- Tap 1 ends at the Shift keyup.
- Fire: a second Shift keydown within 400 ms after the keyup of tap 1.
- Cancel: any other keydown or a mouse button between the taps, or a Shift hold longer than 400 ms.
- The tracker fires from any focus target.
- The tracker does not fire when an overlay or a modal is open (`isOverlayOpen`).
- A bare Shift sends nothing to the PTY, so the terminal receives no input.
- The shortcuts modal lists "Shift Shift — Find File" as one static line.

### 7.2 Finder dialog

- A centered modal with an input and a result list.
- On open, the dialog calls `fs_list_files` and shows "Indexing…" until the list arrives. The dialog does not cache the list.
- The list shows the top 50 results. Each row shows the file name (matched characters highlighted) and the relative folder (dimmed).
- An empty query lists the files that already have a viewer tab.
- A truncated index shows the footer "Showing first 50,000 files".
- Keys: ↑/↓ select, Enter opens, Esc closes. Focus returns to the previous element.
- If the file already has a viewer tab, Enter activates that tab.

### 7.3 Fuzzy ranking

- The query matches the file name as a case-insensitive subsequence.
- Bonuses: consecutive characters, a match at a word or camel-case boundary, a match at the file-name start.
- Example: `BaCo` matches `BankController.php`.
- Ties go to the shorter relative path.

## 8. Viewer

### 8.1 Tab row

- Each tab shows the extension label and the file name. The tooltip shows the full path.
- Two tabs with the same file name show their parent folder, dimmed.
- Middle-click or × closes a tab. Closing the last tab hides the viewer.
- Opening a file that already has a tab activates that tab.
- Shortcut routing: while focus is inside `#file-viewer`, `routing.ts` sends the actions `tab.close`, `tab.next` and `tab.previous` to the file tabs. The keys stay platform-specific (Windows `Ctrl+Shift+W`, `Ctrl+Tab`; macOS `Cmd+W`, `⌃Tab`). Outside the viewer, these actions act on terminal tabs as before.

### 8.2 Body

- A gutter with right-aligned line numbers in a muted color, and a separator line.
- A click on a line marks it as the current line. The current line gets a background, and its number becomes brighter.
- No wrap. Horizontal scroll for long lines.
- Native text selection and copy.
- The viewer renders only the rows near the viewport (virtual rows). All rows have one height. Find in the file searches all lines, not the rendered rows.
- Notices replace the body for `binary` and missing files.

### 8.3 Breadcrumb

- The bottom bar shows `root › dir › … › file`.
- A muted "Read-only" label sits at the right end.

### 8.4 Highlighting

- Colors follow JetBrains Darcula on the dark theme: keywords orange, strings green, numbers blue, comments gray italic. The colors are theme tokens in `style.css`.
- The file extension selects the language table. An unknown extension gives plain text.
- v1 languages: PHP, Dart, Kotlin, TypeScript/JavaScript, SQL, JSON, YAML, Markdown.
- The tokenizer works line by line. It carries the state of an open block comment or multi-line string to the next line.
- Limit: the tokenizer is lexical. Some constructs (for example, a PHP heredoc) can get wrong colors.
- Out of scope: code folding, error stripes, semantic highlighting.

## 9. Verification

### 9.1 Unit tests (Vitest)

- `tests/unit/files/fuzzy.test.ts`: subsequence hit and miss, camel-hump, ranking order, tie break, the 50-result cap.
- `tests/unit/files/highlight.test.ts`: per language — keyword, string, number, comment; multi-line comment state; escaped quotes; unknown extension.
- `tests/unit/keyboard/doubleShift.test.ts`: fast double tap fires; slow tap, long hold, `Shift+H` between taps, repeat event, Ctrl+Shift do not fire.
- `tests/unit/ui/fileViewer.test.ts` (jsdom): open, dedupe, close, cycle tabs; same-name tabs; binary and missing notices; virtual rows; paged rows.
- `tests/unit/ui/fileTree.test.ts` (jsdom): lazy expand, sort order, error row.
- `tests/unit/keyboard/routing.test.ts`: double-Shift opens the finder from the terminal; no fire while an overlay is open; tab actions go to file tabs while the viewer has focus.

### 9.2 Rust tests (`files.rs`)

- `../` escape rejected; symlink to outside root rejected.
- `.git` omitted; sort order correct.
- Binary detection, paged threshold, lossy UTF-8, line index (build and append), line reads, search and its cancel.
- `fs_list_files`: git path (temp repo with `.gitignore`) and fallback walk (skip list, cap).

### 9.3 Commands

Run in a Herdr pane and keep the output as evidence:

1. `cargo test` in `gui/src-tauri`.
2. `npx vitest run` in `gui`.
3. `npx tsc --noEmit` in `gui`.

### 9.4 Live check

1. Open the file tree on this repo. Expand `gui/src`. Hover a file and see the absolute-path tooltip.
2. Focus the terminal. Double-tap Shift. Type `apSoCo`. Press Enter. `appSourceControl.ts` opens with highlighting.
3. Open a second file. Edit the first file from the terminal. Switch back to the first tab and see the new content.
4. Type `Hello` in the terminal. The finder does not open.

## 10. Risks and falsifiers

- Native selection covers only the rendered rows. Paged mode colours each page from a null tokenizer state and cuts lines at 64 KiB. A multi-GB file that is rewritten (not appended) is indexed again in full at each change.
- The 400 ms window can misfire for fast typists. If it does, the window becomes a setting.
- The root comes from the frontend. Confinement protects paths below the root, not the choice of root. This is acceptable because the frontend is the app's own code with no remote content.

## 11. Out of scope (v1)

Editing and save; file watcher; `.gitignore` dimming in the tree; content search (grep); code folding; persistence of tabs across restarts; file operations (create, rename, delete).
