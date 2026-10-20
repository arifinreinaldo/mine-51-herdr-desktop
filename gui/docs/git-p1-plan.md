# Git P1 plan: history and the Sublime Merge details pane (executable steps)

Status: plan, amended 2026-10-11 to match Sublime Merge's flow. Sources: `gui/docs/git-mvp-plan.md` ("Follow-on phases P1–P6"), `gui/docs/git-mvp-spec.md`, the UX handoff `C:\Users\Reinaldo\AppData\Local\Temp\claude\C--Users-Reinaldo\1c5cdee4-3c84-48b9-ad02-d6d641fca07a\scratchpad\herdr-git-ux-handoff.md`, and the Sublime Merge inventory `C:\Users\Reinaldo\AppData\Local\Temp\claude\C--Users-Reinaldo-Backend-herdr\100e1248-500a-448c-a2c9-48735fc26bca\scratchpad\sublime-merge-inventory.md` (authoritative for UX; "inventory §X" below). Branch: `feat/git-source-control`.
Executor: sonnet-pipeline. The main session commits only when the user asks.

## Decisions to confirm (visible UX choices)

The user did not answer these. Each line gives the default this plan builds, then the alternative. "F" marks an item that inventory §F lists as unconfirmed in Sublime Merge, so it is a decision, not a fact.

