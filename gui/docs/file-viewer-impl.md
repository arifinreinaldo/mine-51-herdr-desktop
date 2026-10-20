# File Viewer: implementation spec (executes `gui/docs/file-viewer-spec.md`)

**Deviations from the approved spec. All were accepted in review; record them, do not ask again.**

1. **Double-Shift gate (§7.1).** The approved text gates on `isOverlayOpen`. This plan gates on `isOverlayOpen() && isActiveOverlayEscapableFromOutside()`.
   - Why: a pinned agent popover keeps the overlay slot while it is pinned (`escapableFromOutside: !pinned`, `statusbar.ts:686-689`). The literal gate would turn double-Shift off for every user who pins the agent list.
   - With this gate, the finder supersedes the pinned popover, and `onSupersededReopen` brings the popover back afterwards.
   - Touches: step 21 and one test in routing.test.ts.
2. **Finder focus return (§7.2, "Focus returns to the previous element").** Closing the finder returns focus to the terminal, which is the modal default (`modal.ts:65`). When the viewer is visible, the W1 bounce (step 16) moves focus back into the viewer. No `returnFocusTo` option is added.
3. **State key (§5).** The per-workspace state map is keyed by `` `${workspaceId}\n${cwd}` ``, not by `workspaceId` (review W4).
4. **Commands (§3.2).**
   - `fs_read_text` gains the error code `not_a_file`.
   - `fs_list_files` drops entries that end in `/` (review W6).
5. **Viewer hide rules (§5, addition).** The viewer hides on user moves to the terminal: a left press on a terminal tab or a workspace row, or a terminal-tab switch. When something else focuses the terminal, focus goes back into the viewer instead (review W1). The diff view keeps its own rule unchanged.

**Baseline, measured 2026-10-19 on the dirty tree:**

| Check | Result |
|---|---|
| `cargo test` in `gui/src-tauri` | Green: 317 lib tests plus integration tests |
| `npx tsc --noEmit` | Exit 0 |
| `npx vitest run` | 68 files, 828 tests, all pass |
| `cargo fmt --check` | Already fails on `flutter.rs:521,551` |
| `cargo clippy --lib --tests -- -D warnings` | Already fails in `engine.rs:1410`, `dispatch.rs:190`, `flutter.rs:449,555` and `settings.rs:263,264,307,308` |

**Exec labels.** `mechanical` means every edit in the step is a literal replacement of 2 lines or fewer. All other steps are `judgment`, even when the text is given literally.

## Header

**goal**: Add a sidebar file tree, a read-only file viewer with file tabs, and a double-Shift finder for the focused workspace, as `gui/docs/file-viewer-spec.md` specifies. Decisions D1–D8 stay fixed; the accepted deviations are listed above.

**deliverables**

Create these files:
- Rust: `gui/src-tauri/src/files.rs`.
- TS:
  - `gui/src/files/filesApi.ts`
  - `gui/src/files/fuzzy.ts`
  - `gui/src/files/highlight.ts`
  - `gui/src/keyboard/doubleShift.ts`
  - `gui/src/ui/fileTree.ts`
  - `gui/src/ui/fileViewer.ts`
  - `gui/src/ui/quickOpen.ts`
  - `gui/src/appFiles.ts`
- Tests (5 new files; Vitest goes from 68 to 73 files):
  - `gui/tests/unit/files/fuzzy.test.ts`
  - `gui/tests/unit/files/highlight.test.ts`
  - `gui/tests/unit/keyboard/doubleShift.test.ts`
  - `gui/tests/unit/ui/fileTree.test.ts`
  - `gui/tests/unit/ui/fileViewer.test.ts`

Touch these files, with additive edits only:
- `gui/src-tauri/src/lib.rs`
- `gui/src-tauri/src/git.rs` (visibility only)
- `gui/src-tauri/src/settings.rs`
- `gui/index.html`
- `gui/src/appDom.ts`
- `gui/src/settings.ts`
- `gui/src/ui/menus.ts`
- `gui/src/appMenuBar.ts`
- `gui/src/main.ts`
- `gui/src/keyboard/routing.ts`
- `gui/src/appSourceControl.ts` (export `closeDiff`, plus 1 line)
- `gui/src/ui/shortcutsModal.ts`
- `gui/src/style.css`
- `gui/tests/unit/keyboard/routing.test.ts`
- `gui/tests/unit/ui/menus.test.ts`
- `gui/tests/unit/ui/shortcutsModal.test.ts`

Keep these untouched:
- All other files, including `gui/src/ui/modal.ts` and the S3–S5 git work beyond the edits listed above.
- `src-tauri/capabilities/default.json`. Custom commands need no ACL entry; see the description in that file.
- `package.json` and `Cargo.toml`. Add no dependencies.

Do not commit. Do not run the dev server. Do not run `cargo fmt`: it would also reformat `flutter.rs`.

**contracts**

Rust commands (spec §3.2):
- All three are `#[tauri::command] pub async fn`. Blocking fs work runs in `tokio::task::spawn_blocking`, as in `flutter.rs:366-371`.
- `fs_list_dir(root: String, rel: String) -> Result<Vec<DirEntry>, ApiError>`
- `fs_read_text(root: String, rel: String) -> Result<ReadResult, ApiError>`
- `fs_list_files(root: String) -> Result<FileList, ApiError>`

JSON shapes. Serde uses `rename_all = "camelCase"`, as in `git.rs:15-21`.
- `DirEntry {"name": string, "isDir": bool}`
- `ReadResult {"kind": "text"|"binary"|"tooLarge", "content": string|null, "size": number}`. `ReadKind` is an enum with `#[serde(rename_all = "camelCase")]`, so `TooLarge` becomes `"tooLarge"`.
- `FileList {"files": string[], "truncated": bool}`

Errors:
- `ApiError {code, message}` (`commands.rs:183-186`), built with `crate::flutter::api_error` (`flutter.rs:45`).

| Code | When |
|---|---|
| `invalid_root` | The root is empty or relative, canonicalize fails, or the root is not a directory. |
| `outside_root` | The canonical target does not start with the canonical root. |
| `not_found` | An io `NotFound`. The frontend shows the "missing" notice. |
| `not_a_file` | Review W6. The canonical target exists but is not a regular file: a folder, a submodule folder or a FIFO. Message: `"Not a regular file: {rel}"`. The frontend shows it through the generic `error` notice. |
| `io_error` | Any other io error. |
| `fs_failed` | A `spawn_blocking` join error. |

Constants:
- `MAX_READ_BYTES = 2 * 1024 * 1024`, the same 2 MiB as `git.rs:56`.
- `BINARY_SNIFF_BYTES = 8 * 1024`
- `MAX_FILES = 50_000`
- `LS_FILES_CAP_BYTES = 16 * 1024 * 1024`
- Walk skip list (spec §3.2): `.git`, `node_modules`, `build`, `target`, `.dart_tool`, `vendor`.

git call:
- `git ls-files -z --cached --others --exclude-standard`, through `run_git(&root, …, None, Some(LS_FILES_CAP_BYTES), GIT_TIMEOUT)` (`git.rs:253`).

TS, in `filesApi.ts`:
- `fsListDir(root, rel): Promise<DirEntry[]>`
- `fsReadText(root, rel): Promise<ReadResult>`
- `fsListFiles(root): Promise<FileListing>`
- Each is one `invoke` with `{ root, rel }` or `{ root }`, as in `git/gitApi.ts:48-66`.

Other TS contracts:
- `KeyboardRoutingHandlers` (`routing.ts:49-59`) gets `onFileTabAction(id: string): void` in P4 and `onDoubleShift(): void` in P5. P5 also adds a new export, `routeKeyup(event: KeyboardEvent): void`.
- `ui/fileViewer.ts` exports:
  - `TabView { scrollTop: number; currentLine: number | null }`
  - `TabState { tabs: string[]; active: string | null; views: Map<string, TabView> }`
  - `openTab`, `closeTab`, `cycleTab`, `viewOf`, `renderFileViewer`
- New setting: `fileTreeOpen` in TS, `file_tree_open` in Rust. The default is `false`, with `#[serde(default)]`, as in `settings.rs:65-68`.
- `MenuBarContext` (`menus.ts:46-49`) gets `fileTreeOpen: boolean; onToggleFileTree(): void;`. The menu item has id `view.fileTree` and label "File Tree". It has no `ShortcutAction`.
- `appFiles.ts` exports `initFiles(): Promise<void>`, `applyFileTreeVisibility(): void`, `fileTabAction(id: string): void` and `openFindFile(): void`.

**edge cases**

Rust, paths and confinement:
1. Windows canonical paths are verbatim (`\\?\C:\…`). The rustfmt output in this repo shows this: `Diff in \\?\C:\Users\Reinaldo\…\flutter.rs`. Verbatim paths do not normalize `/` or `..`.
   - So join `rel` onto the original `root` string: `std::fs::canonicalize(Path::new(&root).join(&rel))`.
   - Then compare the two canonical paths with `starts_with`.
2. An absolute `rel` (`/etc/x`, `C:\x`) makes `Path::join` replace the root. Only canonicalize plus `starts_with` rejects it. Test this case.
3. A `..` path to an existing file outside the root gives `outside_root`. A `..` path to a missing file gives `not_found`. Both are rejections.
4. A symlink that points out of the root: canonicalize follows it, `starts_with` fails, and the result is `outside_root`.
   - On Windows without Developer Mode, the test cannot create the symlink. It then skips, as in `git.rs:632-638` and `git.rs:862-865`.

Rust, the file index:

5. `git ls-files` prints an unmerged path once per stage, so call `Vec::dedup()`. The cached part is sorted, so the duplicates are next to each other.
6. When the root is a subfolder of a repo, `ls-files` prints paths relative to that subfolder. The finder needs that form.
7. If git is missing (`git_not_found`, `git.rs:279-285`), the folder is not a repo (non-zero exit), or git times out, `fs_list_files` uses the fallback walk.
8. When stdout reaches its cap (`GitOutput.capped`, `git.rs:216-217`), the exit code has no meaning (`git.rs:487-489`). Drop the last entry, which can be partial, and set `truncated`.
9. The walk uses `DirEntry::file_type()`, which does not follow symlinks. So the walk does not enter symlinked folders or Windows junctions, and it cannot loop.
   - A symlink is listed only when `entry.path().is_file()` is true.
10. `fs_list_dir` omits `.git` (spec §3.2). The walk skips the six names at any depth.
11. Review W6: `ls-files --others` prints an untracked nested repository as `dir/`. `parse_ls_files` drops every entry that ends in `/`.

Rust, reading files:

12. A file over 2 MiB: read at most `MAX+1` bytes through `File::take`. More than `MAX` bytes gives `tooLarge`. Exactly `MAX` bytes gives `text`.
13. A NUL byte in the first 8 KiB gives `binary`. Invalid UTF-8 gives lossy text with U+FFFD.
14. Review W6: check `metadata().is_file()` before `File::open`.
    - On Unix, opening a FIFO for reading blocks until a writer appears, and that would hang a `spawn_blocking` thread.
    - A folder, or a submodule (a folder in the worktree), gives `not_a_file` instead of an io error.
    - `rel = ""` (the root itself) also gives `not_a_file`.

Keyboard:

15. A bare Shift never reaches the PTY. `keymap.ts:84,106-108` returns `null` for `"Shift"`.
16. The pinned-popover gate is deviation 1 at the top.
17. What `isOverlayOpen` covers:
    - **Covered:** top-level menus (`menu.ts:392-394`; submenus are not registered, their parent menu is), modals (`modal.ts:71`), the find bar (`findBar.ts:99`), confirm popovers (`confirmPopover.ts:170`), statusbar popovers (`statusbar.ts:188,686`) and the wizard (`wizard.ts:143`).
    - **Not covered:** the diff view, which only toggles `hidden` (`appSourceControl.ts:103,113`). No extra gate is necessary: opening a file from the finder closes the diff.
18. The modal always gives focus to the terminal when it closes (`modal.ts:65`). So finder Enter calls `dispose()` first and opens the file second, the same order as `menu.ts:181-182`. The viewer then takes focus.

Focus and hiding (review W1):

19. These calls give the terminal focus programmatically:
    - `statusbar.ts:185` (usage popover dispose) and `statusbar.ts:680` (agent popover dispose). The agent-done auto-close at `appDoneNotifications.ts:44-53` reaches line 680 after 8.1 s.
    - `modal.ts:65`, `confirmPopover.ts:161` and `wizard.ts:152`.
    - Menus that return focus through `keyboardCaptureReturnTarget`: `menus.ts:320`, `tabs.ts:180`, `sidebar.ts:277`, `paneContextMenu.ts:51` and `appFlutterRun.ts:326`.

    While the viewer is visible, every capture focus bounces back to `#file-viewer`. The viewer does not hide.
20. These are the user moves to the terminal:
    - A left press on `#tab-list`. `tabs.ts:284-288` then refocuses the capture.
    - A left press on `#sidebar-list` (`sidebar.ts:231-237`).
    - A change of the snapshot's `focused_tab_id` (`appTypes.ts:71`). These all change it:
      - Alt+1..9 (`appMenuBar.ts:348-350`) and Alt+` (`appMenuBar.ts:365-375`)
      - Next/Previous Tab outside the viewer (`appMenuBar.ts:99-110`) and New Tab (`appMenuBar.ts:94`)
      - the All Tabs menu (`appTabStrip.ts:183`) and tab-menu actions (`appTabStrip.ts:35`)
      - an agent-popover row (`appStatusBar.ts:59-61,90`)

    A grep found no `tab.focus` or `workspace.focus` call in a path that `appDoneNotifications.ts` reaches. That file imports only `openOrRefreshAgentPopover` (`:7`).
21. The canvas and the pane chrome are children of `#terminal-wrap`, under the viewer (z-index 4). So `appTerminalMouse.ts:239` and `paneChrome.ts:109` cannot fire while the viewer is visible.
22. Known limits:
    - Tab changes that the user did not make also hide the viewer: the focused tab closes when its process exits, another client switches tabs, or a CLI call uses `--focus`.
    - Some user moves keep the same tab and therefore do not hide the viewer: sidebar Enter on the current workspace (`sidebar.ts:290-296`), Alt+N to the current tab, and an agent-popover row in the current tab.
    - In both cases, Esc in the viewer gets to the terminal.
23. `hideFileViewer` refocuses the terminal only when the viewer held focus. Otherwise, a hide driven by a snapshot would take focus from the finder input or the commit box.
    - Read `fileViewerEl.contains(document.activeElement)` before you set `hidden`, because hiding the element blurs it to `body`.

Workspace state:

24. Review W4: there is one state per `` `${workspaceId}\n${cwd}` ``. `new_workspace_cwd` follows the focused pane (`appSourceControl.ts:181`). So a pane switch or a `cd` changes the key, and a switch back restores the expanded folders and the tabs. A key change hides the viewer.
25. The workspace can change while the finder is open. The `onOpen` callback then ignores the pick.

Viewer:

26. Two tabs with the same file name show their parent folder name, dimmed (spec §8.1). A file at the root shows no folder.
27. Middle-click on a tab: close it on `auxclick` with `button === 1`. Call `preventDefault` on `mousedown` with `button === 1`, which stops autoscroll.
28. The tab close "×" is a `<span>`, not a `<button>`. A click leaves focus on `#file-viewer`, so Ctrl+Tab and Ctrl+Shift+W keep going to the file tabs after a close re-renders the row.
29. A file longer than 5,000 lines renders 5,000 rows and a notice (spec §8.2).
30. A trailing newline: drop the last empty line that the split makes.
31. Review W3: a click on the tab that is already active does not read the file again.
    - Each tab keeps its own scroll position and current line in `TabState.views`. Every render restores them, so closing a background tab does not reset the active tab.
    - Set `scrollTop` last, after the breadcrumb is attached. The body height changes when the breadcrumb is added.
32. If a new read makes the file shorter, `scrollTop` clamps, and a current line past the end marks nothing.

Tests:

33. In `routing.test.ts`, `fakeElement` (`:11-15`) has no `closest`, and `fakeEvent` (`:17-30`) has no `timeStamp` or `repeat`. So the code uses `activeElement?.closest?.(…)` and passes `now` explicitly. A missing `timeStamp` gives `NaN`, and the tracker never fires.
34. `menus.test.ts:190` depends on the View-menu order: Toggle Sidebar at 0, Color Theme at 1. Append the new item after Source Control.
35. `shortcutsModal.test.ts:23-28` counts `.modal-shortcut-row`. The static Find File line therefore uses a different class and sits outside `.shortcuts-modal-list`.

**counterintuitive**
- `FileList` is a DOM global (`tsconfig.json:6` has `lib: [..., "DOM"]`). Name the TS interface `FileListing`. The JSON keys stay as specified, and the Rust struct stays `FileList`.
- `run_git`, `GitOutput` and `GIT_TIMEOUT` are private today (`git.rs:57,212-218,253`; a grep finds 0 `pub(crate)` items in git.rs). They need `pub(crate)`.
- `ls-files` needs `-z`. `core.quotepath=false` (`git.rs:261`) does not stop the C-quoting of special characters.
- Give `git -C` the original `root` string, not the canonical `\\?\` form.
- Spec §8.4 puts the Darcula colors in `style.css`, but `style.css:1-6` says "no hard-coded colours … apart from the built-in theme tables".
  - Resolution: one separate `:root { --syntax-* }` block, with a comment that cites spec §8.4.
  - All built-in themes are dark (`themes/index.ts:28-33`).
- Double-Shift cancels on `pointerdown` in the capture phase, not on `mousedown`. A `preventDefault` on pointerdown suppresses the compatibility mousedown, and pointerdown handlers exist at `tabs.ts:295` and `appTerminalMouse.ts:249`. A `wheel` event between the taps also cancels (review W7).
- On a Shift keydown, `shiftKey` is already `true`. So "no other modifier" means Ctrl, Alt or Meta only.
- The diff hides on every capture focus (`appSourceControl.ts:214`). Do not copy that rule for the viewer.
  - Popovers, and the agent-done auto-close, give the terminal focus programmatically (`statusbar.ts:680`). The viewer would disappear each time an agent finishes (review W1).
  - The viewer bounces focus back to itself instead, and it hides only on the user moves in edge case 20. The diff keeps its rule.
- The diff and the viewer exclude each other without an import cycle:
  - `appFiles` calls the exported `closeDiff(false)`.
  - `appSourceControl.openFile` sets `fileViewerEl.hidden = true`.
  - `appFiles` reads "visible" from the DOM.
- Gates: fmt and clippy already fail on this tree (see the baseline). Use these gates instead:
  - `rustfmt --edition 2021 --check src/files.rs`
  - clippy prints no line that mentions `files.rs`.
- `vitest.config.ts:9` defaults to `node`. Every DOM test starts with `// @vitest-environment jsdom`.
- `tsconfig.json` sets `noUnusedLocals` and `noUnusedParameters`, so the P3 placeholder parameter must start with `_`.

**rejected alternative**: Redirect the file-tab keys in `appMenuBar.ts` `SHORTCUT_HANDLERS` instead of in `routing.ts`. This lost for two reasons:
- Spec §8.1 and §9.1 put the redirect and its test in `routing.ts`.
- `routing.ts` already holds the claims that depend on focus (`TERMINAL_ONLY_IDS`, `routing.ts:40-46,92-94`).

**acceptance**

Offline. Run these in a Herdr pane (`HERDR_ENV=1`):
1. `cd gui/src-tauri && cargo test`: every result `ok`, 0 failed.
2. `rustfmt --edition 2021 --check src/files.rs`: exit 0.
3. `cargo clippy --lib --tests 2>&1 | grep -c "files.rs"`: prints `0`.
4. `cd gui && npx tsc --noEmit`: exit 0.
5. `npx vitest run`: 73 files, 0 failed.

Live. The user runs the app. Checks 1–4 are spec §9.4; checks 5–7 cover the review items, because `appFiles` has no unit test.
1. Open View ▸ File Tree and expand `gui/src`. Hover a file: the tooltip shows its absolute path.
2. Focus the terminal and double-tap Shift. Type `apSoCo` and press Enter. `appSourceControl.ts` opens with highlighting.
3. Open a second file. Edit the first file from the terminal, then switch back to its tab. The tab shows the new content.
4. Type `Hello` in the terminal, pressing Shift before H. The finder does not open.
5. W1: open a file, then let an agent finish. The agent list opens and closes by itself about 8 s later. The viewer stays visible and keeps focus. Then press the active terminal tab: the viewer hides, and the terminal takes your keys.
6. W3: in a file, scroll down and click a line. Open a second file, then close it with its ×. The first file keeps its scroll position and its current line. A click on the active tab does not flash "Loading…".
7. W5: open File Tree and Source Control together in a short window. The workspace list keeps at least two rows.

**smallest-change check**

| Step | Why no smaller change works |
|---|---|
| s1 | Spec §3.2 requires the existing `run_git`. The only change is visibility. |
| s2 | There is no fs plugin, and none is allowed. Three custom commands are the minimum. W6 adds one metadata check and one filter. |
| s3–s5 | Pure modules from the spec's module table. No installed dependency covers them. |
| s6–s7 | Copy `sourceControlOpen` and `#source-control`, field for field. |
| s8 | One `invoke` per command, as in `gitApi.ts`. |
| s9–s10 | The render module and the orchestration from the spec. They reuse the `sc-message` class and the shape of `appSourceControl.ts`. W4 only changes the map key. |
| s11 | The same toggle as Source Control, inline. It has two users, so do not extract it. |
| s12, s18 | Selector lists reuse the `#source-control` and `#diff-view` rules. Only new classes get new rules. W5 is one additive rule. |
| s13–s14 | Required by the spec. W3 keeps the view state in the existing `TabState`; no new module. |
| s15 | Mutual exclusion takes one export and one DOM line, with no import cycle. |
| s16 | Required by the spec. W1 is one focus listener, two pointerdown listeners and one snapshot comparison; no intent tracker. |
| s17, s21 | The spec puts this routing in `routing.ts`. W7 adds one `wheel` listener. |
| s19 | The finder from the spec, on `openModal` without changes to `modal.ts`. |
| s20 | About 13 lines. |
| s22 | One static line. |

## Steps

### P1: Rust backend

**step 1**: Make `run_git` reachable from `files.rs`.
- files: `gui/src-tauri/src/git.rs`
- edit (each anchor is unique in git.rs; verified with grep):
  - (a) `const GIT_TIMEOUT: Duration = Duration::from_secs(15);` → `pub(crate) const GIT_TIMEOUT: Duration = Duration::from_secs(15);`
  - (b) `struct GitOutput {` → `pub(crate) struct GitOutput {`
  - (c) `    code: Option<i32>,\n    stdout: Vec<u8>,` → `    pub(crate) code: Option<i32>,\n    pub(crate) stdout: Vec<u8>,`
  - (d) `    capped: bool,` (`git.rs:217`) → `    pub(crate) capped: bool,`
  - (e) `async fn run_git(` → `pub(crate) async fn run_git(`
- lines: 12 (6 removed, 6 added)
- exec: mechanical. Each edit is a literal of 2 lines or fewer.
- verify: `grep -cE "pub\(crate\) (async fn run_git|const GIT_TIMEOUT|struct GitOutput)" gui/src-tauri/src/git.rs` prints `3`. The baseline is 0.

**step 2**: Create `files.rs` with path confinement, the three commands and their tests, and register them.
- files: `gui/src-tauri/src/files.rs` (new), `gui/src-tauri/src/lib.rs`
- edit, `lib.rs`:
  - (a) `pub mod engine;\npub mod flutter;` → `pub mod engine;\npub mod files;\npub mod flutter;`
  - (b) `            git::git_commit,` → `            git::git_commit,\n            files::fs_list_dir,\n            files::fs_read_text,\n            files::fs_list_files,`