1. **D1 Pane trigger (the caller's default).** `#diff-view` becomes the details pane. It shows over the terminal area while Source Control is active (`isActive()`: section open and sidebar visible), and hides when the section closes. Focus moving outside the panel, the pane and the menus (the terminal, the find bar, a tab) also hides it (the P0 rule, no typing behind the pane, widened from the terminal capture to all chrome), and so does a hidden sidebar; the next click in the panel, or Ctrl+4, shows it again. At startup with the section open, the pane shows and takes focus. Alternative: open the pane only on a click in the panel.
2. **D2 Esc on the Summary** hides the pane and gives the terminal focus; the sidebar section stays open. Alternative: Esc closes the whole section (needs `menuBarContext` sync, which lives in `appMenuBar.ts`).
3. **D3 Esc on a file tab** returns to the Summary and keeps the tab (inventory §B "exit file view"). The tab's × or a middle click closes it (F: tab close by key or middle click). Alternative: Esc closes the tab.
4. **D4 File tabs belong to the selection.** A new selection (commit or working directory) resets the tabs to the Summary. Alternative: keep tabs across selections.
5. **D5 The Files tab follows the selection** (inventory §A): the working directory shows STAGED CHANGES / CHANGES with stage buttons; a selected commit shows one read-only CHANGES (N) list.
6. **D6 The commit box moves** from the sidebar into the working-directory Summary. It is the same element, so its text, Ctrl+Enter and the P0 rules stay. Alternative: keep a second box in the Files tab.
7. **D7 Working-directory section order:** Staged, Unstaged, Untracked (the user's order). Inventory §A reads working / staged / untracked. Conflicted files stay in Unstaged with no stage button (P0 rule); there is no Unmerged section.
8. **D8 Captions (F):** "No changes" / "N changes" and the italic "Commit Changes" on the pinned row; "Summary"; "Collapse all" / "Expand all"; "Nothing to commit" on the disabled commit button; "CHANGES (N)" is CSS uppercase of `Changes (N)`; "Changes" | "Tree"; "Stage All" / "Unstage All".
9. **D9 Bold rows (F, inventory §B "likely current branch"):** HEAD's first-parent chain. History follows HEAD only, so every row is on the current branch; the chain is what separates merged side commits.
10. **D10 File-count badge (F):** shown before the date. It comes from `git log --name-only` (+30 % log time, probe below). A page whose file lists pass 2 MiB shows no badges.
11. **D11 Stats (F):** the meta block's last row, `-N +M` badges and "K files", from `--numstat`.
12. **D12 Discard and revert stay hidden until P2:** no trash icon in the file tab header, no Discard All button, no hover × on rows (F), no Discard / Delete / Revert File menu items. P2's backup and confirm rules apply first. Alternative: show them disabled with a note.
13. **D13 Theme values:** new `--sc-*` variables take inventory §D's light values under `:root[data-theme-kind="light"]`, set from `ThemeDefinition.kind` in `applyCurrentTheme`. Where §D gives no dark value, the dark value is derived (marked "derived" in the CSS). `hc` themes, including imported hc-light ones, take the dark values. The diff line tints keep their P0 mapping to the theme's ANSI colours. Alternative: derive every value with `color-mix` from theme variables (no literals, no kind hook).
14. **D14 Summary sections:** more than 25 files start collapsed; a section renders at most 500 diff rows (the file tab renders all); 4 diff reads at once.
15. **D15 Panel keys:** Ctrl+1 Files, Ctrl+2 Commits, Ctrl+4 details pane, Alt+Left/Right back/forward, Alt+Down/Up parent/child, Ctrl+PgUp/PgDn previous/next tab, Esc as D2/D3. Ctrl+0 (go to HEAD) and Ctrl+3 are not mapped: Ctrl+0 is `view.zoomReset`. Space is the focused control's own key: it opens a row and toggles a header.
16. **D16 File menu:** Copy File Path copies the absolute path, with backslashes on Windows. Open Containing Folder opens the folder through the existing `open_folder` command; it does not select the file.
17. **D17 The Changes | Tree choice** resets on restart (`shortcut:` comment). The tab choice persists (`sourceControlTab`).

## How to read this plan

- Paths are relative to `C:\Users\Reinaldo\Backend\herdr`. The shell is Git Bash, so commands use `/c/Users/Reinaldo/Backend/herdr/...`.
- Each edit gives the exact old text, then the exact new text. The fences start at column 0, so the text inside a fence is the literal file text. Each old text occurs exactly once in its file at the moment its edit runs (script check, see the pre-check below). Most new texts start or end with their old text, so the anchor stays.
- A new file gives its full content. A "replace file" block gives the full new content of an existing file and the sha256 of the file it replaces; run `sha256sum <file>` first and stop on a mismatch.
- `gui/src/settings.ts` has CRLF line endings. Every other file in this plan has LF. Keep each file's line endings; the edit text is shown with LF.
- Apply the texts with the Edit and Write tools, or with a script that reads this file. Never retype them through a shell heredoc: this environment's Bash can collapse a doubled backslash, and one line holds one (the `absolute.replace(...)` line of `openFileMenu` in P1.12, whose string literal is written as two backslash characters).
- Run the steps in order. Later anchors depend on earlier edits.
- Each slice ends with a commit boundary. Do not commit. Stop and report to the main session.
- Do not touch: `gui/crates/herdr-wire`, anything outside `gui/`, `gui/src/render/*` (an import of `FONT_STACK` is allowed), `gui/src-tauri/src/engine.rs`, `gui/src-tauri/src/flutter.rs`, `gui/src-tauri/src/window_chrome.rs` (P1 calls its existing `open_folder`), `gui/src/keyboard/*`, `gui/src/shortcuts.ts`, `gui/src/ui/menu.ts`, `gui/src/ui/menus.ts`, `gui/src/appMenuBar.ts`, `gui/src/main.ts`, `gui/src/themes/*`, `gui/src/git/statusRefresh.ts`, `gui/src/git/diffParse.ts`, and the dependency lists in `Cargo.toml` and `package.json`. No new dependencies.
- P0 rules apply to every P1 call:
  - every git call goes through `run_git`;
  - pathspecs are `:(literal)<path>`;
  - read commands pass `-c core.fsmonitor=false`, and `log`/`show` pass `--no-show-signature`;
  - output that grows with the repo is capped (`DIFF_CAP_BYTES`);
  - `WRITE_LOCK` is for writes only, and P1 adds no write;
  - errors from background loads show inline, and errors from user actions toast;
  - test repos follow P0 deviation 21.
- **Prerequisite.** P0 slices S3–S5 are still uncommitted: `src/git/`, `src/ui/sourceControl.ts`, `src/ui/diffView.ts` and `src/appSourceControl.ts` are untracked. Commit P0 first, or the P1 commit boundaries also carry P0 code. The two whole-file replacements (P1.9 `diffView.ts`, P1.10 `appSourceControl.ts`) check the exact P0 and H2 contents by hash.
- **Pre-check of this plan.** On 2026-10-11 a script parsed this file and applied every exact text, in step order, to a copy of the current `gui/` working tree (P0 uncommitted, as above). It asserted that each old text occurs exactly once when it runs, and that each replaced file matches its hash. On that copy:
  - Rust, the real crate with toolchain 1.96.1: `cargo test -p herdr-gui --lib git::` gave 44 after P1.1 and 53 after P1.2; `fmt:0 clippy:0` (outside `flutter.rs`) at the H1 boundary and after P1.13. `rustfmt --check` of `git.rs` was clean.
  - TypeScript with the repo's own `tsc --noEmit` and vitest: tsc was clean after every step from P1.3 on, and each step's expected counts below are that run's output.
  - A scratch-only jsdom smoke test (not part of this plan) loaded `index.html`, mocked `invoke` and `listen`, and drove the real `appSourceControl.ts` at the H3 and the H4 boundaries: startup show and focus, the working-directory Summary, the Commits tab, a commit Summary, Alt+Down and Alt+Left, a file tab, the Esc chain, Collapse all, the file menu, the pinned row, hide on Esc, re-show, and hide when focus moves to the menu bar. No error notice appeared.

## Spec header

**goal:** the Source Control panel follows Sublime Merge's flow: a Commits tab with HEAD's decorated history under a pinned "Commit Changes" row, a Files tab that follows the selection, and a tabbed details pane over the terminal with a Summary (a commit's meta and message, or the working directory's commit box and sections), a collapsible inline diff per file, file tabs, a file menu and panel-local keys.

**deliverables:**
- Create:
  - `gui/src/ui/commitList.ts`, `gui/src/git/fileTree.ts`, `gui/src/git/panelKeys.ts`, `gui/src/ui/detailsPane.ts`, `gui/src/git/summaryDiffs.ts`, `gui/src/ui/fileMenu.ts`
  - `gui/tests/unit/ui/commitList.test.ts`, `gui/tests/unit/git/fileTree.test.ts`, `gui/tests/unit/ui/sourceControl.test.ts`, `gui/tests/unit/git/panelKeys.test.ts`, `gui/tests/unit/ui/detailsPane.test.ts`, `gui/tests/unit/git/summaryDiffs.test.ts`, `gui/tests/unit/ui/fileMenu.test.ts`
- Touch:
  - `gui/src-tauri/src/git.rs`, `gui/src-tauri/src/lib.rs`, `gui/src-tauri/src/settings.rs`
  - `gui/src/git/gitApi.ts`, `gui/src/settings.ts`, `gui/index.html`, `gui/src/appDom.ts`, `gui/src/appLookups.ts` (one line), `gui/src/style.css`, `gui/src/ui/sourceControl.ts`, `gui/src/appSidebarResize.ts`
  - replaced whole: `gui/src/ui/diffView.ts` (P1.9), `gui/src/appSourceControl.ts` (P1.10); both are untracked P0 files.
- Untouched: the "Do not touch" list above.
- Tests: vitest collects only `tests/unit/**/*.test.ts` (`gui/vitest.config.ts`). The DOM tests start with `// @vitest-environment jsdom`; jsdom is already a devDependency (`gui/package.json:32`). The pure modules (`fileTree`, `panelKeys`, `summaryDiffs`, `fileMenu`) have node tests.

**contracts** (Rust in `git.rs`; the TS types in `gitApi.ts` mirror them in camelCase):
- `git_log(repo: String, skip: u32, limit: u32) -> Result<Vec<CommitRow>, ApiError>`
  - `CommitRow { hash, short_hash, parents: Vec<String>, author, author_email, timestamp: i64, summary, refs: Vec<String>, files: Option<u32> }`. `refs` are the `%D` entries with full names (`HEAD -> refs/heads/main`, `refs/remotes/origin/main`, `tag: refs/tags/v1`, or `HEAD` when detached). `files` counts the files against the first parent.
  - Checks in order: `limit` outside 1..=500 gives `invalid_argument`; then `check_repo` (`invalid_repo`); then `rev-parse --verify --quiet HEAD`, whose exit 1 (no commits) returns `[]`.
  - Command (`log_rows`): `-c core.fsmonitor=false -c log.showRoot=true log -z --no-show-signature --no-color --decorate=full --format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s -M --diff-merges=first-parent --name-only --skip=<skip> --max-count=<limit> HEAD --` with `stdout_cap = Some(DIFF_CAP_BYTES)`. A capped read runs the same command without `--name-only` and without a cap (at most 500 records), and every `files` is `None`.
  - Source: the P1 outline; item 6 (decorations without parsing ambiguity, the file badge); probes (counterintuitive 11–15).
- `git_show(repo: String, hash: String) -> Result<CommitDetail, ApiError>`
  - `CommitDetail { hash, tree, parents, author, author_email, timestamp, message, files: Vec<CommitFile>, truncated: bool }`; `CommitFile { #[serde(flatten)] change: FileChange, added: Option<u32>, deleted: Option<u32> }`, so TS `CommitFile extends FileChange`.
  - Checks in order: `hash` must be 7–64 lowercase hex characters (`invalid_hash`); then `check_repo`.
  - Command: `-c core.fsmonitor=false -c log.showRoot=true show -z --no-show-signature --no-color --no-textconv --format=%H%x1f%T%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%B --raw --numstat -M --diff-merges=first-parent <hash>^{commit} --` with `stdout_cap = Some(DIFF_CAP_BYTES)`. A capped read is success with `truncated: true`; unparsable output is `git_failed` "unexpected git show output".
  - Source: item 2 (Tree, Stats, per-file counts).
- `git_commit_diff(repo: String, hash: String, path: String, orig_path: Option<String>) -> Result<GitDiff, ApiError>`: as the earlier plan, plus `-c log.showRoot=true`. Checks: `invalid_hash`, `invalid_path` for both paths, `invalid_repo`. The TS key is `origPath` (Tauri 2 maps camelCase keys; `send_input { paneId }`, `src/appTerminalInput.ts:26`, relies on it).
- Setting: Rust `source_control_tab: String` with serde default `"files"` (the `agent_sort` pattern); TS `sourceControlTab: SourceControlTab = "files" | "commits"`; any other value means Files.
- Existing command reused: `open_folder(path)` (`src-tauri/src/window_chrome.rs:97-115`) accepts an existing absolute folder only.
- UI contracts:
  - `#diff-view` holds `#details-tabs` and `#details-body`; `#details-body` starts with the moved `#source-control-commit`.
  - `renderSourceControl(branchEl, bodyEl, view, error, colors, files: FilesView, commitFiles: FileChange[] | null, callbacks)`; callbacks add `onToggleCollapsed(key)` and `onFileMenu(file, staged | null, at)`.
  - `renderCommitSummary` and `renderWorktreeSections` return the sections as `Map<sectionKey, HTMLElement>`; `renderSectionBody(sectionEl, state, fontSizePx)` re-renders one.
  - `panelKeyAction(event, inText) -> PanelKeyAction | null`; `fileMenuItems(file, staged, actions) -> MenuItemSpec[]`.
  - CSS variables: `--sc-lane-0`, `--sc-head-chip-fg`, `--sc-chip-bg`, `--sc-tag-bg`, `--sc-tag-fg`, `--sc-badge-add-bg`, `--sc-badge-del-bg`, `--sc-file-header-bg`, `--sc-file-header-hover-bg`, `--sc-file-header-untracked-bg`, `--sc-file-header-unmerged-bg`, `--sc-hunk-header-bg`; `:root[data-theme-kind="light"]` holds the light values.

**edge cases** (line numbers: `@P0` is today's file; otherwise the file after P1.13):
- No commits: `log HEAD` exits 128 ("bad revision 'HEAD'"); `rev-parse --verify --quiet HEAD` exits 1, so `git_log` returns `[]` and the list shows "No commits yet" (test `log_of_a_repo_with_no_commits_is_empty`).
- Root commit: `%P` and `%D` are empty, so `parents` and `refs` are `[]`, and the Summary hides the Parent row (`src/ui/detailsPane.ts:292`). A user's `log.showRoot=false` would list no files; `-c log.showRoot=true` wins (tests `log_lists_…`, `show_root_…`).
- Merge: `show --name-status` alone prints no files; `--diff-merges=first-parent` lists the merge's files against its first parent, in `git_show`, `git_commit_diff` and the log's file count (test `show_merge_…`).
- Rename: `-z` raw and numstat records print the OLD path first; porcelain status prints the new path first (`git.rs:139-148` @P0). The commit file diff needs both pathspecs (test `show_rename_…`).
- Binary file: numstat prints `-` counts, so `added`/`deleted` are `None` and the header shows no badges (test `show_root_…`, `countBadges` `src/ui/detailsPane.ts:155`).
- Empty commit: no raw records, `files` is `[]`; its log row counts 0 files.
- A vendor-import commit: the `show` read stops at 2 MiB; `parse_show` keeps whole records, files past the cut are missing and counts past it are `None`; the Stats row says "(list truncated at 2 MiB)". A log page whose `--name-only` output passes 2 MiB is read again without names (test `log_past_the_cap_…`).
- Many files: the sidebar and the Summary render at most `MAX_ROWS_PER_GROUP` (500) per group, then "and N more"; more than 25 Summary files start collapsed (`AUTO_EXPAND_LIMIT`, `src/git/summaryDiffs.ts:11`); a section renders at most 500 diff rows (`src/ui/detailsPane.ts:83`).
- A local branch named `origin/x`: `--decorate=full` prints `refs/heads/origin/x`, so its chip is a branch, not a remote (test `log_lists_…`, `refChip` `src/ui/commitList.ts:51`).
- Detached HEAD: `%D` starts with `HEAD`, which gets the filled HEAD chip.
- `log.excludeDecoration` in a user's config hides those refs, as in a terminal (comment on `git_log`).
- Paging past the end, exactly 200 commits, HEAD moving between pages: as the earlier plan (`historyWindow`, probe row).
- Clean tree: the pinned row reads "No changes" and the commit button "Nothing to commit" (`src/appSourceControl.ts:238`).
- Focus leaves the panel while the pane shows (a terminal click, the find bar, a terminal tab, the menu bar): the `focusin` listener hides the pane without taking focus back (`src/appSourceControl.ts:828`).
- The pane appears while the capture has focus (startup, a workspace switch): `syncPane` moves focus to the pane root (`src/appSourceControl.ts:317`).
- A status change while typing a commit message: only the sections container re-renders (`src/appSourceControl.ts:379`); the commit box element is not touched.
- A working-directory file tab whose file leaves both lists closes; a staged/unstaged move re-reads it (`followOpenDiff`, `src/appSourceControl.ts:586`).
- A late detail or diff after a new selection: `paneSeq` drops it (`src/appSourceControl.ts:109`).
- A section read that fails: the error shows inside that section; no toast (`src/appSourceControl.ts:465`).
- Alt+Down with no history loaded (the Commits tab never opened): nothing happens; `historyRows` is `null`.
- Ctrl+Shift+B hides the sidebar: `isActive()` turns false, but no Source Control code runs, so the CSS rule `#main.sidebar-hidden #diff-view` hides the pane (`src/style.css:2877`).
- `src/settings.ts` is CRLF: the P1.4 verify counts CRLF pairs against LF bytes.

**counterintuitive** (each verified on 2026-10-11 with git 2.45.1 in throwaway repos under the session scratchpad, or in the code named):
1. Name-status and raw `-z` records print a rename as `R100\0old\0new\0`, the reverse of porcelain v1 (`R  new\0old\0`). Numstat `-z` prints it as `0\t0\t\0old\0new\0`. Tests pin both orders.
2. `git show <merge> --name-status` lists no files by default (combined diff). `--diff-merges=first-parent` lists the merge's files against its first parent.
3. The diff of a renamed file in a commit needs both pathspecs. With only the new path, git shows a whole new file.
4. `git log HEAD` in a repo with no commits exits 128. Check `rev-parse --verify --quiet HEAD` (exit 1) first; do not match stderr.
5. `git show <tree-or-blob-hash>` exits 0 and prints the object. `<hash>^{commit}` turns that into exit 128.
6. Without a commit-graph, `--date-order` and `--topo-order` walk the whole history (72 ms default vs 267 ms for `-n 200` on a 60 000-commit synthetic repo). P1 keeps the default order; only the P1b lane rail needs `--topo-order`.
7. `gui/src/settings.ts` is CRLF; a Git Bash `grep $'\r'` does not show it, a Python byte count does.
8. The tabs, the filter button and Refresh need about 280 px, and the default sidebar is 260 px, so the tablist replaces the `SOURCE CONTROL` label; its `aria-label` keeps the name.
9. Vitest prints ANSI colour codes even when piped. The expected lines in this plan are the visible text.
10. `.sc-row`, `.icon-btn` and `.sc-view-toggle` set `display`, which beats the `hidden` attribute, so each needs an explicit `[hidden]` rule.
11. `git show --numstat --name-status` silently prints the name-status only. `--raw --numstat` prints both: all raw records, then all numstat records in the same order.
12. Default `%D` prints short names, so a local branch `origin/fake` looks like the remote-tracking `origin/fake`. With `--decorate=full`, `%D` prints `refs/heads/origin/fake` and `refs/remotes/origin/...`.
13. `log -z --name-only` puts a commit's file names after its header, the first one starting with `\n`; a commit with no files has no token. A header is told apart by its first field, a 40- or 64-digit `%H`.
14. On this repo (1 779 commits), 201 rows took 74 ms bare, 98 ms with `--name-only` and 626 ms with `--shortstat`. The file badge therefore counts names, not lines.
15. A user's `log.showRoot=false` makes `log` and `show` list no files for the root commit; a command-line `-c log.showRoot=true` wins. A user's `diff.renames=false` makes the log count a rename as two files; `-M` counts it once (test `show_rename_…`).
16. `--clear-decorations` does not undo a config `log.excludeDecoration` (probe), so P1 does not pass it.
17. A `focusin` listener hides the pane when focus leaves the panel, the pane and `#overlay-root`; a listener on the terminal capture alone would miss the find bar, whose input sits under the pane (z 3 < 4). The sidebar and tab menus return focus with `keyboardCaptureReturnTarget()` (`src/ui/sidebar.ts:276-278`); a P1 menu that did the same would hide the pane on every menu close. P1 menus return focus to the clicked element.
18. Moving the commit box element blurs it. If a status change re-rendered the whole Summary, the caret and an IME composition would die every 3 s while an agent edits files; so a status change re-renders only the sections container.
19. Space opens a P0 row and toggles a header through the element's own key handler. The panel key map has no Space; otherwise one press would do both.
20. Ctrl+Alt is AltGr on Windows (`src/keyboard/routing.ts:140-149` @P0), so the panel map never maps Ctrl+Alt. In a text field only Esc maps: macOS Option+arrows move by word.
21. jsdom has no `scrollIntoView`; `detailsPane.ts` calls it as `?.scrollIntoView?.(…)`, so the renderer tests run. The orchestration calls it plainly (WebView2 and WKWebView have it).

**rejected alternative:** a new details column in the `#editor` grid, beside or in place of `#terminal-wrap`.
- Showing or hiding a grid column resizes the terminal canvas. The renderer's resize observer then sends `resize` for the focused pane, and every PTY reflows each time the user opens or closes Source Control.
- It would touch `src/render/*` or the resize wiring in `main.ts`, both on the "Do not touch" list.
- The chosen design reuses `#diff-view`: it is `position: absolute; inset: 0` inside `#terminal-wrap` at z-index 4 (`src/style.css:2536-2544` @P0), so the terminal keeps its size and keeps rendering under it. The tab strip above it stays live, and the connection banner (z 5) stays on top.
- Blast radius of the reuse: focus (the `focusin` rule, `syncPane`'s focus move, menus that return focus to the pane, the hidden-sidebar CSS rule), Esc (the panel key listener on `#diff-view` and `#source-control` replaces the P0 Esc listener), terminal input (the pane holds focus, so keys bubble to it at routing step 4), table shortcuts (still global at routing step 2, open risk 7), resize (none).

**acceptance:**
- Offline: the Overall verify command at the end. Expected: `fmt:0 clippy:0`; every `test result: ok.`, with the herdr-gui lib line at `333 passed`; tsc silent; `Test Files  75 passed (75)` and `Tests  870 passed (870)`.
- Live (main session only, after `npm run package:fast`): the list in step P1.14, on `%TEMP%\cowbell-git-demo`.

**ui direction** (from the caller: Sublime Merge's flow 1:1, inventory as the UX authority; herdr's theme variables first; no new dependencies):
- Direction: Sublime Merge's two-pane git view inside Cowbell. The sidebar section is the commit and file list; the details pane over the terminal is the Summary and the file tabs.
- Tone (0–5): density 4, ornament 1, contrast 3, motion 0.
- Skeleton:

```
sidebar (260 px default; drag up to 640 px)          #diff-view over the terminal (tab strip above stays)
+---------------------------------------+   +--------------------------------------------------------+
| v WORKSPACES                      [+] |   | [Summary] [a.ts x] [new.md x]                     [x]  |
|   ...workspace rows...                |   |--------------------------------------------------------|
+---------------------------------------+   | Commit Hash  a1b2c3d4e5f6...      (italic grey labels) |
| v FILES  COMMITS            [F] [R]   |   | Tree         9f8e7d6c...                               |
| (branch) main  ^1             herdr   |   | Author       Ada <ada@example.com>                     |
| [filter files...]      (Files, F on)  |   | Date         10/9/2026, 14:05                          |
| v STAGED CHANGES (1)            [-]   |   | Parent       0a1b2c3d... (link)                        |
|   M a.ts    src                       |   | Stats        [-3] [+12]  2 files                       |
| v CHANGES (2)                   [+]   |   |--------------------------------------------------------|
|   U n.txt                             |   | fix the parser                    (terminal font)      |
| [Changes][Tree]                       |   |--------------------------------------------------------|
+---------------------------------------+   |                                       [Collapse all]   |
  Commits tab:                              | v M src/a.ts                    [-3] [+12]  [...]      |
| 3 changes        Commit Changes (it.) |   |   @@ -1,3 +1,12 @@               (hunk header tint)    |
| [main] fix the parser   Ada  [2]  2h  |   |   12  12   context ...                                 |
| merged side commit      Bob  [1]  3d  |   | > R docs/old.md -> docs/new.md   [-0] [+0]  [...]      |
| Load more                             |   +--------------------------------------------------------+
                                            working directory: [message box] [Commit / Nothing to commit]
                                            then STAGED (n) [Unstage All], UNSTAGED (n) [Stage All],
                                            UNTRACKED (n) [Stage All], each with file sections
```

- Type and colour:
  - The UI font is 13px; tabs, meta, chips, badges and headers use `--fs-xs` (12px); the commit message and the diff use `FONT_STACK` at the terminal font size.
  - Summary bold on first-parent rows (600); author italic in `--descriptionForeground`; meta labels italic `--descriptionForeground` (inventory §D `#808080` maps to it).
  - Chips: `--sc-chip-bg` with a 4px `--sc-lane-0` left border; HEAD filled `--sc-lane-0` with `--sc-head-chip-fg`; remote and other chips grey; tags `--sc-tag-bg` / `--sc-tag-fg`.
  - Selected rows and tabs reuse `--list-activeSelection*`, `--tab-*` and `--focusBorder`; file headers, hunk headers and badges use the new `--sc-*` variables.
- States:
  - Before page 1 the list is empty; "No commits yet"; a history error is an `.sc-error` line on top; "Loading…" replaces Load more.
  - The pane shows "Loading…" until a commit's detail arrives, and the error text if it fails (the error also toasts). A section shows "Loading…" until its diff arrives, or its error.
  - Clean tree: the pinned row reads "No changes", the Summary "No changes", the button "Nothing to commit".
  - No workspace, not a repo and git missing show the same body messages on both tabs, and the pane stays hidden.
  - Below a 340 px container width the author hides; summaries truncate with an ellipsis at any width.

**smallest-change check:**
- P1.1: one parser pair and one paged runner on the existing `run_git`, `check_repo` and `require_success`; the cap fallback reruns the same argument list minus one flag.
- P1.2: `parse_show` reuses `kind_of` and flattens `FileChange`; the line counts ride in the same `show` call (`--raw --numstat`), no second process; `git_commit_diff` reuses `finish_diff`.
- P1.3: three handler lines and three one-line wrappers.
- P1.4: the `agent_sort` String-with-default pattern; static markup; one theme-kind line; CSS variables only for colours the theme tables lack.
- P1.5: one renderer file; `refChip` and `firstParentChain` are pure one-pass functions; `formatAge` is reused.
- P1.6: an inline seq counter (the `diffSeq` pattern); no new module.
- P1.7: one pure tree function; the renderer gains one options object; the state stays in the orchestration module.
- P1.8: one pure table function; the listeners sit on the two panel roots; routing does not change.
- P1.9: one renderer module that reuses `STATUS_LETTER`, `MAX_ROWS_PER_GROUP` and the diff rows, which move out of `renderDiffView` instead of being copied.
- P1.10: `#diff-view` is reused, so no layout or PTY size changes; the commit box element moves, it is not duplicated; `followOpenDiff` drives the tabs. A whole-file replacement, because the change is +365 −93 lines of 410.
- P1.11: two pure modules; `openMenu` and `open_folder` are reused.
- P1.12: per-file reads through the existing `git_commit_diff` and `git_diff`, for commits and the working directory alike; a finished read re-renders its own section only.
- P1.13: one constant.

## Deviations from the earlier P1 plan and the outline in git-mvp-plan.md (apply them; do not re-decide)

Kept from the earlier P1 plan:
1. `git_commit_diff` takes `orig_path: Option<String>` (counterintuitive 3).
2. `git_log` puts `%D` before `%s`, and `git_show` has its own format that ends in `%B`. The free text is always the last field.
3. `CommitDetail` has no `refs` and no `shortHash` (the row has them), and it has `truncated`, because the `show` output is capped.
4. `git_log` runs `rev-parse --verify --quiet HEAD` before `log` (counterintuitive 4).
5. Every hash goes to git as `<hash>^{commit}` (counterintuitive 5).
6. P1 keeps git's default log order; P1b adds `--topo-order` (counterintuitive 6).
7. The tablist replaces the `SOURCE CONTROL` label (counterintuitive 8).
8. Dates: `formatAge` under 7 days, then a short local date.
9. Only the author hides below a 340 px container width.
10. A history re-read keeps the loaded rows (`historyWindow`, the probe row decides `hasMore`); the list re-renders only when its JSON changed.
11. History load errors show inline; commit detail and file-tab diff errors toast (action errors, P0 spec §7).
12. The P0 test helper `git()` returns its trimmed stdout.
13. File rows show the muted status letter only (P0 deviation 13).

New in this amendment:
14. The overlay with a back stack (git-mvp-plan.md "Layout decision") becomes the tabbed details pane in the same `#diff-view` (item 1, D1–D4).
15. `git_log` passes `--decorate=full`, so `refs` holds full names (item 6, counterintuitive 12); TS `refChip` classifies them.
16. The file-count badge, deferred before, is in (item 6, D10): `--name-only -M --diff-merges=first-parent`, capped, with a rerun without names.
17. `git_show` gains `tree` and per-file counts (`CommitFile`) and uses `--raw --numstat` instead of `--name-status` (item 2, counterintuitive 11).
18. `log`, `show` and the commit diff pass `-c log.showRoot=true` (counterintuitive 15).
19. "No new design tokens" is lifted for the `--sc-*` colours and the `data-theme-kind` hook (item 9, D13). The CSS block says why it holds literal colours, against the `style.css` header rule.
20. The navigation keys move from P5 into P1 (item 8, D15). Enter, Backspace and their Shift variants stay with P2 and P5.
21. The commit box moves from the sidebar into the working-directory Summary (D6); its button reads "Nothing to commit" with nothing staged (item 2).
22. A P0 file row click (or Enter) opens a file tab in the pane instead of the P0 overlay; the intent is the same.
23. The Files tab lists the selected commit's files (D5), and gains collapsible headers, a filter and the Tree style (item 4).
24. Slicing: H2 Commits tab, pinned row and Files options; H3 pane and Summary; H4 sections, file menu and width. The earlier P1.7a, P1.7b and P1.8 become P1.8–P1.13; the earlier optional P1.9 is the optional O1.
25. Lanes 1–5 come with P1b, and the word-level diff colours with P4, where they are used.

## Baseline facts (verified 2026-10-11, before any P1 change)

| Check | Result |
|---|---|
| `npx vitest run` | `68` files, `828` tests passed |
| `cargo test -p herdr-gui --lib git::` | `37 passed; 280 filtered out` (lib total 317); it also prints a pre-existing test-only warning, `unused variable: sh` at `src-tauri/src/engine.rs:1410` |
| `cargo fmt --check` | 2 diffs, both in `src-tauri/src/flutter.rs` (pre-existing, out of scope) |
| `cargo clippy --workspace -- -D warnings` | findings only in `src-tauri/src/flutter.rs` (`:449`, `:555`) |
| `cargo test --workspace` | needs the herdr root `tests/fixtures/` (the `herdr-wire` fixture tests read them) |
| toolchain | the herdr root `rust-toolchain.toml` pins `1.96.1`; the root `clippy.toml` sets `too-many-arguments-threshold = 11` |
| `git --version` | `git version 2.45.1.windows.1` (`--diff-merges=first-parent` needs 2.31 or later; `--decorate=full` with `%D` works on 2.45.1) |
| line endings | LF in every file of this plan except `src/settings.ts` (CRLF) |
| themes | all six built-in themes are `kind: "dark"` (`src/themes/index.ts:27-34`); light themes come only from imports, whose kind comes from the theme file (`src-tauri/src/theme_import.rs:457`) |

---

## Slice H1: read commands and TS wrappers

Before H1 ends, nothing calls the new commands; the UI does not change.

### step P1.1
Goal: add `CommitRow`, `parse_log`, `log_rows` and the `git_log` command (full ref names, a file count per row), with 2 unit tests and 5 integration tests.

- files: `gui/src-tauri/src/git.rs`

edit 1 (`git.rs`): insert the code between `git_commit` and the test module.

old:
```rust
    Ok(CommitResult {
        hash: hash.to_string(),
        summary: summary.to_string(),
    })
}

#[cfg(test)]
mod tests {
```

new:
```rust
    Ok(CommitResult {
        hash: hash.to_string(),
        summary: summary.to_string(),
    })
}

/// `git_log` returns at most this many rows per call.
const MAX_LOG_LIMIT: u32 = 500;
/// `%H` is first, so `parse_log` tells a header from a `--name-only` file
/// token. `%s` is last, so a stray `\x1f` in a subject stays in the subject.
const LOG_FORMAT: &str = "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRow {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    /// Author date, Unix seconds (`%at`).
    pub timestamp: i64,
    pub summary: String,
    /// `%D` entries with full ref names (`--decorate=full`):
    /// `HEAD -> refs/heads/main`, `refs/remotes/origin/main`, `tag: refs/tags/v1`.
    pub refs: Vec<String>,
    /// Files changed against the first parent. `None` when the page's file
    /// lists passed the output cap.
    pub files: Option<u32>,
}

/// One `LOG_FORMAT` header, or `None` for any other token (a file name).
fn parse_log_header(token: &str) -> Option<CommitRow> {
    let f: Vec<&str> = token.splitn(8, '\x1f').collect();
    let full_hash = matches!(f[0].len(), 40 | 64)
        && f[0].bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if f.len() < 8 || !full_hash {
        return None;
    }
    Some(CommitRow {
        hash: f[0].to_string(),
        short_hash: f[1].to_string(),
        parents: f[2].split_whitespace().map(String::from).collect(),
        author: f[3].to_string(),
        author_email: f[4].to_string(),
        timestamp: f[5].parse().unwrap_or(0),
        refs: f[6]
            .split(", ")
            .filter(|r| !r.is_empty())
            .map(String::from)
            .collect(),
        summary: f[7].to_string(),
        files: None,
    })
}

/// `log -z` ends every header with NUL. With `--name-only` (`with_files`),
/// the commit's file names follow its header, one NUL-terminated token each;
/// the first one starts with `\n`, and a commit with no files has none.
fn parse_log(stdout: &[u8], with_files: bool) -> Vec<CommitRow> {
    let text = String::from_utf8_lossy(stdout);
    let mut rows: Vec<CommitRow> = Vec::new();
    for token in text.split('\0') {
        if let Some(mut row) = parse_log_header(token) {
            row.files = with_files.then_some(0);
            rows.push(row);
        } else if !token.is_empty() {
            if let Some(n) = rows.last_mut().and_then(|r| r.files.as_mut()) {
                *n += 1;
            }
        }
    }
    rows
}

/// One page of `git log`. `cap` bounds the `--name-only` output; past it, the
/// page is read again without file names, so no row is lost.
async fn log_rows(
    repo: &str,
    skip: u32,
    limit: u32,
    cap: usize,
) -> Result<Vec<CommitRow>, ApiError> {
    let skip_arg = format!("--skip={skip}");
    let limit_arg = format!("--max-count={limit}");
    // `log.showRoot=true`: a user's `false` would list no files for the root commit.
    // shortcut: git's default (date) order; the P1b lane rail needs --topo-order.
    let mut args = vec![
        "-c",
        "core.fsmonitor=false",
        "-c",
        "log.showRoot=true",
        "log",
        "-z",
        "--no-show-signature",
        "--no-color",
        "--decorate=full",
        LOG_FORMAT,
        "-M",
        "--diff-merges=first-parent",
        "--name-only",
        &skip_arg,
        &limit_arg,
        "HEAD",
        "--",
    ];
    let out = run_git(repo, &args, None, Some(cap), GIT_TIMEOUT).await?;
    if !out.capped {
        return Ok(parse_log(&require_success(out)?, true));
    }
    // shortcut: a page whose file lists pass the cap shows no file counts.
    args.retain(|a| *a != "--name-only");
    // Without file names, at most MAX_LOG_LIMIT records: no cap.
    let stdout = require_success(run_git(repo, &args, None, None, GIT_TIMEOUT).await?)?;
    Ok(parse_log(&stdout, false))
}

/// Commits reachable from HEAD, newest first, after `skip` rows. A repo with
/// no commits gives `[]`. A user's `log.excludeDecoration` still hides refs,
/// as it does for `git log` in a terminal.
#[tauri::command]
pub async fn git_log(repo: String, skip: u32, limit: u32) -> Result<Vec<CommitRow>, ApiError> {
    if !(1..=MAX_LOG_LIMIT).contains(&limit) {
        return Err(api_error(
            "invalid_argument",
            format!("limit must be 1..={MAX_LOG_LIMIT}, got {limit}"),
        ));
    }
    check_repo(&repo).await?;
    // No commits yet: `log HEAD` fails with "bad revision 'HEAD'", exit 128.
    let head = run_git(
        &repo,
        &["rev-parse", "--verify", "--quiet", "HEAD"],
        None,
        None,
        GIT_TIMEOUT,
    )
    .await?;
    if head.code == Some(1) {
        return Ok(Vec::new());
    }
    require_success(head)?;
    log_rows(&repo, skip, limit, DIFF_CAP_BYTES).await
}

#[cfg(test)]
mod tests {
```

edit 2 (`git.rs`): the last three lines of the file. Append the tests at the end of `mod tests`.

old:
```rust
        let _ = std::fs::remove_dir_all(&dir);
    }
}
```

new:
```rust
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A full-length hash made of `c`, for the parser fixtures.
    fn hash_of(c: char) -> String {
        c.to_string().repeat(40)
    }

    #[test]
    fn parse_log_reads_fields_full_refs_and_file_counts() {
        let (m, r) = (hash_of('1'), hash_of('2'));
        let out = format!(
            "{m}\x1fm\x1fp1 p2\x1fAda\x1fada@x.org\x1f1700000000\x1fHEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1\x1fMerge feat\0\na.txt\0b.txt\0{r}\x1fr\x1f\x1fBob\x1fbob@x.org\x1f1600000000\x1f\x1froot\0"
        );
        let rows = parse_log(out.as_bytes(), true);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].hash, m);
        assert_eq!(rows[0].short_hash, "m");
        assert_eq!(rows[0].parents, vec!["p1", "p2"]);
        assert_eq!(rows[0].author, "Ada");
        assert_eq!(rows[0].author_email, "ada@x.org");
        assert_eq!(rows[0].timestamp, 1_700_000_000);
        assert_eq!(
            rows[0].refs,
            vec![
                "HEAD -> refs/heads/main",
                "refs/remotes/origin/main",
                "tag: refs/tags/v1"
            ]
        );
        assert_eq!(rows[0].summary, "Merge feat");
        assert_eq!(rows[0].files, Some(2));
        // A root commit has no parents, an undecorated commit has no refs, and
        // a commit with no file tokens counts 0.
        assert!(rows[1].parents.is_empty());
        assert!(rows[1].refs.is_empty());
        assert_eq!(rows[1].summary, "root");
        assert_eq!(rows[1].files, Some(0));
        // Without --name-only, no count is known.
        assert!(parse_log(out.as_bytes(), false)
            .iter()
            .all(|r| r.files.is_none()));
    }

    #[test]
    fn parse_log_keeps_a_unit_separator_inside_the_summary() {
        let h = hash_of('a');
        let out = format!("{h}\x1fh\x1f\x1fA\x1fa@x\x1f1\x1f\x1fone\x1ftwo\0");
        let rows = parse_log(out.as_bytes(), false);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].summary, "one\x1ftwo");
    }

    #[tokio::test]
    async fn log_lists_head_first_with_parents_full_refs_and_file_counts() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("log-merge");
        // A user's log.showRoot=false must not hide the root commit's file.
        git(&dir, &["config", "log.showRoot", "false"]);
        commit_file(&dir, "a.txt", "one\n");
        // tag.gpgsign=true in a global config would turn this into a signed tag that opens an editor.
        git(&dir, &["config", "tag.gpgsign", "false"]);
        git(&dir, &["tag", "v1"]);
        git(&dir, &["checkout", "-q", "-b", "feat"]);
        commit_file(&dir, "f.txt", "f\n");
        git(&dir, &["checkout", "-q", "main"]);
        commit_file(&dir, "b.txt", "b\n");
        git(
            &dir,
            &["merge", "-q", "--no-ff", "-m", "merge feat", "feat"],
        );
        // A local branch named like a remote one: only the full name tells them apart.
        git(&dir, &["branch", "origin/fake"]);
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let rows = git_log(repo, 0, 10).await.unwrap();
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0].summary, "merge feat");
        assert_eq!(rows[0].parents.len(), 2);
        assert_eq!(rows[0].refs[0], "HEAD -> refs/heads/main");
        assert!(rows[0].refs.contains(&"refs/heads/origin/fake".to_string()));
        assert!(rows.iter().any(|r| r.refs == ["refs/heads/feat"]));
        assert!(rows.iter().any(|r| r.refs == ["tag: refs/tags/v1"]));
        assert_eq!(rows.iter().filter(|r| r.parents.is_empty()).count(), 1);
        for r in &rows {
            // Against the first parent, every commit here changed one file:
            // the merge brings f.txt, and the root adds a.txt.
            assert_eq!(r.files, Some(1), "{}", r.summary);
            assert!(r.short_hash.len() >= 7 && r.hash.starts_with(&r.short_hash));
            assert_eq!(r.author, "Test");
            assert_eq!(r.author_email, "test@example.com");
            assert!(r.timestamp > 0);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn log_pages_with_skip_and_limit() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("log-pages");
        for name in ["a.txt", "b.txt", "c.txt"] {
            commit_file(&dir, name, "x\n");
        }
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let first = git_log(repo.clone(), 0, 2).await.unwrap();
        let second = git_log(repo.clone(), 2, 2).await.unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].summary, "add c.txt");
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].summary, "add a.txt");
        assert!(git_log(repo, 3, 2).await.unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn log_of_a_repo_with_no_commits_is_empty() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("log-unborn");
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        assert!(git_log(repo, 0, 10).await.unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn log_rejects_a_limit_outside_1_to_500() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("log-limit");
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        for limit in [0, 501] {
            let err = git_log(repo.clone(), 0, limit).await.unwrap_err();
            assert_eq!(err.code, "invalid_argument", "limit {limit}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn log_past_the_cap_keeps_every_row_without_file_counts() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("log-cap");
        for name in ["a.txt", "b.txt", "c.txt"] {
            commit_file(&dir, name, "x\n");
        }
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let full = log_rows(&repo, 0, 10, DIFF_CAP_BYTES).await.unwrap();
        assert!(full.iter().all(|r| r.files == Some(1)));
        // 64 bytes is less than one header, so the first read stops at the cap.
        let capped = log_rows(&repo, 0, 10, 64).await.unwrap();
        assert_eq!(
            capped.iter().map(|r| &r.hash).collect::<Vec<_>>(),
            full.iter().map(|r| &r.hash).collect::<Vec<_>>()
        );
        assert!(capped.iter().all(|r| r.files.is_none()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
```

- lines: edit 1 +139 −0 = 139; edit 2 +166 −0 = 166.
- exec: `mechanical`. Exact text; the pre-check compiled and passed it on the real crate.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib git:: 2>&1 | grep 'test result'`
  Expected: `test result: ok. 44 passed; 0 failed; 0 ignored; 0 measured; 280 filtered out` (then the timing). No new warning: `git_log` is `pub`, so `log_rows`, `parse_log` and `CommitRow` are reachable.

### step P1.2
Goal: add `CommitFile`, `CommitDetail`, `validate_hash`, `parse_show`, `git_show` (tree hash, per-file line counts) and `git_commit_diff`, with 4 unit tests and 5 integration tests. The test helper `git()` returns its stdout.

- files: `gui/src-tauri/src/git.rs`

edit 1 (`git.rs`, test helper): the helper returns the trimmed stdout. Existing calls ignore the `String`, which gives no warning.

old:
```rust
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
```

new:
```rust
    /// Runs git, asserts success, and returns the trimmed stdout.
    fn git(dir: &Path, args: &[&str]) -> String {
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
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }
```

edit 2 (`git.rs`): insert the code between `git_log` (from P1.1) and the test module.

old:
```rust
    log_rows(&repo, skip, limit, DIFF_CAP_BYTES).await
}

#[cfg(test)]
mod tests {
```

new:
```rust
    log_rows(&repo, skip, limit, DIFF_CAP_BYTES).await
}

/// `%B` (the raw message) is last, so it may hold anything but NUL.
const SHOW_FORMAT: &str = "--format=%H%x1f%T%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%B";

/// One changed file of a commit, with its `--numstat` line counts.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    #[serde(flatten)]
    pub change: FileChange,
    /// `None` for a binary file, or when the output stopped at the cap.
    pub added: Option<u32>,
    pub deleted: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub hash: String,
    pub tree: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    /// Author date, Unix seconds (`%at`).
    pub timestamp: i64,
    pub message: String,
    /// Against the first parent; a root commit lists every file as added.
    pub files: Vec<CommitFile>,
    /// The output stopped at `DIFF_CAP_BYTES`, so `files` is only a prefix.
    pub truncated: bool,
}

/// Accepts 7 to 64 lowercase hex digits only (64 covers SHA-256 repos). This
/// also keeps a value like `--output=x` away from git's argv.
fn validate_hash(hash: &str) -> Result<(), ApiError> {
    let ok = (7..=64).contains(&hash.len())
        && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    if !ok {
        return Err(api_error(
            "invalid_hash",
            format!("invalid commit hash: {hash:?}"),
        ));
    }
    Ok(())
}

/// `show -z --raw --numstat` output. The `SHOW_FORMAT` header ends with NUL.
/// Unless the commit changed nothing, a `\n` follows, then one raw record per
/// file (`:<modes> <hashes> <status>\0<path>\0`), then one numstat record per
/// file in the same order (`<added>\t<deleted>\t<path>\0`, with `-` counts for
/// a binary file).
/// Counterintuitive: a rename or copy puts the OLD path first, the reverse of
/// the porcelain status order: `...R100\0old\0new\0` and `0\t0\t\0old\0new\0`.
fn parse_show(stdout: &[u8], truncated: bool) -> Option<CommitDetail> {
    // A capped read can end inside a record: keep only NUL-terminated tokens.
    let end = if truncated {
        stdout.iter().rposition(|b| *b == 0).map_or(0, |p| p + 1)
    } else {
        stdout.len()
    };
    let text = String::from_utf8_lossy(&stdout[..end]);
    let (header, rest) = text.split_once('\0')?;
    let f: Vec<&str> = header.splitn(7, '\x1f').collect();
    if f.len() < 7 {
        return None;
    }
    let mut files = Vec::new();
    let mut tokens = rest.trim_start_matches('\n').split('\0').peekable();
    while let Some(raw) = tokens.next_if(|t| t.starts_with(':')) {
        let Some(&code) = raw.rsplit(' ').next().and_then(|s| s.as_bytes().first()) else {
            break;
        };
        let orig = if matches!(code, b'R' | b'C') {
            tokens.next()
        } else {
            None
        };
        let Some(path) = tokens.next().filter(|p| !p.is_empty()) else {
            break;
        };
        files.push(CommitFile {
            change: FileChange {
                path: path.to_string(),
                orig_path: orig.map(String::from),
                kind: kind_of(code),
            },
            added: None,
            deleted: None,
        });
    }
    for file in &mut files {
        let mut stat = tokens.next().unwrap_or("").splitn(3, '\t');
        let (Some(added), Some(deleted), Some(path)) = (stat.next(), stat.next(), stat.next())
        else {
            break;
        };
        // An empty path: the rename's old and new paths follow as two tokens.
        if path.is_empty() && (tokens.next().is_none() || tokens.next().is_none()) {
            break;
        }
        file.added = added.parse().ok();
        file.deleted = deleted.parse().ok();
    }
    Some(CommitDetail {
        hash: f[0].to_string(),
        tree: f[1].to_string(),
        parents: f[2].split_whitespace().map(String::from).collect(),
        author: f[3].to_string(),
        author_email: f[4].to_string(),
        timestamp: f[5].parse().unwrap_or(0),
        message: f[6].trim_end().to_string(),
        files,
        truncated,
    })
}

/// One commit's message and changed files with line counts.
/// `--diff-merges=first-parent` lists a merge's files against its first parent.
#[tauri::command]
pub async fn git_show(repo: String, hash: String) -> Result<CommitDetail, ApiError> {
    validate_hash(&hash)?;
    check_repo(&repo).await?;
    // `^{commit}` makes a tree or blob hash fail (exit 128, git_failed) instead of printing its content.
    let rev = format!("{hash}^{{commit}}");
    // Counterintuitive: `--numstat --name-status` prints the name-status only;
    // `--raw --numstat` prints both.
    let out = run_git(
        &repo,
        &[
            "-c",
            "core.fsmonitor=false",
            "-c",
            "log.showRoot=true",
            "show",
            "-z",
            "--no-show-signature",
            "--no-color",
            "--no-textconv",
            SHOW_FORMAT,
            "--raw",
            "--numstat",
            "-M",
            "--diff-merges=first-parent",
            &rev,
            "--",
        ],
        None,
        Some(DIFF_CAP_BYTES),
        GIT_TIMEOUT,
    )
    .await?;
    let truncated = out.capped;
    // The read stopped at the cap and closed the pipe, so git's exit code means nothing here.
    let stdout = if truncated {
        out.stdout
    } else {
        require_success(out)?
    };
    parse_show(&stdout, truncated)
        .ok_or_else(|| api_error("git_failed", "unexpected git show output"))
}

/// One file's diff in commit `hash`, against its first parent. A rename needs
/// `orig_path`: git pairs the two sides only when both paths pass the
/// pathspec, otherwise the new path shows as a whole new file.
#[tauri::command]
pub async fn git_commit_diff(
    repo: String,
    hash: String,
    path: String,
    orig_path: Option<String>,
) -> Result<GitDiff, ApiError> {
    validate_hash(&hash)?;
    validate_path(&path)?;
    if let Some(orig) = &orig_path {
        validate_path(orig)?;
    }
    check_repo(&repo).await?;
    let rev = format!("{hash}^{{commit}}");
    let literal = format!(":(literal){path}");
    let orig_literal = orig_path.map(|o| format!(":(literal){o}"));
    let mut args = vec![
        "-c",
        "core.fsmonitor=false",
        "-c",
        "log.showRoot=true",
        "show",
        "--format=",
        "--no-show-signature",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "-U3",
        "-M",
        "--diff-merges=first-parent",
        &rev,
        "--",
        &literal,
    ];
    if let Some(orig) = &orig_literal {
        args.push(orig);
    }
    let out = run_git(&repo, &args, None, Some(DIFF_CAP_BYTES), GIT_TIMEOUT).await?;
    // The read stopped at the cap and closed the pipe, so git's exit code means nothing here.
    if out.capped {
        return Ok(finish_diff(&out.stdout));
    }
    Ok(finish_diff(&require_success(out)?))
}

#[cfg(test)]
mod tests {
```

edit 3 (`git.rs`): the last three lines of the file again. Append the tests.

old:
```rust
        let _ = std::fs::remove_dir_all(&dir);
    }
}
```

new:
```rust
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The `FileChange` part of each commit file, for `kinds`.
    fn changes(files: &[CommitFile]) -> Vec<FileChange> {
        files.iter().map(|f| f.change.clone()).collect()
    }

    /// The raw part of one `show -z --raw` record.
    fn raw(status: &str) -> String {
        format!(":100644 100644 1111111 2222222 {status}")
    }

    #[test]
    fn parse_show_reads_header_raw_records_and_numstat_with_rename() {
        // Counterintuitive: -z prints a rename OLD path first, in both parts.
        let out = format!(
            "h1\x1ft1\x1fp1\x1fAda\x1fada@x.org\x1f1700000000\x1fsubject\n\nbody line\n\0\n{}\0a.txt\0{}\0old.txt\0new.txt\0{}\0bin.dat\03\t1\ta.txt\00\t0\t\0old.txt\0new.txt\0-\t-\tbin.dat\0",
            raw("M"),
            raw("R100"),
            raw("A")
        );
        let d = parse_show(out.as_bytes(), false).unwrap();
        assert_eq!(d.hash, "h1");
        assert_eq!(d.tree, "t1");
        assert_eq!(d.parents, vec!["p1"]);
        assert_eq!(d.author, "Ada");
        assert_eq!(d.author_email, "ada@x.org");
        assert_eq!(d.timestamp, 1_700_000_000);
        assert_eq!(d.message, "subject\n\nbody line");
        assert_eq!(
            kinds(&changes(&d.files)),
            vec![
                ("a.txt", ChangeKind::Modified),
                ("new.txt", ChangeKind::Renamed),
                ("bin.dat", ChangeKind::Added)
            ]
        );
        assert_eq!(d.files[0].change.orig_path, None);
        assert_eq!(d.files[1].change.orig_path.as_deref(), Some("old.txt"));
        assert_eq!((d.files[0].added, d.files[0].deleted), (Some(3), Some(1)));
        assert_eq!((d.files[1].added, d.files[1].deleted), (Some(0), Some(0)));
        // A binary file has `-` counts.
        assert_eq!((d.files[2].added, d.files[2].deleted), (None, None));
        assert!(!d.truncated);
    }

    #[test]
    fn parse_show_of_an_empty_commit_has_no_files() {
        let d = parse_show(b"h\x1ft\x1f\x1fA\x1fa@x\x1f1\x1fempty\n\0", false).unwrap();
        assert!(d.parents.is_empty());
        assert!(d.files.is_empty());
        assert_eq!(d.message, "empty");
    }

    #[test]
    fn parse_show_keeps_whole_records_when_capped() {
        // A cut inside the raw records keeps only the whole records before it.
        let cut_raw = format!(
            "h\x1ft\x1f\x1fA\x1fa@x\x1f1\x1fm\n\0\n{}\0a.txt\0{}\0old\0ne",
            raw("M"),
            raw("R100")
        );
        let d = parse_show(cut_raw.as_bytes(), true).unwrap();
        assert_eq!(
            kinds(&changes(&d.files)),
            vec![("a.txt", ChangeKind::Modified)]
        );
        assert!(d.truncated);
        // A cut inside the numstat records keeps every file; later counts are unknown.
        let cut_stat = format!(
            "h\x1ft\x1f\x1fA\x1fa@x\x1f1\x1fm\n\0\n{}\0a.txt\0{}\0b.txt\01\t0\ta.txt\02\t",
            raw("M"),
            raw("M")
        );
        let d = parse_show(cut_stat.as_bytes(), true).unwrap();
        assert_eq!(d.files.len(), 2);
        assert_eq!(d.files[0].added, Some(1));
        assert_eq!(d.files[1].added, None);
        assert!(parse_show(b"no header terminator", false).is_none());
    }

    #[test]
    fn validate_hash_accepts_lowercase_hex_7_to_64_only() {
        for h in ["abc1234".to_string(), "a".repeat(40), "0".repeat(64)] {
            assert!(validate_hash(&h).is_ok(), "hash {h:?}");
        }
        for h in [
            "abc123".to_string(),
            "a".repeat(65),
            "ABC1234".into(),
            "abc123g".into(),
            "-abc1234".into(),
            "HEAD".into(),
            String::new(),
        ] {
            let err = validate_hash(&h).unwrap_err();
            assert_eq!(err.code, "invalid_hash", "hash {h:?}");
        }
    }

    #[tokio::test]
    async fn show_root_commit_lists_files_tree_counts_and_full_message() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("show-root");
        // A user's log.showRoot=false must not hide the root commit's files.
        git(&dir, &["config", "log.showRoot", "false"]);
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        std::fs::write(dir.join("bin.dat"), [0u8, 1, 2]).unwrap();
        git(&dir, &["add", "a.txt", "bin.dat"]);
        git(&dir, &["commit", "-q", "-m", "first", "-m", "body line"]);
        let hash = git(&dir, &["rev-parse", "HEAD"]);
        let tree = git(&dir, &["rev-parse", "HEAD^{tree}"]);
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let d = git_show(repo.clone(), hash.clone()).await.unwrap();
        assert_eq!(d.hash, hash);
        assert_eq!(d.tree, tree);
        assert!(d.parents.is_empty());
        assert_eq!(d.message, "first\n\nbody line");
        assert_eq!(
            kinds(&changes(&d.files)),
            vec![("a.txt", ChangeKind::Added), ("bin.dat", ChangeKind::Added)]
        );
        assert_eq!((d.files[0].added, d.files[0].deleted), (Some(1), Some(0)));
        assert_eq!((d.files[1].added, d.files[1].deleted), (None, None));
        assert!(!d.truncated);
        let diff = git_commit_diff(repo, hash, "a.txt".into(), None)
            .await
            .unwrap();
        assert!(diff.text.contains("new file mode") && diff.text.contains("@@ -0,0 +1 @@"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn show_rename_reports_orig_path_and_commit_diff_pairs_it() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("show-rename");
        commit_file(&dir, "old.txt", "one\ntwo\nthree\n");
        git(&dir, &["mv", "old.txt", "new.txt"]);
        git(&dir, &["commit", "-q", "-m", "rename"]);
        // `-M` detects the rename whatever the user's diff.renames says.
        git(&dir, &["config", "diff.renames", "false"]);
        let hash = git(&dir, &["rev-parse", "HEAD"]);
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let d = git_show(repo.clone(), hash.clone()).await.unwrap();
        assert_eq!(
            kinds(&changes(&d.files)),
            vec![("new.txt", ChangeKind::Renamed)]
        );
        assert_eq!(d.files[0].change.orig_path.as_deref(), Some("old.txt"));
        assert_eq!((d.files[0].added, d.files[0].deleted), (Some(0), Some(0)));
        assert_eq!(git_log(repo.clone(), 0, 1).await.unwrap()[0].files, Some(1));
        let paired = git_commit_diff(
            repo.clone(),
            hash.clone(),
            "new.txt".into(),
            Some("old.txt".into()),
        )
        .await
        .unwrap();
        assert!(paired.text.contains("rename from old.txt"));
        assert!(!paired.text.contains("new file mode"));
        // Without the old path, git shows the new path as a whole new file.
        let alone = git_commit_diff(repo, hash, "new.txt".into(), None)
            .await
            .unwrap();
        assert!(alone.text.contains("new file mode"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn show_merge_lists_files_against_the_first_parent() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("show-merge");
        commit_file(&dir, "a.txt", "one\n");
        git(&dir, &["checkout", "-q", "-b", "feat"]);
        commit_file(&dir, "f.txt", "f\n");
        git(&dir, &["checkout", "-q", "main"]);
        commit_file(&dir, "b.txt", "b\n");
        git(
            &dir,
            &["merge", "-q", "--no-ff", "-m", "merge feat", "feat"],
        );
        let hash = git(&dir, &["rev-parse", "HEAD"]);
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let d = git_show(repo.clone(), hash.clone()).await.unwrap();
        assert_eq!(d.parents.len(), 2);
        // Against the first parent (main), only the file from feat changed.
        assert_eq!(
            kinds(&changes(&d.files)),
            vec![("f.txt", ChangeKind::Added)]
        );
        let diff = git_commit_diff(repo, hash, "f.txt".into(), None)
            .await
            .unwrap();
        assert!(diff.text.lines().any(|l| l == "+f"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn commit_diff_contains_a_hunk() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("commit-diff");
        commit_file(&dir, "a.txt", "one\n");
        commit_file(&dir, "a.txt", "one\ntwo\n");
        // A short hash is valid too.
        let hash = git(&dir, &["rev-parse", "--short", "HEAD"]);
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        let d = git_commit_diff(repo, hash, "a.txt".into(), None)
            .await
            .unwrap();
        assert!(d.text.contains("@@") && d.text.lines().any(|l| l == "+two"));
        assert!(!d.truncated && !d.binary);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn show_rejects_a_tree_hash_and_invalid_hashes() {
        if !git_available() {
            eprintln!("skipping: git not on PATH");
            return;
        }
        let dir = init_repo("show-invalid");
        commit_file(&dir, "a.txt", "one\n");
        let tree = git(&dir, &["rev-parse", "HEAD^{tree}"]);
        let repo = git_status(s(&dir)).await.unwrap().repo.unwrap();
        // `^{commit}` refuses a tree, so its listing never reaches the parser.
        let err = git_show(repo.clone(), tree).await.unwrap_err();
        assert_eq!(err.code, "git_failed");
        for h in ["HEAD", "abc", "-abc1234"] {
            let err = git_show(repo.clone(), h.into()).await.unwrap_err();
            assert_eq!(err.code, "invalid_hash", "hash {h:?}");
            let err = git_commit_diff(repo.clone(), h.into(), "a.txt".into(), None)
                .await
                .unwrap_err();
            assert_eq!(err.code, "invalid_hash", "hash {h:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
```

- lines: edit 1 +3 −1 = 4; edit 2 +209 −0 = 209; edit 3 +249 −0 = 249.
- exec: `mechanical`. Exact text; the pre-check compiled and passed it on the real crate.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib git:: 2>&1 | grep 'test result'`
  Expected: `test result: ok. 53 passed; 0 failed; 0 ignored; 0 measured; 280 filtered out`.

### step P1.3
Goal: register the three commands, add the TS types and wrappers, and prove fmt and clippy are clean outside `flutter.rs`.

- files: `gui/src-tauri/src/lib.rs`, `gui/src/git/gitApi.ts`

edit 1 (`lib.rs`, `generate_handler!` list):

old:
```rust
            git::git_commit,
```

new:
```rust
            git::git_commit,
            git::git_log,
            git::git_show,
            git::git_commit_diff,
```

edit 2 (`gitApi.ts`): the last function of the file. Append the types and wrappers.

old:
```ts
export function gitCommit(repo: string, message: string): Promise<CommitResult> {
  return invoke<CommitResult>("git_commit", { repo, message });
}
```

new:
```ts
export function gitCommit(repo: string, message: string): Promise<CommitResult> {
  return invoke<CommitResult>("git_commit", { repo, message });
}

/** One `git log` row (git P1). */
export interface CommitRow {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  /** Author date in Unix seconds (`%at`). */
  timestamp: number;
  summary: string;
  /** `%D` entries with full ref names: `HEAD -> refs/heads/main`, `refs/remotes/origin/main`, `tag: refs/tags/v1`. */
  refs: string[];
  /** Files changed against the first parent; `null` when the page passed the output cap. */
  files: number | null;
}

/** One changed file of a commit, with its line counts (`null` for a binary file). */
export interface CommitFile extends FileChange {
  added: number | null;
  deleted: number | null;
}

/** One commit from `git show`: the full message, and the files against its first parent. */
export interface CommitDetail {
  hash: string;
  tree: string;
  parents: string[];
  author: string;
  authorEmail: string;
  /** Author date in Unix seconds (`%at`). */
  timestamp: number;
  message: string;
  files: CommitFile[];
  /** The file list stopped at the 2 MiB output cap. */
  truncated: boolean;
}

/** Newest first from HEAD. `limit` is 1..=500; a repo with no commits gives `[]`. */
export function gitLog(repo: string, skip: number, limit: number): Promise<CommitRow[]> {
  return invoke<CommitRow[]>("git_log", { repo, skip, limit });
}

export function gitShow(repo: string, hash: string): Promise<CommitDetail> {
  return invoke<CommitDetail>("git_show", { repo, hash });
}

/** One file's diff in a commit. A rename needs `origPath`, or git shows the new path as a new file. */
export function gitCommitDiff(repo: string, hash: string, path: string, origPath: string | null): Promise<GitDiff> {
  return invoke<GitDiff>("git_commit_diff", { repo, hash, path, origPath });
}
```

- lines: edit 1 +3 −0 = 3; edit 2 +51 −0 = 51.
- exec: `mechanical`. Exact text.
- verify: first run `cd /c/Users/Reinaldo/Backend/herdr/gui && rustfmt --edition 2021 src-tauri/src/git.rs`. It formats only git.rs and should change nothing. Never run `cargo fmt` here: it would also rewrite the out-of-scope `flutter.rs`. Then:
  `cd /c/Users/Reinaldo/Backend/herdr/gui && echo "fmt:$(cargo fmt --check 2>&1 | grep '^Diff in' | grep -vc flutter.rs) clippy:$(cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^ +--> ' | grep -vc flutter.rs)" && (cd src-tauri && cargo test -p herdr-gui --lib git:: 2>&1 | grep 'test result') && npx tsc --noEmit && echo TSC_OK`
  Expected: `fmt:0 clippy:0`, then `test result: ok. 53 passed; …`, then `TSC_OK`.

**Commit boundary H1. Do not commit.** Files: `gui/src-tauri/src/git.rs`, `gui/src-tauri/src/lib.rs`, `gui/src/git/gitApi.ts`. Suggested message: `feat: add git log, show and commit diff commands`.

---

## Slice H2: the Commits tab, the pinned row and the Files tab list styles

After H2, the section header holds the FILES / COMMITS tabs. The Commits tab lists HEAD's history with ref chips, bold first-parent rows and file-count badges; a click only selects a commit (H3 shows it). The Files tab gets collapsible group headers, a path filter and the Changes | Tree style. The P0 overlay and commit box do not change yet.
### step P1.4
Goal: persist `sourceControlTab`; add the header tabs, the filter button and input, the pinned row, the commit list and the Changes | Tree toggle, their DOM lookups, the theme-kind hook, and the styles with the git colour variables.

- files: `gui/src-tauri/src/settings.rs`, `gui/src/settings.ts`, `gui/index.html`, `gui/src/appDom.ts`, `gui/src/appLookups.ts`, `gui/src/style.css`

edit 1 (`settings.rs`) (struct):

old:
```rust
    #[serde(default)]
    pub source_control_open: bool,
}
```

new:
```rust
    #[serde(default)]
    pub source_control_open: bool,
    /// Git P1: the active Source Control tab, `"files"` or `"commits"`. A
    /// `String`, not an enum: an unknown value must not fail the whole file.
    #[serde(default = "default_source_control_tab")]
    pub source_control_tab: String,
}
```

edit 2 (`settings.rs`) (default functions):

old:
```rust
fn default_true() -> bool {
    true
}
```

new:
```rust
fn default_true() -> bool {
    true
}
fn default_source_control_tab() -> String {
    "files".to_string()
}
```

edit 3 (`settings.rs`) (`Default` impl):

old:
```rust
            source_control_open: false,
```

new:
```rust
            source_control_open: false,
            source_control_tab: default_source_control_tab(),
```

edit 4 (`settings.rs`) (test `partial_json_fills_in_defaults`):

old:
```rust
        assert!(!response.settings.source_control_open);
```

new:
```rust
        assert!(!response.settings.source_control_open);
        assert_eq!(response.settings.source_control_tab, "files");
```

edit 5 (`settings.ts`) (type; keep CRLF):

old:
```ts
export type AgentSort = "priority" | "server_order";
```

new:
```ts
export type AgentSort = "priority" | "server_order";
export type SourceControlTab = "files" | "commits";
```

edit 6 (`settings.ts`) (interface; keep CRLF):

old:
```ts
  sourceControlOpen: boolean;
}
```

new:
```ts
  sourceControlOpen: boolean;
  /** Git P1: the active Source Control tab. Any value but `"commits"` means Files. */
  sourceControlTab: SourceControlTab;
}
```

edit 7 (`settings.ts`) (defaults; keep CRLF):

old:
```ts
  sourceControlOpen: false,
};
```

new:
```ts
  sourceControlOpen: false,
  sourceControlTab: "files",
};
```

edit 8 (`index.html`) (header): the tablist replaces the label (counterintuitive 8), and a filter button joins Refresh. The tab text is `Files` / `Commits`; CSS uppercases it, so a screen reader does not spell out capitals.

old:
```html
            <span class="sidebar-header__label">SOURCE CONTROL</span>
            <span class="sidebar-header__spacer"></span>
            <button id="source-control-refresh" class="icon-btn" title="Refresh" aria-label="Refresh">
```

new:
```html
            <div class="sc-tabs" role="tablist" aria-label="Source Control">
              <button type="button" id="source-control-tab-files" class="sc-tab" role="tab" aria-selected="true">
                Files
              </button>
              <button type="button" id="source-control-tab-commits" class="sc-tab" role="tab" aria-selected="false">
                Commits
              </button>
            </div>
            <span class="sidebar-header__spacer"></span>
            <button
              id="source-control-filter-btn"
              class="icon-btn"
              title="Filter Files"
              aria-label="Filter Files"
              aria-pressed="false"
            >
              <i class="codicon codicon-filter"></i>
            </button>
            <button id="source-control-refresh" class="icon-btn" title="Refresh" aria-label="Refresh">
```

edit 9 (`index.html`) (filter input): hidden until the filter button opens it.

old:
```html
          <div id="source-control-branch" class="sc-branch" hidden></div>
```

new:
```html
          <div id="source-control-branch" class="sc-branch" hidden></div>
          <input
            id="source-control-filter"
            class="sc-filter"
            type="search"
            placeholder="Filter files"
            aria-label="Filter files"
            spellcheck="false"
            hidden
          />
```

edit 10 (`index.html`) (lists and toggle): the pinned row and the commit list go after the body and start hidden; `applyTab` (P1.6) shows them. The Changes | Tree toggle sits at the bottom of the Files tab.

old:
```html
          <div id="source-control-body"></div>
```

new:
```html
          <div id="source-control-body"></div>
          <div
            id="source-control-pinned"
            class="sc-row sc-commit-row sc-commit-row--pinned"
            tabindex="0"
            role="button"
            title="Show the working directory and the commit box"
            hidden
          ></div>
          <div id="source-control-commits" hidden></div>
          <div id="source-control-view-toggle" class="sc-view-toggle" role="group" aria-label="File list style">
            <button type="button" id="source-control-view-changes" class="sc-view-toggle__btn" aria-pressed="true">
              Changes
            </button>
            <button type="button" id="source-control-view-tree" class="sc-view-toggle__btn" aria-pressed="false">
              Tree
            </button>
          </div>
```

edit 11 (`appDom.ts`):

old:
```ts
export const sourceControlCommitBtn = document.getElementById("source-control-commit-btn") as HTMLButtonElement;
```

new:
```ts
export const sourceControlCommitBtn = document.getElementById("source-control-commit-btn") as HTMLButtonElement;
export const sourceControlTabFilesBtn = document.getElementById("source-control-tab-files") as HTMLButtonElement;
export const sourceControlTabCommitsBtn = document.getElementById("source-control-tab-commits") as HTMLButtonElement;
export const sourceControlFilterBtn = document.getElementById("source-control-filter-btn") as HTMLButtonElement;
export const sourceControlFilterEl = document.getElementById("source-control-filter") as HTMLInputElement;
export const sourceControlPinnedEl = document.getElementById("source-control-pinned") as HTMLDivElement;
export const sourceControlCommitsEl = document.getElementById("source-control-commits") as HTMLDivElement;
export const sourceControlViewToggleEl = document.getElementById("source-control-view-toggle") as HTMLDivElement;
export const sourceControlViewChangesBtn = document.getElementById("source-control-view-changes") as HTMLButtonElement;
export const sourceControlViewTreeBtn = document.getElementById("source-control-view-tree") as HTMLButtonElement;
```

edit 12 (`appLookups.ts`) (`applyCurrentTheme`): the hook for the light git colours.

old:
```ts
  const theme = applyThemeById(appState.themeRegistry, appState.settings.theme, document.documentElement.style);
```

new:
```ts
  const theme = applyThemeById(appState.themeRegistry, appState.settings.theme, document.documentElement.style);
  // Git P1: `:root[data-theme-kind="light"]` in style.css switches the git colours.
  document.documentElement.dataset.themeKind = theme.kind;
```

edit 13 (`style.css`) (hidden rules): `.sc-row`, `.icon-btn` and `.sc-view-toggle` set `display`, which beats the `hidden` attribute.

old:
```css
#source-control[hidden],
.sc-branch[hidden] {
```

new:
```css
#source-control[hidden],
#source-control-pinned[hidden],
#source-control-filter-btn[hidden],
.sc-filter[hidden],
.sc-view-toggle[hidden],
.sc-branch[hidden] {
```

edit 14 (`style.css`) (scroll): the commit list scrolls exactly like the body.

old:
```css
#source-control-body {
  flex: 0 1 auto;
```

new:
```css
#source-control-body,
#source-control-commits {
  flex: 0 1 auto;
```

edit 15 (`style.css`) (end of file): the last rule of the file. Append the H2 block: the git colour variables, the tabs, the commit rows, the chips and badge, and the Files tab styles.

old:
```css
.diff-view__note {
  padding: 8px 12px;
  color: var(--descriptionForeground);
}
```

new:
```css
.diff-view__note {
  padding: 8px 12px;
  color: var(--descriptionForeground);
}

/* ---------------------------------------------------------------------- */
/* Source Control history and list styles (git P1): the Files / Commits    */
/* tabs, the pinned row, the commit list, the filter and the Tree style.   */
/* ---------------------------------------------------------------------- */

/* Git colours the theme tables lack, from Sublime Merge's own theme
   (inventory section D). Dark values first; `applyCurrentTheme` sets
   `data-theme-kind`, and light themes take section D's light values. A
   "derived" value has no dark value in section D. The diff line tints stay
   on the theme's ANSI colours (P0). */
:root {
  --sc-lane-0: hsl(210, 65%, 70%);
  --sc-head-chip-fg: hsl(210, 40%, 12%); /* derived: white text fails on the dark lane colour */
  --sc-chip-bg: hsla(210, 30%, 70%, 0.15); /* derived */
  --sc-tag-bg: hsl(44, 100%, 60%);
  --sc-tag-fg: hsl(44, 100%, 20%);
  --sc-badge-add-bg: hsla(114, 40%, 50%, 0.3); /* derived */
  --sc-badge-del-bg: hsla(0, 40%, 55%, 0.3); /* derived */
  --sc-file-header-bg: hsl(210, 25%, 30%); /* derived */
  --sc-file-header-hover-bg: hsl(210, 25%, 34%); /* derived */
  --sc-file-header-untracked-bg: hsl(210, 8%, 30%); /* derived */
  --sc-file-header-unmerged-bg: hsl(32, 40%, 30%); /* derived */
  --sc-hunk-header-bg: hsl(210, 20%, 24%); /* derived */
}

:root[data-theme-kind="light"] {
  --sc-lane-0: hsl(210, 100%, 60%);
  --sc-head-chip-fg: #ffffff;
  --sc-chip-bg: hsla(210, 30%, 40%, 0.15);
  --sc-badge-add-bg: hsl(114, 40%, 83%);
  --sc-badge-del-bg: hsl(0, 40%, 83%);
  --sc-file-header-bg: hsl(210, 60%, 83%);
  --sc-file-header-hover-bg: hsl(210, 60%, 88%);
  --sc-file-header-untracked-bg: hsl(210, 10%, 83%);
  --sc-file-header-unmerged-bg: hsl(32, 60%, 83%);
  --sc-hunk-header-bg: hsl(210, 50%, 93%);
}

#source-control {
  container: source-control / inline-size;
}

.sc-tabs {
  display: flex;
  align-self: stretch;
  gap: 10px;
}

.sc-tab {
  padding: 0 2px;
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--descriptionForeground);
}

.sc-tab:hover,
.sc-tab[aria-selected="true"] {
  color: var(--sideBarSectionHeader-foreground);
}

.sc-tab[aria-selected="true"] {
  box-shadow: inset 0 -1px 0 var(--focusBorder);
}

.sc-commit-row {
  padding: 0 8px 0 12px;
}

.sc-commit-row.is-selected {
  background: var(--list-activeSelectionBackground);
  color: var(--list-activeSelectionForeground);
}

.sc-commit-row--pinned {
  flex-shrink: 0;
  border-bottom: 1px solid var(--sideBar-border);
}

.sc-commit-row__summary {
  flex: 1 1 0;
  min-width: 48px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sc-commit-row__summary--bold {
  font-weight: 600;
}

.sc-commit-row__action {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-style: italic;
  color: var(--descriptionForeground);
}

.sc-commit-row__author {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--fs-xs);
  font-style: italic;
  color: var(--descriptionForeground);
}

.sc-commit-row__date {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  color: var(--descriptionForeground);
}

.sc-commit-row.is-selected .sc-commit-row__author,
.sc-commit-row.is-selected .sc-commit-row__date,
.sc-commit-row.is-selected .sc-commit-row__action,
.sc-commit-row.is-selected .sc-badge {
  color: inherit;
}

/* A ref chip: a 4px left border in the lane colour; HEAD is filled with it. */
.sc-chip {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 4px;
  border-left: 4px solid var(--sc-lane-0);
  border-radius: 3px;
  background: var(--sc-chip-bg);
  font-size: var(--fs-xs);
  line-height: 16px;
  color: var(--foreground);
}

.sc-chip--head {
  background: var(--sc-lane-0);
  color: var(--sc-head-chip-fg);
}

.sc-chip--remote,
.sc-chip--other {
  border-left-width: 0;
  color: var(--descriptionForeground);
}

.sc-chip--tag {
  border-left-width: 0;
  background: var(--sc-tag-bg);
  color: var(--sc-tag-fg);
}

.sc-badge {
  flex-shrink: 0;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--sc-chip-bg);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--descriptionForeground);
}

/* Files tab: collapsible group headers, the filter and the Tree style. */

.sc-group-header {
  cursor: pointer;
}

.sc-group-header > .codicon,
.sc-row--folder > .codicon {
  flex-shrink: 0;
  font-size: 14px;
}

.sc-group-header__title {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sc-filter {
  flex-shrink: 0;
  margin: 0 12px 4px;
  padding: 2px 6px;
  border: 1px solid var(--menu-border);
  border-radius: 4px;
  background: var(--terminal-background);
  color: var(--terminal-foreground);
  font: inherit;
  font-size: var(--fs-xs);
}

.sc-view-toggle {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 4px 12px;
  border-top: 1px solid var(--sideBar-border);
}

.sc-view-toggle__btn {
  padding: 0 8px;
  border-radius: 3px;
  font-size: var(--fs-xs);
  color: var(--descriptionForeground);
}

.sc-view-toggle__btn:hover {
  color: var(--foreground);
}

.sc-view-toggle__btn[aria-pressed="true"] {
  background: var(--list-inactiveSelectionBackground);
  color: var(--foreground);
}

/* A narrow sidebar hides the author first; the summary and the date stay. */
@container source-control (max-width: 339px) {
  .sc-commit-row__author {
    display: none;
  }
}
```

- lines: edit 1 +4 −0 = 4; edit 2 +3 −0 = 3; edit 3 +1 −0 = 1; edit 4 +1 −0 = 1; edit 5 +1 −0 = 1; edit 6 +2 −0 = 2; edit 7 +1 −0 = 1; edit 8 +17 −1 = 18; edit 9 +9 −0 = 9; edit 10 +17 −0 = 17; edit 11 +9 −0 = 9; edit 12 +2 −0 = 2; edit 13 +4 −0 = 4; edit 14 +2 −1 = 3; edit 15 +229 −0 = 229.
- exec: `mechanical`. Exact text. The new DOM exports are unused until P1.6, which tsc allows for exports.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && echo TSC_OK && python -I -c "b=open('src/settings.ts','rb').read(); print('crlf-ok' if b.count(b'\n') == b.count(b'\r\n') else 'MIXED')" && cd src-tauri && cargo test -p herdr-gui --lib settings:: 2>&1 | grep 'test result'`
  Expected: `TSC_OK`, `crlf-ok`, then `test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 326 filtered out`.

### step P1.5
Goal: add the Commits tab renderer (pinned row, commit rows with ref chips, bold first-parent rows and the file badge, Load more, empty and error states) and its jsdom test.

- files: `gui/src/ui/commitList.ts` (new), `gui/tests/unit/ui/commitList.test.ts` (new)
  The test sits under `tests/unit/` for vitest to collect it, and starts with `// @vitest-environment jsdom`.

new file `gui/src/ui/commitList.ts`, full content:
```ts
// Git P1: the Commits tab of the Source Control section, a pinned "Commit
// Changes" row and one row per commit, plus the pure paging window, the ref
// chip rule and HEAD's first-parent chain. The fetching and the stale-page
// rule live in `appSourceControl.ts`. Summaries, names and refs come from the
// repo and are untrusted, so all text uses `textContent`.

import type { CommitRow, GitStatus } from "../git/gitApi";
import { formatAge } from "../notifications/statusAge";

export interface CommitListModel {
  /** `null` until the first page arrives. */
  rows: CommitRow[] | null;
  /** The selected commit, tinted; `null` when the working directory is selected. */
  selectedHash: string | null;
  /** The probe row came back (`historyWindow`), so git has more rows. */
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
  /** `Date.now()`, passed in so tests can pin it. */
  now: number;
}

export interface CommitListCallbacks {
  onSelectCommit(row: CommitRow): void;
  onLoadMore(): void;
}

export type RefChipKind = "head" | "branch" | "remote" | "tag" | "other";

export interface RefChip {
  label: string;
  kind: RefChipKind;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HISTORY_PAGE = 200;
/** `git_log`'s cap of 500 rows, minus the probe row. */
const MAX_KEEP = 499;

/** What to ask `git_log` for: the next page (`more`), or a re-read that keeps
 * the list length, so a status change does not cut it back to page 1. Ask for
 * `keep + 1` rows from `skip`: the probe row tells whether git has more. */
export function historyWindow(loadedCount: number, more: boolean): { skip: number; keep: number } {
  if (more) return { skip: loadedCount, keep: HISTORY_PAGE };
  // shortcut: a re-read keeps at most 499 rows, so a longer list shrinks; page the re-read if users load that far.
  return { skip: 0, keep: Math.min(MAX_KEEP, Math.max(HISTORY_PAGE, loadedCount)) };
}

/** One `%D` entry with a full ref name (`git_log` passes `--decorate=full`),
 * so a local branch named `origin/x` never looks like a remote one. */
export function refChip(ref: string): RefChip {
  if (ref === "HEAD") return { label: "HEAD", kind: "head" };
  if (ref.startsWith("HEAD -> ")) return { label: refChip(ref.slice("HEAD -> ".length)).label, kind: "head" };
  if (ref.startsWith("tag: refs/tags/")) return { label: ref.slice("tag: refs/tags/".length), kind: "tag" };
  if (ref.startsWith("refs/heads/")) return { label: ref.slice("refs/heads/".length), kind: "branch" };
  if (ref.startsWith("refs/remotes/")) return { label: ref.slice("refs/remotes/".length), kind: "remote" };
  return { label: ref, kind: "other" };
}

/** The hashes on HEAD's first-parent chain among `rows` (newest first): the
 * bold rows. A parent always comes after its child, so one pass follows
 * `parents[0]` down from the first row. */
export function firstParentChain(rows: readonly CommitRow[]): Set<string> {
  const chain = new Set<string>();
  let next = rows[0]?.hash;
  for (const row of rows) {
    if (row.hash !== next) continue;
    chain.add(row.hash);
    next = row.parents[0];
  }
  return chain;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** "now", "5m", "3h" or "2d" within a week, then a short local date. */
export function commitDateLabel(timestampSec: number, now: number): string {
  const ms = timestampSec * 1000;
  if (now - ms < WEEK_MS) return formatAge(Math.max(0, now - ms));
  const date = new Date(ms);
  return date.getFullYear() === new Date(now).getFullYear()
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** The pinned row: the working-directory state (unique changed paths, so an
 * `MM` file counts once) and the italic "Commit Changes". */
export function renderPinnedRow(pinnedEl: HTMLElement, status: GitStatus, selected: boolean): void {
  const n = new Set([...status.staged, ...status.unstaged].map((f) => f.path)).size;
  pinnedEl.textContent = "";
  pinnedEl.classList.toggle("is-selected", selected);
  pinnedEl.appendChild(el("span", "sc-commit-row__summary", n === 0 ? "No changes" : `${n} ${n === 1 ? "change" : "changes"}`));
  pinnedEl.appendChild(el("span", "sc-commit-row__action", "Commit Changes"));
}

/** Click, Enter and Space run `action`. */
function makeButton(rowEl: HTMLElement, action: () => void): void {
  rowEl.tabIndex = 0;
  rowEl.setAttribute("role", "button");
  rowEl.addEventListener("click", action);
  rowEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    action();
  });
}

function renderRow(row: CommitRow, model: CommitListModel, bold: boolean, callbacks: CommitListCallbacks): HTMLElement {
  const rowEl = el("div", "sc-row sc-commit-row");
  if (row.hash === model.selectedHash) rowEl.classList.add("is-selected");
  rowEl.dataset.hash = row.hash;
  const date = new Date(row.timestamp * 1000).toLocaleString();
  rowEl.title = `${row.shortHash} · ${row.author} <${row.authorEmail}> · ${date}\n${row.summary}`;
  makeButton(rowEl, () => callbacks.onSelectCommit(row));
  for (const ref of row.refs) {
    const chip = refChip(ref);
    const chipEl = el("span", `sc-chip sc-chip--${chip.kind}`, chip.label);
    chipEl.title = ref;
    rowEl.appendChild(chipEl);
  }
  const summary = el("span", "sc-commit-row__summary", row.summary);
  if (bold) summary.classList.add("sc-commit-row__summary--bold");
  rowEl.appendChild(summary);
  rowEl.appendChild(el("span", "sc-commit-row__author", row.author));
  if (row.files !== null) {
    const badge = el("span", "sc-badge", String(row.files));
    badge.title = `${row.files} ${row.files === 1 ? "file" : "files"} changed`;
    rowEl.appendChild(badge);
  }
  rowEl.appendChild(el("span", "sc-commit-row__date", commitDateLabel(row.timestamp, model.now)));
  return rowEl;
}

// shortcut: relative dates refresh only when the list re-renders (tab switch, Refresh, a new commit); add a minute timer if stale labels bother users.
export function renderCommitList(listEl: HTMLElement, model: CommitListModel, callbacks: CommitListCallbacks): void {
  const scrollTop = listEl.scrollTop;
  listEl.textContent = "";
  if (model.error !== null) listEl.appendChild(el("div", "sc-error", model.error));
  if (model.rows === null) return;
  if (model.rows.length === 0) listEl.appendChild(el("div", "sc-message", "No commits yet"));
  const chain = firstParentChain(model.rows);
  for (const row of model.rows) listEl.appendChild(renderRow(row, model, chain.has(row.hash), callbacks));
  if (model.loadingMore) {
    listEl.appendChild(el("div", "sc-row sc-row--more", "Loading…"));
  } else if (model.hasMore) {
    const more = el("div", "sc-row sc-link", "Load more");
    makeButton(more, callbacks.onLoadMore);
    listEl.appendChild(more);
  }
  listEl.scrollTop = scrollTop;
}
```

new file `gui/tests/unit/ui/commitList.test.ts`, full content:
```ts
// @vitest-environment jsdom
//
// Git P1: the Commits tab rows (chips, bold first-parent rows, file badge),
// Load more, the empty and error states, the date label, the paging window,
// and the pinned "Commit Changes" row.

import { describe, expect, it, vi } from "vitest";
import type { CommitRow, GitStatus } from "../../../src/git/gitApi";
import {
  commitDateLabel,
  firstParentChain,
  historyWindow,
  refChip,
  renderCommitList,
  renderPinnedRow,
  type CommitListModel,
} from "../../../src/ui/commitList";

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function row(over: Partial<CommitRow> = {}): CommitRow {
  return {
    hash: "a".repeat(40),
    shortHash: "aaaaaaa",
    parents: [],
    author: "Ada",
    authorEmail: "ada@example.com",
    timestamp: (NOW - 2 * 60 * 60 * 1000) / 1000,
    summary: "fix the parser",
    refs: [],
    files: 2,
    ...over,
  };
}

function model(over: Partial<CommitListModel> = {}): CommitListModel {
  return { rows: [], selectedHash: null, hasMore: false, loadingMore: false, error: null, now: NOW, ...over };
}

function callbacks() {
  return { onSelectCommit: vi.fn(), onLoadMore: vi.fn() };
}

function status(staged: string[], unstaged: string[]): GitStatus {
  const change = (path: string) => ({ path, origPath: null, kind: "modified" as const });
  return {
    repo: "C:/r",
    branch: "main",
    ahead: 0,
    behind: 0,
    unborn: false,
    staged: staged.map(change),
    unstaged: unstaged.map(change),
  };
}

function texts(root: HTMLElement, selector: string): string[] {
  return Array.from(root.querySelectorAll(selector), (n) => n.textContent ?? "");
}

describe("refChip", () => {
  it("names each kind of full ref and keeps a local origin/x a branch", () => {
    expect(refChip("HEAD -> refs/heads/main")).toEqual({ label: "main", kind: "head" });
    expect(refChip("HEAD")).toEqual({ label: "HEAD", kind: "head" });
    expect(refChip("refs/heads/origin/fake")).toEqual({ label: "origin/fake", kind: "branch" });
    expect(refChip("refs/remotes/origin/main")).toEqual({ label: "origin/main", kind: "remote" });
    expect(refChip("tag: refs/tags/v1")).toEqual({ label: "v1", kind: "tag" });
    expect(refChip("refs/notes/x")).toEqual({ label: "refs/notes/x", kind: "other" });
  });
});

describe("firstParentChain", () => {
  it("follows first parents from the top row and skips merged side commits", () => {
    const rows = [
      row({ hash: "m", parents: ["b", "f"] }),
      row({ hash: "f", parents: ["a"] }),
      row({ hash: "b", parents: ["a"] }),
      row({ hash: "a", parents: [] }),
    ];
    expect([...firstParentChain(rows)]).toEqual(["m", "b", "a"]);
    expect(firstParentChain([]).size).toBe(0);
  });
});

describe("renderCommitList", () => {
  it("renders chips by kind, the summary, author, file badge and relative date", () => {
    const list = document.createElement("div");
    const rows = [
      row({ refs: ["HEAD -> refs/heads/main", "refs/remotes/origin/main", "tag: refs/tags/v1"] }),
      row({ hash: "b".repeat(40), summary: "add tests", files: null }),
    ];
    renderCommitList(list, model({ rows }), callbacks());
    expect(list.querySelectorAll(".sc-commit-row")).toHaveLength(2);
    expect(texts(list, ".sc-chip")).toEqual(["main", "origin/main", "v1"]);
    expect(Array.from(list.querySelectorAll(".sc-chip"), (c) => c.className)).toEqual([
      "sc-chip sc-chip--head",
      "sc-chip sc-chip--remote",
      "sc-chip sc-chip--tag",
    ]);
    expect(texts(list, ".sc-commit-row__summary")).toEqual(["fix the parser", "add tests"]);
    expect(texts(list, ".sc-commit-row__author")).toEqual(["Ada", "Ada"]);
    expect(texts(list, ".sc-badge")).toEqual(["2"]);
    expect(texts(list, ".sc-commit-row__date")).toEqual(["2h", "2h"]);
  });

  it("bolds only the first-parent chain from the top row", () => {
    const list = document.createElement("div");
    const rows = [row({ hash: "m", parents: ["b", "f"] }), row({ hash: "f", parents: ["b"] }), row({ hash: "b" })];
    renderCommitList(list, model({ rows }), callbacks());
    const bold = Array.from(list.querySelectorAll(".sc-commit-row__summary"), (n) =>
      n.classList.contains("sc-commit-row__summary--bold"),
    );
    expect(bold).toEqual([true, false, true]);
  });

  it("tints the selected row and selects a commit on click and on Enter", () => {
    const list = document.createElement("div");
    const cb = callbacks();
    const second = row({ hash: "b".repeat(40) });
    renderCommitList(list, model({ rows: [row(), second], selectedHash: second.hash }), cb);
    const rowEls = list.querySelectorAll<HTMLElement>(".sc-commit-row");
    expect(rowEls[0].classList.contains("is-selected")).toBe(false);
    expect(rowEls[1].classList.contains("is-selected")).toBe(true);
    rowEls[1].click();
    rowEls[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(cb.onSelectCommit).toHaveBeenCalledTimes(2);
    expect(cb.onSelectCommit).toHaveBeenCalledWith(second);
  });

  it("shows Load more only while hasMore, and Loading… while a page loads", () => {
    const list = document.createElement("div");
    const cb = callbacks();
    renderCommitList(list, model({ rows: [row()] }), cb);
    expect(list.textContent).not.toContain("Load more");
    renderCommitList(list, model({ rows: [row()], hasMore: true }), cb);
    const more = Array.from(list.querySelectorAll<HTMLElement>(".sc-link")).find((n) => n.textContent === "Load more");
    more?.click();
    expect(cb.onLoadMore).toHaveBeenCalledTimes(1);
    renderCommitList(list, model({ rows: [row()], hasMore: true, loadingMore: true }), cb);
    expect(list.textContent).toContain("Loading…");
    expect(list.textContent).not.toContain("Load more");
  });

  it("shows nothing before the first page, No commits yet for an empty history, and the error line first", () => {
    const list = document.createElement("div");
    renderCommitList(list, model({ rows: null }), callbacks());
    expect(list.childElementCount).toBe(0);
    renderCommitList(list, model({ rows: [] }), callbacks());
    expect(list.textContent).toBe("No commits yet");
    renderCommitList(list, model({ rows: [row()], error: "git timed out after 15s" }), callbacks());
    expect(list.firstElementChild?.className).toBe("sc-error");
    expect(list.firstElementChild?.textContent).toBe("git timed out after 15s");
  });

  it("keeps untrusted summaries and refs as text", () => {
    const list = document.createElement("div");
    const evil = '<img src=x onerror="alert(1)">';
    renderCommitList(list, model({ rows: [row({ summary: evil, refs: [`refs/heads/${evil}`] })] }), callbacks());
    expect(list.querySelector("img")).toBeNull();
    expect(texts(list, ".sc-commit-row__summary")).toEqual([evil]);
    expect(texts(list, ".sc-chip")).toEqual([evil]);
  });
});

describe("commitDateLabel", () => {
  it("is relative within a week and a short local date after", () => {
    expect(commitDateLabel(NOW / 1000 - 30, NOW)).toBe("now");
    expect(commitDateLabel(NOW / 1000 + 3600, NOW)).toBe("now");
    expect(commitDateLabel((NOW - 2 * DAY) / 1000, NOW)).toBe("2d");
    const tenDays = new Date(NOW - 10 * DAY);
    expect(commitDateLabel(tenDays.getTime() / 1000, NOW)).toBe(
      tenDays.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    );
    const lastYear = new Date(NOW - 400 * DAY);
    expect(commitDateLabel(lastYear.getTime() / 1000, NOW)).toBe(
      lastYear.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    );
  });
});

describe("historyWindow", () => {
  it("asks for the next page, or re-reads every loaded row up to 499", () => {
    expect(historyWindow(0, false)).toEqual({ skip: 0, keep: 200 });
    expect(historyWindow(255, false)).toEqual({ skip: 0, keep: 255 });
    expect(historyWindow(600, false)).toEqual({ skip: 0, keep: 499 });
    expect(historyWindow(200, true)).toEqual({ skip: 200, keep: 200 });
  });
});

describe("renderPinnedRow", () => {
  it("counts unique changed paths, always offers Commit Changes, and tints when selected", () => {
    const pinned = document.createElement("div");
    renderPinnedRow(pinned, status(["a.txt"], ["a.txt", "b.txt"]), false);
    expect(texts(pinned, ".sc-commit-row__summary")).toEqual(["2 changes"]);
    expect(texts(pinned, ".sc-commit-row__action")).toEqual(["Commit Changes"]);
    expect(pinned.classList.contains("is-selected")).toBe(false);
    renderPinnedRow(pinned, status([], ["a.txt"]), true);
    expect(texts(pinned, ".sc-commit-row__summary")).toEqual(["1 change"]);
    expect(pinned.classList.contains("is-selected")).toBe(true);
    renderPinnedRow(pinned, status([], []), true);
    expect(texts(pinned, ".sc-commit-row__summary")).toEqual(["No changes"]);
    expect(texts(pinned, ".sc-commit-row__action")).toEqual(["Commit Changes"]);
  });
});
```

- lines: `commitList.ts` 160 (new file); `commitList.test.ts` 205 (new file).
- exec: `judgment`. New files; the content is verbatim, so no choice is left.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run tests/unit/ui/commitList.test.ts 2>&1 | grep -E 'Test Files|Tests '`
  Expected: tsc silent, `Test Files  1 passed (1)`, `Tests  11 passed (11)`.

### step P1.6
Goal: wire the tabs, the pinned row and the history paging (stale pages dropped by a seq counter) into the orchestration. A click on a commit only selects it until H3.

- files: `gui/src/appSourceControl.ts`
- Trigger map for a history load (`loadHistory(false)` = re-read, `loadHistory(true)` = next page):
  - the Commits tab opens (`setTab`), or the section opens on that tab (`applySourceControlVisibility`);
  - a status result changed (`onResult`); this covers a commit from the GUI or a terminal, a checkout and a pull;
  - Refresh;
  - "Load more" (next page).
  A workspace change clears the history and bumps `historySeq`, so a late page from the old repo is dropped.

edit 1 (`appSourceControl.ts`) (imports):

old:
```ts
  sourceControlCommitEl,
  sourceControlEl,
  sourceControlMessageEl,
  sourceControlRefreshBtn,
} from "./appDom";
import { currentThemeDef } from "./appLookups";
import { appState } from "./appState";
import type { RawSnapshot } from "./appTypes";
import { gitCommit, gitDiff, gitStage, gitStatus, gitUnstage, type FileChange, type GitDiff, type GitStatus } from "./git/gitApi";
import { createStatusRefresher, followOpenDiff, type OpenDiffRef } from "./git/statusRefresh";
import { focusKeyboardCapture } from "./keyboard/focusCapture";
import { IS_MAC } from "./shortcuts";
import { renderDiffView } from "./ui/diffView";
```

new:
```ts
  sourceControlCommitEl,
  sourceControlCommitsEl,
  sourceControlEl,
  sourceControlMessageEl,
  sourceControlPinnedEl,
  sourceControlRefreshBtn,
  sourceControlTabCommitsBtn,
  sourceControlTabFilesBtn,
} from "./appDom";
import { currentThemeDef } from "./appLookups";
import { appState, persistSettings } from "./appState";
import type { RawSnapshot } from "./appTypes";
import {
  gitCommit,
  gitDiff,
  gitLog,
  gitStage,
  gitStatus,
  gitUnstage,
  type CommitRow,
  type FileChange,
  type GitDiff,
  type GitStatus,
} from "./git/gitApi";
import { createStatusRefresher, followOpenDiff, type OpenDiffRef } from "./git/statusRefresh";
import { focusKeyboardCapture } from "./keyboard/focusCapture";
import type { SourceControlTab } from "./settings";
import { IS_MAC } from "./shortcuts";
import { historyWindow, renderCommitList, renderPinnedRow } from "./ui/commitList";
import { renderDiffView } from "./ui/diffView";
```

edit 2 (`appSourceControl.ts`) (state):

old:
```ts
let committing = false;
```

new:
```ts
let committing = false;
// History (git P1).
let historyRows: CommitRow[] | null = null; // null until the first page arrives
let historyHasMore = false;
let historyLoadingMore = false;
let historyError: string | null = null;
let historySeq = 0; // drops stale history pages, like diffSeq
let selectedHash: string | null = null;
```

edit 3 (`appSourceControl.ts`) (history functions before `updateCommitBox`): the commit box hides on the Commits tab.

old:
```ts
function updateCommitBox(): void {
  sourceControlCommitEl.hidden = view.kind !== "status";
```

new:
```ts
/** The Commits tab shows history only for a repo; otherwise the body shows its message. */
function showHistory(): boolean {
  return appState.settings.sourceControlTab === "commits" && view.kind === "status";
}

/** The tab buttons, which list is visible, and the pinned row. */
function applyTab(): void {
  const commits = appState.settings.sourceControlTab === "commits";
  sourceControlTabFilesBtn.setAttribute("aria-selected", String(!commits));
  sourceControlTabCommitsBtn.setAttribute("aria-selected", String(commits));
  const shown = showHistory();
  sourceControlBodyEl.hidden = shown;
  sourceControlPinnedEl.hidden = !shown;
  sourceControlCommitsEl.hidden = !shown;
  if (view.kind === "status") renderPinnedRow(sourceControlPinnedEl, view.status, false);
}

function setTab(tab: SourceControlTab): void {
  if (appState.settings.sourceControlTab === tab) return;
  appState.settings.sourceControlTab = tab;
  persistSettings();
  applyTab();
  updateCommitBox();
  if (showHistory()) {
    renderHistory(); // fresh relative dates
    void loadHistory(false);
  }
}

function renderHistory(): void {
  renderCommitList(
    sourceControlCommitsEl,
    {
      rows: historyRows,
      selectedHash,
      hasMore: historyHasMore,
      loadingMore: historyLoadingMore,
      error: historyError,
      now: Date.now(),
    },
    { onSelectCommit: selectCommit, onLoadMore: () => void loadHistory(true) },
  );
}

function selectCommit(row: CommitRow): void {
  selectedHash = row.hash;
  renderHistory();
}

/** `more` loads the next page; otherwise it re-reads the loaded rows (`historyWindow`). */
async function loadHistory(more: boolean): Promise<void> {
  const repo = currentRepo();
  if (repo === null) return;
  const seq = ++historySeq; // the newest request wins; an older page is dropped
  const loaded = historyRows ?? [];
  const { skip, keep } = historyWindow(loaded.length, more);
  if (more) {
    historyLoadingMore = true;
    renderHistory();
  }
  try {
    const rows = await gitLog(repo, skip, keep + 1); // one probe row past `keep`
    if (seq !== historySeq) return;
    const page = rows.slice(0, keep);
    const next = more ? loaded.concat(page) : page;
    const hasMore = rows.length > keep;
    // Every status change re-reads history; skip the rebuild when nothing changed, so row focus survives.
    const changed =
      more || historyError !== null || hasMore !== historyHasMore || JSON.stringify(next) !== JSON.stringify(historyRows);
    historyRows = next;
    historyHasMore = hasMore;
    historyLoadingMore = false;
    historyError = null;
    if (changed) renderHistory();
  } catch (err) {
    if (seq !== historySeq) return;
    historyLoadingMore = false;
    historyError = errorMessage(err); // inline, like poll errors: these loads also run on every status change
    renderHistory();
  }
}

function updateCommitBox(): void {
  sourceControlCommitEl.hidden = view.kind !== "status" || showHistory();
```

edit 4 (`appSourceControl.ts`) (end of `render`):

old:
```ts
  });
  updateCommitBox();
}
```

new:
```ts
  });
  applyTab();
  updateCommitBox();
}
```

edit 5 (`appSourceControl.ts`) (`onResult`):

old:
```ts
    view = status.repo === null ? { kind: "notRepo", cwd } : { kind: "status", status };
    render();
```

new:
```ts
    view = status.repo === null ? { kind: "notRepo", cwd } : { kind: "status", status };
    render();
    if (showHistory()) void loadHistory(false); // a changed status can mean a moved HEAD
```

edit 6 (`appSourceControl.ts`) (`onSnapshot`):

old:
```ts
  activeCwd = cwd;
  closeDiff();
```

new:
```ts
  activeCwd = cwd;
  closeDiff();
  historyRows = null;
  historyHasMore = false;
  historyLoadingMore = false;
  historyError = null;
  selectedHash = null;
  ++historySeq;
  renderHistory(); // clears the old repo's rows before the new status shows the list
```

edit 7 (`appSourceControl.ts`) (`applySourceControlVisibility`): reopening the section with an unchanged status calls no `onResult`, so it loads history itself.

old:
```ts
  if (isActive()) {
    render();
    refresher.request();
  }
```

new:
```ts
  if (isActive()) {
    render();
    refresher.request();
    if (showHistory()) void loadHistory(false);
  }
```

edit 8 (`appSourceControl.ts`) (`initSourceControl`): Refresh also re-reads history; the tab buttons and the pinned row get their listeners once (static elements). Until H3, the pinned row opens the Files tab and focuses the commit box.

old:
```ts
  sourceControlRefreshBtn.addEventListener("click", () => refresher.request());
```

new:
```ts
  sourceControlRefreshBtn.addEventListener("click", () => {
    refresher.request();
    if (showHistory()) void loadHistory(false);
  });
  sourceControlTabFilesBtn.addEventListener("click", () => setTab("files"));
  sourceControlTabCommitsBtn.addEventListener("click", () => setTab("commits"));
  const openFilesTab = () => {
    setTab("files");
    sourceControlMessageEl.focus();
  };
  sourceControlPinnedEl.addEventListener("click", openFilesTab);
  sourceControlPinnedEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openFilesTab();
  });
```

- lines: edit 1 +19 −2 = 21; edit 2 +7 −0 = 7; edit 3 +83 −1 = 84; edit 4 +1 −0 = 1; edit 5 +1 −0 = 1; edit 6 +7 −0 = 7; edit 7 +1 −0 = 1; edit 8 +16 −1 = 17.
- exec: `mechanical`. Exact text.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run 2>&1 | grep -E 'Test Files|Tests '`
  Expected: tsc silent, `Test Files  69 passed (69)`, `Tests  839 passed (839)`.

### step P1.7
Goal: add the Files tab list options: collapsible group headers, the path filter and the Changes | Tree style, with a pure tree builder, two tests, and the wiring.

- files: `gui/src/git/fileTree.ts` (new), `gui/tests/unit/git/fileTree.test.ts` (new), `gui/src/ui/sourceControl.ts`, `gui/tests/unit/ui/sourceControl.test.ts` (new), `gui/src/appSourceControl.ts`
- Collapse state, the filter and the list style are module state in `appSourceControl.ts`; the renderer gets them as one `FilesView`.
- Space on a group header or a folder row toggles it: the row's own key handler, not a panel key (counterintuitive 19).

edit 1 (`sourceControl.ts`) (imports):

old:
```ts
import type { ChangeKind, FileChange, GitStatus } from "../git/gitApi";
```

new:
```ts
import { fileTree, type TreeRow } from "../git/fileTree";
import type { ChangeKind, FileChange, GitStatus } from "../git/gitApi";
```

edit 2 (`sourceControl.ts`) (callbacks and list options):

old:
```ts
  onUnstage(files: FileChange[]): void;
}

export const MAX_ROWS_PER_GROUP = 500;
```

new:
```ts
  onUnstage(files: FileChange[]): void;
  /** A group title, or `<group title>/<folder path>` for a Tree folder. */
  onToggleCollapsed(key: string): void;
}

/** The Files tab's list options (git P1). */
export interface FilesView {
  /** Lowercase path filter; `""` shows every row. */
  filter: string;
  /** Tree style: rows under their folders, indented. */
  tree: boolean;
  /** Collapsed group titles and Tree folders (`onToggleCollapsed` keys). */
  collapsed: ReadonlySet<string>;
}

export const MAX_ROWS_PER_GROUP = 500;
/** Tree indent per level, and the flat row's left padding. */
const INDENT_PX = 12;
const ROW_PAD_PX = 20;
```

edit 3 (`sourceControl.ts`) (`renderRow` and its helpers):

old:
```ts
function renderRow(
  change: FileChange,
  staged: boolean,
  colors: ThemeColors,
  callbacks: SourceControlCallbacks,
): HTMLElement {
  const row = el("div", "sc-row");
```

new:
```ts
/** A collapsible header or folder row: click, Enter and Space toggle it. */
function makeToggle(node: HTMLElement, expanded: boolean, onToggle: () => void): void {
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-expanded", String(expanded));
  node.addEventListener("click", onToggle);
  node.addEventListener("keydown", (event) => {
    if (event.target !== node || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onToggle();
  });
}

function renderFolder(folder: Extract<TreeRow, { kind: "folder" }>, group: string, callbacks: SourceControlCallbacks): HTMLElement {
  const row = el("div", "sc-row sc-row--folder");
  row.style.paddingLeft = `${ROW_PAD_PX + folder.depth * INDENT_PX}px`;
  row.title = folder.path;
  makeToggle(row, !folder.collapsed, () => callbacks.onToggleCollapsed(`${group}/${folder.path}`));
  row.appendChild(el("i", `codicon codicon-chevron-${folder.collapsed ? "right" : "down"}`));
  row.appendChild(el("span", "sc-row__name", folder.name));
  return row;
}

/** `depth` is set in the Tree style: the row is indented and shows no folder. */
function renderRow(
  change: FileChange,
  staged: boolean,
  colors: ThemeColors,
  callbacks: SourceControlCallbacks,
  depth: number | null,
): HTMLElement {
  const row = el("div", "sc-row");
  if (depth !== null) row.style.paddingLeft = `${ROW_PAD_PX + depth * INDENT_PX}px`;
```

edit 4 (`sourceControl.ts`) (folder text):

old:
```ts
  row.appendChild(el("span", "sc-row__dir", slash >= 0 ? change.path.slice(0, slash) : ""));
  if (change.kind !== "conflicted") {
```

new:
```ts
  row.appendChild(el("span", "sc-row__dir", depth === null && slash >= 0 ? change.path.slice(0, slash) : ""));
  if (change.kind !== "conflicted") {
```

edit 5 (`sourceControl.ts`) (group header):

old:
```ts
  staged: boolean,
  colors: ThemeColors,
  callbacks: SourceControlCallbacks,
): void {
  if (changes.length === 0) return;
  const header = el("div", "sc-group-header");
  header.appendChild(el("span", "sc-group-header__title", `${title} (${changes.length})`));
```

new:
```ts
  staged: boolean,
  colors: ThemeColors,
  files: FilesView,
  callbacks: SourceControlCallbacks,
): void {
  if (changes.length === 0) return;
  const collapsed = files.collapsed.has(title);
  const header = el("div", "sc-group-header");
  makeToggle(header, !collapsed, () => callbacks.onToggleCollapsed(title));
  header.appendChild(el("i", `codicon codicon-chevron-${collapsed ? "right" : "down"}`));
  header.appendChild(el("span", "sc-group-header__title", `${title} (${changes.length})`));
```

edit 6 (`sourceControl.ts`) (group rows): the filter, then the cap, then the flat or Tree rows.

old:
```ts
  bodyEl.appendChild(header);
  // shortcut: no virtual list; add one if repos with more than 500 changes turn out to be common.
  for (const change of changes.slice(0, MAX_ROWS_PER_GROUP)) {
    bodyEl.appendChild(renderRow(change, staged, colors, callbacks));
  }
  if (changes.length > MAX_ROWS_PER_GROUP) {
    bodyEl.appendChild(el("div", "sc-row sc-row--more", `and ${changes.length - MAX_ROWS_PER_GROUP} more`));
  }
}
```

new:
```ts
  bodyEl.appendChild(header);
  if (collapsed) return;
  const matching = files.filter === "" ? changes : changes.filter((c) => c.path.toLowerCase().includes(files.filter));
  // shortcut: no virtual list; add one if repos with more than 500 changes turn out to be common.
  const shown = matching.slice(0, MAX_ROWS_PER_GROUP);
  const rows: TreeRow[] = files.tree
    ? fileTree(shown, (path) => files.collapsed.has(`${title}/${path}`))
    : shown.map((change) => ({ kind: "file", change, depth: 0 }));
  for (const row of rows) {
    bodyEl.appendChild(
      row.kind === "folder"
        ? renderFolder(row, title, callbacks)
        : renderRow(row.change, staged, colors, callbacks, files.tree ? row.depth : null),
    );
  }
  if (matching.length > MAX_ROWS_PER_GROUP) {
    bodyEl.appendChild(el("div", "sc-row sc-row--more", `and ${matching.length - MAX_ROWS_PER_GROUP} more`));
  }
}
```

edit 7 (`sourceControl.ts`) (`renderSourceControl` signature):

old:
```ts
  error: string | null,
  colors: ThemeColors,
  callbacks: SourceControlCallbacks,
): void {
  renderBranch(branchEl, view);
```

new:
```ts
  error: string | null,
  colors: ThemeColors,
  files: FilesView,
  callbacks: SourceControlCallbacks,
): void {
  renderBranch(branchEl, view);
```

edit 8 (`sourceControl.ts`) (group calls):

old:
```ts
      renderGroup(bodyEl, "Staged Changes", staged, true, colors, callbacks);
      renderGroup(bodyEl, "Changes", unstaged, false, colors, callbacks);
```

new:
```ts
      renderGroup(bodyEl, "Staged Changes", staged, true, colors, files, callbacks);
      renderGroup(bodyEl, "Changes", unstaged, false, colors, files, callbacks);
```

edit 9 (`appSourceControl.ts`) (imports):

old:
```ts
  sourceControlEl,
  sourceControlMessageEl,
  sourceControlPinnedEl,
  sourceControlRefreshBtn,
  sourceControlTabCommitsBtn,
  sourceControlTabFilesBtn,
} from "./appDom";
```

new:
```ts
  sourceControlEl,
  sourceControlFilterBtn,
  sourceControlFilterEl,
  sourceControlMessageEl,
  sourceControlPinnedEl,
  sourceControlRefreshBtn,
  sourceControlTabCommitsBtn,
  sourceControlTabFilesBtn,
  sourceControlViewChangesBtn,
  sourceControlViewToggleEl,
  sourceControlViewTreeBtn,
} from "./appDom";
```

edit 10 (`appSourceControl.ts`) (imports):

old:
```ts
import { renderSourceControl, type SourceControlView } from "./ui/sourceControl";
```

new:
```ts
import { renderSourceControl, type FilesView, type SourceControlView } from "./ui/sourceControl";
```

edit 11 (`appSourceControl.ts`) (state):

old:
```ts
let selectedHash: string | null = null;
```

new:
```ts
let selectedHash: string | null = null;
// Files tab list options (git P1); the filter text lives in its input.
let filterOpen = false;
// shortcut: the Changes | Tree choice resets on restart; persist it like sourceControlTab if users ask.
let treeView = false;
const collapsed = new Set<string>(); // group titles and `<group>/<folder>` keys
```

edit 12 (`appSourceControl.ts`) (`render`):

old:
```ts
function render(): void {
  renderSourceControl(sourceControlBranchEl, sourceControlBodyEl, view, pollError, currentThemeDef().colors, {
```

new:
```ts
function filesView(): FilesView {
  return { filter: filterOpen ? sourceControlFilterEl.value.trim().toLowerCase() : "", tree: treeView, collapsed };
}

function toggleCollapsed(key: string): void {
  if (!collapsed.delete(key)) collapsed.add(key);
  render();
}

function render(): void {
  renderSourceControl(sourceControlBranchEl, sourceControlBodyEl, view, pollError, currentThemeDef().colors, filesView(), {
```

edit 13 (`appSourceControl.ts`) (`render` callbacks):

old:
```ts
    onOpenFile: openFile,
```

new:
```ts
    onOpenFile: openFile,
    onToggleCollapsed: toggleCollapsed,
```

edit 14 (`appSourceControl.ts`) (`applyTab`): the filter and the toggle belong to the Files tab.

old:
```ts
  sourceControlCommitsEl.hidden = !shown;
  if (view.kind === "status") renderPinnedRow(sourceControlPinnedEl, view.status, false);
```

new:
```ts
  sourceControlCommitsEl.hidden = !shown;
  sourceControlFilterBtn.hidden = commits;
  sourceControlFilterBtn.setAttribute("aria-pressed", String(filterOpen));
  sourceControlFilterEl.hidden = commits || !filterOpen;
  sourceControlViewToggleEl.hidden = commits || view.kind !== "status";
  sourceControlViewChangesBtn.setAttribute("aria-pressed", String(!treeView));
  sourceControlViewTreeBtn.setAttribute("aria-pressed", String(treeView));
  if (view.kind === "status") renderPinnedRow(sourceControlPinnedEl, view.status, false);
```

edit 15 (`appSourceControl.ts`) (`initSourceControl`): Esc in the filter closes only the filter (the innermost Esc).

old:
```ts
  sourceControlTabCommitsBtn.addEventListener("click", () => setTab("commits"));
```

new:
```ts
  sourceControlTabCommitsBtn.addEventListener("click", () => setTab("commits"));
  sourceControlFilterBtn.addEventListener("click", () => {
    filterOpen = !filterOpen;
    if (!filterOpen) sourceControlFilterEl.value = "";
    render();
    if (filterOpen) sourceControlFilterEl.focus();
  });
  sourceControlFilterEl.addEventListener("input", render);
  sourceControlFilterEl.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    filterOpen = false;
    sourceControlFilterEl.value = "";
    render();
    sourceControlFilterBtn.focus();
  });
  const setTreeView = (tree: boolean) => {
    treeView = tree;
    render();
  };
  sourceControlViewChangesBtn.addEventListener("click", () => setTreeView(false));
  sourceControlViewTreeBtn.addEventListener("click", () => setTreeView(true));
```

new file `gui/src/git/fileTree.ts`, full content:
```ts
// Git P1: the rows of the Files tab's Tree style. Pure, so its test needs
// no DOM.

import type { FileChange } from "./gitApi";

export type TreeRow =
  | { kind: "folder"; path: string; name: string; depth: number; collapsed: boolean }
  | { kind: "file"; change: FileChange; depth: number };

interface Folder {
  folders: Map<string, Folder>;
  files: FileChange[];
}

/** At each level, folders (by name) then files (in input order). A collapsed
 * folder keeps its own row and hides every row under it. */
export function fileTree(changes: readonly FileChange[], isCollapsed: (folderPath: string) => boolean): TreeRow[] {
  const root: Folder = { folders: new Map(), files: [] };
  for (const change of changes) {
    let folder = root;
    for (const name of change.path.split("/").slice(0, -1)) {
      let next = folder.folders.get(name);
      if (!next) {
        next = { folders: new Map(), files: [] };
        folder.folders.set(name, next);
      }
      folder = next;
    }
    folder.files.push(change);
  }
  const rows: TreeRow[] = [];
  const walk = (folder: Folder, prefix: string, depth: number): void => {
    for (const name of [...folder.folders.keys()].sort()) {
      const path = prefix + name;
      const collapsed = isCollapsed(path);
      rows.push({ kind: "folder", path, name, depth, collapsed });
      if (!collapsed) walk(folder.folders.get(name)!, `${path}/`, depth + 1);
    }
    for (const change of folder.files) rows.push({ kind: "file", change, depth });
  };
  walk(root, "", 0);
  return rows;
}
```

new file `gui/tests/unit/git/fileTree.test.ts`, full content:
```ts
// Git P1: the Files tab's Tree rows.

import { describe, expect, it } from "vitest";
import { fileTree, type TreeRow } from "../../../src/git/fileTree";

const change = (path: string) => ({ path, origPath: null, kind: "modified" as const });

function labels(rows: TreeRow[]): string[] {
  return rows.map((r) => `${"  ".repeat(r.depth)}${r.kind === "folder" ? `${r.name}/` : r.change.path}`);
}

describe("fileTree", () => {
  it("lists folders by name before files, each level one step deeper", () => {
    const rows = fileTree([change("README.md"), change("src/b.ts"), change("docs/x.md"), change("src/ui/a.ts")], () => false);
    expect(labels(rows)).toEqual(["docs/", "  docs/x.md", "src/", "  ui/", "    src/ui/a.ts", "  src/b.ts", "README.md"]);
    expect(rows[2]).toEqual({ kind: "folder", path: "src", name: "src", depth: 0, collapsed: false });
    expect(rows[3]).toMatchObject({ kind: "folder", path: "src/ui", depth: 1 });
  });

  it("keeps a collapsed folder's row and hides everything under it", () => {
    const rows = fileTree([change("src/ui/a.ts"), change("src/b.ts"), change("c.ts")], (path) => path === "src");
    expect(labels(rows)).toEqual(["src/", "c.ts"]);
    expect(rows[0]).toMatchObject({ kind: "folder", collapsed: true });
  });

  it("gives an empty list for no changes", () => {
    expect(fileTree([], () => false)).toEqual([]);
  });
});
```

new file `gui/tests/unit/ui/sourceControl.test.ts`, full content:
```ts
// @vitest-environment jsdom
//
// Git P1: the Files tab list options of the Source Control section:
// collapsible group headers, the path filter and the Tree style.

import { describe, expect, it, vi } from "vitest";
import type { FileChange, GitStatus } from "../../../src/git/gitApi";
import { renderSourceControl, type FilesView } from "../../../src/ui/sourceControl";

const change = (path: string): FileChange => ({ path, origPath: null, kind: "modified" });

function status(unstaged: string[]): GitStatus {
  return { repo: "C:/r", branch: "main", ahead: 0, behind: 0, unborn: false, staged: [], unstaged: unstaged.map(change) };
}

function callbacks() {
  return { onOpenGitDownload: vi.fn(), onOpenFile: vi.fn(), onStage: vi.fn(), onUnstage: vi.fn(), onToggleCollapsed: vi.fn() };
}

function render(unstaged: string[], files: Partial<FilesView>, cb = callbacks()): HTMLElement {
  const body = document.createElement("div");
  const view = { kind: "status" as const, status: status(unstaged) };
  renderSourceControl(document.createElement("div"), body, view, null, {}, { filter: "", tree: false, collapsed: new Set(), ...files }, cb);
  return body;
}

function names(body: HTMLElement): string[] {
  return Array.from(body.querySelectorAll(".sc-row__name"), (n) => n.textContent ?? "");
}

describe("renderSourceControl Files tab options", () => {
  it("collapses a group to its header, and a header click or Enter toggles it", () => {
    const cb = callbacks();
    const body = render(["a.txt"], { collapsed: new Set(["Changes"]) }, cb);
    const header = body.querySelector<HTMLElement>(".sc-group-header")!;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.querySelector(".codicon-chevron-right")).not.toBeNull();
    expect(body.querySelectorAll(".sc-row")).toHaveLength(0);
    header.click();
    header.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(cb.onToggleCollapsed.mock.calls).toEqual([["Changes"], ["Changes"]]);
  });

  it("does not toggle the group when Stage All is clicked", () => {
    const cb = callbacks();
    const body = render(["a.txt"], {}, cb);
    body.querySelector<HTMLButtonElement>('.sc-group-header button[aria-label="Stage All Changes"]')!.click();
    expect(cb.onStage).toHaveBeenCalledTimes(1);
    expect(cb.onToggleCollapsed).not.toHaveBeenCalled();
  });

  it("filters rows by a lowercase path substring and keeps the full count in the header", () => {
    const body = render(["src/App.ts", "docs/b.md", "src/app.css"], { filter: "app" });
    expect(names(body)).toEqual(["App.ts", "app.css"]);
    expect(body.querySelector(".sc-group-header__title")?.textContent).toBe("Changes (3)");
  });

  it("indents files under folder rows in the Tree style, and a folder click toggles its key", () => {
    const cb = callbacks();
    const body = render(["src/ui/a.ts", "b.ts"], { tree: true }, cb);
    const rows = Array.from(body.querySelectorAll<HTMLElement>(".sc-row"));
    expect(rows.map((r) => r.querySelector(".sc-row__name")?.textContent)).toEqual(["src", "ui", "a.ts", "b.ts"]);
    expect(rows.map((r) => r.style.paddingLeft)).toEqual(["20px", "32px", "44px", "20px"]);
    expect(rows[2].querySelector(".sc-row__dir")?.textContent).toBe("");
    rows[1].click();
    expect(cb.onToggleCollapsed).toHaveBeenCalledWith("Changes/src/ui");
  });
});
```

- lines: edit 1 +1 −0 = 1; edit 2 +15 −0 = 15; edit 3 +26 −0 = 26; edit 4 +1 −1 = 2; edit 5 +4 −0 = 4; edit 6 +14 −4 = 18; edit 7 +1 −0 = 1; edit 8 +2 −2 = 4; edit 9 +5 −0 = 5; edit 10 +1 −1 = 2; edit 11 +5 −0 = 5; edit 12 +10 −1 = 11; edit 13 +1 −0 = 1; edit 14 +6 −0 = 6; edit 15 +22 −0 = 22; `fileTree.ts` 43 (new file); `fileTree.test.ts` 29 (new file); `sourceControl.test.ts` 68 (new file).
- exec: `judgment`. Three new files (verbatim) and exact edits; `renderSourceControl` gains a required parameter, so the renderer edits and the wiring land together.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run 2>&1 | grep -E 'Test Files|Tests '`
  Expected: tsc silent, `Test Files  71 passed (71)`, `Tests  846 passed (846)`.

**Commit boundary H2. Do not commit.** Files: `gui/src-tauri/src/settings.rs`, `gui/src/settings.ts`, `gui/index.html`, `gui/src/appDom.ts`, `gui/src/appLookups.ts`, `gui/src/style.css`, `gui/src/ui/commitList.ts`, `gui/tests/unit/ui/commitList.test.ts`, `gui/src/git/fileTree.ts`, `gui/tests/unit/git/fileTree.test.ts`, `gui/src/ui/sourceControl.ts`, `gui/tests/unit/ui/sourceControl.test.ts`, `gui/src/appSourceControl.ts`. Suggested message: `feat: add the commits tab and file list styles to source control`.

---

## Slice H3: the tabbed details pane and the Summary page

After H3, `#diff-view` is the details pane: a tab bar (Summary plus file tabs) over one body, shown while Source Control is active (decision D1). The Summary shows the selected commit's meta, message and files, or the working directory's commit box and Staged / Unstaged / Untracked sections. A file row opens a file tab with its diff. The panel-local keys work. The Files tab lists the selected commit's files.
### step P1.8
Goal: add the pure panel-key map and its test: Esc, Ctrl+1/2/4, Alt+arrows and Ctrl+PgUp/PgDn, none of them in the global table.

- files: `gui/src/git/panelKeys.ts` (new), `gui/tests/unit/git/panelKeys.test.ts` (new)

new file `gui/src/git/panelKeys.ts`, full content:
```ts
// Git P1: the Source Control panel-local keys (inventory section B) as a pure
// map from a keydown to an action. Listeners on `#source-control` and
// `#diff-view` run it, so a key acts only while focus is inside the panel or
// the details pane. None of these keys is in the global table
// (`shortcuts.ts`), which wins first at routing step 2 whatever has focus.

export type PanelKeyAction =
  | "escape"
  | "filesTab"
  | "commitsTab"
  | "showDetails"
  | "back"
  | "forward"
  | "parent"
  | "child"
  | "prevTab"
  | "nextTab";

export interface PanelKeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const ALT_KEYS: Readonly<Record<string, PanelKeyAction>> = {
  ArrowLeft: "back",
  ArrowRight: "forward",
  ArrowDown: "parent",
  ArrowUp: "child",
};

// Ctrl+0 (go to HEAD) is not here: it is `view.zoomReset` in the global table.
const CTRL_KEYS: Readonly<Record<string, PanelKeyAction>> = {
  Digit1: "filesTab",
  Digit2: "commitsTab",
  Digit4: "showDetails",
  PageUp: "prevTab",
  PageDown: "nextTab",
};

/** `inText`: the target is an input or a textarea. There only Esc is a panel
 * key; every other key keeps its text meaning (macOS Option+arrows move by
 * word). Ctrl+Alt is AltGr on Windows, so it never maps. Space is not here:
 * a focused row or header handles its own Space. */
export function panelKeyAction(event: PanelKeyEvent, inText: boolean): PanelKeyAction | null {
  const { ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta } = event;
  if (event.key === "Escape") return ctrl || shift || alt || meta ? null : "escape";
  if (inText || shift || meta || ctrl === alt) return null;
  return (alt ? ALT_KEYS : CTRL_KEYS)[event.code] ?? null;
}
```

new file `gui/tests/unit/git/panelKeys.test.ts`, full content:
```ts
// Git P1: the Source Control panel-local keys, and the rule that none of
// them is a global shortcut on Windows or macOS.

import { describe, expect, it } from "vitest";
import { panelKeyAction, type PanelKeyEvent } from "../../../src/git/panelKeys";
import { buildMacShortcuts, matchesCombo, SHORTCUTS } from "../../../src/shortcuts";

function key(code: string, mods: Partial<PanelKeyEvent> = {}): PanelKeyEvent {
  const keyName = code === "Escape" ? "Escape" : code;
  return { key: keyName, code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods };
}

const MAPPED: [PanelKeyEvent, string][] = [
  [key("Escape"), "escape"],
  [key("Digit1", { ctrlKey: true }), "filesTab"],
  [key("Digit2", { ctrlKey: true }), "commitsTab"],
  [key("Digit4", { ctrlKey: true }), "showDetails"],
  [key("ArrowLeft", { altKey: true }), "back"],
  [key("ArrowRight", { altKey: true }), "forward"],
  [key("ArrowDown", { altKey: true }), "parent"],
  [key("ArrowUp", { altKey: true }), "child"],
  [key("PageUp", { ctrlKey: true }), "prevTab"],
  [key("PageDown", { ctrlKey: true }), "nextTab"],
];

describe("panelKeyAction", () => {
  it("maps the panel keys", () => {
    for (const [event, action] of MAPPED) expect(panelKeyAction(event, false), event.code).toBe(action);
  });

  it("leaves table keys, AltGr and plain keys alone", () => {
    const unmapped = [
      key("Digit0", { ctrlKey: true }), // view.zoomReset
      key("Digit3", { ctrlKey: true }),
      key("PageUp", { ctrlKey: true, shiftKey: true }), // tab.moveLeft
      key("Digit1", { altKey: true }), // tab.focusByIndex.1
      key("ArrowDown", { altKey: true, shiftKey: true }),
      key("ArrowLeft", { ctrlKey: true, altKey: true }), // AltGr
      key("ArrowLeft"),
      key("Space"),
      key("Escape", { shiftKey: true }),
    ];
    for (const event of unmapped) expect(panelKeyAction(event, false), JSON.stringify(event)).toBeNull();
  });

  it("keeps only Esc inside a text field", () => {
    expect(panelKeyAction(key("Escape"), true)).toBe("escape");
    expect(panelKeyAction(key("ArrowLeft", { altKey: true }), true)).toBeNull();
    expect(panelKeyAction(key("PageDown", { ctrlKey: true }), true)).toBeNull();
  });

  it("never claims a key of the Windows or the macOS shortcut table", () => {
    const tables = [SHORTCUTS, buildMacShortcuts(SHORTCUTS)];
    for (const [event] of MAPPED) {
      for (const table of tables) {
        const hit = table.find((s) => [s.combo, ...(s.altCombos ?? [])].some((c) => matchesCombo(c, event)));
        expect(hit?.id, event.code).toBeUndefined();
      }
    }
  });
});
```

- lines: `panelKeys.ts` 53 (new file); `panelKeys.test.ts` 61 (new file).
- exec: `judgment`. New files; the content is verbatim.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run tests/unit/git/panelKeys.test.ts 2>&1 | grep -E 'Test Files|Tests '`
  Expected: tsc silent, `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

### step P1.9
Goal: add the details-pane renderers (tab bar, commit Summary, working-directory sections, file tab) with a jsdom test, the diff-rows renderer they share, and the pane CSS. Nothing calls them yet; the P0 overlay still works through a thin `renderDiffView` wrapper.

- files: `gui/src/ui/diffView.ts`, `gui/src/ui/sourceControl.ts`, `gui/src/ui/detailsPane.ts` (new), `gui/tests/unit/ui/detailsPane.test.ts` (new), `gui/src/style.css`

edit 1 (`sourceControl.ts`): export the letter map for the Summary's file rows.

old:
```ts
const STATUS_LETTER: Record<ChangeKind, string> = {
```

new:
```ts
export const STATUS_LETTER: Record<ChangeKind, string> = {
```

edit 2 (`style.css`) (end of file): the end of the H2 block. Append the details-pane block.

old:
```css
/* A narrow sidebar hides the author first; the summary and the date stay. */
@container source-control (max-width: 339px) {
  .sc-commit-row__author {
    display: none;
  }
}
```

new:
```css
/* A narrow sidebar hides the author first; the summary and the date stay. */
@container source-control (max-width: 339px) {
  .sc-commit-row__author {
    display: none;
  }
}

/* ---------------------------------------------------------------------- */
/* Details pane (git P1): `#diff-view` holds a tab bar (Summary plus one   */
/* tab per opened file) and one scrolling body.                            */
/* ---------------------------------------------------------------------- */

/* Source Control is inactive while the sidebar is hidden (`isActive()`), and
   Ctrl+Shift+B runs no Source Control code, so CSS hides the pane. */
#main.sidebar-hidden #diff-view {
  display: none;
}

.details-tabs {
  display: flex;
  flex-shrink: 0;
  height: 30px;
  overflow-x: auto;
  scrollbar-width: none;
  background: var(--editorGroupHeader-tabsBackground);
  border-bottom: 1px solid var(--tab-border);
}

.details-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  max-width: 220px;
  padding: 0 4px 0 12px;
  border-right: 1px solid var(--tab-border);
  background: var(--tab-inactiveBackground);
  color: var(--tab-inactiveForeground);
  font-size: var(--fs-xs);
  white-space: nowrap;
  cursor: pointer;
}

.details-tab:first-child {
  padding-right: 12px;
}

.details-tab:hover {
  background: var(--tab-hoverBackground);
}

.details-tab[aria-selected="true"] {
  background: var(--tab-activeBackground);
  color: var(--tab-activeForeground);
  box-shadow: inset 0 1px 0 var(--tab-activeBorderTop);
}

.details-tab__label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.details-tab__close {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  visibility: hidden;
}

.details-tab__close .codicon {
  font-size: 14px;
}

.details-tab:hover .details-tab__close,
.details-tab[aria-selected="true"] .details-tab__close {
  visibility: visible;
}

.details-tabs__spacer {
  flex: 1;
}

.details-tabs > .icon-btn {
  flex-shrink: 0;
  align-self: center;
  margin: 0 6px;
}

/* The commit box at the top of the working-directory Summary. */
.details-body > .sc-commit {
  padding: 10px 12px 6px;
}

.details-body > .sc-commit .btn {
  align-self: flex-start;
}

.summary-meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 12px;
  padding: 10px 12px;
  font-size: var(--fs-xs);
}

.summary-meta__label {
  font-style: italic;
  color: var(--descriptionForeground);
}

.summary-meta__value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  overflow-wrap: anywhere;
}

.summary-meta__files {
  color: var(--descriptionForeground);
}

.summary-counts {
  display: inline-flex;
  flex-shrink: 0;
  gap: 4px;
}

.sc-badge--add {
  background: var(--sc-badge-add-bg);
  color: var(--foreground);
}

.sc-badge--del {
  background: var(--sc-badge-del-bg);
  color: var(--foreground);
}

.summary-message {
  padding: 8px 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-top: 1px solid var(--tab-border);
  border-bottom: 1px solid var(--tab-border);
}

.summary-files {
  padding-top: 8px;
}

.summary-section__header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  margin-top: 4px;
  padding: 0 12px;
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--sideBarSectionHeader-foreground);
}

.summary-section__action {
  margin-left: auto;
  padding: 0 8px;
  font-size: var(--fs-xs);
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

.summary-file {
  margin: 0 12px 4px;
}

.summary-file__header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  border-radius: 3px;
  background: var(--sc-file-header-bg);
  color: var(--foreground);
  font-size: var(--fs-xs);
  white-space: nowrap;
  cursor: pointer;
}

.summary-file__header:hover {
  background: var(--sc-file-header-hover-bg);
}

.summary-file--untracked > .summary-file__header {
  background: var(--sc-file-header-untracked-bg);
}

.summary-file--conflicted > .summary-file__header {
  background: var(--sc-file-header-unmerged-bg);
}