- edit, `files.rs` header and types:
  - Module doc: `//! File viewer spec §3: read-only file commands, confined to a workspace root.`
  - Imports: `crate::commands::ApiError`, `crate::flutter::api_error`, `crate::git::{run_git, GIT_TIMEOUT}`, `serde::Serialize`, `std::io::Read`, `std::path::{Path, PathBuf}`.
  - Types and constants from **contracts**. Each type derives `Debug, Clone, PartialEq, Serialize` with `#[serde(rename_all = "camelCase")]`. `ReadKind` also derives `Copy, Eq`.
- edit, `files.rs` helpers:
  - `fn io_error(e: std::io::Error) -> ApiError`
    - `NotFound` gives `not_found`. Any other error gives `io_error`.
  - `fn canonical_root(root: &str) -> Result<PathBuf, ApiError>`
    - Rejects an empty root and a root where `!Path::new(root).is_absolute()` (as at `git.rs:393`).
    - Canonicalizes the root and requires `is_dir()`.
    - Every failure gives `invalid_root`.
  - `fn confine(root: &str, rel: &str) -> Result<PathBuf, ApiError>`
    - `let base = canonical_root(root)?; let target = std::fs::canonicalize(Path::new(root).join(rel)).map_err(io_error)?;`
    - When `!target.starts_with(&base)`, return `outside_root`.
    - Add a one-line comment that gives the reason from edge case 1.
  - `fn list_dir(root, rel) -> Result<Vec<DirEntry>, ApiError>`
    - Runs `read_dir` on `confine(..)` and skips `.git`.
    - Sets `is_dir = entry.path().is_dir()`.
    - Sorts with `b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))`.
  - `fn read_text(root, rel) -> Result<ReadResult, ApiError>` (review W6):
    1. `let path = confine(root, rel)?; let meta = std::fs::metadata(&path).map_err(io_error)?;`
    2. If `!meta.is_file()`, return `api_error("not_a_file", format!("Not a regular file: {rel}"))`. Do this before `File::open` and add a one-line comment: a FIFO open blocks on Unix, and a folder or a submodule is not a file.
    3. `size = meta.len()`. Then `File::open(&path).map_err(io_error)?` and `.take(MAX_READ_BYTES + 1).read_to_end(&mut bytes)`.
    4. More than `MAX` bytes gives `TooLarge`, content `None`.
    5. A NUL in `bytes[..min(len, 8192)]` gives `Binary`, content `None`.
    6. Otherwise `Text`, with `String::from_utf8_lossy(&bytes).into_owned()`.
  - `fn parse_ls_files(stdout: &[u8], capped: bool, max: usize) -> FileList`
    1. Split on `0`.
    2. Drop empty entries and entries that end with `b"/"`. Add a comment: an untracked nested repo is listed as `dir/` (W6).
    3. Decode lossily.
    4. If `capped`, call `pop()`. Comment: the last entry can be partial.
    5. Call `dedup()`. Comment: git lists an unmerged path once per stage.
    6. Set `truncated = capped || len > max`, then `truncate(max)`.
  - `fn walk(root: &Path, max: usize) -> FileList`
    - Uses an explicit stack of `(PathBuf, rel_prefix)`. A `read_dir` error skips that folder. Relative paths join with `/`.
    - A directory as `file_type()` reports it (symlinks are not followed) that is not in the skip list goes on the stack.
    - A file, or a symlink with `entry.path().is_file()`, goes into `files`.
    - When the list is already at `max` and one more file is found, return with `truncated: true`.
- edit, `files.rs` commands:
  - `fs_list_dir` and `fs_read_text`: `spawn_blocking(move || …).await.map_err(|e| api_error("fs_failed", e.to_string()))?`.
  - `fs_list_files`:
    1. `let base = canonical_root(&root)?;`
    2. Try `run_git(&root, &["ls-files", "-z", "--cached", "--others", "--exclude-standard"], None, Some(LS_FILES_CAP_BYTES), GIT_TIMEOUT).await`.
    3. On `Ok(out)` where `out.code == Some(0) || out.capped`, return `parse_ls_files(&out.stdout, out.capped, MAX_FILES)`.
    4. Otherwise run `spawn_blocking(move || walk(&base, MAX_FILES))`.
- edit, `files.rs` tests (`#[cfg(test)] mod tests`). Copy a `temp_dir(name)` helper from `git.rs:640-650`, with the prefix `cowbell-files-test-`.
  - Confinement:
    - `..` to an existing `base/outside.txt` gives `outside_root`.
    - An absolute rel (the absolute path of the outside file) gives `outside_root`.
    - A symlink to the outside file gives `outside_root`. Make it with `#[cfg(unix)] std::os::unix::fs::symlink` or `#[cfg(windows)] std::os::windows::fs::symlink_file`. If that fails, skip with `eprintln!`.
    - A relative root and a missing root give `invalid_root`.
  - `list_dir`:
    - Entries `.git/`, `b/`, `A/`, `c.txt`, `B.txt` give the names `["A","b","B.txt","c.txt"]` and isDir `[true,true,false,false]`.
    - `list_dir(root, "src/deep")` works with a slash in `rel`.
  - `read_text`:
    - A text file gives Text.
    - A NUL at byte 10 gives Binary with content `None`.
    - `MAX+1` bytes give TooLarge with `size == MAX+1`.
    - Exactly `MAX` bytes give Text.
    - The bytes `[0x66,0xff,0x6f]` give `"f\u{fffd}o"`.
    - A missing file gives `not_found`.
    - W6: a subfolder `sub` gives `not_a_file`, and `rel = ""` gives `not_a_file`.
  - Serde: `ReadKind::TooLarge` serializes as `"tooLarge"`, and `DirEntry` has the key `isDir`.
  - `walk`:
    - It skips all six names and keeps `src/a.ts` and `top.txt`.
    - `walk(root, 1)` gives a list of length 1 and `truncated`.
  - `parse_ls_files`:
    - `parse_ls_files(b"a\0a\0b\0c", true, 10)` gives `["a","b"]` and `truncated`.
    - `parse_ls_files(b"a\0b\0c\0", false, 2)` gives `["a","b"]` and `truncated`.
    - W6: `parse_ls_files(b"a\0nested/\0b\0", false, 10)` gives `["a","b"]` and not truncated.
  - A `#[tokio::test]` for the git path. Skip it when git is missing.
    - Setup: `git init`; a `.gitignore` that contains `ignored.txt`; `git add a.txt`; the files `b.txt`, `ignored.txt` and `sub/c.txt`.
    - Expected: the sorted files are `[".gitignore","a.txt","b.txt","sub/c.txt"]`, not truncated.
- lines: about 4 in `lib.rs`; about 340 in `files.rs` (about 155 code, 185 tests)
- exec: judgment. A new file with test fixtures.
- verify: `cd gui/src-tauri && cargo test --lib -- files::tests git::tests` prints `test result: ok` with `0 failed`. Then `rustfmt --edition 2021 --check src/files.rs` exits 0.

### P2: Pure TS modules

**step 3**: Fuzzy ranking.
- files: `gui/src/files/fuzzy.ts` and `gui/tests/unit/files/fuzzy.test.ts` (both new)
- edit: write `fuzzy.ts` exactly as below. A prototype of this algorithm ran over the 3,133 `ls-files` paths of this repo. For `apSoCo` it found one hit, `gui/src/appSourceControl.ts`, in about 5 ms per query.
  ```ts
  // File viewer spec §7.3: ranks paths for Find File. Pure. The query matches the
  // file name, not the folders, as a case-insensitive subsequence.
  export const MAX_RESULTS = 50;
  export interface FuzzyResult { path: string; score: number; /** Indexes into the file name. */ positions: number[] }
  function isBoundary(name: string, k: number): boolean {
    if (k === 0) return true;
    const prev = name[k - 1];
    return !/[A-Za-z0-9]/.test(prev) || (/[A-Z]/.test(name[k]) && /[a-z]/.test(prev));
  }
  /** Whether `q.slice(from)` is a subsequence of `lower.slice(start)`. */
  function fits(q: string, from: number, lower: string, start: number): boolean {
    let j = start;
    for (let i = from; i < q.length; i++) { j = lower.indexOf(q[i], j); if (j < 0) return false; j++; }
    return true;
  }
  export function fuzzyMatch(query: string, path: string): FuzzyResult | null {
    const q = query.trim().toLowerCase();
    const name = path.slice(path.lastIndexOf("/") + 1);
    const lower = name.toLowerCase();
    if (q === "" || !fits(q, 0, lower, 0)) return null;
    const positions: number[] = [];
    let j = 0;
    for (let i = 0; i < q.length; i++) {
      let pick = lower.indexOf(q[i], j);
      // Keep a consecutive hit; else prefer a later word/camel boundary that still lets the rest match.
      if (!(i > 0 && pick === j)) {
        for (let k = pick; k >= 0; k = lower.indexOf(q[i], k + 1)) {
          if (isBoundary(name, k) && fits(q, i + 1, lower, k + 1)) { pick = k; break; }
        }
      }
      positions.push(pick);
      j = pick + 1;
    }
    let score = 0;
    positions.forEach((k, i) => {
      score += 1;
      if (k === 0) score += 8; else if (isBoundary(name, k)) score += 6;
      if (i > 0 && k === positions[i - 1] + 1) score += 4;
    });
    return { path, score, positions };
  }
  // shortcut: ranks every path on each keystroke; debounce if typing lags at 50,000 files.
  export function rankPaths(query: string, paths: readonly string[], limit = MAX_RESULTS): FuzzyResult[] {
    const results: FuzzyResult[] = [];
    for (const path of paths) { const m = fuzzyMatch(query, path); if (m) results.push(m); }
    results.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return results.slice(0, limit);
  }
  ```
- edit, tests:
  - `BaCo` against `app/Http/BankController.php` gives the positions `[0,1,4,5]`.
  - `xyz` gives `null`. `Http` against the same path gives `null`, because folders do not match.
  - Camel hump: `BC` gives `[0,4]`.
  - Ranking: `main` over `["src/domain.ts","src/main.ts","main.rs"]` gives `["main.rs","src/main.ts","src/domain.ts"]`.
  - Tie: `util` over `["a/b/c/util.ts","util.ts"]` ranks `util.ts` first.
  - Cap: 60 matching paths give 50 results. `limit` 5 gives 5.
  - An empty query gives `[]`.
  - `apSoCo` over `["gui/docs/appendix-sources-and-colors.md","gui/src/ui/sourceControl.ts","gui/src/appStatusBar.ts","gui/src/appSourceControl.ts"]` gives `[0].path === "gui/src/appSourceControl.ts"`. The appendix file gets the same score, and the shorter path wins the tie.
- lines: about 55 code and about 60 test
- exec: judgment. New files.
- verify: `cd gui && npx vitest run tests/unit/files/fuzzy.test.ts` passes all.

**step 4**: Table-driven line tokenizer.
- files: `gui/src/files/highlight.ts` and `gui/tests/unit/files/highlight.test.ts` (both new)
- edit, exports:
  - `type TokenKind = "plain"|"keyword"|"string"|"number"|"comment"`
  - `interface Token { kind; text }`
  - `type LineState = { kind: "comment" | "string"; close: string } | null`
  - `interface Language { keywords: ReadonlySet<string>; caseInsensitive?: boolean; lineComments: readonly string[]; blockComment?: readonly [string, string]; strings: readonly string[] /* longest first */; multiline: readonly string[]; headings?: boolean }`
  - `languageFor(fileName: string): Language | null`. It uses the extension after the last `.`, in lower case.
  - `tokenizeLine(line: string, lang: Language | null, state: LineState): { tokens: Token[]; state: LineState }`
- edit, file header:
  - `// shortcut: lexical only; a PHP heredoc or regex literal can get wrong colours (spec §8.4).`
  - Also state that Git P1 O2 reuses this module (D5).