.summary-file__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

replace file `gui/src/ui/diffView.ts`, full content (sha256 before: d5f9388261f46eb8bb5a9907029291e3178c286c73a5fd2bcd128f5d39c26517):
```ts
// Diff rows (git MVP spec §6.2; git P1): a read-only unified diff with
// old/new line-number gutters. The details pane (`ui/detailsPane.ts`) shows
// it in a file tab; until P1.10 the P0 overlay (`renderDiffView`) uses it
// too. DOM only. Diff text comes from the repo and is untrusted, so all text
// uses `textContent`.

import { parseUnifiedDiff } from "../git/diffParse";
import type { GitDiff } from "../git/gitApi";
import { FONT_STACK } from "../render/renderer";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The rows of one diff in the terminal font, or a note while it loads or
 * for a binary file. Wide lines scroll inside the block. */
export function renderDiffLines(diff: GitDiff | null, fontSizePx: number): HTMLElement {
  const code = el("div", "diff-view__code");
  code.style.fontFamily = FONT_STACK;
  code.style.fontSize = `${fontSizePx}px`;
  if (diff === null) {
    code.appendChild(el("div", "diff-view__note", "Loading…"));
  } else if (diff.binary) {
    code.appendChild(el("div", "diff-view__note", "Binary file, no text diff"));
  } else {
    const lines = el("div", "diff-view__lines");
    for (const line of parseUnifiedDiff(diff.text)) {
      const row = el("div", `diff-row diff-row--${line.kind}`);
      const hasNumbers = line.kind !== "hunk" && line.kind !== "meta";
      row.appendChild(el("span", "diff-row__no", hasNumbers && line.oldNo !== null ? String(line.oldNo) : ""));
      row.appendChild(el("span", "diff-row__no", hasNumbers && line.newNo !== null ? String(line.newNo) : ""));
      row.appendChild(el("span", "diff-row__text", line.text));
      lines.appendChild(row);
    }
    code.appendChild(lines);
    if (diff.truncated) code.appendChild(el("div", "diff-view__note", "Diff truncated at 2 MiB"));
  }
  return code;
}

export interface DiffViewModel {
  path: string;
  staged: boolean;
  untracked: boolean;
  /** `null` while loading. */
  diff: GitDiff | null;
}

/** The P0 overlay: a header with a Close button over the diff rows. P1.10 removes it. */
export function renderDiffView(rootEl: HTMLElement, model: DiffViewModel, fontSizePx: number, onClose: () => void): void {
  rootEl.textContent = "";
  const header = el("div", "diff-view__header");
  header.appendChild(el("span", "diff-view__path", model.path));
  header.appendChild(el("span", "diff-view__tag", model.staged ? "(staged)" : model.untracked ? "(untracked)" : ""));
  const closeBtn = el("button", "icon-btn");
  closeBtn.type = "button";
  closeBtn.title = "Close (Esc)";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(el("i", "codicon codicon-close"));
  closeBtn.addEventListener("click", onClose);
  header.appendChild(closeBtn);
  rootEl.appendChild(header);
  const body = el("div", "diff-view__body");
  body.appendChild(renderDiffLines(model.diff, fontSizePx));
  rootEl.appendChild(body);
}
```