- edit, language tables (extensions, then the fields):

  | Extensions | Line comments | Block comment | Strings (longest first) | Multiline | Flags |
  |---|---|---|---|---|---|
  | `php` | `//`, `#` | `/*` `*/` | `"` `'` | `"` `'` | |
  | `dart` | `//` | `/*` `*/` | `'''` `"""` `'` `"` | `'''` `"""` | |
  | `kt`, `kts` | `//` | `/*` `*/` | `"""` `"` `'` | `"""` | |
  | `ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs` | `//` | `/*` `*/` | `` ` `` `"` `'` | `` ` `` | |
  | `sql` | `--` | `/*` `*/` | `'` | none | caseInsensitive |
  | `json` | none | none | `"` | none | |
  | `yaml`, `yml` | `#` | none | `"` `'` | none | |
  | `md`, `markdown` | none | `<!--` `-->` | ```` ``` ```` `` ` `` | ```` ``` ```` | headings |

- edit, keyword lists:
  - PHP: `abstract and array as break case catch class clone const continue declare default do echo else elseif empty enum extends false final finally fn for foreach function global if implements include include_once instanceof interface isset list match namespace new null or parent print private protected public readonly require require_once return self static switch throw trait true try unset use var while yield`
  - Dart: `abstract as assert async await base break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return sealed set show static super switch sync this throw true try typedef var void when while with yield`
  - Kotlin: `abstract annotation as break by catch class companion const constructor continue data do else enum false final finally for fun get if import in init inline inner interface internal is lateinit null object open operator out override package private protected public return sealed set super suspend this throw true try typealias val var vararg when where while`
  - TS/JS: `abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface keyof let never new null number of private protected public readonly return satisfies set static string super switch this throw true try type typeof undefined unknown var void while yield`
  - SQL: `select from where and or not insert into values update set delete create alter drop table index view join inner left right outer full cross on as group by order having limit offset union all distinct case when then else end null is in exists between like primary key foreign references default unique constraint begin commit rollback asc desc with returning true false`
  - JSON and YAML: `true false null`
  - Markdown: none.
- edit, the algorithm for one line:
  1. When `lang === null`, return one plain token and the state `null`.
  2. If the incoming `state` is a comment, look for `indexOf(close)`.
     - Found: emit a comment token up to and including `close`, then go on with the line.
     - Not found: the whole line is a comment, and the state carries over.
  3. If the incoming `state` is a string, scan for `close` and skip each `\x` escape pair. The results are as in rule 2, with string tokens.
  4. If `headings` is set, `state === null`, and the line matches `/^#{1,6}(\s|$)/`, the whole line is one keyword token.
  5. Otherwise, loop over the position `i` and try these in this order:
     - A line-comment prefix: the rest of the line is a comment.
     - A block-comment opener: look for its close.
       - Not found: the rest of the line is a comment, and the state becomes `{comment, close}`.
     - A string delimiter, longest first: scan for its close as in rule 3.
       - Not found: the rest of the line is a string.
       - The state becomes `{string, delim}` only when the delimiter is in `multiline`.
     - `/^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/`: a number.
     - `/^[A-Za-z_$][\w$]*/`: a word. It is a keyword when the set contains it (lower-case it first when `caseInsensitive` is set); otherwise it is plain.
     - Anything else: one plain character.
  6. Merge adjacent plain tokens.
- edit, tests (per language, only for the kinds that its table defines):
  - PHP: `function` and `return` are keywords. `"a\"b"` is one string. `42` is a number. `// c` is a comment.
  - Dart: `/* open` carries into the next line, `still */ var y = 3;`. `'''` also carries.
  - Kotlin: `"""` carries.
  - TS: a backtick string carries. `0x1F` is a number.
  - SQL: `SELECT` and `select` are both keywords. `'x'` is a string. `-- c` is a comment.
  - JSON: `true` is a keyword. In `-1.5e3`, the number token is `1.5e3`. `"q\"x"` is a string.
  - YAML: `# c` is a comment. `true` is a keyword. `"v"` is a string.
  - Markdown: `# Title` is a keyword line. ```` ``` ```` carries the string state. `<!-- c -->` is a comment.
  - `languageFor("x.unknown") === null` gives one plain token. `languageFor("A.KT")` gives Kotlin.
  - `abc123` is plain.
- lines: about 150 code and about 110 test
- exec: judgment. New files and tables.
- verify: `cd gui && npx vitest run tests/unit/files/highlight.test.ts` passes all.

**step 5**: Double-Shift state machine.
- files: `gui/src/keyboard/doubleShift.ts` and `gui/tests/unit/keyboard/doubleShift.test.ts` (both new)
- edit: write exactly this:
  ```ts
  // File viewer spec §7.1: the double tap on Shift that opens Find File. Pure state;
  // `keyboard/routing.ts` feeds it from its capture-phase listeners.
  // shortcut: a fixed 400 ms window; make it a setting if fast typists misfire (spec §10).
  export const DOUBLE_SHIFT_WINDOW_MS = 400;
  export type ShiftKeyLike = Pick<KeyboardEvent, "code" | "repeat" | "ctrlKey" | "altKey" | "metaKey">;
  export interface DoubleShiftTracker {
    /** `true` when this keydown completes a double tap. */
    keydown(event: ShiftKeyLike, now: number): boolean;
    keyup(event: ShiftKeyLike, now: number): void;
    /** A mouse button or a wheel turn between the taps. */
    cancel(): void;
  }
  function isShift(event: ShiftKeyLike): boolean {
    return event.code === "ShiftLeft" || event.code === "ShiftRight";
  }
  export function createDoubleShiftTracker(windowMs = DOUBLE_SHIFT_WINDOW_MS): DoubleShiftTracker {
    let downAt: number | null = null; // tap 1: Shift down since
    let upAt: number | null = null; // tap 1 ended at
    const cancel = (): void => { downAt = null; upAt = null; };
    return {
      keydown(event, now) {
        if (isShift(event) && event.repeat) return false; // a held Shift; keyup checks the hold time
        // On a Shift keydown shiftKey is already true: only Ctrl, Alt and Meta are "other modifiers".
        if (!isShift(event) || event.ctrlKey || event.altKey || event.metaKey) { cancel(); return false; }
        if (upAt !== null && now - upAt <= windowMs) { cancel(); return true; }
        downAt = now;
        upAt = null;
        return false;
      },
      keyup(event, now) {
        if (!isShift(event) || downAt === null) return;
        upAt = now - downAt <= windowMs ? now : null;
        downAt = null;
      },
      cancel,
    };
  }
  ```
- edit, tests:
  - Fast tap: keydown at 0, keyup at 80, then keydown at 200 (`ShiftRight`) returns `true`.
  - Slow tap: a second keydown at 600 returns `false`.
  - Long hold: keydown at 0, a repeat keydown at 300 (returns false), keyup at 500, then keydown at 600 returns `false`.
  - W7 misfire 1: Shift↓ 0, H↓ 20, Shift↑ 50, Shift↓ 300 gives `false`. Without the H cancel this sequence would fire.
  - W7 misfire 2: Shift↓ 0, Shift↑ 30, H↓ 60, Shift↓ 100 gives `false`.
  - A repeat event as the second press gives `false`.
  - Ctrl+Shift twice gives `false`.
  - `cancel()` between the taps gives `false`.
  - A triple tap fires once.
- lines: about 40 code and about 80 test
- exec: judgment. New files.
- verify: `cd gui && npx vitest run tests/unit/keyboard/doubleShift.test.ts` passes all.

### P3: Tree, settings, mount, menu

**step 6**: Add the `fileTreeOpen` setting.
- files: `gui/src/settings.ts`, `gui/src-tauri/src/settings.rs`
- edit, `settings.ts`:
  - (a) `  sourceControlOpen: boolean;\n}` → `  sourceControlOpen: boolean;\n  /** File viewer spec §4: the file tree section is open. */\n  fileTreeOpen: boolean;\n}`
  - (b) `  sourceControlOpen: false,\n};` → `  sourceControlOpen: false,\n  fileTreeOpen: false,\n};`
- edit, `settings.rs`:
  - (a) `    pub source_control_open: bool,\n}` → `    pub source_control_open: bool,\n    /// File viewer spec §4: the file tree section is open.\n    #[serde(default)]\n    pub file_tree_open: bool,\n}`
  - (b) `            source_control_open: false,` → `            source_control_open: false,\n            file_tree_open: false,`
  - (c) after `        assert!(!response.settings.source_control_open);` add `\n        assert!(!response.settings.file_tree_open);`
- lines: 10
- exec: judgment. The text is literal, but `settings.rs` (a) adds 3 lines.
- verify: `cd gui/src-tauri && cargo test --lib -- settings::tests` prints `test result: ok`. The only TS `Settings` literal is `settings.ts:36`; step 10 runs `tsc` over it.

**step 7**: Add the tree mount and its DOM refs.
- files: `gui/index.html`, `gui/src/appDom.ts`
- edit, `index.html`: replace `        <section id="source-control" aria-label="Source Control" hidden>` with the block below, followed by that same line:
  ```html
          <section id="file-tree" aria-label="Files" hidden>
            <div class="sidebar-header">
              <i class="codicon codicon-chevron-down sidebar-header__chevron"></i>
              <span id="file-tree-title" class="sidebar-header__label">FILES</span>
              <span class="sidebar-header__spacer"></span>
              <button id="file-tree-refresh" class="icon-btn" title="Refresh" aria-label="Refresh">
                <i class="codicon codicon-refresh"></i>
              </button>
              <button id="file-tree-collapse" class="icon-btn" title="Collapse All" aria-label="Collapse All">
                <i class="codicon codicon-collapse-all"></i>
              </button>
            </div>
            <div id="file-tree-body" role="tree" aria-label="Files"></div>
          </section>
  ```
- edit, `appDom.ts`: after `export const sourceControlCommitBtn = document.getElementById("source-control-commit-btn") as HTMLButtonElement;`, add:
  ```ts
  export const fileTreeEl = document.getElementById("file-tree") as HTMLElement;
  export const fileTreeTitleEl = document.getElementById("file-tree-title") as HTMLSpanElement;
  export const fileTreeBodyEl = document.getElementById("file-tree-body") as HTMLDivElement;
  export const fileTreeRefreshBtn = document.getElementById("file-tree-refresh") as HTMLButtonElement;
  export const fileTreeCollapseBtn = document.getElementById("file-tree-collapse") as HTMLButtonElement;
  ```
- lines: 14 and 5
- exec: judgment. The text is literal, but the inserts are longer than 2 lines. All codicons in this spec exist in `node_modules/@vscode/codicons/dist/codicon.css` (verified).
- verify: `grep -c 'id="file-tree' gui/index.html` prints `5`.

**step 8**: Add the `invoke` wrappers.
- files: `gui/src/files/filesApi.ts` (new)
- edit:
  - A header comment that cites spec §3 and lists the error codes, including `not_a_file`.
  - The types `DirEntry`, `ReadResult` and `FileListing`, and the three functions from **contracts**.
  - Each function is `return invoke<T>("fs_…", { root, rel })`.
- lines: about 25
- exec: judgment. A new file.
- verify: `cd gui && npx tsc --noEmit` exits 0.