new file `gui/src/ui/detailsPane.ts`, full content:
```ts
// Git P1: the details pane in `#diff-view`, over the terminal while Source
// Control is active. A tab bar (Summary plus one tab per opened file), the
// Summary of the selected commit or of the working directory, and file tabs.
// DOM only; the state and the fetching live in `appSourceControl.ts`. Text
// from the repo is untrusted, so all text uses `textContent`.

import type { CommitDetail, CommitFile, FileChange, GitDiff, GitStatus } from "../git/gitApi";
import { FONT_STACK } from "../render/renderer";
import { renderDiffLines } from "./diffView";
import { MAX_ROWS_PER_GROUP, STATUS_LETTER } from "./sourceControl";

export interface PaneTab {
  label: string;
  /** The tooltip: the repo-relative path. */
  title: string;
}

export interface TabBarCallbacks {
  /** -1 is the Summary tab. */
  onActivate(index: number): void;
  onClose(index: number): void;
  onClosePane(): void;
}

export interface CommitSummaryModel {
  /** `null` while loading. */
  detail: CommitDetail | null;
  /** The load failed; shown instead of "Loading…". */
  error: string | null;
  /** The summary of a loaded history row, for the Parent tooltips. */
  summaryOf(hash: string): string | undefined;
}

export interface SummaryCallbacks {
  onSelectCommit(hash: string): void;
  onOpenFile(file: FileChange, staged: boolean): void;
}

export interface WorktreeCallbacks extends SummaryCallbacks {
  onStage(files: FileChange[]): void;
  onUnstage(files: FileChange[]): void;
}