**step 9**: Tree render.
- files: `gui/src/ui/fileTree.ts` and `gui/tests/unit/ui/fileTree.test.ts` (both new)
- edit: DOM code only. Set all text through `textContent`, as in `sourceControl.ts:1-4,49-58`. Exports:
  - `export function extLabel(name: string): string`
    - `dot = name.lastIndexOf(".")`, then return `dot > 0 ? name.slice(dot + 1).toLowerCase().slice(0, 4) : ""`.
  - `export function absolutePath(root: string, rel: string): string`
    - The separator is `\` when `root` contains `\`; otherwise it is `/`.
    - Strip trailing separators from `root`. Split `rel` on `/` and join the parts with the separator.
    - When `rel === ""`, return `root`.
  - `export interface FileTreeModel { root: string; expanded: ReadonlySet<string>; children: ReadonlyMap<string, readonly DirEntry[] | { error: string }> }`
  - `export interface FileTreeCallbacks { onToggle(rel: string): void; onOpen(rel: string): void }`
  - `export function renderFileTree(bodyEl: HTMLElement, model: FileTreeModel | null, callbacks: FileTreeCallbacks): void`
- edit, `renderFileTree`:
  1. If a row inside `bodyEl` has focus, keep its rel as `focusedRel`. Then clear `bodyEl`.
  2. A `null` model renders one `div.sc-message` with the text "No workspace".
  3. Otherwise, render `children.get("")` recursively, starting at depth 0. The rel of a child is `parent === "" ? name : parent + "/" + name`.
- edit, each row is a `div.ft-row`:
  - Attributes: `tabIndex = 0`, `role="treeitem"`, `aria-level = depth + 1`, `dataset.rel`, `title = absolutePath(root, rel)`.
  - A folder row also gets `dataset.dir = "1"` and `aria-expanded`.
  - Children, in this order:
    1. one `span.ft-guide` for each depth level
    2. a chevron: `i.codicon.codicon-chevron-down|right.ft-chevron` for a folder, an empty `span.ft-chevron` for a file
    3. an icon: `i.codicon.codicon-folder-opened|folder` for a folder; for a file, `span.ft-ext` with `extLabel`, or `i.codicon.codicon-file` when the label is empty
    4. `span.ft-name`
- edit, children and error rows:
  - An expanded folder renders its children only when `children.get(rel)` exists.
  - An `{error}` value renders `div.ft-row.ft-row--error`. It holds the guides for depth + 1 and the error text, and it gets no tabIndex.
- edit, input:
  - Click: a folder row calls `onToggle`; a file row calls `onOpen`.
  - Keydown on a row (call `preventDefault` for each key that it handles):
    - ArrowDown and ArrowUp focus the next or the previous `.ft-row[tabindex]` in `bodyEl`.
    - ArrowRight on a collapsed folder calls `onToggle`. ArrowLeft on an expanded folder calls `onToggle`.
    - Enter calls `onToggle` on a folder and `onOpen` on a file.
- edit, after the render: focus the row where `dataset.rel === focusedRel`. Compare the rels in a loop, because jsdom has no `CSS.escape`.
- edit, tests (`// @vitest-environment jsdom`):
  - A `null` model shows "No workspace".
  - Lazy expand:
    - `{"": [src dir, a.ts]}` with nothing expanded renders the rels `["src","a.ts"]`.
    - A click on `src` calls `onToggle("src")`. A click on `a.ts` calls `onOpen("a.ts")`.
    - With `src` expanded but not loaded, there are no child rows.
    - With `src: [main.ts]` loaded, the rels are `["src","src/main.ts","a.ts"]`, and the nested row has 1 `.ft-guide`.
  - Sort order: the DOM order is the backend order (folders first).
  - Error row: `src: {error: "Access is denied."}` renders `.ft-row--error` with that text.
  - Tooltip: the root `C:\repo` gives `C:\repo\src\main.ts`. The root `/home/u/repo` gives `/home/u/repo/src/main.ts`.
  - Keyboard: ArrowDown moves the focus. Enter on a file calls `onOpen`. ArrowRight on a collapsed folder calls `onToggle`.
  - `extLabel`: `a.PHP` gives `php`; `.gitignore` gives `""`; `Makefile` gives `""`.
- lines: about 120 code and about 110 test
- exec: judgment. New files.
- verify: `cd gui && npx vitest run tests/unit/ui/fileTree.test.ts` passes all.

**step 10**: Tree orchestration and boot.
- files: `gui/src/appFiles.ts` (new), `gui/src/main.ts`
- edit, `main.ts`:
  - (a) `import { initSourceControl } from "./appSourceControl";` → `import { initFiles } from "./appFiles";\nimport { initSourceControl } from "./appSourceControl";`
  - (b) `  await initSourceControl();` → `  await initSourceControl();\n  await initFiles();`
- edit, `appFiles.ts` header comment: `// File viewer spec §5: the file tree, the viewer and Find File for the focused workspace. UI state lives here, in memory only (D8). Must not import appMenuBar.ts: that module imports this one.`
- edit, state (review W4):
  ```ts
  interface WorkspaceFiles {
    root: string; // the cwd of this state's key
    expanded: Set<string>;
    children: Map<string, DirEntry[] | { error: string }>;
    tabs: string[];
    active: string | null;
  }
  // Review W4: one state per (workspace, cwd), so a pane switch or a cd back finds its folders and tabs again.
  const byKey = new Map<string, WorkspaceFiles>();
  let activeKey: string | null = null;
  let current: WorkspaceFiles | null = null;
  ```
- edit, helpers:
  - `baseName(path)` returns `path.split(/[/\\]/).filter(Boolean).pop() ?? path`, as at `sourceControl.ts:73`.
  - `renderTree()`
    - Sets the title `textContent` to `current ? baseName(current.root) : "FILES"`, and its `title` to `current?.root ?? ""`.
    - Then calls `renderFileTree(fileTreeBodyEl, current, { onToggle: toggleFolder, onOpen: openFileInViewer })`.
  - `async loadDir(ws, rel)`
    - Tries `ws.children.set(rel, await fsListDir(ws.root, rel))`.
    - On an error, sets `ws.children.set(rel, { error: errorMessage(err) })` (`appApi.ts:10`).
    - Then `if (ws === current) renderTree()`.
  - `toggleFolder(rel)`
    - If `expanded.delete(rel)` returns true, render.
    - Otherwise add `rel` to `expanded`, render, and call `void loadDir(current, rel)`. D7: each expand reads the folder again.
  - `refreshTree()` calls `void loadDir(ws, rel)` for each rel in `["", ...ws.expanded]`.
- edit, `onSnapshot`. It follows `appSourceControl.ts:180-194`; step 16 replaces the early-return line:
  ```ts
  function onSnapshot(snapshot: RawSnapshot): void {
    const ws = snapshot.workspaces.find((w) => w.focused);
    const cwd = ws?.new_workspace_cwd || null;
    const key = ws && cwd ? `${ws.workspace_id}\n${cwd}` : null;
    if (key === activeKey) return;
    activeKey = key;
    if (key === null || cwd === null) {
      current = null;
    } else {
      let state = byKey.get(key);
      if (!state) {
        state = { root: cwd, expanded: new Set(), children: new Map(), tabs: [], active: null };
        byKey.set(key, state);
      }
      current = state;
    }
    renderTree();
    if (appState.settings.fileTreeOpen && current && !current.children.has("")) void loadDir(current, "");
  }
  ```
- edit, exports:
  - `export function applyFileTreeVisibility()`
    - Sets `fileTreeEl.hidden = !appState.settings.fileTreeOpen`.
    - Does the same root load as the last line of `onSnapshot`.
  - `export async function initFiles()`
    - Calls `applyFileTreeVisibility()` and `renderTree()`.
    - The refresh button calls `refreshTree`.
    - The collapse button clears `current.expanded` and renders.
    - Then `await listen<RawSnapshot>("snapshot", (e) => onSnapshot(e.payload))`.
- edit, P3 placeholder: `function openFileInViewer(_rel: string): void {}` with the comment `// Step 16 replaces this.` Step 16 replaces it.
- lines: about 4 in `main.ts` and about 95 in `appFiles.ts`
- exec: judgment. Orchestration.
- verify: `cd gui && npx tsc --noEmit` exits 0.

**step 11**: View-menu toggle.
- files: `gui/src/ui/menus.ts`, `gui/src/appMenuBar.ts`, `gui/tests/unit/ui/menus.test.ts`
- edit, `menus.ts`:
  - (a) after `  onToggleSourceControl(): void;` add `\n  fileTreeOpen: boolean;\n  onToggleFileTree(): void;`
  - (b) `      onSelect: ctx.onToggleSourceControl,\n    },\n  ];` → `      onSelect: ctx.onToggleSourceControl,\n    },\n    { id: "view.fileTree", label: "File Tree", checked: ctx.fileTreeOpen, onSelect: ctx.onToggleFileTree },\n  ];`
- edit, `appMenuBar.ts`:
  - (a) after `import { applySourceControlVisibility } from "./appSourceControl";` add `\nimport { applyFileTreeVisibility } from "./appFiles";`
  - (b) after the three lines `    applySourceControlVisibility();\n    persistSettings();\n  },`, add:
    ```ts
      fileTreeOpen: appState.settings.fileTreeOpen,
      onToggleFileTree: () => {
        appState.settings.fileTreeOpen = !appState.settings.fileTreeOpen;
        menuBarContext.fileTreeOpen = appState.settings.fileTreeOpen;
        // The section lives in the sidebar: opening it while hidden would show nothing.
        if (appState.settings.fileTreeOpen && !appState.settings.sidebarVisible) {
          appState.settings.sidebarVisible = true;
          menuBarContext.sidebarVisible = true;
          applySidebarVisibility();
        }
        applyFileTreeVisibility();
        persistSettings();
      },
    ```
  - (c) after `  menuBarContext.sourceControlOpen = appState.settings.sourceControlOpen;` add `\n  menuBarContext.fileTreeOpen = appState.settings.fileTreeOpen;`
- edit, `menus.test.ts`: after `    onToggleSourceControl: noop,` add `\n    fileTreeOpen: false,\n    onToggleFileTree: noop,`
- lines: about 20 in total
- exec: judgment. The text is literal, but `appMenuBar.ts` (b) is 13 lines. The item goes after Source Control (edge case 34).
- verify: `cd gui && npx tsc --noEmit && npx vitest run tests/unit/ui/menus.test.ts` exits 0 and passes all.

**step 12**: Tree CSS, and a minimum height for the workspace list (review W5).
- files: `gui/src/style.css`
- edit, selector lists:
  - (a) `#source-control {` → `#source-control,\n#file-tree {`
  - (b) `#source-control[hidden],` → `#source-control[hidden],\n#file-tree[hidden],`
  - (c) `#source-control-body {` → `#source-control-body,\n#file-tree-body {`
- edit, (d): append a section `/* File tree (file viewer spec §6). */` at the end of the file. Because it comes after `style.css:349-353`, its `#sidebar-list` rule wins over `min-height: 0`.
  - `#sidebar-list { min-height: 88px; }`, with the comment: "Review W5: two `.ws` rows (44px, style.css:357). With Files and Source Control both open, the workspace list never collapses to 0."
  - `.ft-row`: flex, `align-items: center`, `gap: 4px`, `height: 22px`, `padding-left: 8px`, `cursor: pointer`, `white-space: nowrap`.
  - `.ft-row:hover`: `background: var(--list-hoverBackground)`.
  - `.ft-row:focus`: `outline: 1px solid var(--focusBorder)`, `outline-offset: -1px`.
  - `.ft-guide`: `width: 12px`, `align-self: stretch`, `flex-shrink: 0`, `border-left: 1px solid var(--sideBar-border)`.
  - `.ft-chevron`: `width: 16px`, `font-size: 14px`, `flex-shrink: 0`.
  - `.ft-ext`: `min-width: 16px`, `font-size: 10px`, `color: var(--descriptionForeground)`, `text-align: center`.
  - `.ft-name`: ellipsis overflow.
  - `.ft-row--error`: `cursor: default`, `font-size: var(--fs-xs)`, `color: var(--descriptionForeground)`, `white-space: normal`.
- lines: 6 and about 48
- exec: judgment. New rules.
- verify: `grep -c "#file-tree" gui/src/style.css` prints `3`, and `grep -c "min-height: 88px" gui/src/style.css` prints `1`. Then `cd gui && npx vitest run` passes all.

### P4: Viewer and file-tab routing

**step 13**: Add the viewer mount.
- files: `gui/index.html`, `gui/src/appDom.ts`
- edit:
  - `index.html`: after `          <div id="diff-view" tabindex="-1" role="region" aria-label="Diff" hidden></div>` add `\n          <div id="file-viewer" tabindex="-1" role="region" aria-label="File viewer" hidden></div>`
  - `appDom.ts`: after `export const diffViewEl = document.getElementById("diff-view") as HTMLDivElement;` add `\nexport const fileViewerEl = document.getElementById("file-viewer") as HTMLDivElement;`
- lines: 2
- exec: mechanical
- verify: `grep -c "file-viewer" gui/index.html gui/src/appDom.ts` prints `1` for each file.

**step 14**: Viewer render, the tab helpers and the state for each tab view (review W3).
- files: `gui/src/ui/fileViewer.ts` and `gui/tests/unit/ui/fileViewer.test.ts` (both new)
- edit, exports:
  - `export const MAX_VIEWER_LINES = 5000;`
  - `export type ViewerContent = {kind:"loading"} | {kind:"text"; text:string} | {kind:"binary"} | {kind:"tooLarge"; size:number} | {kind:"missing"} | {kind:"error"; message:string};`
  - `export interface TabView { scrollTop: number; currentLine: number | null }`
  - `export interface TabState { tabs: string[]; active: string | null; views: Map<string, TabView> }`
  - `export function viewOf(s, rel): TabView` gets the entry, or creates `{ scrollTop: 0, currentLine: null }`.
  - `export function openTab(s, rel)` pushes `rel` when it is absent, then sets `s.active = rel`. This is the dedupe of spec §8.1.
  - `export function closeTab(s, rel)` splices `rel` out and calls `s.views.delete(rel)`. If the tab was active, it sets `s.active = s.tabs[Math.min(index, s.tabs.length - 1)] ?? null`.
  - `export function cycleTab(s, step: 1 | -1)` wraps around. It does nothing when `active` is `null`.
  - `export interface FileViewerModel { root: string; tabs: readonly string[]; active: string | null; content: ViewerContent; view: TabView }`
    - `root` is the absolute workspace root.
    - `view` is the `TabView` of the active tab. The render's listeners change it in place.
  - `export interface FileViewerCallbacks { onActivate(rel: string): void; onClose(rel: string): void }`
  - `export function renderFileViewer(rootEl, model, fontSizePx, callbacks): void`
- edit, `renderFileViewer` first clears `rootEl`. It then derives `rootName = root.split(/[/\\]/).filter(Boolean).pop() ?? root` and builds three parts.
- edit, part 1, the tab row `div.fv-tabs`. Each tab is a `div.fv-tab`:
  - It gets `.is-active` when it is the active tab, `title = absolutePath(root, rel)` (spec §8.1, "full path"), and `dataset.rel`. `absolutePath` and `extLabel` come from `./fileTree`.
  - Children:
    1. `span.fv-tab__ext` with `extLabel`, or `i.codicon.codicon-file` when the label is empty
    2. `span.fv-tab__name`
    3. `span.fv-tab__dir` with the parent folder name, only when another tab has the same file name
    4. `span.fv-tab__close.codicon.codicon-close` with `title="Close"`. It is a span, not a button (edge case 28).
  - Events:
    - A click calls `onActivate`.
    - A click on the close span calls `stopPropagation` and `onClose`.
    - An `auxclick` with `button === 1` calls `onClose`.
    - A `mousedown` with `button === 1` calls `preventDefault`.
- edit, part 2, the body `div.fv-body`. It sets `fontFamily = FONT_STACK` (`render/renderer.ts:22`) and the font size, as in `diffView.ts:46-47`. The content kind decides what the body shows:

  | Kind | Body |
  |---|---|
  | `loading` | `div.fv-notice` with "Loading…" |
  | `binary` | `div.fv-notice` with "Binary file, not shown" |
  | `tooLarge` | `div.fv-notice` with `` `File too large to show (${(size / 1048576).toFixed(1)} MB, limit 2 MB)` `` |
  | `missing` | `div.fv-notice` with "File not found. It was moved or deleted." |
  | `error` | `div.fv-notice` with the message. This includes `not_a_file` (W6). |
  | `text` | the lines, as described below |

  For `text`:
  1. Split on `/\r\n|\n|\r/`. When there is more than one line and the last line is `""`, pop it.
  2. Make `div.fv-lines` with `style.setProperty("--fv-gutter", `${String(count).length + 1}ch`)`.
  3. Render the first 5,000 lines. Each line is a `div.fv-line` with `dataset.line = String(i)`, a `span.fv-line__no` and a `span.fv-line__text`.
     - A line gets `.is-current` when `i === view.currentLine`.
  4. Get the tokens from `tokenizeLine` with `languageFor(fileName)`, and carry the state from one line to the next.
     - A plain token becomes a text node. The other kinds become `span.tok-<kind>`.
  5. Put one delegated `click` listener on `.fv-lines`. It finds `event.target.closest(".fv-line")`, moves `.is-current` to that line, and sets `view.currentLine = Number(line.dataset.line)`.
  6. Put a `scroll` listener on the body that sets `view.scrollTop = body.scrollTop`. Only `text` content gets this listener.
  7. When the file has more than 5,000 lines, add a `div.fv-notice` with `` `Showing the first 5,000 of ${n.toLocaleString("en-US")} lines` ``.
- edit, part 3, the breadcrumb `div.fv-breadcrumb`:
  - `rootName` and each rel segment as spans, separated by `span.fv-breadcrumb__sep` with " › ".
  - Then `span.fv-readonly` with "Read-only".
- edit, the last statement of the render: `if (content.kind === "text") body.scrollTop = view.scrollTop;`. It comes after the breadcrumb is attached (edge case 31).
- edit, tests (`// @vitest-environment jsdom`). jsdom stores `scrollTop` and does not clamp it, so the tests can assert the value.
  - Open: opening a, then b, gives the tabs `[a,b]` with b active. Dedupe: opening a again keeps the tabs and makes a active.
  - Close: closing the active b in `[a,b,c]` makes c active. Closing the last tab gives `null`. W3: `closeTab` deletes the view of the closed tab only.
  - Cycle wraps in both directions.
  - Same name: the tabs `["a/index.ts","b/index.ts","c.ts"]` give the `.fv-tab__dir` texts `["a","b"]`. The `title` of each tab is `absolutePath(root, rel)`.
  - Notices: each kind renders its `.fv-notice` text and no `.fv-line`.
  - 5,001 lines give 5,000 `.fv-line` rows and the notice.
  - W3, restore: render with `view = {scrollTop: 120, currentLine: 3}`. `.fv-body.scrollTop` is 120, and only the fourth `.fv-line` has `.is-current`.
  - W3, save: set `body.scrollTop = 300` and dispatch `scroll`, and `view.scrollTop` becomes 300. Click a line, and `view.currentLine` becomes that index.
  - W3, re-render: rendering again with the same `view` (which is what a background-tab close does) restores `scrollTop` and the current line.
  - Clicking a line leaves exactly one `.is-current`.
  - A tab click calls `onActivate`. The close span and a middle-button `auxclick` call `onClose`.
  - The breadcrumb ends with "Read-only".
- lines: about 165 code and about 150 test
- exec: judgment. New files.
- verify: `cd gui && npx vitest run tests/unit/ui/fileViewer.test.ts` passes all.

**step 15**: Make the diff and the viewer exclude each other.
- files: `gui/src/appSourceControl.ts`
- edit:
  - (a) `  diffViewEl,\n  keyboardCapture,` → `  diffViewEl,\n  fileViewerEl,\n  keyboardCapture,`
  - (b) `function closeDiff(refocus = true): void {` → `export function closeDiff(refocus = true): void {`
  - (c) `  diffViewEl.hidden = false;` → `  fileViewerEl.hidden = true; // file viewer spec §5: the diff and the viewer share #terminal-wrap\n  diffViewEl.hidden = false;`
- lines: 4
- exec: mechanical. Each edit is a literal of 2 lines or fewer. This file does not import `appFiles`, so there is no cycle. The diff's capture-focus rule at `:214` stays unchanged.
- verify: `grep -c "export function closeDiff\|fileViewerEl" gui/src/appSourceControl.ts` prints `3`.

**step 16**: Viewer orchestration: W1 hide and bounce, W3 views, W4 tab tracking.
- files: `gui/src/appFiles.ts`
- edit, imports, state and placeholder. This step replaces the P3 placeholder.
  - Imports:
    - `closeDiff` from `./appSourceControl`
    - `fileViewerEl`, `keyboardCapture`, `sidebarEl` and `tabListEl` from `./appDom` (`appDom.ts:9,21`)
    - `fsReadText` from `./files/filesApi`
    - `focusKeyboardCapture` from `./keyboard/focusCapture`
    - `renderFileViewer`, `openTab`, `closeTab`, `cycleTab`, `viewOf`, `TabView` and `ViewerContent` from `./ui/fileViewer`
  - Add `views: Map<string, TabView>` to `WorkspaceFiles`, and `views: new Map()` to the initializer in `onSnapshot`.
  - State:
    ```ts
    let activeTabId: string | null = null;
    let content: ViewerContent = { kind: "loading" };
    let readSeq = 0; // drops stale reads (spec §5)
    ```
- edit, `onSnapshot`. Replace `  if (key === activeKey) return;\n  activeKey = key;` with:
  ```ts
    const tabId = snapshot.focused_tab_id;
    if (key === activeKey && tabId === activeTabId) return;
    // Spec §5 plus review W1: a workspace, cwd or terminal-tab switch hides the viewer. Every
    // tab switch in this GUI is a user move: Alt+1..9, Ctrl+Tab outside the viewer, New Tab,
    // All Tabs, an agent-popover row (edge case 20).
    activeTabId = tabId;
    hideFileViewer();
    if (key === activeKey) return;
    activeKey = key;
  ```
- edit, `renderViewer()`
  - Returns when there is no `current` or when `current.active === null`.
  - Otherwise calls `renderFileViewer(fileViewerEl, { root: current.root, tabs: current.tabs, active: current.active, content, view: viewOf(current, current.active) }, appState.renderer?.getFontSizePx() ?? appState.settings.fontSize, { onActivate: activateTab, onClose: closeFileTab })`.
- edit, `async readActive()`. It runs on each activation (D7).
  1. `ws = current`. Return when `ws` is null or `ws.active === null`.
  2. `seq = ++readSeq`, `content = loading`, then render.
  3. Try `fsReadText(ws.root, ws.active)` and map the result:
     - `text` gives `{text: content ?? ""}`.
     - `binary` gives binary.
     - `tooLarge` gives `{tooLarge, size}`.
  4. On an error, `(err as {code?: string})?.code === "not_found"` gives `missing`. Any other error, including `not_a_file`, gives `error` with `errorMessage(err)` (as at `appSourceControl.ts:170`).
  5. Before each assignment, return if `seq !== readSeq`. Then render.
- edit, the other functions:
  - `openFileInViewer(rel)`: `openTab(current, rel); closeDiff(false); fileViewerEl.hidden = false; fileViewerEl.focus(); void readActive();`
  - `activateTab(rel)`: `if (!current || current.active === rel) return; current.active = rel; void readActive();`
    - W3: a click on the active tab does not read or render again.
  - `closeFileTab(rel)`: keep `before`, then call `closeTab`.
    - If `active === null`, call `hideFileViewer()`.
    - If `active !== before`, call `readActive()`.
    - Otherwise call `renderViewer()`. The view of the active tab restores its scroll position and current line.
  - `hideFileViewer()`, with no parameter:
    ```ts
    function hideFileViewer(): void {
      if (fileViewerEl.hidden) return;
      const hadFocus = fileViewerEl.contains(document.activeElement); // read first: hiding blurs to body
      ++readSeq;
      fileViewerEl.hidden = true;
      fileViewerEl.textContent = "";
      // Only when the viewer held focus: a hide that a snapshot causes must not take focus from the finder or the commit box.
      if (hadFocus) focusKeyboardCapture();
    }
    ```
    - The tabs and the views stay (spec §5).
    - `hidden` is set before `focusKeyboardCapture()`, so the bounce below does not fire.
  - `export function fileTabAction(id: string)`
    - Returns when there is no `current`, `fileViewerEl.hidden` is true, or `active === null`.
    - For `"tab.close"`, calls `closeFileTab(active)`.
    - Otherwise runs `cycleTab(current, id === "tab.next" ? 1 : -1); void readActive();`.
- edit, `initFiles` adds these listeners:
  ```ts
    fileViewerEl.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      hideFileViewer(); // spec §5: keeps the tabs
    });
    // Review W1: popovers, menus and modals give the terminal focus when they close
    // (statusbar.ts:185,680, modal.ts:65). Keys must not reach a terminal under the viewer.
    keyboardCapture.addEventListener("focus", () => {
      if (!fileViewerEl.hidden) fileViewerEl.focus();
    });
    // Review W1: a left press on a terminal tab or a workspace row is a move to the terminal.
    for (const el of [tabListEl, sidebarEl]) {
      el.addEventListener("pointerdown", (event) => {
        if (event.button === 0) hideFileViewer();
      }, true);
    }
  ```
  The Escape handler follows `appSourceControl.ts:207-211`.