export interface FileTabModel {
  file: FileChange;
  /** `(staged)`, `(untracked)`, or the commit's short hash. */
  tag: string;
  /** `null` while loading. */
  diff: GitDiff | null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(icon: string, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", className);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(el("i", `codicon codicon-${icon}`));
  button.addEventListener("click", (event) => {
    event.stopPropagation(); // the close button must not also activate its tab
    onClick();
  });
  return button;
}

/** Click, Enter and Space run `action`. */
function makeButton(node: HTMLElement, action: () => void): void {
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.addEventListener("click", action);
  node.addEventListener("keydown", (event) => {
    if (event.target !== node || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    action();
  });
}

/** A rename shows `old → new`. */
export function pathLabel(file: FileChange): string {
  return file.origPath !== null ? `${file.origPath} → ${file.path}` : file.path;
}

/** `active` is -1 for the Summary tab, otherwise an index into `tabs`. A
 * middle click closes a file tab. */
export function renderTabBar(barEl: HTMLElement, tabs: readonly PaneTab[], active: number, callbacks: TabBarCallbacks): void {
  barEl.textContent = "";
  const add = (label: string, title: string, index: number) => {
    const tab = el("div", "details-tab");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(index === active));
    tab.title = title;
    tab.appendChild(el("span", "details-tab__label", label));
    tab.addEventListener("click", () => callbacks.onActivate(index));
    if (index >= 0) {
      tab.addEventListener("auxclick", (event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        callbacks.onClose(index);
      });
      tab.appendChild(iconButton("close", "Close", "details-tab__close", () => callbacks.onClose(index)));
    }
    barEl.appendChild(tab);
  };
  add("Summary", "Summary", -1);
  tabs.forEach((tab, i) => add(tab.label, tab.title, i));
  barEl.appendChild(el("span", "details-tabs__spacer"));
  barEl.appendChild(iconButton("close", "Close the details (Esc)", "icon-btn", callbacks.onClosePane));
  barEl.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/** The `-N +M` badges; nothing when both counts are unknown (a binary file). */
export function countBadges(deleted: number | null, added: number | null): HTMLElement {
  const counts = el("span", "summary-counts");
  if (deleted !== null) counts.appendChild(el("span", "sc-badge sc-badge--del", `-${deleted}`));
  if (added !== null) counts.appendChild(el("span", "sc-badge sc-badge--add", `+${added}`));
  return counts;
}

/** One file's header row: the status letter, the path and the counts. */
function fileHeader(file: FileChange, counts: { added: number | null; deleted: number | null } | null): HTMLElement {
  const header = el("div", "summary-file__header");
  header.title = pathLabel(file);
  header.appendChild(el("span", "sc-row__status", STATUS_LETTER[file.kind]));
  header.appendChild(el("span", "summary-file__path", pathLabel(file)));
  if (counts) header.appendChild(countBadges(counts.deleted, counts.added));
  return header;
}

/** The file rows of a Summary, capped like the sidebar lists. A click opens the file's tab. */
function fileRows(parent: HTMLElement, files: readonly (FileChange | CommitFile)[], staged: boolean, callbacks: SummaryCallbacks): void {
  for (const file of files.slice(0, MAX_ROWS_PER_GROUP)) {
    const counts = "added" in file ? file : null;
    const row = el("div", `summary-file summary-file--${file.kind}`);
    const header = fileHeader(file, counts);
    makeButton(header, () => callbacks.onOpenFile(file, staged));
    row.appendChild(header);
    parent.appendChild(row);
  }
  if (files.length > MAX_ROWS_PER_GROUP) {
    parent.appendChild(el("div", "diff-view__note", `and ${files.length - MAX_ROWS_PER_GROUP} more`));
  }
}

function field(meta: HTMLElement, label: string, value: string | HTMLElement): void {
  meta.appendChild(el("span", "summary-meta__label", label));
  if (typeof value === "string") meta.appendChild(el("span", "summary-meta__value", value));
  else meta.appendChild(value);
}

/** The Stats value: `-N +M` over the files with counts, and the file count. */
function stats(detail: CommitDetail): HTMLElement {
  let added = 0;
  let deleted = 0;
  for (const file of detail.files) {
    added += file.added ?? 0;
    deleted += file.deleted ?? 0;
  }
  const value = el("span", "summary-meta__value");
  value.appendChild(countBadges(deleted, added));
  const n = detail.files.length;
  value.appendChild(el("span", "summary-meta__files", `${n} ${n === 1 ? "file" : "files"}${detail.truncated ? " (list truncated at 2 MiB)" : ""}`));
  return value;
}

/** The Summary of one commit: the meta block, the message and its files. */
export function renderCommitSummary(
  bodyEl: HTMLElement,
  model: CommitSummaryModel,
  fontSizePx: number,
  callbacks: SummaryCallbacks,
): void {
  bodyEl.textContent = "";
  const { detail } = model;
  if (detail === null) {
    bodyEl.appendChild(el("div", "diff-view__note", model.error ?? "Loading…"));
    return;
  }
  const meta = el("div", "summary-meta");
  field(meta, "Commit Hash", detail.hash);
  field(meta, "Tree", detail.tree);
  field(meta, "Author", `${detail.author} <${detail.authorEmail}>`);
  field(meta, "Date", new Date(detail.timestamp * 1000).toLocaleString());
  // A root commit has no Parent row.
  if (detail.parents.length > 0) {
    const parents = el("span", "summary-meta__value");
    for (const hash of detail.parents) {
      const link = el("span", "sc-link summary-meta__parent", hash);
      link.title = model.summaryOf(hash) ?? hash;
      makeButton(link, () => callbacks.onSelectCommit(hash));
      link.setAttribute("role", "link");
      parents.appendChild(link);
    }
    field(meta, detail.parents.length === 1 ? "Parent" : "Parents", parents);
  }
  field(meta, "Stats", stats(detail));
  bodyEl.appendChild(meta);

  const message = el("pre", "summary-message", detail.message);
  message.style.fontFamily = FONT_STACK;
  message.style.fontSize = `${fontSizePx}px`;
  bodyEl.appendChild(message);

  // A merge lists its files against the first parent (`--diff-merges=first-parent`).
  const files = el("div", "summary-files");
  fileRows(files, detail.files, false, callbacks);
  bodyEl.appendChild(files);
}

function section(
  parent: HTMLElement,
  title: string,
  files: readonly FileChange[],
  staged: boolean,
  action: { label: string; files: FileChange[]; run: (files: FileChange[]) => void } | null,
  callbacks: SummaryCallbacks,
): void {
  if (files.length === 0) return;
  const header = el("div", "summary-section__header");
  header.appendChild(el("span", "summary-section__title", `${title} (${files.length})`));
  if (action && action.files.length > 0) {
    const button = el("button", "btn summary-section__action", action.label);
    button.type = "button";
    button.addEventListener("click", () => action.run(action.files));
    header.appendChild(button);
  }
  parent.appendChild(header);
  fileRows(parent, files, staged, callbacks);
}

/** The working-directory sections under the commit box: Staged, Unstaged and
 * Untracked. Re-rendered alone on a status change. */
export function renderWorktreeSections(sectionsEl: HTMLElement, status: GitStatus, callbacks: WorktreeCallbacks): void {
  sectionsEl.textContent = "";
  const unstaged = status.unstaged.filter((f) => f.kind !== "untracked");
  const untracked = status.unstaged.filter((f) => f.kind === "untracked");
  if (status.staged.length === 0 && status.unstaged.length === 0) {
    sectionsEl.appendChild(el("div", "diff-view__note", "No changes"));
    return;
  }
  section(sectionsEl, "Staged", status.staged, true, { label: "Unstage All", files: status.staged, run: callbacks.onUnstage }, callbacks);
  // "Stage All" leaves conflicted files out: `git add` would mark them resolved.
  const stageable = unstaged.filter((f) => f.kind !== "conflicted");
  section(sectionsEl, "Unstaged", unstaged, false, { label: "Stage All", files: stageable, run: callbacks.onStage }, callbacks);
  section(sectionsEl, "Untracked", untracked, false, { label: "Stage All", files: untracked, run: callbacks.onStage }, callbacks);
}

/** A file tab: the path, the tag, and the diff. */
export function renderFileTab(bodyEl: HTMLElement, model: FileTabModel, fontSizePx: number): void {
  bodyEl.textContent = "";
  const header = el("div", "diff-view__header");
  header.appendChild(el("span", "diff-view__path", pathLabel(model.file)));
  header.appendChild(el("span", "diff-view__tag", model.tag));
  bodyEl.appendChild(header);
  bodyEl.appendChild(renderDiffLines(model.diff, fontSizePx));
}
```

new file `gui/tests/unit/ui/detailsPane.test.ts`, full content:
```ts
// @vitest-environment jsdom
//
// Git P1: the details pane: the tab bar, the commit Summary, the
// working-directory sections and a file tab.

import { describe, expect, it, vi } from "vitest";
import type { CommitDetail, FileChange, GitStatus } from "../../../src/git/gitApi";
import {
  renderCommitSummary,
  renderFileTab,
  renderTabBar,
  renderWorktreeSections,
  type CommitSummaryModel,
} from "../../../src/ui/detailsPane";

function detail(over: Partial<CommitDetail> = {}): CommitDetail {
  return {
    hash: "a".repeat(40),
    tree: "t".repeat(40),
    parents: ["b".repeat(40)],
    author: "Ada",
    authorEmail: "ada@example.com",
    timestamp: 1_700_000_000,
    message: "fix the parser\n\nThe body.",
    files: [
      { path: "src/a.ts", origPath: null, kind: "modified", added: 5, deleted: 3 },
      { path: "docs/new.md", origPath: "docs/old.md", kind: "renamed", added: 0, deleted: 0 },
      { path: "img.png", origPath: null, kind: "added", added: null, deleted: null },
    ],
    truncated: false,
    ...over,
  };
}

function model(d: CommitDetail | null, error: string | null = null): CommitSummaryModel {
  return { detail: d, error, summaryOf: (hash) => (hash === "b".repeat(40) ? "the parent" : undefined) };
}

function texts(root: HTMLElement, selector: string): string[] {
  return Array.from(root.querySelectorAll(selector), (n) => n.textContent ?? "");
}

const change = (path: string, kind: FileChange["kind"] = "modified"): FileChange => ({ path, origPath: null, kind });

describe("renderTabBar", () => {
  it("lists Summary first, marks the active tab, and wires activate, close and close-pane", () => {
    const bar = document.createElement("div");
    const cb = { onActivate: vi.fn(), onClose: vi.fn(), onClosePane: vi.fn() };
    renderTabBar(bar, [{ label: "a.ts", title: "src/a.ts" }, { label: "b.md", title: "b.md" }], 0, cb);
    const tabs = bar.querySelectorAll<HTMLElement>(".details-tab");
    expect(texts(bar, ".details-tab__label")).toEqual(["Summary", "a.ts", "b.md"]);
    expect(Array.from(tabs, (t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs[1].title).toBe("src/a.ts");
    expect(tabs[0].querySelector(".details-tab__close")).toBeNull();
    tabs[0].click();
    tabs[2].querySelector<HTMLButtonElement>(".details-tab__close")!.click();
    tabs[1].dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true }));
    bar.querySelector<HTMLButtonElement>('button[aria-label="Close the details (Esc)"]')!.click();
    expect(cb.onActivate.mock.calls).toEqual([[-1]]);
    expect(cb.onClose.mock.calls).toEqual([[1], [0]]);
    expect(cb.onClosePane).toHaveBeenCalledTimes(1);
  });
});

describe("renderCommitSummary", () => {
  it("shows Loading… and then an error in place of the Summary", () => {
    const body = document.createElement("div");
    const cb = { onSelectCommit: vi.fn(), onOpenFile: vi.fn() };
    renderCommitSummary(body, model(null), 14, cb);
    expect(body.textContent).toBe("Loading…");
    renderCommitSummary(body, model(null, "bad revision"), 14, cb);
    expect(body.textContent).toBe("bad revision");
  });

  it("lists the meta fields, a clickable parent, the stats, the message and the files", () => {
    const body = document.createElement("div");
    const cb = { onSelectCommit: vi.fn(), onOpenFile: vi.fn() };
    renderCommitSummary(body, model(detail()), 14, cb);
    expect(texts(body, ".summary-meta__label")).toEqual(["Commit Hash", "Tree", "Author", "Date", "Parent", "Stats"]);
    const parent = body.querySelector<HTMLElement>(".summary-meta__parent")!;
    expect(parent.title).toBe("the parent");
    parent.click();
    expect(cb.onSelectCommit).toHaveBeenCalledWith("b".repeat(40));
    expect(texts(body, ".summary-meta .sc-badge")).toEqual(["-3", "+5"]);
    expect(body.querySelector(".summary-meta__files")?.textContent).toBe("3 files");
    expect(body.querySelector(".summary-message")?.textContent).toBe("fix the parser\n\nThe body.");
    expect(texts(body, ".summary-file__path")).toEqual(["src/a.ts", "docs/old.md → docs/new.md", "img.png"]);
    const headers = body.querySelectorAll<HTMLElement>(".summary-file__header");
    expect(headers[2].querySelector(".sc-badge")).toBeNull();
    headers[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(cb.onOpenFile).toHaveBeenCalledWith(detail().files[1], false);
  });

  it("hides the Parent row for a root commit", () => {
    const body = document.createElement("div");
    renderCommitSummary(body, model(detail({ parents: [] })), 14, { onSelectCommit: vi.fn(), onOpenFile: vi.fn() });
    expect(texts(body, ".summary-meta__label")).not.toContain("Parent");
  });
});

describe("renderWorktreeSections", () => {
  function status(staged: FileChange[], unstaged: FileChange[]): GitStatus {
    return { repo: "C:/r", branch: "main", ahead: 0, behind: 0, unborn: false, staged, unstaged };
  }

  it("splits Staged, Unstaged and Untracked, and Stage All leaves conflicted files out", () => {
    const sections = document.createElement("div");
    const cb = { onSelectCommit: vi.fn(), onOpenFile: vi.fn(), onStage: vi.fn(), onUnstage: vi.fn() };
    const conflicted = change("c.txt", "conflicted");
    const edited = change("e.txt");
    const fresh = change("n.txt", "untracked");
    renderWorktreeSections(sections, status([change("s.txt")], [conflicted, edited, fresh]), cb);
    expect(texts(sections, ".summary-section__title")).toEqual(["Staged (1)", "Unstaged (2)", "Untracked (1)"]);
    const buttons = sections.querySelectorAll<HTMLButtonElement>(".summary-section__action");
    expect(Array.from(buttons, (b) => b.textContent)).toEqual(["Unstage All", "Stage All", "Stage All"]);
    buttons[1].click();
    expect(cb.onStage).toHaveBeenCalledWith([edited]);
    buttons[2].click();
    expect(cb.onStage).toHaveBeenLastCalledWith([fresh]);
    sections.querySelectorAll<HTMLElement>(".summary-file__header")[0].click();
    expect(cb.onOpenFile).toHaveBeenCalledWith(change("s.txt"), true);
  });

  it("says No changes for a clean tree", () => {
    const sections = document.createElement("div");
    const cb = { onSelectCommit: vi.fn(), onOpenFile: vi.fn(), onStage: vi.fn(), onUnstage: vi.fn() };
    renderWorktreeSections(sections, status([], []), cb);
    expect(sections.textContent).toBe("No changes");
  });
});

describe("renderFileTab", () => {
  it("shows a rename as old → new, the tag, and Loading… until the diff arrives", () => {
    const body = document.createElement("div");
    const file: FileChange = { path: "b.txt", origPath: "a.txt", kind: "renamed" };
    renderFileTab(body, { file, tag: "abc1234", diff: null }, 14);
    expect(body.querySelector(".diff-view__path")?.textContent).toBe("a.txt → b.txt");
    expect(body.querySelector(".diff-view__tag")?.textContent).toBe("abc1234");
    expect(body.querySelector(".diff-view__note")?.textContent).toBe("Loading…");
    renderFileTab(body, { file, tag: "", diff: { text: "@@ -1 +1 @@\n-a\n+b\n", truncated: false, binary: false } }, 14);
    expect(texts(body, ".diff-row__text")).toEqual(["@@ -1 +1 @@", "-a", "+b"]);
  });
});
```

- lines: edit 1 +1 −1 = 2; edit 2 +205 −0 = 205; `diffView.ts` 73 lines replace 67 (+41 −36 by diff); `detailsPane.ts` 265 (new file); `detailsPane.test.ts` 143 (new file).
- exec: `judgment`. Two new files and one whole-file replacement, all verbatim; the replacement checks its pre-image hash first (`sha256sum gui/src/ui/diffView.ts`).
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run tests/unit/ui/detailsPane.test.ts 2>&1 | grep -E 'Test Files|Tests '`
  Expected: tsc silent, `Test Files  1 passed (1)`, `Tests  7 passed (7)`.

### step P1.10
Goal: wire the details pane: the pane shows while Source Control is active; a commit row, the pinned row or a file row selects and opens; file tabs; the panel keys; the Files tab follows the selection; the commit box moves into the working-directory Summary.

- files: `gui/index.html`, `gui/src/appDom.ts`, `gui/src/ui/sourceControl.ts`, `gui/src/ui/diffView.ts`, `gui/src/style.css`, `gui/tests/unit/ui/sourceControl.test.ts`, `gui/src/appSourceControl.ts`
- Rules the new `appSourceControl.ts` implements:
  - `paneOpen` is the user's intent. `syncPane` shows `#diff-view` only while `paneOpen`, the section is active (`isActive()`) and the view is a repo.
  - `paneOpen` turns on when the section opens (`applySourceControlVisibility`), on a selection, on a file row, and on Ctrl+4. It turns off on Esc from the Summary, the pane's close button, focus moving outside `#diff-view`, `#source-control` and `#overlay-root` (the P0 rule, widened from the terminal capture: a `focusin` listener), and the section closing. A hidden sidebar hides the pane through CSS (`#main.sidebar-hidden #diff-view`). A workspace switch keeps it on; the pane stays hidden until the new status arrives.
  - When the pane appears while the terminal capture (or nothing) has focus, focus moves to the pane root, so the shell never types behind it.
  - A new selection resets the file tabs to the Summary and bumps `paneSeq`, which drops late detail and diff responses. Selecting the current selection again only shows the pane (Sublime: a click on the selected row does not close anything).
  - Working-directory tabs follow their file through `followOpenDiff` (P0). A working-directory tab re-reads its diff on every visit and on Refresh; an equal diff keeps the DOM and the scroll position.
  - On a status change only the Summary sections re-render, never the commit box, so its caret and IME composition survive the 3 s poll.
  - Esc, innermost first: the commit box (focus moves to the pane root), a file tab (back to the Summary; the tab stays, as Sublime's "exit file view"), then the pane. A menu and the filter handle their own Esc first.
  - Alt+Left/Right walk the Back and Forward stacks. Alt+Down selects the first parent (the working directory's parent is HEAD); Alt+Up selects the first-parent child (HEAD's child is the working directory).
- The whole-file replacement checks its pre-image: `sha256sum gui/src/appSourceControl.ts` must print the hash in the heading, the H2 result. On a mismatch, stop and report.

edit 1 (`index.html`) (sidebar): the commit box leaves the sidebar.

old:
```html
            hidden
          />
          <div id="source-control-commit" class="sc-commit" hidden>
            <textarea
              id="source-control-message"
              rows="2"
              spellcheck="false"
              placeholder="Message (Ctrl+Enter to commit)"
              aria-label="Commit message"
            ></textarea>
            <button type="button" id="source-control-commit-btn" class="btn btn--primary" disabled>Commit</button>
          </div>
```

new:
```html
            hidden
          />
```

edit 2 (`index.html`) (the pane): `#diff-view` gets the tab bar and the body; the same commit box element starts inside the body.

old:
```html
          <div id="diff-view" tabindex="-1" role="region" aria-label="Diff" hidden></div>
```

new:
```html
          <div id="diff-view" tabindex="-1" role="region" aria-label="Source Control details" hidden>
            <div id="details-tabs" class="details-tabs" role="tablist" aria-label="Summary and open files"></div>
            <!-- appSourceControl.ts moves the commit box into each working-directory Summary. -->
            <div id="details-body" class="details-body">
              <div id="source-control-commit" class="sc-commit" hidden>
                <textarea
                  id="source-control-message"
                  rows="3"
                  spellcheck="false"
                  placeholder="Message (Ctrl+Enter to commit)"
                  aria-label="Commit message"
                ></textarea>
                <button type="button" id="source-control-commit-btn" class="btn btn--primary" disabled>
                  Nothing to commit
                </button>
              </div>
            </div>
          </div>
```

edit 3 (`appDom.ts`):

old:
```ts
export const diffViewEl = document.getElementById("diff-view") as HTMLDivElement;
```

new:
```ts
export const diffViewEl = document.getElementById("diff-view") as HTMLDivElement;
export const detailsTabsEl = document.getElementById("details-tabs") as HTMLDivElement;
export const detailsBodyEl = document.getElementById("details-body") as HTMLDivElement;
```

edit 4 (`sourceControl.ts`) (`renderRow`):

old:
```ts
/** `depth` is set in the Tree style: the row is indented and shows no folder. */
function renderRow(
  change: FileChange,
  staged: boolean,
```

new:
```ts
/** `depth` is set in the Tree style: the row is indented and shows no folder.
 * `staged` is `null` for a selected commit's file, which has no stage button. */
function renderRow(
  change: FileChange,
  staged: boolean | null,
```

edit 5 (`sourceControl.ts`) (`renderRow` open):

old:
```ts
  row.addEventListener("click", () => callbacks.onOpenFile(change, staged));
  row.addEventListener("keydown", (event) => {
    if (event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    callbacks.onOpenFile(change, staged);
  });
```

new:
```ts
  row.addEventListener("click", () => callbacks.onOpenFile(change, staged ?? false));
  row.addEventListener("keydown", (event) => {
    if (event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    callbacks.onOpenFile(change, staged ?? false);
  });
```

edit 6 (`sourceControl.ts`) (`renderRow` action):

old:
```ts
  if (change.kind !== "conflicted") {
    row.appendChild(
```

new:
```ts
  if (staged !== null && change.kind !== "conflicted") {
    row.appendChild(
```

edit 7 (`sourceControl.ts`) (`renderGroup`):

old:
```ts
  changes: FileChange[],
  staged: boolean,
  colors: ThemeColors,
  files: FilesView,
```

new:
```ts
  changes: FileChange[],
  staged: boolean | null,
  colors: ThemeColors,
  files: FilesView,
```

edit 8 (`sourceControl.ts`) (`renderGroup` header buttons):

old:
```ts
  if (staged) {
    header.appendChild(
      iconButton("remove", "Unstage All Changes", "icon-btn", () => callbacks.onUnstage(changes)),
    );
  } else {
```

new:
```ts
  if (staged === true) {
    header.appendChild(
      iconButton("remove", "Unstage All Changes", "icon-btn", () => callbacks.onUnstage(changes)),
    );
  } else if (staged === false) {
```

edit 9 (`sourceControl.ts`) (`renderSourceControl` signature):

old:
```ts
  colors: ThemeColors,
  files: FilesView,
  callbacks: SourceControlCallbacks,
): void {
  renderBranch(branchEl, view);
```

new:
```ts
  colors: ThemeColors,
  files: FilesView,
  /** A selected commit's files (git P1); `null` lists the working directory. */
  commitFiles: FileChange[] | null,
  callbacks: SourceControlCallbacks,
): void {
  renderBranch(branchEl, view);
```

edit 10 (`sourceControl.ts`) (status case):

old:
```ts
    case "status": {
      const { staged, unstaged } = view.status;
```

new:
```ts
    case "status": {
      if (commitFiles !== null) {
        renderGroup(bodyEl, "Changes", commitFiles, null, colors, files, callbacks);
        break;
      }
      const { staged, unstaged } = view.status;
```

edit 11 (`diffView.ts`) (header comment):

old:
```ts
// it in a file tab; until P1.10 the P0 overlay (`renderDiffView`) uses it
// too. DOM only. Diff text comes from the repo and is untrusted, so all text
// uses `textContent`.
```

new:
```ts
// it in a file tab. DOM only. Diff text comes from the repo and is untrusted,
// so all text uses `textContent`.
```

edit 12 (`diffView.ts`) (end of file): the P0 overlay wrapper goes.

old:
```ts
  return code;
}

export interface DiffViewModel {
  path: string;
  staged: boolean;
  untracked: boolean;
  /** `null` while loading. */
  diff: GitDiff | null;
}

/** The P0 overlay: a header with a Close button over the diff rows. P1.10 removes it. */
export function renderDiffView(rootEl: HTMLElement, model: DiffViewModel, fontSizePx: number, onClose: () => void): void {
  rootEl.textContent = "";
  const header = el("div", "diff-view__header");
  header.appendChild(el("span", "diff-view__path", model.path));
  header.appendChild(el("span", "diff-view__tag", model.staged ? "(staged)" : model.untracked ? "(untracked)" : ""));
  const closeBtn = el("button", "icon-btn");
  closeBtn.type = "button";
  closeBtn.title = "Close (Esc)";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(el("i", "codicon codicon-close"));
  closeBtn.addEventListener("click", onClose);
  header.appendChild(closeBtn);
  rootEl.appendChild(header);
  const body = el("div", "diff-view__body");
  body.appendChild(renderDiffLines(model.diff, fontSizePx));
  rootEl.appendChild(body);
}
```

new:
```ts
  return code;
}
```

edit 13 (`style.css`) (pane body): the pane body scrolls; a diff block scrolls sideways on its own.

old:
```css
.diff-view__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
```

new:
```css
.details-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.diff-view__code {
  overflow-x: auto;
}
```

edit 14 (`sourceControl.test.ts`) (helper): `renderSourceControl` takes the commit files.

old:
```ts
function render(unstaged: string[], files: Partial<FilesView>, cb = callbacks()): HTMLElement {
  const body = document.createElement("div");
  const view = { kind: "status" as const, status: status(unstaged) };
  renderSourceControl(document.createElement("div"), body, view, null, {}, { filter: "", tree: false, collapsed: new Set(), ...files }, cb);
  return body;
}
```

new:
```ts
function render(unstaged: string[], files: Partial<FilesView>, cb = callbacks(), commitFiles: FileChange[] | null = null): HTMLElement {
  const body = document.createElement("div");
  const view = { kind: "status" as const, status: status(unstaged) };
  const options = { filter: "", tree: false, collapsed: new Set<string>(), ...files };
  renderSourceControl(document.createElement("div"), body, view, null, {}, options, commitFiles, cb);
  return body;
}
```

edit 15 (`sourceControl.test.ts`) (end of file): a test for the commit's files.

old:
```ts
    expect(cb.onToggleCollapsed).toHaveBeenCalledWith("Changes/src/ui");
  });
});
```

new:
```ts
    expect(cb.onToggleCollapsed).toHaveBeenCalledWith("Changes/src/ui");
  });

  it("lists a selected commit's files in one group without stage buttons", () => {
    const cb = callbacks();
    const body = render(["a.txt"], {}, cb, [change("src/x.ts"), change("y.md")]);
    expect(body.querySelector(".sc-group-header__title")?.textContent).toBe("Changes (2)");
    expect(names(body)).toEqual(["x.ts", "y.md"]);
    expect(body.querySelectorAll(".sc-row__action, .sc-group-header button")).toHaveLength(0);
    body.querySelectorAll<HTMLElement>(".sc-row")[0].click();
    expect(cb.onOpenFile).toHaveBeenCalledWith(change("src/x.ts"), false);
  });
});
```

replace file `gui/src/appSourceControl.ts`, full content (sha256 before: 8da7d281deebf0bbbd2a521a1ab22dc89e4caf7553f390ed8b5baf730550e2a0):
```ts
// Source Control orchestration (git MVP spec §6.1, §6.3; git P1): the toggle,
// the 3 s poll, active-workspace tracking, inline poll errors, the history
// list, and the details pane in `#diff-view`: the Summary of the selected
// commit or of the working directory, plus file tabs. The ordering rules are
// pure logic in `git/statusRefresh.ts`; the DOM is `ui/sourceControl.ts`,
// `ui/commitList.ts` and `ui/detailsPane.ts`.
// Must not import `appMenuBar.ts`: that module imports this one.

import { listen } from "@tauri-apps/api/event";
import { errorMessage, invokeSafe, showErrorNotice, showInfoNotice } from "./appApi";
import {
  detailsBodyEl,
  detailsTabsEl,
  diffViewEl,
  keyboardCapture,
  overlayRoot,
  sourceControlBodyEl,
  sourceControlBranchEl,
  sourceControlCommitBtn,
  sourceControlCommitEl,
  sourceControlCommitsEl,
  sourceControlEl,
  sourceControlFilterBtn,
  sourceControlFilterEl,
  sourceControlMessageEl,
  sourceControlPinnedEl,
  sourceControlRefreshBtn,
  sourceControlTabCommitsBtn,
  sourceControlTabFilesBtn,
  sourceControlViewChangesBtn,
  sourceControlViewToggleEl,
  sourceControlViewTreeBtn,
} from "./appDom";
import { currentThemeDef } from "./appLookups";
import { appState, persistSettings } from "./appState";
import type { RawSnapshot } from "./appTypes";
import {
  gitCommit,
  gitCommitDiff,
  gitDiff,
  gitLog,
  gitShow,
  gitStage,
  gitStatus,
  gitUnstage,
  type CommitDetail,
  type CommitRow,
  type FileChange,
  type GitDiff,
  type GitStatus,
} from "./git/gitApi";
import { panelKeyAction } from "./git/panelKeys";
import { createStatusRefresher, followOpenDiff } from "./git/statusRefresh";
import { focusKeyboardCapture } from "./keyboard/focusCapture";
import type { SourceControlTab } from "./settings";
import { IS_MAC } from "./shortcuts";
import { historyWindow, renderCommitList, renderPinnedRow } from "./ui/commitList";
import { renderCommitSummary, renderFileTab, renderTabBar, renderWorktreeSections } from "./ui/detailsPane";
import { renderSourceControl, type FilesView, type SourceControlView } from "./ui/sourceControl";

// shortcut: 3 s poll, not a file watcher; add notify-based watching if the poll shows up in the perf HUD on large repos.
const POLL_MS = 3000;

let activeWorkspaceId: string | null = null;
let activeCwd: string | null = null;
let view: SourceControlView = { kind: "noWorkspace" };
let pollError: string | null = null;
let committing = false;
// History (git P1).
let historyRows: CommitRow[] | null = null; // null until the first page arrives
let historyHasMore = false;
let historyLoadingMore = false;
let historyError: string | null = null;
let historySeq = 0; // drops stale history pages, like paneSeq
let selectedHash: string | null = null;
// Files tab list options (git P1); the filter text lives in its input.
let filterOpen = false;
// shortcut: the Changes | Tree choice resets on restart; persist it like sourceControlTab if users ask.
let treeView = false;
const collapsed = new Set<string>(); // group titles and `<group>/<folder>` keys
// Details pane (git P1). `selection` picks the Summary: a commit, or the
// working directory. File tabs belong to the selection.
type Selection = { kind: "worktree" } | { kind: "commit"; hash: string };
interface FileTab {
  file: FileChange;
  /** Working directory only: which side the diff shows. */
  staged: boolean;
  /** `null` until the first diff arrives. */
  diff: GitDiff | null;
}
let selection: Selection = { kind: "worktree" };
let detail: CommitDetail | null = null; // the selected commit, null while it loads
let detailError: string | null = null;
let tabs: FileTab[] = [];
let activeTab = -1; // -1 is the Summary tab
let paneOpen = false; // the user's intent; `syncPane` also needs an active section and a repo
let paneSeq = 0; // a new selection drops late detail and diff responses
let summarySectionsEl: HTMLElement | null = null; // re-rendered alone, so the commit box keeps focus
const navBack: Selection[] = [];
const navForward: Selection[] = [];

function isActive(): boolean {
  return appState.settings.sourceControlOpen && appState.settings.sidebarVisible;
}

/** The repo of the rendered status, or `null` when the view is not a repo. */
function currentRepo(): string | null {
  return view.kind === "status" ? view.status.repo : null;
}

function fontSize(): number {
  return appState.renderer?.getFontSizePx() ?? appState.settings.fontSize;
}

function sameSelection(a: Selection, b: Selection): boolean {
  return a.kind === "commit" && b.kind === "commit" ? a.hash === b.hash : a.kind === b.kind;
}

function stageFiles(files: FileChange[]): void {
  void runWrite(() => gitStage(currentRepo()!, files.map((f) => f.path)));
}

function unstageFiles(files: FileChange[]): void {
  void runWrite(() =>
    gitUnstage(
      currentRepo()!,
      // A staged rename also needs its old path, or reset leaves the deletion staged.
      files.flatMap((f) => (f.origPath !== null ? [f.path, f.origPath] : [f.path])),
    ),
  );
}

/** The Commits tab shows history only for a repo; otherwise the body shows its message. */
function showHistory(): boolean {
  return appState.settings.sourceControlTab === "commits" && view.kind === "status";
}

/** The tab buttons, which list is visible, and the pinned row. */
function applyTab(): void {
  const commits = appState.settings.sourceControlTab === "commits";
  sourceControlTabFilesBtn.setAttribute("aria-selected", String(!commits));
  sourceControlTabCommitsBtn.setAttribute("aria-selected", String(commits));
  const shown = showHistory();
  sourceControlBodyEl.hidden = shown;
  sourceControlPinnedEl.hidden = !shown;
  sourceControlCommitsEl.hidden = !shown;
  sourceControlFilterBtn.hidden = commits;
  sourceControlFilterBtn.setAttribute("aria-pressed", String(filterOpen));
  sourceControlFilterEl.hidden = commits || !filterOpen;
  sourceControlViewToggleEl.hidden = commits || view.kind !== "status";
  sourceControlViewChangesBtn.setAttribute("aria-pressed", String(!treeView));
  sourceControlViewTreeBtn.setAttribute("aria-pressed", String(treeView));
  if (view.kind === "status") renderPinnedRow(sourceControlPinnedEl, view.status, selection.kind === "worktree");
}

function setTab(tab: SourceControlTab): void {
  if (appState.settings.sourceControlTab === tab) return;
  appState.settings.sourceControlTab = tab;
  persistSettings();
  applyTab();
  if (showHistory()) {
    renderHistory(); // fresh relative dates
    void loadHistory(false);
  }
}

function renderHistory(): void {
  renderCommitList(
    sourceControlCommitsEl,
    {
      rows: historyRows,
      selectedHash,
      hasMore: historyHasMore,
      loadingMore: historyLoadingMore,
      error: historyError,
      now: Date.now(),
    },
    { onSelectCommit: (row) => select({ kind: "commit", hash: row.hash }), onLoadMore: () => void loadHistory(true) },
  );
}

/** `more` loads the next page; otherwise it re-reads the loaded rows (`historyWindow`). */
async function loadHistory(more: boolean): Promise<void> {
  const repo = currentRepo();
  if (repo === null) return;
  const seq = ++historySeq; // the newest request wins; an older page is dropped
  const loaded = historyRows ?? [];
  const { skip, keep } = historyWindow(loaded.length, more);
  if (more) {
    historyLoadingMore = true;
    renderHistory();
  }
  try {
    const rows = await gitLog(repo, skip, keep + 1); // one probe row past `keep`
    if (seq !== historySeq) return;
    const page = rows.slice(0, keep);
    const next = more ? loaded.concat(page) : page;
    const hasMore = rows.length > keep;
    // Every status change re-reads history; skip the rebuild when nothing changed, so row focus survives.
    const changed =
      more || historyError !== null || hasMore !== historyHasMore || JSON.stringify(next) !== JSON.stringify(historyRows);
    historyRows = next;
    historyHasMore = hasMore;
    historyLoadingMore = false;
    historyError = null;
    if (changed) renderHistory();
  } catch (err) {
    if (seq !== historySeq) return;
    historyLoadingMore = false;
    historyError = errorMessage(err); // inline, like poll errors: these loads also run on every status change
    renderHistory();
  }
}

/** The commit box lives in the working-directory Summary (git P1). */
function updateCommitBox(): void {
  sourceControlCommitEl.hidden = view.kind !== "status";
  const nothingStaged = view.kind !== "status" || view.status.staged.length === 0;
  sourceControlCommitBtn.textContent = nothingStaged ? "Nothing to commit" : "Commit";
  sourceControlCommitBtn.disabled = committing || nothingStaged || sourceControlMessageEl.value.trim() === "";
}

function filesView(): FilesView {
  return { filter: filterOpen ? sourceControlFilterEl.value.trim().toLowerCase() : "", tree: treeView, collapsed };
}

function toggleCollapsed(key: string): void {
  if (!collapsed.delete(key)) collapsed.add(key);
  render();
}

/** The sidebar section. The Files tab lists the selected commit's files, or the working directory. */
function render(): void {
  const commitFiles = selection.kind === "commit" ? (detail?.files ?? []) : null;
  renderSourceControl(
    sourceControlBranchEl,
    sourceControlBodyEl,
    view,
    pollError,
    currentThemeDef().colors,
    filesView(),
    commitFiles,
    {
      onOpenGitDownload: () => void invokeSafe("open_external_url", { url: "https://git-scm.com" }),
      onOpenFile: openFileTab,
      onToggleCollapsed: toggleCollapsed,
      onStage: stageFiles,
      onUnstage: unstageFiles,
    },
  );
  applyTab();
  updateCommitBox();
}

/** Selects a commit or the working directory: a fresh Summary and no file
 * tabs, then shows the pane. `record` pushes the old selection on the Back
 * stack (Alt+Left). Selecting the current one again only shows the pane. */
function select(next: Selection, record = true): void {
  if (!sameSelection(next, selection)) {
    if (record) {
      navBack.push(selection);
      navForward.length = 0;
    }
    selection = next;
    selectedHash = next.kind === "commit" ? next.hash : null;
    detail = null;
    detailError = null;
    tabs = [];
    activeTab = -1;
    ++paneSeq;
    renderHistory();
    sourceControlCommitsEl.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
    render(); // the pinned row tint and the Files tab follow the selection
    if (next.kind === "commit") void fetchDetail();
  }
  showPane();
}

/** Opens the pane: a click in the panel, Ctrl+4, or the section opening. */
function showPane(): void {
  paneOpen = true;
  syncPane(true);
}

/** Shows the pane while it is open, the section is active and the view is a
 * repo. `rerender` rebuilds it even when it already shows. When it appears
 * while the terminal has focus, focus moves into it, so the shell never
 * types behind it (spec §6.2). */
function syncPane(rerender = false): void {
  const shown = paneOpen && isActive() && view.kind === "status";
  const appearing = shown && diffViewEl.hidden;
  diffViewEl.hidden = !shown;
  if (!shown) return;
  if (appearing || rerender) renderPane();
  const active = document.activeElement;
  if (appearing && (active === keyboardCapture || active === document.body || active === null)) diffViewEl.focus();
}

/** Hides the pane; the selection and the tabs stay for the next show. */
function hidePane(refocus: boolean): void {
  if (!paneOpen) return;
  paneOpen = false; // before the focus call, so the focusin listener sees it closed
  syncPane();
  if (refocus) focusKeyboardCapture();
}

function renderTabs(): void {
  renderTabBar(
    detailsTabsEl,
    tabs.map((t) => ({ label: t.file.path.slice(t.file.path.lastIndexOf("/") + 1), title: t.file.path })),
    activeTab,
    { onActivate: activateTab, onClose: closeTab, onClosePane: () => hidePane(true) },
  );
}

function renderPane(): void {
  renderTabs();
  showActiveTab(false);
}

const summaryCallbacks = {
  onSelectCommit: (hash: string) => select({ kind: "commit", hash }),
  onOpenFile: openFileTab,
};

/** The active tab's body. `keepScroll` keeps the scroll position (a refresh of the same tab). */
function showActiveTab(keepScroll: boolean): void {
  const scrollTop = detailsBodyEl.scrollTop;
  summarySectionsEl = null;
  const tab = tabs[activeTab];
  if (tab) {
    const tag = selection.kind === "commit" ? selection.hash.slice(0, 7) : tab.staged ? "(staged)" : tab.file.kind === "untracked" ? "(untracked)" : "";
    renderFileTab(detailsBodyEl, { file: tab.file, tag, diff: tab.diff }, fontSize());
  } else if (selection.kind === "commit") {
    renderCommitSummary(
      detailsBodyEl,
      { detail, error: detailError, summaryOf: (hash) => historyRows?.find((r) => r.hash === hash)?.summary },
      fontSize(),
      summaryCallbacks,
    );
  } else {
    // The same commit box element moves into each new Summary, so its text and listeners stay.
    detailsBodyEl.textContent = "";
    summarySectionsEl = document.createElement("div");
    detailsBodyEl.append(sourceControlCommitEl, summarySectionsEl);
    renderWorktree();
  }
  detailsBodyEl.scrollTop = keepScroll ? scrollTop : 0;
}

function renderWorktree(): void {
  if (!summarySectionsEl || view.kind !== "status") return;
  renderWorktreeSections(summarySectionsEl, view.status, { ...summaryCallbacks, onStage: stageFiles, onUnstage: unstageFiles });
}

/** Opens a file tab for the selection, or activates the one already open. */
function openFileTab(file: FileChange, staged: boolean): void {
  if (view.kind !== "status") return;
  let index = tabs.findIndex((t) => t.file.path === file.path && t.staged === staged);
  if (index < 0) index = tabs.push({ file, staged, diff: null }) - 1;
  paneOpen = true;
  activateTab(index);
}

/** -1 is the Summary. A working-directory tab re-reads its diff on every visit. */
function activateTab(index: number): void {
  activeTab = index;
  const tab = tabs[index];
  if (tab && (tab.diff === null || selection.kind === "worktree")) void fetchTabDiff(tab);
  syncPane(true);
}

function closeTab(index: number): void {
  tabs.splice(index, 1);
  // The tab to the left takes over, or the Summary.
  activateTab(index <= activeTab ? activeTab - 1 : activeTab);
}

/** Ctrl+PgUp / Ctrl+PgDn: the previous or next tab, the Summary included, wrapping. */
function cycleTab(direction: 1 | -1): void {
  const slots = tabs.length + 1; // slot 0 is the Summary
  activateTab(((activeTab + 1 + direction + slots) % slots) - 1);
}

async function fetchTabDiff(tab: FileTab): Promise<void> {
  const repo = currentRepo();
  if (repo === null) return;
  const seq = paneSeq;
  const sel = selection;
  try {
    const diff =
      sel.kind === "commit"
        ? await gitCommitDiff(repo, sel.hash, tab.file.path, tab.file.origPath)
        : await gitDiff(repo, tab.file.path, tab.staged, tab.file.kind === "untracked");
    if (seq !== paneSeq || !tabs.includes(tab)) return;
    if (JSON.stringify(diff) === JSON.stringify(tab.diff)) return; // same text: keep the scroll and the DOM
    tab.diff = diff;
    if (tabs[activeTab] === tab && !diffViewEl.hidden) showActiveTab(true);
  } catch (err) {
    if (seq !== paneSeq || !tabs.includes(tab)) return;
    showErrorNotice(errorMessage(err)); // an action error, so it toasts (spec §7)
    closeTab(tabs.indexOf(tab));
  }
}

async function fetchDetail(): Promise<void> {
  const repo = currentRepo();
  if (repo === null || selection.kind !== "commit") return;
  const seq = paneSeq;
  try {
    const loaded = await gitShow(repo, selection.hash);
    if (seq !== paneSeq) return;
    detail = loaded;
  } catch (err) {
    if (seq !== paneSeq) return;
    detailError = errorMessage(err);
    showErrorNotice(detailError); // an action error, so it toasts (spec §7)
  }
  render(); // the Files tab lists the commit's files
  if (activeTab < 0 && !diffViewEl.hidden) showActiveTab(false);
}

/** After a status change: working-directory tabs follow their file (the P0
 * rule, `followOpenDiff`), and the Summary sections re-render alone, so the
 * commit box keeps its focus and caret. */
function followWorktree(status: GitStatus): void {
  const active = tabs[activeTab];
  const refetch: FileTab[] = [];
  tabs = tabs.filter((tab) => {
    const follow = followOpenDiff({ path: tab.file.path, staged: tab.staged, kind: tab.file.kind }, status);
    if (follow.action === "refetch") {
      tab.staged = follow.staged;
      tab.file = { ...tab.file, kind: follow.kind };
      refetch.push(tab);
    }
    return follow.action !== "close";
  });
  activeTab = active ? tabs.indexOf(active) : -1; // a closed active tab falls back to the Summary
  if (diffViewEl.hidden) return;
  renderTabs();
  if (activeTab < 0 && summarySectionsEl) renderWorktree();
  else if (active && activeTab < 0) showActiveTab(false);
  for (const tab of refetch) if (tab === active) void fetchTabDiff(tab);
}

/** Alt+Left / Alt+Right: the previous or the next selection. */
function navigate(from: Selection[], to: Selection[]): void {
  const next = from.pop();
  if (!next) return;
  to.push(selection);
  select(next, false);
}

/** Alt+Down: the first parent. The working directory's parent is HEAD. */
function selectParent(): void {
  const rows = historyRows ?? [];
  if (selection.kind === "worktree") {
    if (rows[0]) select({ kind: "commit", hash: rows[0].hash });
    return;
  }
  const hash = selection.hash;
  const parent = detail?.hash === hash ? detail.parents[0] : rows.find((r) => r.hash === hash)?.parents[0];
  if (parent) select({ kind: "commit", hash: parent });
}

/** Alt+Up: the child on the first-parent line. HEAD's child is the working directory. */
function selectChild(): void {
  if (selection.kind !== "commit") return;
  const rows = historyRows ?? [];
  const hash = selection.hash;
  if (rows[0]?.hash === hash) {
    select({ kind: "worktree" });
    return;
  }
  const child = rows.find((r) => r.parents[0] === hash);
  if (child) select({ kind: "commit", hash: child.hash });
}

/** Panel-local keys (`git/panelKeys.ts`), on `#source-control` and `#diff-view`. */
function onPanelKey(event: KeyboardEvent): void {
  const target = event.target;
  const inText = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
  const action = panelKeyAction(event, inText);
  if (action === null) return;
  event.preventDefault();
  switch (action) {
    case "escape": // the innermost thing first: the text field, the file tab, then the pane
      if (inText) diffViewEl.focus();
      else if (diffViewEl.hidden) return;
      else if (activeTab >= 0) activateTab(-1);
      else hidePane(true);
      return;
    case "filesTab":
      setTab("files");
      return sourceControlTabFilesBtn.focus();
    case "commitsTab":
      setTab("commits");
      return sourceControlTabCommitsBtn.focus();
    case "showDetails":
      showPane();
      return diffViewEl.focus();
    case "back":
      return navigate(navBack, navForward);
    case "forward":
      return navigate(navForward, navBack);
    case "parent":
      return selectParent();
    case "child":
      return selectChild();
    case "prevTab":
      return cycleTab(-1);
    case "nextTab":
      return cycleTab(1);
  }
}

/** Runs a stage or unstage call; refreshes in `finally` (spec §6.3). */
async function runWrite(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    showErrorNotice(errorMessage(err));
  } finally {
    refresher.request();
  }
}

async function commit(): Promise<void> {
  const repo = currentRepo();
  if (sourceControlCommitBtn.disabled || repo === null) return;
  committing = true;
  updateCommitBox();
  try {
    const r = await gitCommit(repo, sourceControlMessageEl.value);
    sourceControlMessageEl.value = "";
    showInfoNotice(`Committed ${r.hash}`);
  } catch (err) {
    showErrorNotice(errorMessage(err));
  } finally {
    committing = false;
    updateCommitBox();
    refresher.request();
  }
}

const refresher = createStatusRefresher<GitStatus>({
  fetch: gitStatus,
  currentCwd: () => activeCwd,
  onResult(cwd, status) {
    pollError = null;
    view = status.repo === null ? { kind: "notRepo", cwd } : { kind: "status", status };
    render();
    if (showHistory()) void loadHistory(false); // a changed status can mean a moved HEAD
    if (status.repo !== null && selection.kind === "worktree") followWorktree(status);
    syncPane();
  },
  onError(_cwd, err) {
    if ((err as { code?: string })?.code === "git_not_found") {
      view = { kind: "gitMissing" };
      pollError = null;
    } else {
      pollError = errorMessage(err);
    }
    render(); // poll errors never toast (spec §7)
    syncPane();
  },
});

function onSnapshot(snapshot: RawSnapshot): void {
  // shortcut: new_workspace_cwd follows a cd only after herdr learns the pane's new cwd (the shell reports it, e.g. OSC 7); add a shell-integration hint if users expect otherwise.
  const ws = snapshot.workspaces.find((w) => w.focused);
  const id = ws?.workspace_id ?? null;
  const cwd = ws?.new_workspace_cwd || null;
  if (id === activeWorkspaceId && cwd === activeCwd) return;
  activeWorkspaceId = id;
  activeCwd = cwd;
  historyRows = null;
  historyHasMore = false;
  historyLoadingMore = false;
  historyError = null;
  selectedHash = null;
  ++historySeq;
  renderHistory(); // clears the old repo's rows before the new status shows the list
  // A new workspace starts on its working directory, with no file tabs.
  selection = { kind: "worktree" };
  detail = null;
  detailError = null;
  tabs = [];
  activeTab = -1;
  navBack.length = 0;
  navForward.length = 0;
  ++paneSeq;
  refresher.reset();
  pollError = null;
  view = cwd ? { kind: "loading" } : { kind: "noWorkspace" };
  render();
  syncPane(); // hidden until the new status arrives
  if (isActive()) refresher.request();
}

/** The caller's default (git P1): the pane shows while Source Control is active. */
export function applySourceControlVisibility(): void {
  sourceControlEl.hidden = !appState.settings.sourceControlOpen;
  if (isActive()) {
    render();
    refresher.request();
    if (showHistory()) void loadHistory(false);
    showPane();
  } else {
    hidePane(diffViewEl.contains(document.activeElement) || sourceControlEl.contains(document.activeElement));
  }
}

export async function initSourceControl(): Promise<void> {
  applySourceControlVisibility();
  sourceControlRefreshBtn.addEventListener("click", () => {
    refresher.request();
    if (showHistory()) void loadHistory(false);
    const tab = tabs[activeTab];
    if (tab && selection.kind === "worktree") void fetchTabDiff(tab); // an edit that keeps the status changes no list
  });
  sourceControlTabFilesBtn.addEventListener("click", () => setTab("files"));
  sourceControlTabCommitsBtn.addEventListener("click", () => setTab("commits"));
  sourceControlFilterBtn.addEventListener("click", () => {
    filterOpen = !filterOpen;
    if (!filterOpen) sourceControlFilterEl.value = "";
    render();
    if (filterOpen) sourceControlFilterEl.focus();
  });
  sourceControlFilterEl.addEventListener("input", render);
  sourceControlFilterEl.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    filterOpen = false;
    sourceControlFilterEl.value = "";
    render();
    sourceControlFilterBtn.focus();
  });
  const setTreeView = (tree: boolean) => {
    treeView = tree;
    render();
  };
  sourceControlViewChangesBtn.addEventListener("click", () => setTreeView(false));
  sourceControlViewTreeBtn.addEventListener("click", () => setTreeView(true));
  // The pinned row selects the working directory and puts the caret in the commit box.
  const openWorktree = () => {
    select({ kind: "worktree" });
    if (activeTab >= 0) activateTab(-1);
    if (!diffViewEl.hidden) sourceControlMessageEl.focus();
  };
  sourceControlPinnedEl.addEventListener("click", openWorktree);
  sourceControlPinnedEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openWorktree();
  });
  sourceControlEl.addEventListener("keydown", onPanelKey);
  diffViewEl.addEventListener("keydown", onPanelKey);
  // Focus that leaves the panel, the pane and the menus (the terminal, the find bar,
  // a tab) must not type behind the pane (spec §6.2): hide it, without taking focus.
  document.addEventListener("focusin", (event) => {
    const target = event.target as Node;
    if (!diffViewEl.contains(target) && !sourceControlEl.contains(target) && !overlayRoot.contains(target)) hidePane(false);
  });
  sourceControlMessageEl.addEventListener("input", updateCommitBox);
  sourceControlMessageEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    void commit();
  });
  sourceControlCommitBtn.addEventListener("click", () => void commit());
  if (IS_MAC) sourceControlMessageEl.placeholder = "Message (⌘Return to commit)";
  window.addEventListener("focus", () => {
    if (isActive()) refresher.request();
  });
  window.setInterval(() => {
    if (isActive() && !document.hidden) refresher.request();
  }, POLL_MS);
  await listen<RawSnapshot>("snapshot", (event) => onSnapshot(event.payload));
}
```

- lines: edit 1 +0 −10 = 10; edit 2 +18 −1 = 19; edit 3 +2 −0 = 2; edit 4 +3 −2 = 5; edit 5 +2 −2 = 4; edit 6 +1 −1 = 2; edit 7 +1 −1 = 2; edit 8 +2 −2 = 4; edit 9 +2 −0 = 2; edit 10 +4 −0 = 4; edit 11 +2 −3 = 5; edit 12 +0 −27 = 27; edit 13 +5 −1 = 6; edit 14 +3 −2 = 5; edit 15 +10 −0 = 10; `appSourceControl.ts` 681 lines replace 410 (+365 −93 by diff).
- exec: `judgment`. The texts are exact, but the step replaces the orchestration file whole and changes the P0 overlay into the pane; the executor checks the pre-image hash and reports any mismatch.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run 2>&1 | grep -E 'Test Files|Tests '`
  Expected: tsc silent, `Test Files  73 passed (73)`, `Tests  858 passed (858)`.

**Commit boundary H3. Do not commit.** Files: `gui/src/git/panelKeys.ts`, `gui/tests/unit/git/panelKeys.test.ts`, `gui/src/ui/diffView.ts`, `gui/src/ui/sourceControl.ts`, `gui/src/ui/detailsPane.ts`, `gui/tests/unit/ui/detailsPane.test.ts`, `gui/src/style.css`, `gui/index.html`, `gui/src/appDom.ts`, `gui/tests/unit/ui/sourceControl.test.ts`, `gui/src/appSourceControl.ts`. Suggested message: `feat: replace the diff overlay with a tabbed details pane`.