- lines: about 95
- exec: judgment. Orchestration.
- verify: `cd gui && npx tsc --noEmit` exits 0.

**step 17**: Send the tab keys to the file tabs when focus is inside the viewer.
- files: `gui/src/keyboard/routing.ts`, `gui/src/main.ts`, `gui/tests/unit/keyboard/routing.test.ts`
- edit, `routing.ts`:
  - (a) after `import { closeActiveOverlay, isActiveOverlayEscapableFromOutside, isOverlayOpen } from "../ui/overlay";` add `\n\n/** File viewer spec §8.1: inside the viewer, these tab actions act on the file tabs. */\nconst FILE_TAB_IDS = new Set(["tab.close", "tab.next", "tab.previous"]);`
  - (b) `  onTerminalTextCommit(text: string): void;\n}` → `  onTerminalTextCommit(text: string): void;\n  /** File viewer spec §8.1: a tab action while focus is inside \`#file-viewer\`. */\n  onFileTabAction(id: string): void;\n}`
  - (c) `    event.preventDefault();\n    handlers.onShortcut(shortcut);\n    return;` → `    event.preventDefault();\n    // \`closest?.\`: the unit tests pass plain objects, not DOM elements.\n    if (FILE_TAB_IDS.has(shortcut.id) && activeElement?.closest?.("#file-viewer")) handlers.onFileTabAction(shortcut.id);\n    else handlers.onShortcut(shortcut);\n    return;`
- edit, `main.ts`:
  - (a) `import { initFiles } from "./appFiles";` → `import { fileTabAction, initFiles } from "./appFiles";`
  - (b) `  installKeyboardRouting(keyboardCapture, { onShortcut, onTerminalKey, onPasteOverride, onTerminalTextCommit });` → `  installKeyboardRouting(keyboardCapture, {\n    onShortcut,\n    onTerminalKey,\n    onPasteOverride,\n    onTerminalTextCommit,\n    onFileTabAction: fileTabAction,\n  });`
- edit, `routing.test.ts` (a), in `fakeHandlers`:
  - `  textCommits: string[];\n} {` → `  textCommits: string[];\n  fileTabActions: string[];\n} {`
  - after `  const textCommits: string[] = [];` add `\n  const fileTabActions: string[] = [];`
  - after `    onTerminalTextCommit: (text) => textCommits.push(text),` add `\n    onFileTabAction: (id) => fileTabActions.push(id),`
  - `    textCommits,\n    get pastes() {` → `    textCommits,\n    fileTabActions,\n    get pastes() {`
- edit, `routing.test.ts` (b): before `  // Finding #4: an overlay (menu/popover/modal/confirm) that opened without`, insert:
  ```ts
    // File viewer spec §8.1: while focus is inside #file-viewer, the tab keys act on the file tabs.
    it("tab.close, tab.next and tab.previous go to the file tabs while focus is inside #file-viewer", () => {
      const capture = fakeElement();
      const viewer = document.createElement("div");
      viewer.id = "file-viewer";
      const inner = document.createElement("div");
      viewer.appendChild(inner);
      const handlers = fakeHandlers();
      routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyW" }), capture, inner, handlers);
      routeKeydown(fakeEvent({ ctrlKey: true, key: "Tab", code: "Tab" }), capture, viewer, handlers);
      routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, key: "Tab", code: "Tab" }), capture, viewer, handlers);
      expect(handlers.fileTabActions).toEqual(["tab.close", "tab.next", "tab.previous"]);
      expect(handlers.shortcuts).toEqual([]);
      routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyW" }), capture, capture, handlers);
      expect(handlers.shortcuts).toEqual(["tab.close"]);
    });

    it("other shortcuts inside #file-viewer still reach onShortcut", () => {
      const viewer = document.createElement("div");
      viewer.id = "file-viewer";
      const handlers = fakeHandlers();
      routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyN" }), fakeElement(), viewer, handlers);
      expect(handlers.shortcuts).toEqual(["workspace.new"]);
      expect(handlers.fileTabActions).toEqual([]);
    });

  ```
- lines: about 47
- exec: judgment. All text is given, but several edits are longer than 2 lines.
- verify: `cd gui && npx tsc --noEmit && npx vitest run tests/unit/keyboard/routing.test.ts` exits 0 and passes all.

**step 18**: Viewer and syntax CSS.
- files: `gui/src/style.css`
- edit, selector lists:
  - (a) `#diff-view {` → `#diff-view,\n#file-viewer {`
  - (b) `#diff-view[hidden] {` → `#diff-view[hidden],\n#file-viewer[hidden] {`
  - (c) `#diff-view:focus {` → `#diff-view:focus,\n#file-viewer:focus {`
- edit, (d): append a section `/* File viewer (file viewer spec §8). */`:
  - Syntax colors:
    - `:root { --syntax-keyword: #cc7832; --syntax-string: #6a8759; --syntax-number: #6897bb; --syntax-comment: #808080; }`, with the comment: "JetBrains Darcula, spec §8.4. The one exception to the rule in this file's header, as the spec requires."
    - `.tok-keyword`, `.tok-string` and `.tok-number` use these colors. `.tok-comment` also gets `font-style: italic`.
  - Tab row:
    - `.fv-tabs`: flex, `height: 30px`, `overflow-x: auto`, `flex-shrink: 0`, `border-bottom: 1px solid var(--tab-border)`, `font-size: var(--fs-xs)`.
    - `.fv-tab`: flex, `gap: 4px`, `padding: 0 6px 0 10px`, `white-space: nowrap`, `cursor: pointer`, `color: var(--descriptionForeground)`, `border-right: 1px solid var(--tab-border)`.
    - `.fv-tab.is-active`: `color: var(--foreground)`, `box-shadow: inset 0 -2px var(--focusBorder)`.
    - `.fv-tab__ext` and `.fv-tab__dir`: `color: var(--descriptionForeground)`.
    - `.fv-tab__close`: `visibility: hidden`, `font-size: 14px`. It is visible on `.fv-tab:hover` and on `.is-active`.
  - Body and lines:
    - `.fv-body`: `flex: 1`, `min-height: 0`, `overflow: auto`.
    - `.fv-lines`: `width: max-content`, `min-width: 100%`, `padding: 4px 0`.
    - `.fv-line`: flex, `white-space: pre`.
    - `.fv-line.is-current`: `background: var(--list-hoverBackground)`.
    - `.fv-line__no`: `position: sticky`, `left: 0`, `width: var(--fv-gutter)`, `flex-shrink: 0`, `padding-right: 1ch`, `margin-right: 1ch`, `text-align: right`, `color: var(--descriptionForeground)`, `background: var(--terminal-background)`, `border-right: 1px solid var(--tab-border)`, `user-select: none`.
    - `.fv-line.is-current .fv-line__no`: `color: var(--foreground)`, `background: var(--list-hoverBackground)`.
    - `.fv-notice`: `padding: 8px 12px`, `color: var(--descriptionForeground)`.
  - Breadcrumb:
    - `.fv-breadcrumb`: flex, `gap: 4px`, `height: 22px`, `padding: 0 12px`, `flex-shrink: 0`, `border-top: 1px solid var(--tab-border)`, `font-size: var(--fs-xs)`, `color: var(--descriptionForeground)`, `white-space: nowrap`, `overflow: hidden`.
    - `.fv-readonly`: `margin-left: auto`.
- lines: 6 and about 75
- exec: judgment. New rules.
- verify: `grep -c "#file-viewer" gui/src/style.css` prints `3`. Then `cd gui && npx vitest run` passes all.

### P5: Finder, double-Shift, shortcuts modal

**step 19**: Finder dialog.
- files: `gui/src/ui/quickOpen.ts` (new), `gui/src/style.css`
- edit, setup:
  - Export `interface QuickOpenOptions { root: string; openTabs: readonly string[]; onOpen(rel: string): void }` and `openQuickOpen(options): () => void`.
  - Call `openModal("Find File", build, { className: "quick-open", onClose: () => { closed = true; } })`.
  - Pass no `returnFocusTo`. The modal sends focus to the terminal on close (`modal.ts:65`), and the W1 bounce returns it to the viewer when the viewer is visible.
- edit, body contents:
  - an `input` with `className = "shortcuts-modal-search"` (the existing style at `style.css:1792`), `placeholder="Type a file name"`, `aria-label="Find file"` and `spellcheck=false`
  - `div.qo-status`
  - `div.qo-list` with `role="listbox"`
  - `div.qo-footer` with "Showing first 50,000 files". It is hidden unless the index is truncated.
- edit, state: `files: string[] | null = null`, `selected = 0`, `error: string | null`.
- edit, `render()`:
  - Rows:
    - An empty query lists `openTabs`, without highlights.
    - A non-empty query shows no rows while `files === null`; after that, it shows `rankPaths(query, files)`.
  - The status text is the first that applies:
    1. `error`
    2. "Indexing…" while `files === null`
    3. "No matching files" when a non-empty query gives no rows
    4. empty
  - Each row is a `div.qo-row`, with `.is-selected` on the selected row and `title = rel`.
    - `span.qo-name` holds the name. Each run of matched positions is a `span.qo-hit`.
    - `span.qo-dir` holds the folder part, split as in `sourceControl.ts:111-114`.
  - A `mousedown` on a row calls `preventDefault`, so the input keeps focus. A click on a row calls `choose(rel)`.
- edit, input events:
  - `input`: sets `selected = 0`, then renders.
  - keydown:
    - ArrowDown and ArrowUp clamp `selected`, render, and call `scrollIntoView?.({ block: "nearest" })` on the selected row. Both call `preventDefault`.
    - Enter calls `choose(rows[selected])` when that row exists.
    - Esc: `openModal` handles it (`modal.ts:42-47`).
- edit, actions:
  - `choose(rel)`: `dispose(); options.onOpen(rel);`. This order is necessary (edge case 18).
  - `fsListFiles(root).then(...)`: if `closed`, return. Otherwise set `files` and the footer, and render.
  - `.catch(...)`: if `closed`, return. Otherwise set `files = []` and `error = errorMessage(err)`, and render. Do not cache the list (spec §7.2).
  - `window.setTimeout(() => input.focus(), 0)`, as at `shortcutsModal.ts:62-65`.
- edit, CSS:
  - `.modal.quick-open { width: 600px; }`
  - `.qo-list`: `margin-top: 8px`, `max-height: 50vh`, `overflow-y: auto`.
  - `.qo-row`: flex, `gap: 8px`, `padding: 3px 6px`, `border-radius: 3px`, `cursor: pointer`, `white-space: nowrap`.
  - `.qo-row.is-selected`: `background: var(--list-activeSelectionBackground)`, `color: var(--list-activeSelectionForeground)`.
  - `.qo-hit`: `color: var(--focusBorder)`, `font-weight: 600`.
  - `.qo-dir`: `color: var(--descriptionForeground)`, ellipsis overflow.
  - `.qo-status` and `.qo-footer`: `padding: 4px 6px`, `font-size: var(--fs-xs)`, `color: var(--descriptionForeground)`.
- lines: about 105 in `quickOpen.ts` and about 30 of CSS
- exec: judgment. A new file.
- verify: `cd gui && npx tsc --noEmit` exits 0.

**step 20**: Find File entry point.
- files: `gui/src/appFiles.ts`
- edit: import `openQuickOpen` from `./ui/quickOpen`, then add:
  ```ts
  export function openFindFile(): void {
    const ws = current;
    if (!ws) return;
    openQuickOpen({
      root: ws.root,
      openTabs: [...ws.tabs],
      // The workspace can change while the finder is open.
      onOpen: (rel) => {
        if (ws === current) openFileInViewer(rel);
      },
    });
  }
  ```
  `openFileInViewer` calls `openTab`. That is how Enter activates a tab that is already open (spec §7.2).
- lines: about 13
- exec: judgment. Small, but it is orchestration.
- verify: `cd gui && npx tsc --noEmit` exits 0.