---

## Slice H4: Summary file sections, the file menu, and the sidebar width

After H4, every file in a Summary is a collapsible section with its diff inline (the first 500 rows), "Collapse all" / "Expand all", `-N +M` counts in each header, and a "…" menu. The same file menu opens on a sidebar row (right click or Shift+F10), on a section header and from the file tab header. The sidebar can be dragged to 640 px.
### step P1.11
Goal: add the pure Summary section rules (`sectionKey`, the initial collapse, which sections read, the diff line counts) and the pure file-menu items, with node tests.

- files: `gui/src/git/summaryDiffs.ts` (new), `gui/tests/unit/git/summaryDiffs.test.ts` (new), `gui/src/ui/fileMenu.ts` (new), `gui/tests/unit/ui/fileMenu.test.ts` (new)

new file `gui/src/git/summaryDiffs.ts`, full content:
```ts
// Git P1: which Summary sections load their diff, and the line counts of a
// loaded diff. Pure, so the rules have a node test.

import { parseUnifiedDiff } from "./diffParse";
import type { FileChange, GitDiff } from "./gitApi";

export type SectionSide = "staged" | "unstaged" | "commit";

/** More files than this: every section starts collapsed, so a large commit
 * does not start hundreds of diff reads. */
export const AUTO_EXPAND_LIMIT = 25;

/** One Summary section per file and side. The kind is part of the key, so a
 * file whose kind changes loads again, as the P0 open diff did. */
export function sectionKey(file: FileChange, side: SectionSide): string {
  return `${side}:${file.kind}:${file.path}`;
}

/** The sections that start collapsed for a new selection. */
export function initialCollapsed(keys: readonly string[]): Set<string> {
  return keys.length > AUTO_EXPAND_LIMIT ? new Set(keys) : new Set();
}

/** The expanded sections to read, in display order: not loaded and not in
 * flight. After a status change a file keeps its key, so its loaded diff
 * stays (an edit that keeps the status shows after Refresh); a new or
 * changed file gets a new key and loads. */
export function sectionsToLoad(
  keys: readonly string[],
  collapsed: ReadonlySet<string>,
  loaded: ReadonlySet<string>,
  inFlight: ReadonlySet<string>,
): string[] {
  return keys.filter((key) => !collapsed.has(key) && !loaded.has(key) && !inFlight.has(key));
}

/** The `+` and `-` rows of a diff, for a header with no `--numstat` counts. */
export function diffCounts(diff: GitDiff): { added: number | null; deleted: number | null } {
  if (diff.binary) return { added: null, deleted: null };
  let added = 0;
  let deleted = 0;
  for (const line of parseUnifiedDiff(diff.text)) {
    if (line.kind === "add") added += 1;
    else if (line.kind === "del") deleted += 1;
  }
  return { added, deleted };
}
```

new file `gui/tests/unit/git/summaryDiffs.test.ts`, full content:
```ts
// Git P1: the Summary section load rules and the diff line counts.

import { describe, expect, it } from "vitest";
import { AUTO_EXPAND_LIMIT, diffCounts, initialCollapsed, sectionKey, sectionsToLoad } from "../../../src/git/summaryDiffs";

const change = (path: string, kind: "modified" | "added" = "modified") => ({ path, origPath: null, kind });

describe("sectionKey", () => {
  it("changes with the side and the kind, so a changed file loads again", () => {
    expect(sectionKey(change("a.txt"), "unstaged")).toBe("unstaged:modified:a.txt");
    expect(sectionKey(change("a.txt"), "staged")).not.toBe(sectionKey(change("a.txt"), "unstaged"));
    expect(sectionKey(change("a.txt", "added"), "staged")).not.toBe(sectionKey(change("a.txt"), "staged"));
  });
});

describe("initialCollapsed", () => {
  it("expands every section up to the limit and collapses all of them past it", () => {
    const keys = Array.from({ length: AUTO_EXPAND_LIMIT }, (_, i) => `k${i}`);
    expect(initialCollapsed(keys).size).toBe(0);
    expect(initialCollapsed([...keys, "one more"]).size).toBe(AUTO_EXPAND_LIMIT + 1);
  });
});

describe("sectionsToLoad", () => {
  it("reads only expanded sections that are neither loaded nor in flight, in order", () => {
    const keys = ["a", "b", "c", "d", "e"];
    expect(sectionsToLoad(keys, new Set(["b"]), new Set(["c"]), new Set(["d"]))).toEqual(["a", "e"]);
  });

  it("after a status change loads only the new keys", () => {
    const before = [sectionKey(change("a.txt"), "unstaged")];
    const after = [...before, sectionKey(change("b.txt"), "unstaged")];
    expect(sectionsToLoad(after, new Set(), new Set(before), new Set())).toEqual(["unstaged:modified:b.txt"]);
  });
});

describe("diffCounts", () => {
  it("counts the + and - rows, and none for a binary file", () => {
    const text = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old\n+new\n+more\n ctx\n";
    expect(diffCounts({ text, truncated: false, binary: false })).toEqual({ added: 2, deleted: 1 });
    expect(diffCounts({ text: "Binary files a/x and b/x differ\n", truncated: false, binary: true })).toEqual({ added: null, deleted: null });
  });
});
```

new file `gui/src/ui/fileMenu.ts`, full content:
```ts
// Git P1: the file context menu of the Source Control panel and the details
// pane (inventory section B). Pure item data for `openMenu` (`ui/menu.ts`).
// Discard, Delete and Revert File wait for P2 and its safety rules; File
// History, Blame, Cherry Pick File, Save Patch and Open in Editor are later
// slices.

import type { FileChange } from "../git/gitApi";
import type { MenuItemSpec } from "./menu";

export interface FileMenuActions {
  onStage(): void;
  onUnstage(): void;
  onOpenFolder(): void;
  onCopyPath(): void;
}

/** `staged` is `true` for a staged file, `false` for an unstaged one, and
 * `null` for a commit's file. A conflicted file has no Stage item: `git add`
 * would mark it resolved. */
export function fileMenuItems(file: FileChange, staged: boolean | null, actions: FileMenuActions): MenuItemSpec[] {
  const items: MenuItemSpec[] = [];
  if (staged === false && file.kind !== "conflicted") items.push({ id: "stage", label: "Stage", onSelect: actions.onStage });
  if (staged === true) items.push({ id: "unstage", label: "Unstage", onSelect: actions.onUnstage });
  items.push({
    id: "open-folder",
    label: "Open Containing Folder",
    separatorBefore: items.length > 0,
    onSelect: actions.onOpenFolder,
  });
  items.push({ id: "copy-path", label: "Copy File Path", onSelect: actions.onCopyPath });
  return items;
}
```

new file `gui/tests/unit/ui/fileMenu.test.ts`, full content:
```ts
// Git P1: the file context menu items by file state.

import { describe, expect, it, vi } from "vitest";
import type { FileChange } from "../../../src/git/gitApi";
import { fileMenuItems } from "../../../src/ui/fileMenu";

const file = (kind: FileChange["kind"]): FileChange => ({ path: "src/a.ts", origPath: null, kind });

function actions() {
  return { onStage: vi.fn(), onUnstage: vi.fn(), onOpenFolder: vi.fn(), onCopyPath: vi.fn() };
}

describe("fileMenuItems", () => {
  it("offers Stage for an unstaged file, Unstage for a staged one, and neither for a commit's file", () => {
    const ids = (staged: boolean | null, kind: FileChange["kind"] = "modified") =>
      fileMenuItems(file(kind), staged, actions()).map((i) => i.id);
    expect(ids(false)).toEqual(["stage", "open-folder", "copy-path"]);
    expect(ids(true)).toEqual(["unstage", "open-folder", "copy-path"]);
    expect(ids(null)).toEqual(["open-folder", "copy-path"]);
    expect(ids(false, "conflicted")).toEqual(["open-folder", "copy-path"]);
  });

  it("puts a separator before the shared items only after a stage item, and runs the actions", () => {
    const a = actions();
    const items = fileMenuItems(file("untracked"), false, a);
    expect(items.find((i) => i.id === "open-folder")?.separatorBefore).toBe(true);
    expect(fileMenuItems(file("added"), null, a)[0].separatorBefore).toBe(false);
    for (const item of items) item.onSelect?.();
    expect([a.onStage, a.onOpenFolder, a.onCopyPath].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    expect(a.onUnstage).not.toHaveBeenCalled();
  });
});
```

- lines: `summaryDiffs.ts` 47 (new file); `summaryDiffs.test.ts` 43 (new file); `fileMenu.ts` 32 (new file); `fileMenu.test.ts` 32 (new file).
- exec: `judgment`. New files; the content is verbatim.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run tests/unit/git/summaryDiffs.test.ts tests/unit/ui/fileMenu.test.ts 2>&1 | grep -E 'Test Files|Tests '`
  Expected: tsc silent, `Test Files  2 passed (2)`, `Tests  7 passed (7)`.

### step P1.12
Goal: make each Summary file a collapsible section with its diff, add Collapse all, the header counts and the "…" button, the file menu on sections, sidebar rows and the file tab, and the section reads (four at a time).

- files: `gui/src/ui/diffView.ts`, `gui/src/ui/detailsPane.ts`, `gui/tests/unit/ui/detailsPane.test.ts`, `gui/src/ui/sourceControl.ts`, `gui/tests/unit/ui/sourceControl.test.ts`, `gui/src/appSourceControl.ts`, `gui/src/style.css`
- Rules the edits implement:
  - A section's key is `sectionKey(file, side)`; the kind is part of it, so a changed file reads again.
  - The first Summary render of a selection collapses every section when there are more than 25 files (`initialCollapsed`); otherwise all start expanded.
  - Expanded sections read their diff, at most 4 at once (`SECTION_READS`); a finished read re-renders its own section only. A read error shows in its section, not as a toast: it is a background load (spec §7).
  - On a status change, a working-directory file keeps its key and its diff; a file that left the lists drops its diff; a new key reads. Refresh drops every working-directory diff and reads again.
  - A section toggle re-renders the Summary with the scroll kept, then puts focus back on that header.
  - The file menu returns focus to the clicked element, never to the terminal capture, whose focus would hide the pane.

edit 1 (`diffView.ts`): a section shows at most `maxLines` rows.

old:
```ts
// it in a file tab. DOM only. Diff text comes from the repo and is untrusted,
// so all text uses `textContent`.
```

new:
```ts
// it in a file tab and in each Summary section. DOM only. Diff text comes
// from the repo and is untrusted, so all text uses `textContent`.
```

edit 2 (`diffView.ts`):

old:
```ts
 * for a binary file. Wide lines scroll inside the block. */
export function renderDiffLines(diff: GitDiff | null, fontSizePx: number): HTMLElement {
```

new:
```ts
 * for a binary file. Wide lines scroll inside the block. Past `maxLines`, a
 * note points to the file tab. */
export function renderDiffLines(diff: GitDiff | null, fontSizePx: number, maxLines = Infinity): HTMLElement {
```

edit 3 (`diffView.ts`):

old:
```ts
    for (const line of parseUnifiedDiff(diff.text)) {
```

new:
```ts
    const parsed = parseUnifiedDiff(diff.text);
    for (const line of parsed.slice(0, maxLines)) {
```

edit 4 (`diffView.ts`):

old:
```ts
    code.appendChild(lines);
    if (diff.truncated) code.appendChild(el("div", "diff-view__note", "Diff truncated at 2 MiB"));
```

new:
```ts
    code.appendChild(lines);
    if (parsed.length > maxLines) {
      code.appendChild(el("div", "diff-view__note", `${parsed.length - maxLines} more lines: open the file tab`));
    }
    if (diff.truncated) code.appendChild(el("div", "diff-view__note", "Diff truncated at 2 MiB"));
```

edit 5 (`detailsPane.ts`): file sections replace the file rows; the renderers return the sections by key.

old:
```ts
// Summary of the selected commit or of the working directory, and file tabs.
```

new:
```ts
// Summary of the selected commit or of the working directory (one collapsible
// section per file, with its diff), and file tabs.
```

edit 6 (`detailsPane.ts`):

old:
```ts
import type { CommitDetail, CommitFile, FileChange, GitDiff, GitStatus } from "../git/gitApi";
import { FONT_STACK } from "../render/renderer";
```

new:
```ts
import type { CommitDetail, CommitFile, FileChange, GitDiff, GitStatus } from "../git/gitApi";
import { sectionKey, type SectionSide } from "../git/summaryDiffs";
import { FONT_STACK } from "../render/renderer";
```

edit 7 (`detailsPane.ts`):

old:
```ts
export interface CommitSummaryModel {
```

new:
```ts
/** One file section of a Summary (git P1, H4). */
export interface SectionState {
  collapsed: boolean;
  /** `undefined` before the read starts, `null` while it runs, a string for its error. */
  diff: GitDiff | string | null | undefined;
  /** The header counts: `--numstat` for a commit, the loaded diff for the working directory. */
  counts: { added: number | null; deleted: number | null } | null;
}

/** The section states of a Summary, looked up by `sectionKey`. */
export interface SectionsModel {
  section(key: string): SectionState;
  /** Every section is collapsed: the toolbar offers "Expand all". */
  allCollapsed: boolean;
}

export interface CommitSummaryModel extends SectionsModel {
```

edit 8 (`detailsPane.ts`):

old:
```ts
export interface SummaryCallbacks {
  onSelectCommit(hash: string): void;
  onOpenFile(file: FileChange, staged: boolean): void;
```

new:
```ts
/** A menu anchor in client pixels, and the element that gets focus back. */
export interface MenuAnchor {
  x: number;
  y: number;
  returnFocus: HTMLElement;
}

export interface SummaryCallbacks {
  onSelectCommit(hash: string): void;
  onOpenFile(file: FileChange, staged: boolean): void;
  onToggleSection(key: string): void;
  onToggleAll(): void;
  /** `staged` is `null` for a commit's file. */
  onFileMenu(file: FileChange, staged: boolean | null, at: MenuAnchor): void;
```

edit 9 (`detailsPane.ts`):

old:
```ts
  diff: GitDiff | null;
}

```

new:
```ts
  diff: GitDiff | null;
  counts: { added: number | null; deleted: number | null } | null;
}

/** Sections render at most this many diff rows; the file tab shows all of them. */
const INLINE_MAX_LINES = 500;

```

edit 10 (`detailsPane.ts`):

old:
```ts
function fileHeader(file: FileChange, counts: { added: number | null; deleted: number | null } | null): HTMLElement {
```

new:
```ts
function fileHeader(file: FileChange, counts: SectionState["counts"]): HTMLElement {
```

edit 11 (`detailsPane.ts`):

old:
```ts
  if (counts) header.appendChild(countBadges(counts.deleted, counts.added));
  return header;
}

/** The file rows of a Summary, capped like the sidebar lists. A click opens the file's tab. */
function fileRows(parent: HTMLElement, files: readonly (FileChange | CommitFile)[], staged: boolean, callbacks: SummaryCallbacks): void {
  for (const file of files.slice(0, MAX_ROWS_PER_GROUP)) {
    const counts = "added" in file ? file : null;
    const row = el("div", `summary-file summary-file--${file.kind}`);
    const header = fileHeader(file, counts);
    makeButton(header, () => callbacks.onOpenFile(file, staged));
    row.appendChild(header);
    parent.appendChild(row);
```

new:
```ts
  header.appendChild(countBadges(counts?.deleted ?? null, counts?.added ?? null));
  return header;
}

/** A "More Actions…" button: the file menu opens below it. */
function moreButton(onMenu: (at: MenuAnchor) => void, returnFocus: HTMLElement | null): HTMLButtonElement {
  const button = iconButton("ellipsis", "More Actions…", "icon-btn summary-file__more", () => {
    const rect = button.getBoundingClientRect();
    onMenu({ x: rect.left, y: rect.bottom, returnFocus: returnFocus ?? button });
  });
  return button;
}

/** Replaces one section's counts and body: the diff (its first rows only), a
 * note, or no body while collapsed. A finished read calls it alone, so the
 * rest of the Summary stays as it is. */
export function renderSectionBody(sectionEl: HTMLElement, state: SectionState, fontSizePx: number): void {
  sectionEl.querySelector(".summary-counts")?.replaceWith(countBadges(state.counts?.deleted ?? null, state.counts?.added ?? null));
  sectionEl.querySelector(".summary-file__body")?.remove();
  if (state.collapsed) return;
  const body = el("div", "summary-file__body");
  if (typeof state.diff === "string") body.appendChild(el("div", "diff-view__note", state.diff));
  else body.appendChild(renderDiffLines(state.diff ?? null, fontSizePx, INLINE_MAX_LINES));
  sectionEl.appendChild(body);
}

/** The file sections of a Summary, capped like the sidebar lists. A header
 * click or Enter opens the file's tab; the chevron or Space collapses the
 * section; "…" or a right click opens the file menu. Fills `sections` by key. */
function fileSections(
  parent: HTMLElement,
  files: readonly (FileChange | CommitFile)[],
  side: SectionSide,
  model: SectionsModel,
  fontSizePx: number,
  callbacks: SummaryCallbacks,
  sections: Map<string, HTMLElement>,
): void {
  const staged = side === "commit" ? null : side === "staged";
  for (const file of files.slice(0, MAX_ROWS_PER_GROUP)) {
    const key = sectionKey(file, side);
    const state = model.section(key);
    const sectionEl = el("div", `summary-file summary-file--${file.kind}`);
    const header = fileHeader(file, state.counts);
    header.tabIndex = 0;
    header.setAttribute("role", "button");
    header.setAttribute("aria-expanded", String(!state.collapsed));
    const label = state.collapsed ? "Expand" : "Collapse";
    header.prepend(iconButton(`chevron-${state.collapsed ? "right" : "down"}`, label, "summary-file__toggle", () => callbacks.onToggleSection(key)));
    const onMenu = (at: MenuAnchor) => callbacks.onFileMenu(file, staged, at);
    header.appendChild(moreButton(onMenu, header));
    header.addEventListener("click", () => callbacks.onOpenFile(file, staged ?? false));
    header.addEventListener("keydown", (event) => {
      if (event.target !== header) return;
      if (event.key === "Enter") callbacks.onOpenFile(file, staged ?? false);
      else if (event.key === " ") callbacks.onToggleSection(key);
      else return;
      event.preventDefault();
    });
    header.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      onMenu({ x: event.clientX, y: event.clientY, returnFocus: header });
    });
    sectionEl.appendChild(header);
    renderSectionBody(sectionEl, state, fontSizePx);
    sections.set(key, sectionEl);
    parent.appendChild(sectionEl);
```

edit 12 (`detailsPane.ts`):

old:
```ts
  }
}
```

new:
```ts
  }
}

/** "Collapse all", or "Expand all" when every section is collapsed. */
function toolbar(parent: HTMLElement, model: SectionsModel, callbacks: SummaryCallbacks): void {
  const bar = el("div", "summary-toolbar");
  const button = el("button", "btn summary-toolbar__toggle", model.allCollapsed ? "Expand all" : "Collapse all");
  button.type = "button";
  button.addEventListener("click", callbacks.onToggleAll);
  bar.appendChild(button);
  parent.appendChild(bar);
}
```

edit 13 (`detailsPane.ts`):

old:
```ts
/** The Summary of one commit: the meta block, the message and its files. */
```

new:
```ts
/** The Summary of one commit: the meta block, the message and one section
 * per file. Returns the sections by key. */
```

edit 14 (`detailsPane.ts`):

old:
```ts
  callbacks: SummaryCallbacks,
): void {
  bodyEl.textContent = "";
```

new:
```ts
  callbacks: SummaryCallbacks,
): Map<string, HTMLElement> {
  const sections = new Map<string, HTMLElement>();
  bodyEl.textContent = "";
```

edit 15 (`detailsPane.ts`):

old:
```ts
    bodyEl.appendChild(el("div", "diff-view__note", model.error ?? "Loading…"));
    return;
  }
```

new:
```ts
    bodyEl.appendChild(el("div", "diff-view__note", model.error ?? "Loading…"));
    return sections;
  }
```

edit 16 (`detailsPane.ts`):

old:
```ts
  fileRows(files, detail.files, false, callbacks);
  bodyEl.appendChild(files);
```

new:
```ts
  if (detail.files.length > 0) toolbar(files, model, callbacks);
  fileSections(files, detail.files, "commit", model, fontSizePx, callbacks, sections);
  bodyEl.appendChild(files);
  return sections;
```

edit 17 (`detailsPane.ts`):

old:
```ts
  staged: boolean,
  action: { label: string; files: FileChange[]; run: (files: FileChange[]) => void } | null,
  callbacks: SummaryCallbacks,
```

new:
```ts
  side: "staged" | "unstaged",
  action: { label: string; files: FileChange[]; run: (files: FileChange[]) => void },
  view: { model: SectionsModel; fontSizePx: number; callbacks: SummaryCallbacks; sections: Map<string, HTMLElement> },
```

edit 18 (`detailsPane.ts`):

old:
```ts
  if (action && action.files.length > 0) {
```

new:
```ts
  if (action.files.length > 0) {
```

edit 19 (`detailsPane.ts`):

old:
```ts
  fileRows(parent, files, staged, callbacks);
}

/** The working-directory sections under the commit box: Staged, Unstaged and
 * Untracked. Re-rendered alone on a status change. */
export function renderWorktreeSections(sectionsEl: HTMLElement, status: GitStatus, callbacks: WorktreeCallbacks): void {
```

new:
```ts
  fileSections(parent, files, side, view.model, view.fontSizePx, view.callbacks, view.sections);
}

/** The working-directory sections under the commit box: Staged, Unstaged and
 * Untracked. Re-rendered alone on a status change. Returns the file sections by key. */
export function renderWorktreeSections(
  sectionsEl: HTMLElement,
  status: GitStatus,
  model: SectionsModel,
  fontSizePx: number,
  callbacks: WorktreeCallbacks,
): Map<string, HTMLElement> {
  const sections = new Map<string, HTMLElement>();
```

edit 20 (`detailsPane.ts`):

old:
```ts
    return;
  }
  section(sectionsEl, "Staged", status.staged, true, { label: "Unstage All", files: status.staged, run: callbacks.onUnstage }, callbacks);
  // "Stage All" leaves conflicted files out: `git add` would mark them resolved.
  const stageable = unstaged.filter((f) => f.kind !== "conflicted");
  section(sectionsEl, "Unstaged", unstaged, false, { label: "Stage All", files: stageable, run: callbacks.onStage }, callbacks);
  section(sectionsEl, "Untracked", untracked, false, { label: "Stage All", files: untracked, run: callbacks.onStage }, callbacks);
}

/** A file tab: the path, the tag, and the diff. */
export function renderFileTab(bodyEl: HTMLElement, model: FileTabModel, fontSizePx: number): void {
```

new:
```ts
    return sections;
  }
  toolbar(sectionsEl, model, callbacks);
  const view = { model, fontSizePx, callbacks, sections };
  section(sectionsEl, "Staged", status.staged, "staged", { label: "Unstage All", files: status.staged, run: callbacks.onUnstage }, view);
  // "Stage All" leaves conflicted files out: `git add` would mark them resolved.
  const stageable = unstaged.filter((f) => f.kind !== "conflicted");
  section(sectionsEl, "Unstaged", unstaged, "unstaged", { label: "Stage All", files: stageable, run: callbacks.onStage }, view);
  section(sectionsEl, "Untracked", untracked, "unstaged", { label: "Stage All", files: untracked, run: callbacks.onStage }, view);
  return sections;
}

/** A file tab: the path, the tag, the counts, the "…" menu, and the whole diff. */
export function renderFileTab(bodyEl: HTMLElement, model: FileTabModel, fontSizePx: number, onMenu: (at: MenuAnchor) => void): void {
```

edit 21 (`detailsPane.ts`):

old:
```ts
  header.appendChild(el("span", "diff-view__tag", model.tag));
  bodyEl.appendChild(header);
```

new:
```ts
  header.appendChild(el("span", "diff-view__tag", model.tag));
  header.appendChild(countBadges(model.counts?.deleted ?? null, model.counts?.added ?? null));
  header.appendChild(moreButton(onMenu, null));
  bodyEl.appendChild(header);
```

edit 22 (`detailsPane.test.ts`): the new signatures, and the section tests.

old:
```ts
// Git P1: the details pane: the tab bar, the commit Summary, the
// working-directory sections and a file tab.

import { describe, expect, it, vi } from "vitest";
import type { CommitDetail, FileChange, GitStatus } from "../../../src/git/gitApi";
import {
  renderCommitSummary,
  renderFileTab,
  renderTabBar,
  renderWorktreeSections,
  type CommitSummaryModel,
```

new:
```ts
// Git P1: the details pane: the tab bar, the commit Summary with its file
// sections, the working-directory sections and a file tab.

import { describe, expect, it, vi } from "vitest";
import type { CommitDetail, FileChange, GitDiff, GitStatus } from "../../../src/git/gitApi";
import { sectionKey } from "../../../src/git/summaryDiffs";
import {
  renderCommitSummary,
  renderFileTab,
  renderSectionBody,
  renderTabBar,
  renderWorktreeSections,
  type CommitSummaryModel,
  type SectionState,
  type SectionsModel,
```

edit 23 (`detailsPane.test.ts`):

old:
```ts
function model(d: CommitDetail | null, error: string | null = null): CommitSummaryModel {
  return { detail: d, error, summaryOf: (hash) => (hash === "b".repeat(40) ? "the parent" : undefined) };
}
```

new:
```ts
/** Every section expanded and not read yet, unless `states` says otherwise. */
function sectionsModel(states: Record<string, Partial<SectionState>> = {}, allCollapsed = false): SectionsModel {
  return { section: (key) => ({ collapsed: false, diff: undefined, counts: null, ...states[key] }), allCollapsed };
}

function model(d: CommitDetail | null, error: string | null = null, sections = sectionsModel()): CommitSummaryModel {
  return { ...sections, detail: d, error, summaryOf: (hash) => (hash === "b".repeat(40) ? "the parent" : undefined) };
}

function summaryCallbacks() {
  return { onSelectCommit: vi.fn(), onOpenFile: vi.fn(), onToggleSection: vi.fn(), onToggleAll: vi.fn(), onFileMenu: vi.fn() };
}

const DIFF: GitDiff = { text: "@@ -1 +1 @@\n-a\n+b\n", truncated: false, binary: false };
```

edit 24 (`detailsPane.test.ts`):

old:
```ts
    const body = document.createElement("div");
    const cb = { onSelectCommit: vi.fn(), onOpenFile: vi.fn() };
    renderCommitSummary(body, model(null), 14, cb);
```

new:
```ts
    const body = document.createElement("div");
    const cb = summaryCallbacks();
    renderCommitSummary(body, model(null), 14, cb);
```

edit 25 (`detailsPane.test.ts`):

old:
```ts
    const cb = { onSelectCommit: vi.fn(), onOpenFile: vi.fn() };
    renderCommitSummary(body, model(detail()), 14, cb);
```

new:
```ts
    const cb = summaryCallbacks();
    const counts = { [sectionKey(detail().files[0], "commit")]: { counts: { added: 5, deleted: 3 } } };
    renderCommitSummary(body, model(detail(), null, sectionsModel(counts)), 14, cb);
```

edit 26 (`detailsPane.test.ts`):

old:
```ts
    expect(texts(body, ".summary-meta .sc-badge")).toEqual(["-3", "+5"]);
    expect(body.querySelector(".summary-meta__files")?.textContent).toBe("3 files");
```

new:
```ts
    expect(texts(body, ".summary-meta .sc-badge")).toEqual(["-3", "+5"]);
    expect(texts(body, ".summary-file__header .sc-badge")).toEqual(["-3", "+5"]);
    expect(body.querySelector(".summary-meta__files")?.textContent).toBe("3 files");
```

edit 27 (`detailsPane.test.ts`):

old:
```ts
    renderCommitSummary(body, model(detail({ parents: [] })), 14, { onSelectCommit: vi.fn(), onOpenFile: vi.fn() });
```

new:
```ts
    renderCommitSummary(body, model(detail({ parents: [] })), 14, summaryCallbacks());
```

edit 28 (`detailsPane.test.ts`):

old:
```ts
    const cb = { onSelectCommit: vi.fn(), onOpenFile: vi.fn(), onStage: vi.fn(), onUnstage: vi.fn() };
    const conflicted = change("c.txt", "conflicted");
    const edited = change("e.txt");
    const fresh = change("n.txt", "untracked");
    renderWorktreeSections(sections, status([change("s.txt")], [conflicted, edited, fresh]), cb);
```

new:
```ts
    const cb = { ...summaryCallbacks(), onStage: vi.fn(), onUnstage: vi.fn() };
    const conflicted = change("c.txt", "conflicted");
    const edited = change("e.txt");
    const fresh = change("n.txt", "untracked");
    renderWorktreeSections(sections, status([change("s.txt")], [conflicted, edited, fresh]), sectionsModel(), 14, cb);
```

edit 29 (`detailsPane.test.ts`):

old:
```ts
    const cb = { onSelectCommit: vi.fn(), onOpenFile: vi.fn(), onStage: vi.fn(), onUnstage: vi.fn() };
    renderWorktreeSections(sections, status([], []), cb);
```

new:
```ts
    const cb = { ...summaryCallbacks(), onStage: vi.fn(), onUnstage: vi.fn() };
    renderWorktreeSections(sections, status([], []), sectionsModel(), 14, cb);
```

edit 30 (`detailsPane.test.ts`):

old:
```ts
    renderFileTab(body, { file, tag: "abc1234", diff: null }, 14);
    expect(body.querySelector(".diff-view__path")?.textContent).toBe("a.txt → b.txt");
    expect(body.querySelector(".diff-view__tag")?.textContent).toBe("abc1234");
    expect(body.querySelector(".diff-view__note")?.textContent).toBe("Loading…");
    renderFileTab(body, { file, tag: "", diff: { text: "@@ -1 +1 @@\n-a\n+b\n", truncated: false, binary: false } }, 14);
    expect(texts(body, ".diff-row__text")).toEqual(["@@ -1 +1 @@", "-a", "+b"]);
  });
});

```

new:
```ts
    renderFileTab(body, { file, tag: "abc1234", diff: null, counts: null }, 14, vi.fn());
    expect(body.querySelector(".diff-view__path")?.textContent).toBe("a.txt → b.txt");
    expect(body.querySelector(".diff-view__tag")?.textContent).toBe("abc1234");
    expect(body.querySelector(".diff-view__note")?.textContent).toBe("Loading…");
    const onMenu = vi.fn();
    renderFileTab(body, { file, tag: "", diff: DIFF, counts: { added: 1, deleted: 1 } }, 14, onMenu);
    expect(texts(body, ".diff-row__text")).toEqual(["@@ -1 +1 @@", "-a", "+b"]);
    expect(texts(body, ".diff-view__header .sc-badge")).toEqual(["-1", "+1"]);
    body.querySelector<HTMLButtonElement>('button[aria-label="More Actions…"]')!.click();
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});

describe("Summary file sections", () => {
  const a = detail().files[0];
  const keyA = sectionKey(a, "commit");

  it("shows the diff of an expanded section, a note for a failed read, and no body when collapsed", () => {
    const body = document.createElement("div");
    const keyB = sectionKey(detail().files[1], "commit");
    const keyC = sectionKey(detail().files[2], "commit");
    const states = { [keyA]: { diff: DIFF }, [keyB]: { diff: "git timed out after 15s" }, [keyC]: { collapsed: true } };
    const sections = renderCommitSummary(body, model(detail(), null, sectionsModel(states)), 14, summaryCallbacks());
    expect([...sections.keys()]).toEqual([keyA, keyB, keyC]);
    expect(texts(sections.get(keyA)!, ".diff-row__text")).toEqual(["@@ -1 +1 @@", "-a", "+b"]);
    expect(sections.get(keyB)!.querySelector(".diff-view__note")?.textContent).toBe("git timed out after 15s");
    expect(sections.get(keyC)!.querySelector(".summary-file__body")).toBeNull();
    expect(sections.get(keyC)!.querySelector(".summary-file__header")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the tab on a click or Enter, toggles on the chevron or Space, and opens the menu on … or a right click", () => {
    const body = document.createElement("div");
    const cb = summaryCallbacks();
    const sections = renderCommitSummary(body, model(detail()), 14, cb);
    const header = sections.get(keyA)!.querySelector<HTMLElement>(".summary-file__header")!;
    header.click();
    header.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(cb.onOpenFile.mock.calls).toEqual([[a, false], [a, false]]);
    header.querySelector<HTMLButtonElement>(".summary-file__toggle")!.click();
    header.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(cb.onToggleSection.mock.calls).toEqual([[keyA], [keyA]]);
    header.querySelector<HTMLButtonElement>(".summary-file__more")!.click();
    header.dispatchEvent(new MouseEvent("contextmenu", { clientX: 3, clientY: 4, bubbles: true }));
    expect(cb.onFileMenu.mock.calls.map((c) => [c[0], c[1], c[2].returnFocus === header])).toEqual([
      [a, null, true],
      [a, null, true],
    ]);
    expect(cb.onOpenFile).toHaveBeenCalledTimes(2);
  });

  it("offers Collapse all, or Expand all when every section is collapsed", () => {
    const body = document.createElement("div");
    const cb = summaryCallbacks();
    renderCommitSummary(body, model(detail()), 14, cb);
    const toggle = body.querySelector<HTMLButtonElement>(".summary-toolbar__toggle")!;
    expect(toggle.textContent).toBe("Collapse all");
    toggle.click();
    expect(cb.onToggleAll).toHaveBeenCalledTimes(1);
    renderCommitSummary(body, model(detail(), null, sectionsModel({}, true)), 14, cb);
    expect(body.querySelector(".summary-toolbar__toggle")?.textContent).toBe("Expand all");
  });

  it("re-renders one section's counts and body alone, and caps a long diff", () => {
    const body = document.createElement("div");
    const sections = renderCommitSummary(body, model(detail()), 14, summaryCallbacks());
    const sectionEl = sections.get(keyA)!;
    const long: GitDiff = { text: `@@ -1,600 +1,600 @@\n${"+x\n".repeat(600)}`, truncated: false, binary: false };
    renderSectionBody(sectionEl, { collapsed: false, diff: long, counts: { added: 600, deleted: 0 } }, 14);
    expect(texts(sectionEl, ".summary-file__header .sc-badge")).toEqual(["-0", "+600"]);
    expect(sectionEl.querySelectorAll(".diff-row")).toHaveLength(500);
    expect(sectionEl.querySelector(".summary-file__body .diff-view__note")?.textContent).toBe("101 more lines: open the file tab");
  });
});

```

edit 31 (`sourceControl.ts`): the row's file menu.

old:
```ts
  onToggleCollapsed(key: string): void;
}
```

new:
```ts
  onToggleCollapsed(key: string): void;
  /** A right click or Shift+F10 on a file row (git P1). `staged` is `null` for a commit's file. */
  onFileMenu(file: FileChange, staged: boolean | null, at: { x: number; y: number; returnFocus: HTMLElement }): void;
}
```

edit 32 (`sourceControl.ts`):

old:
```ts
  });
  row.dataset.path = change.path;
```

new:
```ts
  });
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    callbacks.onFileMenu(change, staged, { x: event.clientX, y: event.clientY, returnFocus: row });
  });
  row.addEventListener("keydown", (event) => {
    if (event.target !== row || event.key !== "F10" || !event.shiftKey) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    callbacks.onFileMenu(change, staged, { x: rect.left, y: rect.bottom, returnFocus: row });
  });
  row.dataset.path = change.path;
```

edit 33 (`sourceControl.test.ts`): the new callback, and a menu test.

old:
```ts
  return { onOpenGitDownload: vi.fn(), onOpenFile: vi.fn(), onStage: vi.fn(), onUnstage: vi.fn(), onToggleCollapsed: vi.fn() };
```

new:
```ts
  return {
    onOpenGitDownload: vi.fn(),
    onOpenFile: vi.fn(),
    onStage: vi.fn(),
    onUnstage: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onFileMenu: vi.fn(),
  };
```

edit 34 (`sourceControl.test.ts`):

old:
```ts
  });
});
```

new:
```ts
  });

  it("opens the file menu on a right click and on Shift+F10, with the row's stage state", () => {
    const cb = callbacks();
    const body = render(["a.txt"], {}, cb);
    const row = body.querySelector<HTMLElement>(".sc-row")!;
    row.dispatchEvent(new MouseEvent("contextmenu", { clientX: 5, clientY: 6, bubbles: true }));
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
    expect(cb.onFileMenu.mock.calls.map((c) => [c[0].path, c[1], c[2].returnFocus === row])).toEqual([
      ["a.txt", false, true],
      ["a.txt", false, true],
    ]);
    expect(cb.onFileMenu.mock.calls[0][2]).toMatchObject({ x: 5, y: 6 });
  });
});
```

edit 35 (`appSourceControl.ts`): the section state, the reads, the toggles and the file menu.

old:
```ts
  type CommitDetail,
  type CommitRow,
```

new:
```ts
  type CommitDetail,
  type CommitFile,
  type CommitRow,
```

edit 36 (`appSourceControl.ts`):

old:
```ts
import { createStatusRefresher, followOpenDiff } from "./git/statusRefresh";
import { focusKeyboardCapture } from "./keyboard/focusCapture";
```

new:
```ts
import { createStatusRefresher, followOpenDiff } from "./git/statusRefresh";
import { diffCounts, initialCollapsed, sectionKey, sectionsToLoad, type SectionSide } from "./git/summaryDiffs";
import { focusKeyboardCapture } from "./keyboard/focusCapture";
```

edit 37 (`appSourceControl.ts`):

old:
```ts
import { renderCommitSummary, renderFileTab, renderTabBar, renderWorktreeSections } from "./ui/detailsPane";
import { renderSourceControl, type FilesView, type SourceControlView } from "./ui/sourceControl";
```

new:
```ts
import {
  renderCommitSummary,
  renderFileTab,
  renderSectionBody,
  renderTabBar,
  renderWorktreeSections,
  type MenuAnchor,
  type SectionsModel,
} from "./ui/detailsPane";
import { fileMenuItems } from "./ui/fileMenu";
import { openMenu } from "./ui/menu";
import { MAX_ROWS_PER_GROUP, renderSourceControl, type FilesView, type SourceControlView } from "./ui/sourceControl";
```

edit 38 (`appSourceControl.ts`):

old:
```ts
const navForward: Selection[] = [];

```

new:
```ts
const navForward: Selection[] = [];
// Summary file sections (git P1), by `sectionKey`: collapse state, loaded diffs, reads in flight.
const SECTION_READS = 4; // diff reads in flight at once
let sectionsReady = false; // the first Summary render of a selection sets the initial collapse
let sectionCollapsed = new Set<string>();
const sectionDiffs = new Map<string, GitDiff | string>(); // a string is the read's error
const sectionReads = new Set<string>();
let sectionEls = new Map<string, HTMLElement>(); // the rendered sections, for a finished read

```

edit 39 (`appSourceControl.ts`):

old:
```ts
      onToggleCollapsed: toggleCollapsed,
      onStage: stageFiles,
```

new:
```ts
      onToggleCollapsed: toggleCollapsed,
      onFileMenu: openFileMenu,
      onStage: stageFiles,
```

edit 40 (`appSourceControl.ts`):

old:
```ts
    ++paneSeq;
    renderHistory();
```

new:
```ts
    ++paneSeq;
    resetSections();
    renderHistory();
```

edit 41 (`appSourceControl.ts`):

old:
```ts
  onOpenFile: openFileTab,
};
```

new:
```ts
  onOpenFile: openFileTab,
  onToggleSection: toggleSection,
  onToggleAll: toggleAllSections,
  onFileMenu: openFileMenu,
};
```

edit 42 (`appSourceControl.ts`):

old:
```ts
    renderFileTab(detailsBodyEl, { file: tab.file, tag, diff: tab.diff }, fontSize());
  } else if (selection.kind === "commit") {
    renderCommitSummary(
      detailsBodyEl,
      { detail, error: detailError, summaryOf: (hash) => historyRows?.find((r) => r.hash === hash)?.summary },
      fontSize(),
      summaryCallbacks,
    );
```

new:
```ts
    const staged = selection.kind === "commit" ? null : tab.staged;
    const model = { file: tab.file, tag, diff: tab.diff, counts: fileCounts(tab.file, tab.diff) };
    renderFileTab(detailsBodyEl, model, fontSize(), (at) => openFileMenu(tab.file, staged, at));
  } else if (selection.kind === "commit") {
    initSections();
    sectionEls = renderCommitSummary(
      detailsBodyEl,
      { ...sectionsModel(), detail, error: detailError, summaryOf: (hash) => historyRows?.find((r) => r.hash === hash)?.summary },
      fontSize(),
      summaryCallbacks,
    );
    pumpSections();
```

edit 43 (`appSourceControl.ts`):

old:
```ts
  renderWorktreeSections(summarySectionsEl, view.status, { ...summaryCallbacks, onStage: stageFiles, onUnstage: unstageFiles });
```

new:
```ts
  initSections();
  // A file that left the lists drops its diff.
  const keys = new Set(summaryFiles().map(({ file, side }) => sectionKey(file, side)));
  for (const key of sectionDiffs.keys()) if (!keys.has(key)) sectionDiffs.delete(key);
  sectionEls = renderWorktreeSections(summarySectionsEl, view.status, sectionsModel(), fontSize(), {
    ...summaryCallbacks,
    onStage: stageFiles,
    onUnstage: unstageFiles,
  });
  pumpSections();
}

/** Line counts for a header: `--numstat` for a commit's file, else the loaded diff. */
function fileCounts(file: FileChange | CommitFile, diff: GitDiff | string | null | undefined) {
  if ("added" in file) return { added: file.added, deleted: file.deleted };
  return diff && typeof diff !== "string" ? diffCounts(diff) : null;
}

/** The Summary's files with their sides, in display order, capped like the renderers. */
function summaryFiles(): { file: FileChange | CommitFile; side: SectionSide }[] {
  if (selection.kind === "commit") {
    return (detail?.files ?? []).slice(0, MAX_ROWS_PER_GROUP).map((file) => ({ file, side: "commit" as const }));
  }
  if (view.kind !== "status") return [];
  const { staged, unstaged } = view.status;
  const group = (files: FileChange[], side: SectionSide) => files.slice(0, MAX_ROWS_PER_GROUP).map((file) => ({ file, side }));
  return [
    ...group(staged, "staged"),
    ...group(unstaged.filter((f) => f.kind !== "untracked"), "unstaged"),
    ...group(unstaged.filter((f) => f.kind === "untracked"), "unstaged"),
  ];
}

function sectionsModel(): SectionsModel {
  const files = new Map<string, FileChange | CommitFile>();
  for (const { file, side } of summaryFiles()) files.set(sectionKey(file, side), file);
  return {
    section: (key) => {
      const diff = sectionDiffs.get(key) ?? (sectionReads.has(key) ? null : undefined);
      const file = files.get(key);
      return { collapsed: sectionCollapsed.has(key), diff, counts: file ? fileCounts(file, diff) : null };
    },
    allCollapsed: files.size > 0 && [...files.keys()].every((key) => sectionCollapsed.has(key)),
  };
}

function resetSections(): void {
  sectionsReady = false;
  sectionDiffs.clear();
  sectionReads.clear();
  sectionEls = new Map();
}

/** The first Summary render of a selection sets the initial collapse (`initialCollapsed`). */
function initSections(): void {
  if (sectionsReady || (selection.kind === "commit" && detail === null)) return;
  sectionCollapsed = initialCollapsed(summaryFiles().map(({ file, side }) => sectionKey(file, side)));
  sectionsReady = true;
}

/** Starts diff reads for the expanded sections, at most SECTION_READS at once. */
function pumpSections(): void {
  const repo = currentRepo();
  if (repo === null) return;
  const entries = summaryFiles();
  const keys = entries.map(({ file, side }) => sectionKey(file, side));
  for (const key of sectionsToLoad(keys, sectionCollapsed, new Set(sectionDiffs.keys()), sectionReads)) {
    if (sectionReads.size >= SECTION_READS) return;
    const { file, side } = entries[keys.indexOf(key)];
    void readSection(repo, key, file, side);
  }
}

async function readSection(repo: string, key: string, file: FileChange, side: SectionSide): Promise<void> {
  const seq = paneSeq;
  const sel = selection;
  sectionReads.add(key);
  let result: GitDiff | string;
  try {
    result =
      sel.kind === "commit"
        ? await gitCommitDiff(repo, sel.hash, file.path, file.origPath)
        : await gitDiff(repo, file.path, side === "staged", file.kind === "untracked");
  } catch (err) {
    result = errorMessage(err); // a background read: the error shows in its section (spec §7)
  }
  if (seq !== paneSeq) return;
  sectionReads.delete(key);
  sectionDiffs.set(key, result);
  const sectionEl = sectionEls.get(key);
  if (sectionEl?.isConnected) renderSectionBody(sectionEl, sectionsModel().section(key), fontSize());
  pumpSections();
}

/** Re-renders the Summary in place, scroll kept. `focusKey` puts focus back on that section's header. */
function rerenderSummary(focusKey?: string): void {
  if (activeTab >= 0 || diffViewEl.hidden) return;
  if (summarySectionsEl) renderWorktree();
  else showActiveTab(true);
  if (focusKey) sectionEls.get(focusKey)?.querySelector<HTMLElement>(".summary-file__header")?.focus();
}

function toggleSection(key: string): void {
  if (!sectionCollapsed.delete(key)) sectionCollapsed.add(key);
  rerenderSummary(key);
}

/** Collapse all, or Expand all when every section is collapsed. */
function toggleAllSections(): void {
  const keys = summaryFiles().map(({ file, side }) => sectionKey(file, side));
  sectionCollapsed = keys.every((key) => sectionCollapsed.has(key)) ? new Set() : new Set(keys);
  rerenderSummary();
}

/** The file context menu (inventory section B) for a sidebar row, a Summary
 * section or a file tab. Focus returns to the clicked element, never to the
 * terminal capture: its focus would hide the pane. */
function openFileMenu(file: FileChange, staged: boolean | null, at: MenuAnchor): void {
  const repo = currentRepo();
  if (repo === null) return;
  const absolute = `${repo}/${file.path}`;
  const root = overlayRoot.getBoundingClientRect();
  const items = fileMenuItems(file, staged, {
    onStage: () => stageFiles([file]),
    onUnstage: () => unstageFiles([file]),
    onOpenFolder: () => void invokeSafe("open_folder", { path: absolute.slice(0, absolute.lastIndexOf("/")) }),
    onCopyPath: () => {
      // git prints `C:/...`; a Windows path pastes with backslashes.
      const text = IS_MAC ? absolute : absolute.replace(/\//g, "\\");
      navigator.clipboard.writeText(text).catch((err: unknown) => showErrorNotice(errorMessage(err)));
    },
  });
  openMenu(overlayRoot, { left: at.x - root.left, top: at.y - root.top }, items, { returnFocusTo: at.returnFocus });
```

edit 44 (`appSourceControl.ts`):

old:
```ts
  ++paneSeq;
  refresher.reset();
```

new:
```ts
  ++paneSeq;
  resetSections();
  refresher.reset();
```

edit 45 (`appSourceControl.ts`):

old:
```ts
    const tab = tabs[activeTab];
    if (tab && selection.kind === "worktree") void fetchTabDiff(tab); // an edit that keeps the status changes no list
```

new:
```ts
    if (selection.kind === "worktree") {
      // An edit that keeps the status changes no list and no key: read the diffs again.
      const tab = tabs[activeTab];
      if (tab) void fetchTabDiff(tab);
      sectionDiffs.clear();
      rerenderSummary();
    }
```

edit 46 (`style.css`) (end of file): the end of the H3 block. Append the section styles.

old:
```css
.summary-file__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

new:
```css
.summary-file__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Summary file sections (git P1): a collapsible header over its diff. */

.summary-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 0 12px 6px;
}

.summary-toolbar__toggle {
  padding: 0 8px;
  font-size: var(--fs-xs);
}

.summary-file__toggle {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 16px;
  height: 16px;
  margin-left: -4px;
}

.summary-file__toggle .codicon {
  font-size: 14px;
}

.summary-file__more {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  visibility: hidden;
}

.summary-file__header:hover .summary-file__more,
.summary-file__header:focus-within .summary-file__more {
  visibility: visible;
}

.summary-file__header[aria-expanded="true"] {
  border-radius: 3px 3px 0 0;
}

.summary-file__body {
  border: 1px solid var(--sc-file-header-bg);
  border-top: none;
  border-radius: 0 0 3px 3px;
}

.diff-row--hunk {
  background: var(--sc-hunk-header-bg);
}
```

- lines: edit 1 +2 −2 = 4; edit 2 +3 −2 = 5; edit 3 +2 −1 = 3; edit 4 +3 −0 = 3; edit 5 +2 −1 = 3; edit 6 +1 −0 = 1; edit 7 +17 −1 = 18; edit 8 +11 −0 = 11; edit 9 +4 −0 = 4; edit 10 +1 −1 = 2; edit 11 +63 −9 = 72; edit 12 +10 −0 = 10; edit 13 +2 −1 = 3; edit 14 +2 −1 = 3; edit 15 +1 −1 = 2; edit 16 +3 −1 = 4; edit 17 +3 −3 = 6; edit 18 +1 −1 = 2; edit 19 +10 −3 = 13; edit 20 +9 −6 = 15; edit 21 +2 −0 = 2; edit 22 +7 −3 = 10; edit 23 +13 −2 = 15; edit 24 +1 −1 = 2; edit 25 +3 −2 = 5; edit 26 +1 −0 = 1; edit 27 +1 −1 = 2; edit 28 +2 −2 = 4; edit 29 +2 −2 = 4; edit 30 +67 −2 = 69; edit 31 +2 −0 = 2; edit 32 +10 −0 = 10; edit 33 +8 −1 = 9; edit 34 +13 −0 = 13; edit 35 +1 −0 = 1; edit 36 +1 −0 = 1; edit 37 +12 −2 = 14; edit 38 +7 −0 = 7; edit 39 +1 −0 = 1; edit 40 +1 −0 = 1; edit 41 +3 −0 = 3; edit 42 +7 −3 = 10; edit 43 +133 −1 = 134; edit 44 +1 −0 = 1; edit 45 +7 −2 = 9; edit 46 +52 −0 = 52.
- exec: `judgment`. Exact edits in six files; the renderer signatures change, so the renderers, their tests and the orchestration land together.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run 2>&1 | grep -E 'Test Files|Tests '`
  Expected: tsc silent, `Test Files  75 passed (75)`, `Tests  870 passed (870)`.

### step P1.13
Goal: let the user drag the sidebar to 640 px, wide enough for a full commit row. Nothing else in the resize code changes; there is no auto-grow.

- files: `gui/src/appSidebarResize.ts`

edit 1 (`appSidebarResize.ts`):

old:
```ts
const SIDEBAR_MAX_WIDTH = 400;
```

new:
```ts
// Wide enough for a full commit row (git P1). There is no auto-grow: a width change reflows every pane.
const SIDEBAR_MAX_WIDTH = 640;
```

- lines: edit 1 +2 −1 = 3.
- exec: `mechanical`. Exact text.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && grep -n "SIDEBAR_MAX_WIDTH = 640" src/appSidebarResize.ts && npx tsc --noEmit && echo TSC_OK`
  Expected: `11:const SIDEBAR_MAX_WIDTH = 640;`, then `TSC_OK`.

### step P1.14
Goal: run the slice check offline. The live check runs in the main session only.

- files: none (verify only)
- edit: none
- lines: 0
- exec: `mechanical`. Commands only. The live part is not for the executor.
- verify (offline, executor). This assumes P0 is committed (see the prerequisite); otherwise the diffstat also lists P0's own changes:
  `cd /c/Users/Reinaldo/Backend/herdr/gui && git diff --stat -- src-tauri/src/engine.rs src-tauri/src/flutter.rs src-tauri/src/window_chrome.rs crates package.json package-lock.json src-tauri/Cargo.toml src/render src/keyboard src/shortcuts.ts src/ui/menu.ts src/ui/menus.ts src/appMenuBar.ts src/main.ts src/themes src/git/statusRefresh.ts src/git/diffParse.ts && echo "fmt:$(cargo fmt --check 2>&1 | grep '^Diff in' | grep -vc flutter.rs) clippy:$(cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^ +--> ' | grep -vc flutter.rs)" && cargo test --workspace 2>&1 | grep -E '^test result' && npx tsc --noEmit && npx vitest run 2>&1 | grep -E 'Test Files|Tests '`
  Expected:
  - no diffstat lines;
  - `fmt:0 clippy:0`;
  - every `test result: ok.`, and the herdr-gui lib line reads `333 passed`;
  - tsc silent;
  - `Test Files  75 passed (75)` and `Tests  870 passed (870)`.
- verify (live, **main session only**, after `npm run package:fast`), on a scratch repo, never on this repo:
  1. Build the demo repo in Git Bash (about 15 s). The clone gives `origin/*` refs; the local branch `origin/fake` must show as a branch chip, not a remote one:
     `U="$TEMP/cowbell-git-up"; D="$TEMP/cowbell-git-demo"; rm -rf "$U" "$D" && git init -q -b main "$U" && cd "$U" && git config user.name Demo && git config user.email demo@example.com && echo one > a.txt && git add a.txt && git commit -qm first && git tag v1 && git checkout -qb feat && echo f > f.txt && git add f.txt && git commit -qm "feat file" && git checkout -q main && echo two >> a.txt && git commit -qam second && git merge -q --no-ff -m "merge feat" feat && git clone -q "$U" "$D" && cd "$D" && git config user.name Demo && git config user.email demo@example.com && git mv a.txt b.txt && printf '\000\001' > bin.dat && git add bin.dat && git commit -qm "rename a to b, add a binary" && git branch origin/fake && for i in $(seq 1 250); do git commit -q --allow-empty -m "filler $i"; done && echo edit >> b.txt && echo new > n.txt`
  2. In the **gui-test** herdr session, open a workspace on `$D` and press `Ctrl+Shift+G`. The pane covers the terminal with the working-directory Summary: the commit box (button "Nothing to commit"), UNSTAGED (1) with `b.txt` and its diff, UNTRACKED (1) with `n.txt`. Typing does not reach the terminal.
  3. Click COMMITS. The pinned row reads "2 changes" and an italic "Commit Changes". 200 rows; the top row has a filled `main` chip; "rename a to b, add a binary" has a blue-bordered `origin/fake` branch chip; `origin/main` and `origin/HEAD` are grey on "merge feat"; `v1` is yellow on "first"; "feat file" is not bold; each row has a file badge (`0` on the fillers). "Load more" loads the rest (255 rows, no "Load more").
  4. Click "merge feat". The Summary shows Commit Hash, Tree, Author, Date, Parents (two links), Stats (`-0 +1`, "1 file"), the message, "Collapse all", and an expanded `f.txt` section with `+f`. Click "Collapse all": the section closes and the button reads "Expand all".
  5. Click the `f.txt` header: a file tab opens. Ctrl+PgUp shows the Summary, Ctrl+PgDn the tab. Esc shows the Summary; the tab stays. Esc again hides the pane, and typing reaches the terminal.
  6. Click a commit row: the pane shows again. Click a Parent link, then Alt+Left (back), Alt+Down (parent), Alt+Up (child); on the top row Alt+Up selects the working directory.
  7. Click "rename a to b, add a binary": the sections show `a.txt → b.txt` with `rename from a.txt`, and `bin.dat` with no badges and "Binary file, no text diff".
  8. Click the pinned row: the caret is in the commit box. Click Stage All on UNSTAGED: `b.txt` moves to STAGED. While typing a message, run `touch z.txt` in another pane: within 3 s UNTRACKED (2) shows, and the caret and the text stay. Ctrl+Enter commits; the new commit is the top row.
  9. FILES tab: collapse a header with Space, filter with the filter button (Esc closes the filter only), switch to Tree. Select a commit: the Files tab lists its files without stage buttons.
  10. Right-click a file row, then a section's "…": Stage or Unstage, Open Containing Folder (Explorer opens the folder), Copy File Path (a paste shows a backslash path). Closing the menu with Esc keeps the pane open.
  11. With the pane open, press `Ctrl+Shift+F`: the pane hides and the find bar has the input. Click a row, then press `Ctrl+Shift+B`: the pane hides with the sidebar; `Ctrl+Shift+B` again shows both.
  12. At 260 px the author hides; drag to 640 px; restart: the width and the Commits tab are kept, and the pane shows at startup.
  13. Switch to an imported light theme: chips, badges, file and hunk headers stay readable. Switch to another workspace: the pane shows that repo's working directory.
  14. Screenshots of steps 2, 3, 4 and 8, with demo data only.

**Commit boundary H4. Do not commit.** Files: `gui/src/git/summaryDiffs.ts`, `gui/tests/unit/git/summaryDiffs.test.ts`, `gui/src/ui/fileMenu.ts`, `gui/tests/unit/ui/fileMenu.test.ts`, `gui/src/ui/diffView.ts`, `gui/src/ui/detailsPane.ts`, `gui/tests/unit/ui/detailsPane.test.ts`, `gui/src/ui/sourceControl.ts`, `gui/tests/unit/ui/sourceControl.test.ts`, `gui/src/appSourceControl.ts`, `gui/src/style.css`, `gui/src/appSidebarResize.ts`. Suggested message: `feat: add file sections, the file menu and a wider sidebar to source control`.

---

## Optional slices and later work (outlines only; each gets its own exact-step plan first)

### O1 (optional): a vertical sash between the workspace list and Source Control

Do it only if the P1.14 live check shows that the section's `max-height: 50%` (P0 deviation 17) is too small for history. Unchanged from the earlier plan's P1.9: a `source_control_height: u32` setting (0 = auto), a 4 px `div#source-control-sash` styled like `#sidebar-resize-handle`, the pointer-capture pattern of `wireSidebarResize`, and a pure clamp function in its own module with a node test. exec: settings and markup `mechanical`, the wiring `judgment`.

### P1b (optional): the lane rail

- Rust: add `--topo-order` to the `git_log` arguments (counterintuitive 6). The P1 log tests stay valid.
- `src/git/lanes.ts`: a pure `computeLanes(rows)`; `// shortcut: lanes cover only the loaded pages; a parent beyond the last page ends its column at the list end.`
- Colours: add `--sc-lane-1` … `--sc-lane-5` beside `--sc-lane-0`, with inventory §D's values (light `hsl(260,80%,65%)`, `hsl(330,80%,60%)`, `hsl(32,100%,50%)`, `hsl(114,50%,50%)`, `hsl(180,100%,35%)`; dark `hsl(260,60%,75%)`, `hsl(330,65%,65%)`, `hsl(0,70%,70%)`, `hsl(44,75%,60%)`, `hsl(180,60%,65%)`). Each row sets `--sc-row-lane`, and the chip border and the HEAD fill read it instead of `--sc-lane-0`.
- Render one inline SVG per row in the left padding, 10 px per lane, at most 8 lanes. Tests: `tests/unit/git/lanes.test.ts` (linear, branch and merge, octopus, page boundary).

### O2 (after P1): syntax highlighting in diffs

- Smallest option: a tiny line tokenizer, `src/git/syntax.ts` (about 120 lines, no dependency). It marks strings, comments, numbers and a keyword list per extension family, and carries the open block-comment or string state across the rows of one hunk. `renderDiffLines` wraps the tokens in spans coloured from the `--terminal-ansi*` variables. Test: `tests/unit/git/syntax.test.ts`.
- The dependency option: highlight.js core plus about ten languages (roughly 40 KB gzipped). It is more accurate, but it is a new dependency, and per-row highlighting still breaks multi-line tokens unless it runs on whole files.
- Recommendation: the tokenizer, with `shortcut:` comments for its limits; move to a dependency only if users ask for many languages.

### O3 (with P2): hunk buttons, discard affordances and the edit keys

- Hunk header rows get a hover-revealed actions slot: Stage Hunk, Unstage Hunk, Discard Hunk, and "…" (Revert Hunk, Cherry Pick Hunk); visible while the pointer is over the hunk or its header has focus (inventory §C).
- D12's hidden affordances return: the trash icon in the file tab header, Discard All, the hover × on rows, and Discard / Delete / Revert File in `fileMenuItems`. Each opens the P2 confirm popover and uses the P2 backup.
- Key contexts (inventory §B, P5): Enter stages or unstages the hunk in a diff, the file on a row; Backspace opens the discard confirm (unstaged only); Shift+Enter and Shift+Backspace act on the whole file from its diff; Ctrl+Enter commits from the message box.

### O4 (later): more file menu items and inventory keys

- File History (a `path:` filter on the Commits tab, `log -- :(literal)<path>`), Blame (`git blame --porcelain`), Cherry Pick File (`checkout <hash> -- <path>`, a write), Save Patch (`show <hash> -- <path>` into a save dialog), Open in Editor (needs an editor setting).
- Keys and controls: Ctrl+9 (Commit Changes), Ctrl+8 (current branch), mouse buttons 4 and 5 (back, forward), Ctrl+F commit search, F5 refresh, a Copy menu on each meta value.

---

## Overall verify (after P1.13)

```
cd /c/Users/Reinaldo/Backend/herdr/gui && echo "fmt:$(cargo fmt --check 2>&1 | grep '^Diff in' | grep -vc flutter.rs) clippy:$(cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^ +--> ' | grep -vc flutter.rs)" && cargo test --workspace 2>&1 | grep -E '^test result' && npx tsc --noEmit && npx vitest run 2>&1 | grep -E 'Test Files|Tests '
```

Expected:
- `fmt:0 clippy:0`;
- every `test result: ok.`, with the herdr-gui lib line at `333 passed`;
- tsc silent;
- `Test Files  75 passed (75)` and `Tests  870 passed (870)`.

`npm run check` itself still fails, but only on the pre-existing `flutter.rs` fmt and clippy findings.

## Summary

- Steps: 14 (P1.1–P1.14) in 4 slices: H1 read commands (P1.1–P1.3), H2 Commits tab, pinned row and Files options (P1.4–P1.7), H3 tabbed pane and Summary (P1.8–P1.10), H4 sections, file menu and width (P1.11–P1.14). Outlines only: O1 sash, P1b lanes, O2 syntax highlighting, O3 P2 hooks, O4 later items.
- New tests:
  - Rust `git::`: 37 → 53 (+16: 6 unit, 10 integration). The herdr-gui lib goes 317 → 333. `settings::` stays at 7 (one new assert).
  - Vitest: 68 files / 828 tests → 75 / 870 (+7 files: `commitList` 11, `fileTree` 3, `sourceControl` 6, `panelKeys` 4, `detailsPane` 11, `summaryDiffs` 5, `fileMenu` 2).
- Estimates: H1 0.5 day, H2 1 day, H3 1.5 days, H4 1 day, the live check and its fixes 0.5–1 day: about 4.5–5 days (the earlier plan: 2 days). P1b stays at about 1 day, O2 at about 1 day.
- Verified: the offline checks above on a scratch copy, and the jsdom smoke run of the pane flow. Not verified: the live app (P1.14 live list), the light-theme contrast, macOS.

## Open risks

1. P0 S3–S5 are uncommitted. Commit them before H1, or the P1 boundaries carry P0 code; the two whole-file replacements stop on a hash mismatch.
2. The pre-existing `flutter.rs` fmt and clippy findings keep `npm run check` red.
3. While the Commits tab shows, each changed status runs one `git log` of at most 500 rows with `--name-only` (+30 % against a bare log, counterintuitive 14); at most one per 3 s poll.
4. A HEAD move that leaves the status JSON unchanged does not re-read history until Refresh or a tab switch.
5. A list longer than 499 rows shrinks to 499 on the next re-read; relative dates go stale until a re-render (`shortcut:` comments).
6. A content-only edit (the status stays ` M`) leaves the working-directory diffs stale until Refresh, a tab visit or a reselect; P0 has the same limit.
7. Global table shortcuts still fire under the pane. `Ctrl+Shift+F` is covered (its input takes focus outside the panel, so the pane hides), but `Ctrl+Shift+W` closes the terminal tab under the pane.
8. D1's default covers the terminal at startup when the section was left open.
9. A hidden sidebar hides the pane through CSS only: `paneOpen` stays on, so showing the sidebar again shows the pane again, and focus inside the pane falls to `body` while it is hidden.
10. A file menu that closes after a re-render returns focus to a removed element, so focus falls to `body` until the next click.
11. "Expand all" on a 500-file commit starts 500 reads, 4 at a time, each two git processes (`check_repo` and `show`).
12. Imported hc-light themes get the dark git colours (`hc` has no light variant in `theme_import.rs`).
13. Container queries need WebView2 (supported) or WKWebView from Safari 16. Check the oldest macOS target.
14. On macOS, `Ctrl+1`…`Ctrl+4` can be system shortcuts (Mission Control "Switch to Desktop N", off by default).
15. A commit message with a NUL byte (possible only through plumbing) ends the `show` header early; `git_show` then returns `git_failed`.
16. The orchestration has no unit test; the scratch smoke run is not part of this plan, and the live check (P1.14) is main-session only.

## Unresolved (not blockers)

- History follows HEAD only, as the outline says. All branches (`--branches --remotes`) would be a P1b or P6 decision.
- The decisions D1–D17 at the top wait for the user; each is a small, local change to flip.
- The live check (P1.14) is main-session only and was not run here.