**step 21**: Wire double-Shift into the router (deviation 1; review W7).
- files: `gui/src/keyboard/routing.ts`, `gui/src/main.ts`, `gui/tests/unit/keyboard/routing.test.ts`
- edit, `routing.ts`:
  - (a) after `import { findShortcut, IS_MAC, type ShortcutAction } from "../shortcuts";` add `\nimport { createDoubleShiftTracker } from "./doubleShift";`
  - (b) after `const FILE_TAB_IDS = new Set(["tab.close", "tab.next", "tab.previous"]);` add `\n/** File viewer spec §7.1: one tracker for the document; every keydown, keyup, pointerdown and wheel feeds it. */\nconst doubleShift = createDoubleShiftTracker();`
  - (c) `  onFileTabAction(id: string): void;\n}` → `  onFileTabAction(id: string): void;\n  /** File viewer spec §7.1: a double tap on Shift opens Find File. */\n  onDoubleShift(): void;\n}`
  - (d) after `  if (event.isComposing || event.keyCode === 229) return;\n`, insert:
    ```ts

      // File viewer spec §7.1: first, so that any other key cancels a pending tap. A pinned
      // agent popover holds the overlay slot but is not escapable from outside; it must not
      // block the finder (the finder supersedes it, and it reopens afterwards).
      if (doubleShift.keydown(event, event.timeStamp) && !(isOverlayOpen() && isActiveOverlayEscapableFromOutside())) {
        handlers.onDoubleShift();
        return;
      }
    ```
  - (e) replace `/** Installs the single capture-phase \`document\` \`keydown\` listener and\n * returns a disposer. */` with:
    ```ts
    /** Feeds a keyup to the double-Shift tracker. Exported for the unit tests. */
    export function routeKeyup(event: KeyboardEvent): void {
      doubleShift.keyup(event, event.timeStamp);
    }

    /** Installs the single capture-phase `document` `keydown` listener, plus the
     * `keyup`, `pointerdown` and `wheel` listeners the double-Shift tracker needs,
     * and returns a disposer. */
    ```
  - (f) replace `  document.addEventListener("keydown", listener, true);\n  return () => document.removeEventListener("keydown", listener, true);` with:
    ```ts
      // pointerdown, not mousedown: a pointerdown preventDefault suppresses mousedown.
      const cancelDoubleShift = (): void => doubleShift.cancel();
      document.addEventListener("keydown", listener, true);
      document.addEventListener("keyup", routeKeyup, true);
      document.addEventListener("pointerdown", cancelDoubleShift, true);
      document.addEventListener("wheel", cancelDoubleShift, { capture: true, passive: true });
      return () => {
        document.removeEventListener("keydown", listener, true);
        document.removeEventListener("keyup", routeKeyup, true);
        document.removeEventListener("pointerdown", cancelDoubleShift, true);
        document.removeEventListener("wheel", cancelDoubleShift, true);
      };
    ```
- edit, `main.ts`:
  - (a) `import { fileTabAction, initFiles } from "./appFiles";` → `import { fileTabAction, initFiles, openFindFile } from "./appFiles";`
  - (b) `    onFileTabAction: fileTabAction,\n  });` → `    onFileTabAction: fileTabAction,\n    onDoubleShift: openFindFile,\n  });`
- edit, `routing.test.ts`:
  - (a) `import { hasTabUiFocus, routeKeydown, type KeyboardRoutingHandlers } from "../../../src/keyboard/routing";` → `import { hasTabUiFocus, installKeyboardRouting, routeKeydown, routeKeyup, type KeyboardRoutingHandlers } from "../../../src/keyboard/routing";`
  - (b) `  fileTabActions: string[];\n} {` → `  fileTabActions: string[];\n  doubleShifts: number;\n} {`
  - (c) `  let pastes = 0;\n  return {` → `  let pastes = 0;\n  let doubleShifts = 0;\n  return {`
  - (d) after `    onFileTabAction: (id) => fileTabActions.push(id),` add `\n    onDoubleShift: () => {\n      doubleShifts++;\n    },`
  - (e) after `    get pastes() {\n      return pastes;\n    },` add `\n    get doubleShifts() {\n      return doubleShifts;\n    },`
  - (f) add at the end of the file:
    ```ts

    // File viewer spec §7.1: double-Shift opens Find File from any focus target.
    describe("double-Shift", () => {
      afterEach(() => {
        closeActiveOverlay();
      });

      const shift = (timeStamp: number) => fakeEvent({ key: "Shift", code: "ShiftLeft", shiftKey: true, timeStamp });
      const keyH = (timeStamp: number) => fakeEvent({ key: "H", code: "KeyH", shiftKey: true, timeStamp });

      function doubleTap(capture: Element, handlers: ReturnType<typeof fakeHandlers>, t0: number): void {
        routeKeydown(shift(t0), capture, capture, handlers);
        routeKeyup(shift(t0 + 60));
        routeKeydown(shift(t0 + 200), capture, capture, handlers);
      }

      it("opens Find File from the terminal capture and sends nothing to the terminal", () => {
        const capture = fakeElement();
        const handlers = fakeHandlers();
        doubleTap(capture, handlers, 1_000);
        expect(handlers.doubleShifts).toBe(1);
        expect(handlers.terminalKeys).toEqual([]);
      });

      it("does not fire while an overlay is open", () => {
        const capture = fakeElement();
        const handlers = fakeHandlers();
        openOverlay(vi.fn());
        doubleTap(capture, handlers, 10_000);
        expect(handlers.doubleShifts).toBe(0);
      });

      it("still fires over a pinned agent popover (escapableFromOutside: false)", () => {
        const capture = fakeElement();
        const handlers = fakeHandlers();
        openOverlay(vi.fn(), { escapableFromOutside: false });
        doubleTap(capture, handlers, 20_000);
        expect(handlers.doubleShifts).toBe(1);
      });

      // Review W7: without the H cancel, each of these two sequences would fire.
      it("Shift↓ H↓ Shift↑ then Shift↓ (typing a capital) does not fire", () => {
        const capture = fakeElement();
        const handlers = fakeHandlers();
        routeKeydown(shift(30_000), capture, capture, handlers);
        routeKeydown(keyH(30_020), capture, capture, handlers);
        routeKeyup(shift(30_050));
        routeKeydown(shift(30_300), capture, capture, handlers);
        expect(handlers.doubleShifts).toBe(0);
      });

      it("Shift↓ Shift↑ H↓ Shift↓ does not fire", () => {
        const capture = fakeElement();
        const handlers = fakeHandlers();
        routeKeydown(shift(40_000), capture, capture, handlers);
        routeKeyup(shift(40_030));
        routeKeydown(keyH(40_060), capture, capture, handlers);
        routeKeydown(shift(40_100), capture, capture, handlers);
        expect(handlers.doubleShifts).toBe(0);
      });

      it("installKeyboardRouting: a wheel turn or a pointer press between the taps cancels them", () => {
        const handlers = fakeHandlers();
        const dispose = installKeyboardRouting(document.createElement("textarea"), handlers);
        const key = (type: string) =>
          document.dispatchEvent(new KeyboardEvent(type, { key: "Shift", code: "ShiftLeft", shiftKey: type === "keydown" }));
        try {
          for (const between of ["wheel", "pointerdown"]) {
            key("keydown");
            key("keyup");
            document.dispatchEvent(new Event(between));
            key("keydown"); // tap 1 again, no fire
            document.dispatchEvent(new Event(between)); // clear before the next round
          }
          expect(handlers.doubleShifts).toBe(0);
          key("keydown");
          key("keyup");
          key("keydown");
          expect(handlers.doubleShifts).toBe(1);
        } finally {
          dispose();
        }
      });
    });
    ```
- lines: about 120
- exec: judgment. All text is given, but several edits are longer than 2 lines.
- verify: `cd gui && npx tsc --noEmit && npx vitest run tests/unit/keyboard/routing.test.ts tests/unit/keyboard/doubleShift.test.ts` exits 0 and passes all.

**step 22**: Add the static line to the shortcuts modal.
- files: `gui/src/ui/shortcutsModal.ts`, `gui/src/style.css`, `gui/tests/unit/ui/shortcutsModal.test.ts`
- edit, `shortcutsModal.ts`: after `    body.appendChild(list);\n`, insert:
  ```ts

      // File viewer spec §7.1: a modifier-only gesture, so the shortcut table cannot hold it.
      const findFile = document.createElement("div");
      findFile.className = "shortcuts-modal-static";
      findFile.append("Find File");
      const findFileKey = document.createElement("span");
      findFileKey.className = "key";
      findFileKey.textContent = "Shift Shift";
      findFile.appendChild(findFileKey);
      body.appendChild(findFile);
  ```
- edit, `style.css`:
  - (a) `.modal-shortcut-row {` → `.modal-shortcut-row,\n.shortcuts-modal-static {`
  - (b) `.modal-shortcut-row .key {` → `.modal-shortcut-row .key,\n.shortcuts-modal-static .key {`
- edit, `shortcutsModal.test.ts`: `    expect(document.activeElement).toBe(captureEl);\n  });\n});` → `    expect(document.activeElement).toBe(captureEl);\n  });\n\n  it("lists Shift Shift Find File as one static line outside the filtered list", () => {\n    openKeyboardShortcutsModal();\n    const search = document.querySelector<HTMLInputElement>(".shortcuts-modal-search")!;\n    search.value = "xyzzy no such shortcut";\n    search.dispatchEvent(new Event("input", { bubbles: true }));\n    const line = document.querySelector(".shortcuts-modal-static");\n    expect(line?.textContent).toBe("Find FileShift Shift");\n    expect(line?.querySelector(".key")?.textContent).toBe("Shift Shift");\n  });\n});`
- lines: 10 in `shortcutsModal.ts`, 4 in `style.css`, 10 in the test
- exec: judgment. All text is given, but the inserts are longer than 2 lines.
- verify: `cd gui && npx vitest run tests/unit/ui/shortcutsModal.test.ts tests/unit/shortcuts.test.ts` passes all.

## Overall verify

```
cd /c/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test && rustfmt --edition 2021 --check src/files.rs && test "$(cargo clippy --lib --tests 2>&1 | grep -c 'files.rs')" = 0 && cd .. && npx tsc --noEmit && npx vitest run
```

Expected:
- Every cargo `test result` is `ok`, with 0 failed.
- rustfmt prints nothing.
- clippy prints no line that mentions `files.rs`.
- tsc exits 0.
- Vitest passes 73 files with 0 failed.

The user then runs live checks 1–7 under **acceptance**.

Files relevant to this plan:
- `C:\Users\Reinaldo\Backend\herdr\gui\docs\file-viewer-spec.md`
- `C:\Users\Reinaldo\Backend\herdr\gui\docs\file-viewer-impl.md` (the previous version of this spec)
- `C:\Users\Reinaldo\Backend\herdr\gui\src\appSourceControl.ts`
- `C:\Users\Reinaldo\Backend\herdr\gui\src\appDoneNotifications.ts`
- `C:\Users\Reinaldo\Backend\herdr\gui\src\appMenuBar.ts`
- `C:\Users\Reinaldo\Backend\herdr\gui\src\keyboard\routing.ts`
- `C:\Users\Reinaldo\Backend\herdr\gui\src\ui\modal.ts`
- `C:\Users\Reinaldo\Backend\herdr\gui\src\ui\statusbar.ts`
- `C:\Users\Reinaldo\Backend\herdr\gui\src\ui\tabs.ts`
- `C:\Users\Reinaldo\Backend\herdr\gui\src\ui\sidebar.ts`
- `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\git.rs`
- `C:\Users\Reinaldo\Backend\herdr\gui\src-tauri\src\lib.rs`

---

**Skipped, by choice:**
- No unit test for `appFiles`. The W1 hide and bounce, the W3 restore wiring and the W4 key are covered only by live checks 5–7. The pure parts are unit-tested: the views in `fileViewer.test.ts` and the tracker in `doubleShift.test.ts`.
- No unit test for `quickOpen`.
- No arrow-key scrolling inside the viewer.
- No pruning of `byKey` for workspaces that close: a small leak of memory.
- No shortcut for the tree toggle.

**Risks:**
- **Finder speed.** At 50,000 files, ranking may take about 90 ms per keystroke. This number is extrapolated from 3,133 files, not measured.
- **W1 limits (edge case 22).** Tab changes that the user did not make also hide the viewer. A user move to the same tab does not hide it; Esc covers that case.