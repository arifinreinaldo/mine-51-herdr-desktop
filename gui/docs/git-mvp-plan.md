# Git MVP plan: Source Control panel (executable steps)

Status: plan, 2026-10-09. Amended 2026-10-11: spec review findings A–J (reproduced with git 2.45.1) and the user's scope update (follow-on phases P1–P6). Source: `gui/docs/git-mvp-spec.md`. Branch: `feat/gui-phase1`.
Executor: sonnet-pipeline. The main session commits only when the user asks.

## How to read this plan

- All paths are absolute or relative to `C:\Users\Reinaldo\Backend\herdr`. The shell is Git Bash, so commands use `/c/Users/Reinaldo/Backend/herdr/...`.
- `edit` blocks give the exact old text, then the exact new text. "Append" means: add the block at the end of the file.
- Fenced `old:`/`new:`/append blocks sit inside list items, so each line carries extra list indentation. Strip the indentation up to the fence's own column; the text that remains is the literal file text, with the source file's own leading spaces kept. Single-line inline-code edits are exact as written.
- Each slice ends with a **commit boundary**; S5 has two (S5a after step 17, S5b at the end). Do not commit. Stop and report to the main session.
- Do not touch: `gui/crates/herdr-wire`, anything outside `gui/`, the herdr config, the e2e scripts, `gui/src/render/*` (an `import` of `FONT_STACK` is allowed), the dependency lists in `Cargo.toml` or `package.json`, `gui/src-tauri/src/engine.rs`. `gui/src/keyboard/routing.ts` and `gui/tests/unit/keyboard/routing.test.ts` change only in step 17, with its exact text. No new dependencies.
- Phases: P0 is slices S1–S5 below, fully executable. P1–P6 at the end are executable-level outlines. Each one gets its own exact-step plan before execution.

## Amendment summary (2026-10-11)

- goal: fold the spec review findings A–J into P0 and outline the follow-on phases P1–P6.
- deliverables: this file only. P0 now also touches `gui/src/keyboard/routing.ts` and `gui/tests/unit/keyboard/routing.test.ts` (step 17).
- step map: steps 1–16 keep their numbers. Step 17 is new. The old steps 17–22 are now 18–23.

| Finding | Change | Where |
|---|---|---|
| A | `git reset -q` unstages in repos with and without commits. `is_unborn` and the `rm --cached` branch are gone. New tests: stage, edit, unstage with no commits; staged rename with `origPath`. | deviation 23, step 4 |
| B | Source Control is the last View-menu item. No test fixture changes. | deviation 29, step 15 |
| C | No `GIT_LITERAL_PATHSPECS`. Every pathspec is `:(literal)<path>`. New `[xy].txt` test. | deviation 9, steps 2, 4 |
| D | Routing step 2 gates five terminal-only ids on capture focus, on every OS. One new routing test. | deviation 30, step 17 |
| E | The timeout covers `child.wait()` only. The readers start before the wait. A 2 s drain keeps the bytes already read. New lingering-child test. | deviation 26, step 2 |
| G | `add` and `reset` read `:(literal)` paths from stdin. No 1000-path limit and no chunking; a 16 MiB payload cap. | deviation 24, steps 4, 22 |
| I | `-c core.fsmonitor=false` on status and diff. Clean filters are an accepted, commented risk. | deviation 25, step 2 |
| J | `stdout_cap`: diff reads at most cap+1 bytes, then closes the pipe. A capped result is success. New test. | deviation 27, step 2 |
| nits | `log -1 --no-show-signature`. `env_remove` of `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_LITERAL_PATHSPECS`. | deviation 28, steps 2, 4 |
| F, H | Documented `shortcut:` limits, no code. | deviation 22, steps 2, 14, 23 |

counterintuitive (each verified in scratch repos with git 2.45.1, 2026-10-11):
- `git rm --cached -q -- b.txt` exits 1 on an `AM` file: "the following file has staged content different from both the file and the HEAD". `git reset -q -- b.txt` exits 0 in a repo with no commits and leaves `?? b.txt`.
- `--pathspec-from-file` entries still get pathspec magic. An unprefixed `[xy].txt` also staged `x.txt`. An unprefixed `reset` of `[x].txt` also unstaged `x.txt`.
- An inherited `GIT_LITERAL_PATHSPECS=1` turns `:(literal)x.txt` into a file name: `fatal: pathspec ':(literal)x.txt' did not match any files`.
- NTFS forbids `*` and `?` in file names, and Git Bash silently wrote `*.txt` as U+F02A. The glob test therefore uses `[xy].txt`.
- `--no-index` takes file paths, not pathspecs: `:(literal)u.txt` gives `error: Could not access ':(literal)u.txt'`, exit 1.
- `git -c "alias.linger=!cd / && sleep 6 &" linger | cat` exits 0 at once, but the pipe stays open for 6 s.
- Closing the read end stops git: a 38 MB `--no-index` diff piped to `head -c 100` ended after 1.4 s, against 4.9 s for the full run.
- `git reset` without `-q` exits 0 even when it prints "Unstaged changes after reset". A `reset` pathspec that matches nothing exits 0; an `add` pathspec that matches nothing exits 128.

rejected alternatives:
- C: set `GIT_LITERAL_PATHSPECS=1` only for add, reset and diff. It lost because an env var is invisible at the call site, and any future hook-running call could inherit it again. The `:(literal)` prefix sits next to the path it protects.
- B: keep Source Control next to Toggle Sidebar and add a second ArrowDown to two menu tests. It lost because it needs two fixture edits instead of zero.

smallest-change check:
- A: one command replaces two branches and a helper.
- B: an existing anchor, zero test edits.
- C: a string prefix, no env plumbing.
- D: one new set and one condition in the existing gate.
- E and J: one reader helper plus one parameter in the single runner.
- G: stdin already exists for commit; reuse it.
- I: two args on existing calls.
- nits: one flag and four `env_remove` calls.

## Baseline facts (verified 2026-10-09, before any change; rechecked 2026-10-11)

| Check | Result |
|---|---|
| `cargo test -p herdr-gui --lib` | `280 passed` |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | `66` files, `806` tests passed (rechecked 2026-10-11) |
| `npx vitest run tests/unit/keyboard/routing.test.ts` | `19` tests (2026-10-11) |
| `cargo fmt --check` | **FAILS**: 2 diffs, both in `src-tauri/src/flutter.rs` (lines 521, 551) |
| `cargo clippy --workspace -- -D warnings` | **FAILS**: 2 errors, both in `src-tauri/src/flutter.rs` (449 `Iterator::last`, 555 `map_or`) |
| `git --version` | `git version 2.45.1.windows.1` |
| `git add` / `git reset` with `--pathspec-from-file=- --pathspec-file-nul` | supported (probe 2026-10-11) |

Because of the flutter.rs failures, `npm run check` is red before this work starts. This plan does not fix flutter.rs (out of scope). The verify commands below count fmt and clippy findings **outside** `flutter.rs` and expect `0`. The main session decides whether to fix flutter.rs in a separate commit.

## Resolved spec gaps and deviations (apply them; do not re-decide)

1. `engine.rs`: no change. `apply_no_window` is already `pub(crate)` at `src-tauri/src/engine.rs:145`.
2. `lib.rs` uses `pub mod` for every module, so add `pub mod git;` (not `mod git;`). The commands must be `pub async fn` so that `generate_handler!` in `lib.rs` can reach them.
3. Vitest collects only `tests/unit/**/*.test.ts` (`vitest.config.ts`). The parser test goes to `tests/unit/git/diffParse.test.ts`, not `src/git/diffParse.test.ts`. If it were in `src/`, vitest would never run it.
4. `appSourceControl.ts` imports `appDom.ts` and `appState.ts`, and both touch `document` when they load. A node-env vitest cannot import it. The ordering rules (in-flight, dirty follow-up, stale-cwd drop, same-JSON skip) and the open-diff rule go into a pure module, `src/git/statusRefresh.ts`. This follows the pattern of `src/flutter/runState.ts`. The test is `tests/unit/git/statusRefresh.test.ts`.
5. These files are missing from the spec's Touch list but must change, or tsc fails or the key does nothing:
   - `src/appMenuBar.ts`: add the `menuBarContext` fields, `refreshMenuBarContext`, and the `SHORTCUT_HANDLERS` entry.
   - `tests/unit/ui/menus.test.ts`: `fakeContext()` is a full `MenuBarContext` literal.
   - `src/appDom.ts`: the codebase convention for DOM lookups.
   - `tests/unit/shortcuts.test.ts`: one new test.
6. Active-workspace hook: `appSourceControl.ts` registers its own `listen<RawSnapshot>("snapshot", …)` and reads `event.payload`. `appEvents.ts` does not change.
7. `git diff --no-index` also exits **1** on an error. A probe gave `error: Could not access 'missing.txt'`, exit 1, and empty stdout. Rule: exit 0 is success, and exit 1 is success only when stdout starts with `diff --git`. Every other result is `git_failed` with stderr. A capped result (deviation 27) is success before this rule applies.
8. `git -C ""` leaves the cwd unchanged, so git would read the GUI process's own cwd. `git_status` rejects an empty or non-absolute `cwd` with `invalid_path`. The TS side treats an empty `new_workspace_cwd` as "No workspace".
9. Pathspec magic: `--` stops options, but not pathspec magic (`:(glob)`, `*`, `?`, `[…]`). `--pathspec-from-file` entries get magic too. Probe (2026-10-11): an unprefixed `[xy].txt` also staged `x.txt`, and an unprefixed `reset` of `[x].txt` also unstaged `x.txt`. Rule: send every pathspec as `:(literal)<path>`, on stdin for add and reset and on argv for diff. The runner never sets `GIT_LITERAL_PATHSPECS`: git passes that env to hooks, and a hook's own glob pathspec then matches nothing (review finding C). The `--no-index` diff takes file paths, not pathspecs, so it gets the plain path.
10. The untracked diff also passes `--no-textconv` (verified to work with `--no-index`). This matches the §3.7 intent.
11. Error codes the spec does not name: an empty `paths` list, or a pathspec payload over `MAX_PATHS_BYTES`, gives `invalid_path`. A bad `message` gives `invalid_message`. Order: validate the cheap arguments first, then run the `rev-parse` repo check.
12. `ChangeKind` with `rename_all = "lowercase"` serializes `TypeChanged` as `"typechanged"`. The TS union uses that exact string.
13. `--fg-muted` does not exist; use `--descriptionForeground`. `applyTheme` writes only `REQUIRED_KEYS`, so no `--gitDecoration-*` CSS variable ever exists. Instead, the status letter reads `currentThemeDef().colors["gitDecoration.*"]` in TS and sets an inline `color` only when the theme defines the key. Otherwise the letter keeps the CSS default `--descriptionForeground`. No built-in theme defines those keys today, so the letters are muted except with imported VS Code themes. `tokens.ts` does not change.
14. Diff tints use `color-mix(in srgb, var(--terminal-ansiGreen|Red) 15%, transparent)`. `style.css` already uses `color-mix`, and `--terminal-ansi*` are required keys.
15. The terminal font has no CSS variable. `diffView.ts` imports `FONT_STACK` from `src/render/renderer.ts` and uses `appState.renderer?.getFontSizePx() ?? appState.settings.fontSize`.
16. The spec's "focusCapture helper" is `focusKeyboardCapture()` in `src/keyboard/focusCapture.ts`. The "existing toast" is `showInfoNotice` in `src/appApi.ts`.
17. Correction 3: the agent list is a popover in `#overlay-root` (`src/ui/statusbar.ts`), not inside `#sidebar`. `appSidebarPanel.ts` renders the workspace rows. Inside `#sidebar`, only `#sidebar-list` (`flex: 1`) competes with the new section. `#source-control` gets `flex: 0 1 auto; max-height: 50%; min-height: 0`, so the workspace list always keeps at least half the sidebar. **Flag this layout for the live check.**
18. Opening Source Control while the sidebar is hidden also shows the sidebar. Otherwise `Ctrl+Shift+G` would do nothing visible. The poll runs only while the section is open, the sidebar is visible, and `document.hidden` is false.
19. Small UI defaults: detached HEAD shows `detached HEAD`. A group with 0 entries is not rendered. With both groups empty, the body shows "No changes". "Stage All" leaves Conflicted files out, because `git add` on a conflicted file marks it resolved. Stage All and Unstage All send every path in one call (deviation 24). Unstaging a staged rename also passes its `origPath`.
20. Commit key: `Ctrl+Enter`, and `Cmd+Enter` on macOS (`event.ctrlKey || event.metaKey`). The macOS placeholder reads `Message (⌘Return to commit)`. See "Open items".
21. The test repos set local `user.name`, `user.email`, `commit.gpgsign=false`, `core.autocrlf=false`, and `core.hooksPath=<absolute path that does not exist>`. This stops the user's global signing or hook setup from hanging a test. Tests always pass `status.repo` (git prints `C:/Users/...` with forward slashes) as the `repo` argument, never the `temp_dir()` string.
22. Known limits, each written as a `shortcut:` code comment:
    - one global write lock;
    - `kill_on_drop` does not kill hook grandchildren on timeout;
    - a timeout kill can leave `.git/index.lock` behind (finding F; comment in `run_git`);
    - `new_workspace_cwd` follows a `cd` only after herdr learns the pane's new cwd (finding H; comment in `onSnapshot`, caveat in the step-23 live check);
    - the 3 s poll;
    - the 500-row cap;
    - combined conflict diffs (`@@@`) render as `meta` rows;
    - a staged rename's diff shows only the new path.
23. (A) Unstage runs `git reset -q` with stdin pathspecs in every repo, with or without commits.
    - The spec's `rm --cached -q` exits 1 on a file that was staged and then edited (`AM`). Its message: "the following file has staged content different from both the file and the HEAD" (probe, git 2.45.1).
    - `restore --staged` fails with "could not resolve HEAD" in a repo with no commits.
    - `reset -q` handled both cases. Probe: `AM b.txt` became `?? b.txt`, exit 0.
    - It also unstages a staged rename when both paths are passed. Probe: `R old.txt -> new.txt` became ` D old.txt` and `?? new.txt`.
    - A `reset` pathspec that matches nothing exits 0, so passing an `origPath` is always safe.
24. (G) `add` and `reset` read paths from stdin: `--pathspec-from-file=- --pathspec-file-nul`, each entry `:(literal)<path>\0`. Git 2.45.1 supports this (probe).
    - Paths never reach argv, so there is no command-line length limit, no `--`, and no chunking.
    - Spec §3.2's "at most 1000 entries" becomes a 16 MiB payload cap (`MAX_PATHS_BYTES`).
    - `git diff` has no `--pathspec-from-file`. It gets one `:(literal)` path after `--`.
25. (I) Every `status` and `diff` call adds `-c core.fsmonitor=false`, so a repo-configured fsmonitor hook never runs on the 3 s poll. Repo-configured clean filters still run, exactly as `git status` in a pane does. That is an accepted risk at the spec §3.7 trust level, written as a comment in `git_status`.
26. (E) `wait_with_output` waits until both pipes close. A hook's background child inherits the pipes, so a commit that succeeded can still end in `git_timeout`.
    - Probe: `git -c "alias.linger=!cd / && sleep 6 &" linger | cat` exits 0 at once and holds the pipe for 6 s.
    - Rule: the reader tasks start before the wait, and the timeout covers `child.wait()` only.
    - After the exit, both readers share one `DRAIN_TIMEOUT` (2 s) deadline and keep the bytes they already read.
27. (J) `run_git` takes `stdout_cap`. `git_diff` passes `Some(DIFF_CAP_BYTES)`, and all other calls pass `None`.
    - The reader stops after cap+1 bytes and closes the pipe, so memory stays bounded.
    - Git then stops. Probe: a 38 MB `--no-index` diff piped to `head -c 100` ended after 1.4 s instead of 4.9 s.
    - A capped result is success whatever the exit code. `finish_diff` cuts it and sets `truncated`.
28. (nits) `log -1 --no-show-signature`, so `log.showSignature=true` cannot put GPG text in front of the hash. The runner removes these inherited env vars:
    - `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE`, which would override `-C`;
    - `GIT_LITERAL_PATHSPECS`: with it set, `:(literal)x.txt` is read as a file name (`fatal: pathspec ':(literal)x.txt' did not match any files`, probe).
29. (B) Source Control is the last View-menu item, after Desktop Notifications. Spec §2 asked for "next to Toggle Sidebar".
    - `src/ui/menu.ts:379-380` highlights the first enabled item when a menu opens.
    - `tests/unit/ui/menus.test.ts:183-207` press one ArrowDown to reach Color Theme (index 1, which has a submenu).
    - At index 1, that ArrowDown would land on Source Control, which has no submenu, and both tests would fail.
30. (D) Spec §6.1 assumes that routing step 3 keeps textarea typing away from the terminal. Step 2 runs first and ignores focus.
    - `src/keyboard/routing.ts:80-90` claims any table shortcut whatever has focus. Only `pane.copy` and `pane.paste` on macOS are gated.
    - On Windows, `Shift+Insert` (`pane.paste`) and `Shift+PgUp/PgDn/Home/End` (scrollback) would hijack the commit box.
    - Step 17 gates these five ids on `activeElement === keyboardCaptureEl` on every OS. This also covers `Cmd+V` and `Cmd+Up/Down` on macOS.
    - Side effect: these keys no longer scroll the terminal while a tab or a sidebar row has focus.

## Open items for the main session (not blockers)

- The pre-existing fmt and clippy failures in `src-tauri/src/flutter.rs` make `npm run check` red no matter what this plan does.
- `Cmd+Enter` on macOS is my default; the spec says only `Ctrl+Enter`.
- Step 17 changes global key routing (the find bar and the dialogs also get native `Shift+Home/End/Insert`). It has its own commit boundary, S5a, so it reverts alone.
- The live check (§9.2) is main-session only.

---

## Slice S1: git.rs read path (status, diff)

### step 1
Goal: create `git.rs` with the types, `validate_path`, the porcelain parser, the diff post-processor, and their unit tests. Declare the module.

- files: `gui/src-tauri/src/git.rs` (new), `gui/src-tauri/src/lib.rs`
- edit (`lib.rs`):
  - old:
    ```
    pub mod folder_picker;
    pub mod memory;
    ```
  - new:
    ```
    pub mod folder_picker;
    pub mod git;
    pub mod memory;
    ```
- edit (`git.rs`, new file). Requirements:
  - Module doc comment: Git MVP spec, the Source Control commands.
  - Imports: `crate::commands::ApiError`, `crate::flutter::api_error` (the existing `pub(crate)` helper), and `serde::Serialize`.
  - Types (all `#[derive(Debug, Clone, PartialEq, Serialize)]` with `#[serde(rename_all = "camelCase")]`):
    - `pub struct GitStatus { pub repo: Option<String>, pub branch: Option<String>, pub ahead: u32, pub behind: u32, pub unborn: bool, pub staged: Vec<FileChange>, pub unstaged: Vec<FileChange> }`. Also derive `Default`.
    - `pub struct FileChange { pub path: String, pub orig_path: Option<String>, pub kind: ChangeKind }`.
    - `pub enum ChangeKind { Added, Modified, Deleted, Renamed, Copied, TypeChanged, Untracked, Conflicted }` with `#[serde(rename_all = "lowercase")]`. Also derive `Copy` and `Eq`.
    - `pub struct GitDiff { pub text: String, pub truncated: bool, pub binary: bool }`.
    - Define `CommitResult` in step 4, not here, because an unused type gives a dead-code warning.
  - `const DIFF_CAP_BYTES: usize = 2 * 1024 * 1024;`
  - `fn validate_path(path: &str) -> Result<(), ApiError>` returns `invalid_path` when the path:
    - is empty;
    - contains `'\0'`;
    - starts with `/` or `\`;
    - has an ASCII letter as byte 0 and `:` as byte 1 (this covers `C:\x` and `C:x`);
    - has any segment equal to `..` when split on `/` or `\`.

    The message names the path.
  - `fn parse_branch_line(line: &str, status: &mut GitStatus)` takes the text after `## `:
    - `No commits yet on X` or `Initial commit on X` (older git) gives `unborn = true` and `branch = X`, where X is cut at `...` if present.
    - `HEAD (no branch)` gives `branch = None`.
    - Otherwise, split off an optional ` [` suffix. The branch is the part before `...` (`split_once("...")`, never a split on `.`). Parse the bracket text, trimmed of `]` and split on `, `: `ahead N` sets `ahead`, `behind N` sets `behind`, and `gone` is ignored.
  - `fn parse_porcelain(stdout: &[u8]) -> GitStatus`:
    - Split on `b'\0'`, decode each field with `String::from_utf8_lossy`, and skip empty fields.
    - A field that starts with `## ` goes to `parse_branch_line`.
    - Skip any other field with fewer than 4 bytes.
    - Otherwise `x = byte 0`, `y = byte 1`, `path = field[3..]`.
    - If `x` or `y` is `R` or `C`, take the **next** field as the original path.
    - `??` gives Untracked in `unstaged`. `!!` is skipped.
    - The pairs `DD AU UD UA DU AA UU` give Conflicted in `unstaged` only.
    - Otherwise: `x != ' '` pushes to `staged` with `kind_of(x)`, and `y != ' '` pushes to `unstaged` with `kind_of(y)`. `orig_path` is set only on the entry whose own code is `R` or `C`.
    - `kind_of`: `A` Added, `M` Modified, `D` Deleted, `R` Renamed, `C` Copied, `T` TypeChanged, anything else Modified.
    - Sort both lists by `path`.
  - `fn finish_diff(stdout: &[u8]) -> GitDiff`:
    - `text = String::from_utf8_lossy(stdout).into_owned()`.
    - If `text.len() > DIFF_CAP_BYTES`: cut after the last `b'\n'` within the first `DIFF_CAP_BYTES` bytes. If there is no newline, cut at the largest char boundary ≤ the cap. Then `text.truncate(cut)` and `truncated = true`.
    - `binary` = some line starts with `Binary files ` and no line starts with `@@`.
  - `#[cfg(test)] mod tests` with exactly these unit tests (literal porcelain bytes):
    - `porcelain_staged_unstaged_and_both_columns` (`M `, ` M`, `MM`)
    - `porcelain_added_deleted_untracked` (`A `, `D `, `??`)
    - `porcelain_rename_consumes_orig_path_and_next_record_parses` (`R  new\0old\0 M other\0`)
    - `porcelain_unmerged_pairs_are_conflicted_in_unstaged_only` (`UU`, `AA`, `DU`)
    - `porcelain_ignores_ignored_entries` (`!!`)
    - `porcelain_keeps_space_and_non_ascii_paths_raw` (`?? my file.txt`, `?? über/ß.txt`)
    - `porcelain_sorts_each_list_by_path`
    - `branch_with_upstream_ahead_and_behind` (`## main...origin/main [ahead 2, behind 1]`)
    - `branch_without_upstream` (`## feature.x`, which checks that the dot is kept)
    - `branch_unborn` (`## No commits yet on main`)
    - `branch_detached` (`## HEAD (no branch)`)
    - `branch_ahead_only_behind_only_and_gone`
    - `validate_path_rejects_unsafe_paths` (`""`, `"../x"`, `"a/../b"`, `"a\\..\\b"`, `"/x"`, `"\\x"`, `"C:\\x"`, `"C:x"`, `"a\0b"`, each with code `invalid_path`)
    - `validate_path_accepts_repo_relative_paths` (`"a.txt"`, `"dir/sub file.txt"`, `"-rf"`, `"über.txt"`, `"..a/b"`)
    - `finish_diff_truncates_at_last_newline_before_cap` (`"+line\n".repeat(400_000)`: result ends with `\n`, `len <= DIFF_CAP_BYTES`, `truncated`)
    - `finish_diff_flags_binary_only_without_hunks`
    - `serializes_camel_case_and_lowercase_kinds` (`serde_json::to_value` of a `FileChange` with `ChangeKind::TypeChanged` has the keys `origPath` and `"kind": "typechanged"`)
- lines: lib.rs 1. git.rs about 330 (about 150 code, 180 tests).
- exec: `judgment`. New file and parser design; the rules above fix every behavior.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib git:: 2>&1 | grep 'test result'`
  Expected: `test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 280 filtered out`.
  Dead-code warnings for `parse_porcelain`, `finish_diff` and `validate_path` are allowed until step 2.

### step 2
Goal: add the process runner (concurrent pipe readers, exit-only timeout, stdout cap), the repo check, and the `git_status` and `git_diff` commands, plus integration tests against real temp repos.

- files: `gui/src-tauri/src/git.rs`
- edit (`git.rs`). Requirements:
  - Imports: `std::path::Path`, `std::process::Stdio`, `std::sync::{Arc, Mutex}`, `std::time::Duration`, `tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt}`, `tokio::process::Command as AsyncCommand`, and `crate::engine::apply_no_window`.
  - `const GIT_TIMEOUT: Duration = Duration::from_secs(15);`, `const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);` and `const STDERR_MAX_CHARS: usize = 2000;`. Define the 120 s commit timeout in step 4, not here.
  - Private `struct GitOutput { code: Option<i32>, stdout: Vec<u8>, stderr: String, capped: bool }`. `stderr` is lossy-decoded and trimmed. `capped` is true when the stdout read stopped at its cap.
  - `fn spawn_reader(pipe: impl AsyncRead + Unpin + Send + 'static, cap: Option<usize>) -> (tokio::task::JoinHandle<()>, Arc<Mutex<Vec<u8>>>)` (deviations 26, 27):
    - The task reads 64 KiB chunks and appends each one to the shared buffer. It stops at EOF, at a read error, or (with `Some(cap)`) when the buffer is longer than `cap`.
    - Returning drops the pipe. With a cap, git's next write then fails and git exits.
    - The buffer is shared, so the caller keeps the bytes read so far even when it aborts the task.
  - `async fn run_git(dir: &str, args: &[&str], stdin: Option<&[u8]>, stdout_cap: Option<usize>, timeout: Duration) -> Result<GitOutput, ApiError>`. One private function runs every git call (spec §3.1):
    - Program `git`. Args are `-C`, `dir`, `-c`, `core.quotepath=false`, then `args`. Never a shell string.
    - Env: set `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` and `LC_ALL=C`. `env_remove` `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_LITERAL_PATHSPECS` (deviation 28). Never set `GIT_LITERAL_PATHSPECS` (deviation 9).
    - `stdin`: `Stdio::piped()` when `Some`, else `Stdio::null()`. `stdout` and `stderr` piped. `.kill_on_drop(true)`. Call `apply_no_window(&mut cmd)`.
    - Spawn error with `ErrorKind::NotFound` gives `git_not_found` ("Git is not installed"). Any other spawn error gives `git_failed`.
    - When `stdin` is `Some`, take `child.stdin` and write the bytes from a `tokio::spawn`ed task (owned copy, then drop it to close stdin), so a large payload cannot deadlock against full pipes.
    - Take `child.stdout` and `child.stderr` and call `spawn_reader` for each **before** any wait. Stdout gets `stdout_cap`; stderr gets `None`. If nothing reads the pipes while git runs, output larger than the pipe buffer blocks git, and every large status or diff becomes `git_timeout`.
    - `tokio::time::timeout(timeout, child.wait())`. The timeout covers the exit only, never the pipes (deviation 26). On a timeout, abort both reader tasks and return `git_timeout` "git timed out after Ns". Returning drops `child`, and `kill_on_drop` kills git. Add these two comments:
      - `// shortcut: kill_on_drop ends git but not hook grandchildren; use a job object if hooks hang in practice.`
      - `// shortcut: a timeout kill can leave .git/index.lock behind; git names the lock in its next error and the user removes it. Report the lock path here if users hit it.`
    - A `wait()` error gives `git_failed`.
    - After the exit, give both readers one shared deadline: `let deadline = tokio::time::Instant::now() + DRAIN_TIMEOUT;`, then `tokio::time::timeout_at(deadline, &mut handle)` for each. `abort()` a reader whose deadline passed, then take its buffer contents. Comment: `// git has exited, so its output is complete; only EOF can be missing, when a hook's background child still holds the pipe.`
    - `capped` = `stdout_cap` is `Some(c)` and `stdout.len() > c`.
    - Never map a non-zero exit here; return `GitOutput`.
  - `fn require_success(out: GitOutput) -> Result<Vec<u8>, ApiError>`: `code == Some(0)` gives `stdout`. Otherwise `git_failed` with `stderr` cut to `STDERR_MAX_CHARS` chars. When `stderr` is empty, the message is `git exited with code N`, or `git was terminated` when `code` is `None`.
  - `async fn check_repo(repo: &str) -> Result<(), ApiError>`:
    - Run `rev-parse --show-toplevel` in `repo` (`stdout_cap` `None`). Re-run it on every call; no cache.
    - A failure, or trimmed stdout (`trim_end_matches(['\r', '\n'])`) that differs from `repo` by exact string compare, gives `invalid_repo`.
    - A `git_not_found` error passes through.
  - `#[tauri::command] pub async fn git_status(cwd: String) -> Result<GitStatus, ApiError>`:
    1. Return `invalid_path` when `cwd` is empty or `!Path::new(&cwd).is_absolute()` (deviation 8).
    2. Run `rev-parse --show-toplevel` in `cwd`. On a non-zero exit, `stderr` that contains `not a git repository` returns `Ok(GitStatus::default())`. Any other non-zero exit returns `git_failed` (the §3.3 exception).
    3. `repo` = trimmed stdout. Then run `require_success(run_git(&repo, &["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all"], None, None, GIT_TIMEOUT))` (deviation 25).
    4. Run `parse_porcelain`, set `repo: Some(repo)`, and return.
    - Doc comment: why `GIT_OPTIONAL_LOCKS=0` matters (the spec §3.3 last paragraph).
    - Comment: `// Accepted risk (spec §3.7): core.fsmonitor is off for status and diff, but repo-configured clean filters (filter.*.clean) still run, exactly as in a terminal.`
  - `#[tauri::command] pub async fn git_diff(repo: String, path: String, staged: bool, untracked: bool) -> Result<GitDiff, ApiError>`:
    - First `validate_path(&path)`, then `check_repo(&repo)`.
    - Every form starts its args with `-c`, `core.fsmonitor=false`, and passes `Some(DIFF_CAP_BYTES)` as `stdout_cap` (deviations 25, 27).
    - `untracked`: `diff --no-index --no-color --no-ext-diff --no-textconv -- /dev/null <path>`, with the plain `path`. `--no-index` takes file paths, not pathspecs (deviation 9).
    - `staged`: `diff --cached --no-color --no-ext-diff --no-textconv -U3 -- :(literal)<path>`.
    - Otherwise: `diff --no-color --no-ext-diff --no-textconv -U3 -- :(literal)<path>`.
    - If `out.capped`: return `Ok(finish_diff(&out.stdout))` before any exit-code rule. Comment: `// The read stopped at the cap and closed the pipe, so git's exit code means nothing here.`
    - Otherwise, `untracked`: exit 0 is success. Exit 1 is success only when stdout starts with `b"diff --git"`; otherwise `git_failed` with stderr (deviation 7). The other two forms go through `require_success`.
    - Return `finish_diff(&stdout)`. Comment: `// shortcut: a staged rename shows only the new path's diff; pass orig_path too if users ask.`
  - Test helpers inside `mod tests`:
    - `fn git_available() -> bool`: `std::process::Command::new("git").arg("--version")` succeeds.
    - `fn temp_dir(name: &str) -> PathBuf`: `std::env::temp_dir()` joined with `cowbell-git-test-{name}-{pid}-{counter}` (static `AtomicU64`). Create it fresh.
    - `fn git(dir: &Path, args: &[&str])`: a sync `std::process::Command` that asserts success.
    - `fn init_repo(name: &str) -> PathBuf`: run `git init -b main`, then the local configs from deviation 21.
    - Each integration test starts with `if !git_available() { eprintln!("skipping: git not on PATH"); return; }` and ends with a best-effort `remove_dir_all`.
  - Integration tests (`#[tokio::test]`):
    - `status_outside_a_repo_is_repo_none` (empty temp folder gives `repo: None` and empty lists)
    - `status_rejects_empty_and_relative_cwd` (`""` and `"rel/dir"` give `invalid_path`; no git needed, but keep the skip guard)
    - `status_unborn_repo_lists_untracked_file` (`unborn`, `branch == Some("main")`, one Untracked in `unstaged`, staged empty)
    - `unstaged_diff_contains_a_hunk`: commit `a.txt` with the helper, append a line, then `git_diff(repo, "a.txt", false, false)`. Text contains `@@` and `+`. `repo` comes from `git_status(...).repo`.
    - `staged_diff_after_git_add` (the helper runs `git add`, then `staged = true` contains `@@`)
    - `untracked_diff_via_no_index_exit_1` (untracked `b.txt`, `untracked = true`, a line starts with `+`)
    - `untracked_diff_of_missing_file_is_git_failed` (`untracked = true` on `gone.txt` gives `git_failed`)
    - `diff_rejects_invalid_paths` (`../x`, `C:\x`, `/x` give `invalid_path`)
    - `diff_rejects_a_subfolder_as_repo` (`<repo>/sub` gives `invalid_repo`)
    - `diff_over_the_cap_is_truncated_not_failed` (finding J): untracked `big.txt` with `"0123456789abcdef\n".repeat(200_000)` (3.4 MB). `git_diff(repo, "big.txt", false, true)` is `Ok`, `truncated`, `text.len() <= DIFF_CAP_BYTES`, and the text ends with `\n`.
    - `run_git_returns_when_git_exits_even_if_a_child_keeps_the_pipe_open` (finding E):
      - In an `init_repo` dir, call `run_git(dir, &["-c", "alias.linger=!echo marker; cd / && sleep 8 &", "linger"], None, None, Duration::from_secs(6))` and time it with `std::time::Instant`.
      - Assert `Ok`, `code == Some(0)`, stdout contains `marker`, and an elapsed time of at least 1.5 s and under 5 s.
      - The lower bound proves that the drain deadline fired, so the pipe really was held. A missing `sleep` fails the test instead of passing it.
      - Comment: the alias's shell exits at once and `sleep` keeps stdout open, as a hook's background job does. `cd /` lets `remove_dir_all` delete the temp dir. Before the fix, `wait_with_output` returned `git_timeout` after 6 s.
- lines: about 340 (about 150 code, 190 tests).
- exec: `judgment`. Async process code and test fixtures.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib git:: 2>&1 | grep 'test result'`
  Expected: `test result: ok. 28 passed; 0 failed; 0 ignored; 0 measured; 280 filtered out`.

### step 3
Goal: register the two read commands, and prove fmt and clippy are clean outside `flutter.rs`.

- files: `gui/src-tauri/src/lib.rs`
- edit:
  - old: `            folder_picker::pick_workspace_folder,`
  - new:
    ```
                folder_picker::pick_workspace_folder,
                git::git_status,
                git::git_diff,
    ```
- lines: 2
- exec: `mechanical`. Exact text.
- verify: first run `rustfmt --edition 2021 /c/Users/Reinaldo/Backend/herdr/gui/src-tauri/src/git.rs`. It formats only git.rs. Never run `cargo fmt` here: it would also rewrite the out-of-scope flutter.rs. Then:
  `cd /c/Users/Reinaldo/Backend/herdr/gui && echo "fmt:$(cargo fmt --check 2>&1 | grep '^Diff in' | grep -vc flutter.rs) clippy:$(cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^ +--> ' | grep -vc flutter.rs)" && cargo test -p herdr-gui --lib git:: 2>&1 | grep 'test result'`
  Expected: `fmt:0 clippy:0`, then `test result: ok. 28 passed; 0 failed; …`.

**Commit boundary S1. Do not commit.** Files: `gui/src-tauri/src/git.rs`, `gui/src-tauri/src/lib.rs`. Suggested message: `feat: add read-only git status and diff commands`.

---

## Slice S2: stage, unstage, commit

### step 4
Goal: add `git_stage`, `git_unstage` and `git_commit` with the write lock, stdin pathspecs, and tests.

- files: `gui/src-tauri/src/git.rs`
- edit (`git.rs`). Requirements:
  - `const COMMIT_TIMEOUT: Duration = Duration::from_secs(120);` with the comment that hooks and GPG signing can be slow. `const MAX_PATHS_BYTES: usize = 16 * 1024 * 1024;` and `const MAX_MESSAGE_BYTES: usize = 64 * 1024;`.
  - `static WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());` with the comment `// shortcut: one global lock for stage/unstage/commit; use per-repo locks if multi-repo throughput ever matters.` `git_status` and `git_diff` never take it.
  - `#[derive(Debug, Clone, PartialEq, Serialize)] #[serde(rename_all = "camelCase")] pub struct CommitResult { pub hash: String, pub summary: String }`
  - `fn validate_paths(paths: &[String]) -> Result<(), ApiError>`: an empty list gives `invalid_path`. `paths.iter().map(|p| p.len() + 1).sum::<usize>() > MAX_PATHS_BYTES` gives `invalid_path` ("too many paths"). Then run `validate_path` on each path. There is no entry-count limit (deviation 24).
  - `fn literal_pathspecs(paths: &[String]) -> Vec<u8>`: for each path, the bytes `:(literal)`, then the path bytes, then `\0`. Comment: `// --pathspec-from-file entries still get pathspec magic; :(literal) turns it off per path, without an env var that hooks would inherit.`
  - `pub async fn git_stage(repo: String, paths: Vec<String>) -> Result<(), ApiError>`: `validate_paths`, `check_repo`, take the lock, then `run_git(&repo, &["add", "--pathspec-from-file=-", "--pathspec-file-nul"], Some(&literal_pathspecs(&paths)), None, GIT_TIMEOUT)` through `require_success`.
  - `pub async fn git_unstage(repo: String, paths: Vec<String>) -> Result<(), ApiError>`: `validate_paths`, `check_repo`, take the lock, then `run_git(&repo, &["reset", "-q", "--pathspec-from-file=-", "--pathspec-file-nul"], Some(&literal_pathspecs(&paths)), None, GIT_TIMEOUT)` through `require_success`. It is the same call with and without commits (deviation 23). Comment: `// reset works with and without commits; rm --cached exits 1 on a staged-then-edited file (AM), and restore --staged fails with no HEAD.`
  - `pub async fn git_commit(repo: String, message: String) -> Result<CommitResult, ApiError>`:
    - `validate_message`, `check_repo`, take the lock.
    - `commit -F -` with `stdin: Some(message.as_bytes())`, `stdout_cap` `None` and `COMMIT_TIMEOUT`, through `require_success`. No `--no-verify`.
    - Then `log -1 --no-show-signature --format=%h%x00%s` (`GIT_TIMEOUT`). Trim the trailing newline and `split_once('\0')`; a missing NUL gives `git_failed`.
  - `fn validate_message(message: &str) -> Result<(), ApiError>`: `message.trim().is_empty()` or `message.len() > MAX_MESSAGE_BYTES` gives `invalid_message`.
  - All three commands get `#[tauri::command]` and doc comments.
  - New tests:
    - `validate_paths_rejects_empty_and_oversized_payload` (unit): `[]` gives `invalid_path`. `vec!["a".repeat(1024); 16 * 1024]` gives `invalid_path` (16 793 600 bytes > 16 MiB). `vec!["a.txt".to_string(); 1001]` is ok, which proves the old 1000-entry limit is gone.
    - `validate_message_rejects_blank_and_over_64_kib` (unit; `"  \n"` and `"x".repeat(65 * 1024)` give `invalid_message`, `"fix"` is ok)
    - `stage_then_unstage_in_unborn_repo` (integration; after stage, `staged` has Added `b.txt`; after unstage, `staged` is empty and `b.txt` is Untracked again)
    - `unstage_in_unborn_repo_after_editing_the_staged_file` (integration, finding A):
      - write `b.txt` and run `git_stage`;
      - append a line to `b.txt`, so the porcelain code is `AM`;
      - run `git_unstage`: `staged` is empty and `b.txt` is Untracked.
      - The old `rm --cached -q` exited 1 here.
    - `stage_then_unstage_after_first_commit` (integration; commit `a.txt` with the helper, modify it, stage, unstage, and `a.txt` is Modified in `unstaged` only)
    - `unstage_staged_rename_with_orig_path` (integration):
      - commit `old.txt` with the helper, then run the helper `git mv old.txt new.txt`;
      - run `git_unstage(repo, vec!["new.txt".into(), "old.txt".into()])`;
      - `staged` is empty, and `unstaged` holds Deleted `old.txt` and Untracked `new.txt`.
    - `pathspecs_treat_glob_characters_literally` (integration, finding C):
      1. Commit `x.txt` with the helper, then modify it. Create an untracked `[xy].txt`.
      2. `git_stage(repo, vec!["[xy].txt".into()])`: `staged` holds only Added `[xy].txt`, and `x.txt` stays Modified in `unstaged`.
      3. The helper runs `git add x.txt`.
      4. `git_diff(repo, "[xy].txt", true, false)` has exactly one line that starts with `diff --git`.
      5. `git_unstage(repo, vec!["[xy].txt".into()])`: `staged` holds only Modified `x.txt`.
      - Comment: `*` and `?` are invalid in NTFS file names, so the test uses `[…]`. Without `:(literal)`, step 2 also stages `x.txt` (probe 2026-10-11).
    - `commit_returns_short_hash_and_status_is_clean` (integration; stage `a.txt` in an unborn repo, commit `"first"`, `hash.len() >= 7`, `summary == "first"`, then status `unborn == false` with both lists empty)
    - `commit_with_nothing_staged_is_git_failed` (integration; after the first commit, a second `git_commit` gives `git_failed`)
- lines: about 200 (about 70 code, 130 tests).
- exec: `judgment`. Lock placement and test fixtures.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib git:: 2>&1 | grep 'test result'`
  Expected: `test result: ok. 37 passed; 0 failed; 0 ignored; 0 measured; 280 filtered out`.

### step 5
Goal: register the three write commands.

- files: `gui/src-tauri/src/lib.rs`
- edit:
  - old: `            git::git_diff,`
  - new:
    ```
                git::git_diff,
                git::git_stage,
                git::git_unstage,
                git::git_commit,
    ```
- lines: 3
- exec: `mechanical`. Exact text.
- verify: first run `rustfmt --edition 2021 /c/Users/Reinaldo/Backend/herdr/gui/src-tauri/src/git.rs` (never `cargo fmt`). Then `cd /c/Users/Reinaldo/Backend/herdr/gui && echo "fmt:$(cargo fmt --check 2>&1 | grep '^Diff in' | grep -vc flutter.rs) clippy:$(cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^ +--> ' | grep -vc flutter.rs)" && cargo test -p herdr-gui --lib git:: 2>&1 | grep 'test result'`
  Expected: `fmt:0 clippy:0`, then `test result: ok. 37 passed; 0 failed; …`.

**Commit boundary S2. Do not commit.** Files: `gui/src-tauri/src/git.rs`, `gui/src-tauri/src/lib.rs`. Suggested message: `feat: add git stage, unstage and commit commands`.

---

## Slice S3: TypeScript API and diff parser

### step 6
Goal: add the typed `invoke` wrappers.

- files: `gui/src/git/gitApi.ts` (new)
- edit: create the file with exactly this content:
  ```ts
  // Git MVP spec §4: the TypeScript side of `src-tauri/src/git.rs`. Each
  // wrapper is one `invoke` and rejects with the backend's `{ code, message }`
  // `ApiError`; the caller picks an inline error (poll) or a notice (action),
  // spec §7.

  import { invoke } from "@tauri-apps/api/core";

  /** `ChangeKind` serialized lowercase: `TypeChanged` is `"typechanged"`. */
  export type ChangeKind =
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "copied"
    | "typechanged"
    | "untracked"
    | "conflicted";

  export interface FileChange {
    /** Repo-relative with `/` separators, exactly as git prints it. */
    path: string;
    origPath: string | null;
    kind: ChangeKind;
  }

  export interface GitStatus {
    /** `rev-parse --show-toplevel`; `null` outside a git repository. */
    repo: string | null;
    branch: string | null;
    ahead: number;
    behind: number;
    unborn: boolean;
    staged: FileChange[];
    unstaged: FileChange[];
  }

  export interface GitDiff {
    text: string;
    truncated: boolean;
    binary: boolean;
  }

  export interface CommitResult {
    hash: string;
    summary: string;
  }

  export function gitStatus(cwd: string): Promise<GitStatus> {
    return invoke<GitStatus>("git_status", { cwd });
  }

  export function gitDiff(repo: string, path: string, staged: boolean, untracked: boolean): Promise<GitDiff> {
    return invoke<GitDiff>("git_diff", { repo, path, staged, untracked });
  }

  export function gitStage(repo: string, paths: string[]): Promise<void> {
    return invoke<void>("git_stage", { repo, paths });
  }

  export function gitUnstage(repo: string, paths: string[]): Promise<void> {
    return invoke<void>("git_unstage", { repo, paths });
  }

  export function gitCommit(repo: string, message: string): Promise<CommitResult> {
    return invoke<CommitResult>("git_commit", { repo, message });
  }
  ```
- lines: 68
- exec: `judgment`. New file. The content is given verbatim, so no choices are left.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && echo TSC_OK`. Expected: `TSC_OK`.

### step 7
Goal: add the pure unified-diff parser.

- files: `gui/src/git/diffParse.ts` (new)
- edit: create the file. Required export shape (spec §5):
  ```ts
  export type DiffLine =
    | { kind: "hunk"; text: string }
    | { kind: "context" | "add" | "del"; text: string; oldNo: number | null; newNo: number | null }
    | { kind: "meta"; text: string };
  export function parseUnifiedDiff(text: string): DiffLine[];
  ```
  Rules:
  - `""` returns `[]`. Split on `"\n"` and drop one trailing empty element.
  - Strip one trailing `"\r"` from each line before you classify it. The `text` is otherwise the full line, **including** its `+`, `-` or space prefix (the live check expects a `+hi` row).
  - Hunk header regex: `/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/`. A match pushes `hunk`, sets `oldNo = a` and `newNo = c`, and sets `inHunk = true`.
  - A line that starts with `diff --git ` sets `inHunk = false` and is dropped.
  - Outside a hunk: drop lines that start with `diff --git `, `index `, `--- ` or `+++ `. Every other line is `meta`. This keeps `new file mode`, `deleted file mode`, `rename from`, `rename to`, `old mode` and `Binary files … differ`.
  - Inside a hunk, by the first char:
    - `-` gives `del { oldNo, newNo: null }`, then `oldNo++`.
    - `+` gives `add { oldNo: null, newNo }`, then `newNo++`.
    - a space or an empty line gives `context { oldNo, newNo }`, then both `++`.
    - `\` gives `meta` with no counter change.
    - anything else is `meta`.
  - Comment: `// shortcut: combined conflict diffs (@@@) do not match the hunk regex, so they render as meta rows; parse them if conflict viewing matters.`
- lines: about 55
- exec: `judgment`. New file.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && echo TSC_OK`. Expected: `TSC_OK`.

### step 8
Goal: add the parser tests (spec §5).

- files: `gui/tests/unit/git/diffParse.test.ts` (new; node env, so no `@vitest-environment` line)
- edit: create the file. It imports `parseUnifiedDiff` from `"../../../src/git/diffParse"` and has exactly these `it` cases:
  1. `parses a modify hunk with old and new line numbers` (the headers are dropped; check `del`/`add`/`context` numbers)
  2. `parses a new file` (`new file mode 100644` is `meta`; `@@ -0,0 +1,3 @@` gives 3 `add` rows with `newNo` 1..3 and `oldNo` null)
  3. `parses a deleted file` (`deleted file mode` is `meta`; `@@ -1,2 +0,0 @@` gives 2 `del` rows)
  4. `restarts the counters on each hunk` (two hunks, `@@ -1,2 +1,2 @@` and `@@ -10,2 +10,3 @@`)
  5. `keeps "\ No newline at end of file" as meta without moving the counters`
  6. `treats a count-less hunk header as a count of 1` (`@@ -1 +1 @@`)
  7. `strips a trailing \r from CRLF input` (no `text` ends with `\r`; the kinds match the LF version)
  8. `returns [] for empty input`
  9. `keeps a deleted line that starts with "--" inside a hunk as del` (the line `--- x`, inside a hunk, is `del`)
- lines: about 110
- exec: `judgment`. New test file.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx vitest run tests/unit/git/diffParse.test.ts 2>&1 | grep -E 'Test Files|Tests '`
  Expected: `Test Files  1 passed (1)` and `Tests  9 passed (9)`.

**Commit boundary S3. Do not commit.** Files: `gui/src/git/gitApi.ts`, `gui/src/git/diffParse.ts`, `gui/tests/unit/git/diffParse.test.ts`. Suggested message: `feat: add the git api wrappers and the unified-diff parser`.

---

## Slice S4: read-only Source Control section

Before S4, the UI has no behavior change: S1–S3 add commands and modules that nothing calls yet.

### step 9
Goal: persist `sourceControlOpen` (default `false`), so that old settings files still load.

- files: `gui/src-tauri/src/settings.rs`, `gui/src/settings.ts`
- edit 1 (`settings.rs`, struct):
  - old:
    ```
        /// `{project dir -> flavor}`, the last pick. Typed into a shell on Play.
        #[serde(default)]
        pub flutter_flavors: HashMap<String, String>,
    }
    ```
  - new:
    ```
        /// `{project dir -> flavor}`, the last pick. Typed into a shell on Play.
        #[serde(default)]
        pub flutter_flavors: HashMap<String, String>,
        /// Git MVP spec §6.1: the Source Control section is open.
        /// `#[serde(default)]` keeps an older `settings.json` loading (`false`).
        #[serde(default)]
        pub source_control_open: bool,
    }
    ```
- edit 2 (`settings.rs`, `Default` impl):
  - old:
    ```
                flutter_flavors: HashMap::new(),
            }
    ```
  - new:
    ```
                flutter_flavors: HashMap::new(),
                source_control_open: false,
            }
    ```
- edit 3 (`settings.rs`, test `partial_json_fills_in_defaults`):
  - old: `        assert!(!response.settings.agent_list_pinned);`
  - new:
    ```
            assert!(!response.settings.agent_list_pinned);
            assert!(!response.settings.source_control_open);
    ```
- edit 4 (`settings.ts`, interface):
  - old:
    ```
      /** `{project dir -> flavor}`, the last pick. */
      flutterFlavors: Record<string, string>;
    }
    ```
  - new:
    ```
      /** `{project dir -> flavor}`, the last pick. */
      flutterFlavors: Record<string, string>;
      /** Git MVP spec §6.1: the Source Control section is open. */
      sourceControlOpen: boolean;
    }
    ```
- edit 5 (`settings.ts`, defaults):
  - old:
    ```
      flutterFlavors: {},
    };
    ```
  - new:
    ```
      flutterFlavors: {},
      sourceControlOpen: false,
    };
    ```
- lines: 4 + 1 + 1 + 2 + 1 = 9
- exec: `mechanical`. Exact text.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && cd src-tauri && cargo test -p herdr-gui --lib settings:: 2>&1 | grep 'test result'`
  Expected: tsc prints nothing, then `test result: ok. 7 passed; 0 failed; …`.

### step 10
Goal: claim `Ctrl+Shift+G` (Windows) and `Cmd+Shift+G` (macOS) for `view.sourceControl`. No existing binding uses `KeyG` (checked in `src/` and `tests/`). The existing test "no two actions share a combo" is the macOS collision check.

- files: `gui/src/shortcuts.ts`, `gui/tests/unit/shortcuts.test.ts`
- edit 1 (`shortcuts.ts`, `NAMED_SHORTCUTS`):
  - old:
    ```
        id: "view.toggleSidebar",
        menu: "View",
        label: "Toggle Sidebar",
        display: "Ctrl+Shift+B",
        combo: combo(true, true, false, "KeyB"),
      },
    ```
  - new:
    ```
        id: "view.toggleSidebar",
        menu: "View",
        label: "Toggle Sidebar",
        display: "Ctrl+Shift+B",
        combo: combo(true, true, false, "KeyB"),
      },
      {
        id: "view.sourceControl",
        menu: "View",
        label: "Source Control",
        display: "Ctrl+Shift+G",
        combo: combo(true, true, false, "KeyG"),
      },
    ```
- edit 2 (`shortcuts.ts`, `MAC_ENTRIES`):
  - old: `  "view.toggleSidebar": { combo: cmd("KeyB") },`
  - new:
    ```
      "view.toggleSidebar": { combo: cmd("KeyB") },
      "view.sourceControl": { combo: cmd("KeyG", { shift: true }) },
    ```
- edit 3 (`shortcuts.test.ts`, after the `Ctrl+Shift+E resolves to view.focusSidebar` test):
  - old:
    ```
        ).toBe("view.focusSidebar");
      });
    ```
  - new:
    ```
        ).toBe("view.focusSidebar");
      });

      it("Ctrl+Shift+G resolves to view.sourceControl", () => {
        expect(
          findShortcut({ ctrlKey: true, shiftKey: true, altKey: false, code: "KeyG" }, false)?.id,
        ).toBe("view.sourceControl");
      });
    ```
- edit 4 (`shortcuts.test.ts`, the macOS "matches the agreed layout" test):
  - old: `    expect(shown("agents.jumpToNextNeedingAttention")).toBe("⌘J");`
  - new:
    ```
        expect(shown("agents.jumpToNextNeedingAttention")).toBe("⌘J");
        expect(shown("view.sourceControl")).toBe("⇧⌘G");
    ```
- lines: 7 + 1 + 6 + 1 = 15
- exec: `mechanical`. Exact text.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx vitest run tests/unit/shortcuts.test.ts tests/unit/ui/shortcutsModal.test.ts 2>&1 | grep -E 'Test Files|Tests |FAIL'`
  Expected: `Test Files  2 passed (2)`, a `Tests  N passed (N)` line, and no `FAIL` line. `shortcutsModal.test.ts` counts rows through `cheatSheetEntries().length`, so the new entry needs no fixture change.

### step 11
Goal: add the pure refresh scheduler (spec §6.3 ordering rules) and its vitest (spec §8.2).

- files: `gui/src/git/statusRefresh.ts` (new), `gui/tests/unit/git/statusRefresh.test.ts` (new, node env)
- edit (`statusRefresh.ts`). This reference implementation is load-bearing; keep its semantics:
  ```ts
  // Git MVP spec §6.3 ordering rules as pure logic (no DOM, unit-tested): one
  // git_status in flight; a trigger during a run causes exactly one follow-up;
  // a result for a cwd that is no longer active is dropped; an unchanged result
  // is not applied again, so the list does not flicker every poll.

  export interface StatusRefresherDeps<T> {
    fetch(cwd: string): Promise<T>;
    /** The active workspace's `new_workspace_cwd`, or `null` with no workspace. */
    currentCwd(): string | null;
    /** Called only when the result differs (JSON) from the last one applied. */
    onResult(cwd: string, result: T): void;
    onError(cwd: string, err: unknown): void;
  }

  export interface StatusRefresher {
    /** Starts a run, or marks one follow-up when a run is in flight. */
    request(): void;
    /** Forgets the last result, so the next one is applied even when equal. */
    reset(): void;
  }

  export function createStatusRefresher<T>(deps: StatusRefresherDeps<T>): StatusRefresher {
    let running = false;
    let dirty = false;
    let lastJson: string | null = null;

    async function run(): Promise<void> {
      const cwd = deps.currentCwd();
      if (cwd === null) return;
      running = true;
      try {
        const result = await deps.fetch(cwd);
        if (deps.currentCwd() !== cwd) return; // stale: the workspace changed
        const json = JSON.stringify(result);
        if (json === lastJson) return;
        lastJson = json;
        deps.onResult(cwd, result);
      } catch (err) {
        if (deps.currentCwd() !== cwd) return;
        lastJson = null; // the next success must render, to clear the error line
        deps.onError(cwd, err);
      } finally {
        running = false;
        if (dirty) {
          dirty = false;
          void run();
        }
      }
    }

    return {
      request() {
        if (running) {
          dirty = true;
          return;
        }
        void run();
      },
      reset() {
        lastJson = null;
      },
    };
  }
  ```
- edit (`statusRefresh.test.ts`): use a `deferred<T>()` helper, a fake `fetch` that records its cwd arguments, a mutable `cwd` variable, and `const flush = () => new Promise((r) => setTimeout(r, 0));`. Exactly these cases:
  1. `runs one fetch for the active cwd and applies the result`
  2. `drops a result whose cwd is no longer active` (switch cwd A to B before resolving; `onResult` is not called for A)
  3. `drops an error whose cwd is no longer active`
  4. `a trigger during a run causes exactly one follow-up` (3 `request()` calls while in flight give exactly 2 fetches in total)
  5. `skips an unchanged result, and applies it again after reset()`
  6. `does nothing without an active cwd` (`currentCwd()` returns `null`, and `fetch` is never called)
- lines: about 60 + 120
- exec: `judgment`. New files.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx vitest run tests/unit/git/statusRefresh.test.ts 2>&1 | grep -E 'Test Files|Tests '`
  Expected: `Test Files  1 passed (1)` and `Tests  6 passed (6)`.

### step 12
Goal: add the section markup, the DOM lookups and the read-only styles.

- files: `gui/index.html`, `gui/src/appDom.ts`, `gui/src/style.css`
- edit 1 (`index.html`):
  - old:
    ```
            <div id="sidebar-list" role="listbox" aria-label="Workspaces"></div>
            <div class="sidebar-footer" id="sidebar-footer" tabindex="0" role="button">
    ```
  - new:
    ```
            <div id="sidebar-list" role="listbox" aria-label="Workspaces"></div>
            <section id="source-control" aria-label="Source Control" hidden>
              <div class="sidebar-header">
                <i class="codicon codicon-chevron-down sidebar-header__chevron"></i>
                <span class="sidebar-header__label">SOURCE CONTROL</span>
                <span class="sidebar-header__spacer"></span>
                <button id="source-control-refresh" class="icon-btn" title="Refresh" aria-label="Refresh">
                  <i class="codicon codicon-refresh"></i>
                </button>
              </div>
              <div id="source-control-branch" class="sc-branch" hidden></div>
              <div id="source-control-body"></div>
            </section>
            <div class="sidebar-footer" id="sidebar-footer" tabindex="0" role="button">
    ```
- edit 2 (`appDom.ts`):
  - old: `export const sidebarResizeHandleEl = document.getElementById("sidebar-resize-handle") as HTMLDivElement;`
  - new:
    ```
    export const sidebarResizeHandleEl = document.getElementById("sidebar-resize-handle") as HTMLDivElement;
    export const sourceControlEl = document.getElementById("source-control") as HTMLElement;
    export const sourceControlBranchEl = document.getElementById("source-control-branch") as HTMLDivElement;
    export const sourceControlBodyEl = document.getElementById("source-control-body") as HTMLDivElement;
    export const sourceControlRefreshBtn = document.getElementById("source-control-refresh") as HTMLButtonElement;
    ```
- edit 3 (`style.css`). Append:
  ```css

  /* ---------------------------------------------------------------------- */
  /* Source Control (git MVP spec §6.1). `max-height: 50%` keeps the        */
  /* workspace list at least half the sidebar.                              */
  /* ---------------------------------------------------------------------- */

  #source-control {
    display: flex;
    flex-direction: column;
    flex: 0 1 auto;
    max-height: 50%;
    min-height: 0;
    border-top: 1px solid var(--sideBar-border);
  }

  #source-control[hidden],
  .sc-branch[hidden] {
    display: none;
  }

  #source-control-body {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 4px;
  }

  .sc-branch {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 12px 4px;
    font-size: var(--fs-xs);
    color: var(--descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    flex-shrink: 0;
  }

  .sc-branch .codicon {
    font-size: 14px;
  }

  .sc-branch__repo {
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sc-message {
    padding: 4px 12px;
    font-size: var(--fs-xs);
    color: var(--descriptionForeground);
    overflow-wrap: anywhere;
  }

  .sc-link {
    color: var(--focusBorder);
    cursor: pointer;
  }

  .sc-error {
    padding: 2px 12px 4px;
    font-size: var(--fs-xs);
    color: var(--errorForeground);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .sc-group-header {
    display: flex;
    align-items: center;
    height: 22px;
    padding: 0 8px 0 12px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--sideBarSectionHeader-foreground);
  }

  .sc-row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px 0 20px;
    cursor: pointer;
    white-space: nowrap;
  }

  .sc-row:hover {
    background: var(--list-hoverBackground);
  }

  .sc-row__status {
    width: 12px;
    flex-shrink: 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    text-align: center;
    color: var(--descriptionForeground);
  }

  .sc-row__name {
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sc-row__dir {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--fs-xs);
    color: var(--descriptionForeground);
  }

  .sc-row--more {
    cursor: default;
    font-size: var(--fs-xs);
    color: var(--descriptionForeground);
  }

  .sc-row--more:hover {
    background: none;
  }
  ```
- lines: 12 + 4 + 124 = 140
- exec: `mechanical`. Exact text.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && echo TSC_OK`. Expected: `TSC_OK`.

### step 13
Goal: add the read-only section renderer.

- files: `gui/src/ui/sourceControl.ts` (new)
- edit: create the file. Requirements:
  - Imports: `type { ChangeKind, FileChange, GitStatus } from "../git/gitApi"` and `type { ThemeColors } from "../themes/tokens"`.
  - Export:
    ```ts
    export type SourceControlView =
      | { kind: "noWorkspace" }
      | { kind: "loading" }
      | { kind: "gitMissing" }
      | { kind: "notRepo"; cwd: string }
      | { kind: "status"; status: GitStatus };
    export interface SourceControlCallbacks {
      onOpenGitDownload(): void;
    }
    export const MAX_ROWS_PER_GROUP = 500;
    export function renderSourceControl(
      branchEl: HTMLElement,
      bodyEl: HTMLElement,
      view: SourceControlView,
      error: string | null,
      colors: ThemeColors,
      callbacks: SourceControlCallbacks,
    ): void;
    ```
  - Status letters: `added A`, `modified M`, `deleted D`, `renamed R`, `copied C`, `typechanged T`, `untracked U`, `conflicted !`.
  - Theme keys:
    - `added`: `gitDecoration.addedResourceForeground`
    - `modified` and `typechanged`: `gitDecoration.modifiedResourceForeground`
    - `deleted`: `gitDecoration.deletedResourceForeground`
    - `renamed` and `copied`: `gitDecoration.renamedResourceForeground`
    - `untracked`: `gitDecoration.untrackedResourceForeground`
    - `conflicted`: `gitDecoration.conflictingResourceForeground`

    Set `style.color` only when `colors[key]` is defined (deviation 13).
  - Branch line (`branchEl`, shown only for `kind: "status"`, otherwise `hidden = true`):
    - an `<i class="codicon codicon-git-branch">`;
    - a span with `status.branch ?? "detached HEAD"`;
    - a span with `↑N` and/or `↓M`, each only when non-zero;
    - a `span.sc-branch__repo` with the last path segment of `status.repo` (split on `/` and `\`) and `title = status.repo`.
  - Body (`bodyEl.textContent = ""`, then build):
    - First, `div.sc-error` with `error` when it is non-null.
    - `noWorkspace`: `div.sc-message` "No workspace".
    - `loading`: nothing.
    - `gitMissing`: `div.sc-message` "Git is not installed", then a `span.sc-link` "git-scm.com" (`role="link"`, `tabindex="0"`). Click and Enter call `onOpenGitDownload`.
    - `notRepo`: "Not a git repository", then a second `div.sc-message` with `cwd` (`title = cwd`).
    - `status` with both lists empty: "No changes".
    - Otherwise, groups in this order: `Staged Changes (n)` from `staged`, then `Changes (n)` from `unstaged`. A group with 0 entries is skipped.
  - Group: `div.sc-group-header` with its title, then at most `MAX_ROWS_PER_GROUP` rows, then a `div.sc-row.sc-row--more` "and N more" when the list is longer. Comment: `// shortcut: no virtual list; add one if repos with more than 500 changes turn out to be common.`
  - Row (`div.sc-row`):
    - `dataset.path = path`;
    - `title` = path, or "Resolve conflicts in a terminal" for `conflicted`;
    - children: `span.sc-row__status` (the letter), `span.sc-row__name` (the basename after the last `/`), and `span.sc-row__dir` (the dirname, or empty).
  - All text goes through `textContent`, never `innerHTML` (paths are untrusted).
- lines: about 120
- exec: `judgment`. New file and DOM building.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && echo TSC_OK`. Expected: `TSC_OK`.

### step 14
Goal: add the orchestration (toggle, poll, active-workspace tracking, inline poll errors).

- files: `gui/src/appSourceControl.ts` (new)
- edit: create the file. It must **not** import `appMenuBar.ts`, because `appMenuBar` imports this module (import cycle). Requirements:
  - Imports:
    - `listen` from `@tauri-apps/api/event`;
    - `errorMessage` and `invokeSafe` from `./appApi`;
    - the 4 `sourceControl*` elements from `./appDom`;
    - `currentThemeDef` from `./appLookups`;
    - `appState` from `./appState`;
    - `type RawSnapshot` from `./appTypes`;
    - `gitStatus` and `type GitStatus` from `./git/gitApi`;
    - `createStatusRefresher` from `./git/statusRefresh`;
    - `renderSourceControl` and `type SourceControlView` from `./ui/sourceControl`.
  - Module state: `activeWorkspaceId: string | null`, `activeCwd: string | null`, `view: SourceControlView = { kind: "noWorkspace" }`, `pollError: string | null`.
  - `const POLL_MS = 3000;` with the comment `// shortcut: 3 s poll, not a file watcher; add notify-based watching if the poll shows up in the perf HUD on large repos.`
  - `function isActive(): boolean`: `appState.settings.sourceControlOpen && appState.settings.sidebarVisible`.
  - `refresher = createStatusRefresher<GitStatus>({ fetch: gitStatus, currentCwd: () => activeCwd, onResult, onError })`:
    - `onResult`: `pollError = null`. `view = status.repo === null ? { kind: "notRepo", cwd } : { kind: "status", status }`. Then `render()`.
    - `onError`: `(err as { code?: string })?.code === "git_not_found"` sets `view = { kind: "gitMissing" }` and `pollError = null`. Otherwise `pollError = errorMessage(err)`. Then `render()`. Poll errors never toast (spec §7).
  - `function render()`: `renderSourceControl(sourceControlBranchEl, sourceControlBodyEl, view, pollError, currentThemeDef().colors, { onOpenGitDownload: () => void invokeSafe("open_external_url", { url: "https://git-scm.com" }) })`.
  - `function onSnapshot(snapshot: RawSnapshot)`:
    - First line, a comment (finding H): `// shortcut: new_workspace_cwd follows a cd only after herdr learns the pane's new cwd (the shell reports it, e.g. OSC 7); add a shell-integration hint if users expect otherwise.`
    - `ws = snapshot.workspaces.find((w) => w.focused)`.
    - `id = ws?.workspace_id ?? null` and `cwd = ws?.new_workspace_cwd || null`. An empty string means no workspace (deviation 8).
    - If both equal the last values, return.
    - Otherwise store them, `refresher.reset()`, `pollError = null`, `view = cwd ? { kind: "loading" } : { kind: "noWorkspace" }`, `render()`, and `if (isActive()) refresher.request()`.
  - `export function applySourceControlVisibility(): void`: `sourceControlEl.hidden = !appState.settings.sourceControlOpen`. If `isActive()`, run `render()` and `refresher.request()`.
  - `export async function initSourceControl(): Promise<void>`:
    - `applySourceControlVisibility()`.
    - Refresh button `click` calls `refresher.request()`.
    - `window` `focus` calls `refresher.request()` when `isActive()`.
    - `window.setInterval(() => { if (isActive() && !document.hidden) refresher.request(); }, POLL_MS)`.
    - `await listen<RawSnapshot>("snapshot", (event) => onSnapshot(event.payload))`.
- lines: about 90
- exec: `judgment`. New file, orchestration.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && echo TSC_OK`. Expected: `TSC_OK`.

### step 15
Goal: wire the menu item (last in the View menu, deviation 29), the shortcut handler, the menu context and the startup call.

- files: `gui/src/ui/menus.ts`, `gui/tests/unit/ui/menus.test.ts`, `gui/src/appMenuBar.ts`, `gui/src/main.ts`
- edit 1 (`menus.ts`, `MenuBarContext`):
  - old:
    ```
      sidebarVisible: boolean;
      onToggleSidebar(): void;
    ```
  - new:
    ```
      sidebarVisible: boolean;
      onToggleSidebar(): void;
      sourceControlOpen: boolean;
      onToggleSourceControl(): void;
    ```
- edit 2 (`menus.ts`, `viewMenuItems`, after Desktop Notifications, the last item). Index 0 (Toggle Sidebar) and index 1 (Color Theme) keep their places, so the ArrowDown tests at `menus.test.ts:183-207` are unaffected:
  - old:
    ```
          onSelect: ctx.onToggleDesktopNotifications,
        },
      ];
    ```
  - new:
    ```
          onSelect: ctx.onToggleDesktopNotifications,
        },
        {
          id: "view.sourceControl",
          label: "Source Control",
          shortcut: shortcutDisplay("view.sourceControl"),
          checked: ctx.sourceControlOpen,
          onSelect: ctx.onToggleSourceControl,
        },
      ];
    ```
- edit 3 (`menus.test.ts`, `fakeContext()`):
  - old:
    ```
        sidebarVisible: true,
        onToggleSidebar: noop,
    ```
  - new:
    ```
        sidebarVisible: true,
        onToggleSidebar: noop,
        sourceControlOpen: false,
        onToggleSourceControl: noop,
    ```
- edit 4 (`appMenuBar.ts`, import):
  - old: `import { applySidebarVisibility } from "./appSidebarResize";`
  - new:
    ```
    import { applySidebarVisibility } from "./appSidebarResize";
    import { applySourceControlVisibility } from "./appSourceControl";
    ```
- edit 5 (`appMenuBar.ts`, `menuBarContext`):
  - old:
    ```
      onToggleSidebar: () => {
        appState.settings.sidebarVisible = !appState.settings.sidebarVisible;
        menuBarContext.sidebarVisible = appState.settings.sidebarVisible;
        applySidebarVisibility();
        persistSettings();
      },
    ```
  - new:
    ```
      onToggleSidebar: () => {
        appState.settings.sidebarVisible = !appState.settings.sidebarVisible;
        menuBarContext.sidebarVisible = appState.settings.sidebarVisible;
        applySidebarVisibility();
        persistSettings();
      },
      sourceControlOpen: appState.settings.sourceControlOpen,
      onToggleSourceControl: () => {
        appState.settings.sourceControlOpen = !appState.settings.sourceControlOpen;
        menuBarContext.sourceControlOpen = appState.settings.sourceControlOpen;
        // The section lives in the sidebar: opening it while hidden would show nothing.
        if (appState.settings.sourceControlOpen && !appState.settings.sidebarVisible) {
          appState.settings.sidebarVisible = true;
          menuBarContext.sidebarVisible = true;
          applySidebarVisibility();
        }
        applySourceControlVisibility();
        persistSettings();
      },
    ```
- edit 6 (`appMenuBar.ts`, `refreshMenuBarContext`):
  - old:
    ```
      menuBarContext.sidebarVisible = appState.settings.sidebarVisible;
      menuBarContext.currentThemeId = appState.settings.theme;
    ```
  - new:
    ```
      menuBarContext.sidebarVisible = appState.settings.sidebarVisible;
      menuBarContext.sourceControlOpen = appState.settings.sourceControlOpen;
      menuBarContext.currentThemeId = appState.settings.theme;
    ```
- edit 7 (`appMenuBar.ts`, `SHORTCUT_HANDLERS`):
  - old: `  "view.toggleSidebar": () => menuBarContext.onToggleSidebar(),`
  - new:
    ```
      "view.toggleSidebar": () => menuBarContext.onToggleSidebar(),
      "view.sourceControl": () => menuBarContext.onToggleSourceControl(),
    ```
- edit 8 (`main.ts`, import):
  - old: `import { renderSidebarNow } from "./appSidebarPanel";`
  - new:
    ```
    import { renderSidebarNow } from "./appSidebarPanel";
    import { initSourceControl } from "./appSourceControl";
    ```
- edit 9 (`main.ts`). Register the snapshot listener before the `sync_state` replay:
  - old:
    ```
      await wireEvents();
      await subscribeSurface();
    ```
  - new:
    ```
      await wireEvents();
      await initSourceControl();
      await subscribeSurface();
    ```
- lines: 2 + 7 + 2 + 1 + 13 + 1 + 1 + 1 + 1 = 29
- exec: `mechanical`. Exact text.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run tests/unit/ui/menus.test.ts tests/unit/shortcuts.test.ts 2>&1 | grep -E 'Test Files|FAIL'`
  Expected: tsc silent, `Test Files  2 passed (2)`, no `FAIL`.

### step 16
Goal: run the S4 slice check, and prove that S4 left `routing.ts` and `engine.rs` unchanged. Note: routing step 2 claims table shortcuts whatever has focus (`src/keyboard/routing.ts:80-90`, deviation 30). The commit box arrives in S5, and step 17 gates the five terminal-only ids before it.

- files: none (verify only)
- edit: none
- lines: 0
- exec: `mechanical`. Commands only.
- verify:
  `cd /c/Users/Reinaldo/Backend/herdr/gui && git diff --stat -- src/keyboard/routing.ts src-tauri/src/engine.rs && echo "fmt:$(cargo fmt --check 2>&1 | grep '^Diff in' | grep -vc flutter.rs) clippy:$(cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^ +--> ' | grep -vc flutter.rs)" && cargo test --workspace 2>&1 | grep -E '^test result' && npx tsc --noEmit && npx vitest run 2>&1 | grep -E 'Test Files|Tests '`
  Expected:
  - no diffstat lines;
  - `fmt:0 clippy:0`;
  - every `test result: ok.`, and the herdr-gui lib line reads `317 passed`;
  - tsc silent;
  - `Test Files  68 passed (68)` and `Tests  822 passed (822)` (806 + 9 + 6 + 1).

**Commit boundary S4. Do not commit.** Files:
- `gui/src-tauri/src/settings.rs`, `gui/src/settings.ts`
- `gui/src/shortcuts.ts`, `gui/tests/unit/shortcuts.test.ts`
- `gui/src/git/statusRefresh.ts`, `gui/tests/unit/git/statusRefresh.test.ts`
- `gui/index.html`, `gui/src/appDom.ts`, `gui/src/style.css`
- `gui/src/ui/sourceControl.ts`, `gui/src/appSourceControl.ts`
- `gui/src/ui/menus.ts`, `gui/tests/unit/ui/menus.test.ts`
- `gui/src/appMenuBar.ts`, `gui/src/main.ts`

Suggested message: `feat: add a read-only source control section`.

---

## Slice S5: terminal-only keys, diff view, stage buttons, commit box

### step 17
Goal: gate paste and the scrollback shortcuts on terminal focus on every OS, so a text field keeps native `Shift+Insert`, `Shift+PgUp/PgDn/Home/End` (and `Cmd+V`, `Cmd+Up/Down` on macOS). Deviation 30.

- files: `gui/src/keyboard/routing.ts`, `gui/tests/unit/keyboard/routing.test.ts`
- edit 1 (`routing.ts`):
  - old:
    ```
    /** Cmd+C / Cmd+V act on the terminal only while it has focus; in a text field
     * (find bar, dialogs) they must stay the native copy and paste. */
    const TERMINAL_ONLY_MAC_IDS = new Set(["pane.copy", "pane.paste"]);
    ```
  - new:
    ```
    /** Cmd+C acts on the terminal only while it has focus; in a text field (find
     * bar, dialogs) it must stay the native copy. */
    const TERMINAL_ONLY_MAC_IDS = new Set(["pane.copy"]);
    /** Paste and the scrollback keys act on the terminal only while it has focus,
     * on every OS: in a text field (find bar, dialogs, the commit box) Shift+Insert,
     * Shift+PgUp/PgDn/Home/End and Cmd+V/Up/Down must stay native. */
    const TERMINAL_ONLY_IDS = new Set([
      "pane.paste",
      "pane.scrollPageUp",
      "pane.scrollPageDown",
      "pane.scrollToTop",
      "pane.scrollToBottom",
    ]);
    ```
- edit 2 (`routing.ts`, in `routeKeydown`):
  - old:
    ```
      const shortcut =
        found && IS_MAC && TERMINAL_ONLY_MAC_IDS.has(found.id) && activeElement !== keyboardCaptureEl
          ? undefined
          : found;
    ```
  - new:
    ```
      const terminalOnly =
        found && (TERMINAL_ONLY_IDS.has(found.id) || (IS_MAC && TERMINAL_ONLY_MAC_IDS.has(found.id)));
      const shortcut = terminalOnly && activeElement !== keyboardCaptureEl ? undefined : found;
    ```
- edit 3 (`routing.test.ts`, after the `Ctrl+Shift+V reads the clipboard only while the terminal capture has focus` test):
  - old:
    ```
        const handlers2 = fakeHandlers();
        routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyV" }), capture, row, handlers2);
        expect(handlers2.pastes).toBe(0);
      });
    ```
  - new:
    ```
        const handlers2 = fakeHandlers();
        routeKeydown(fakeEvent({ ctrlKey: true, shiftKey: true, code: "KeyV" }), capture, row, handlers2);
        expect(handlers2.pastes).toBe(0);
      });

      // Git MVP plan step 17: paste and the scrollback keys are terminal-only on
      // every OS, so a text field (the commit box, the find bar) keeps its native
      // Shift+Insert paste and Shift+Home/End/PgUp/PgDn selection.
      it("step 2: Shift+Insert and the Shift scrollback keys act on the terminal only while the capture has focus", () => {
        const capture = fakeElement();
        const textField = fakeElement();
        for (const code of ["Insert", "PageUp", "PageDown", "Home", "End"]) {
          const handlers = fakeHandlers();
          const event = fakeEvent({ shiftKey: true, key: code, code });
          routeKeydown(event, capture, textField, handlers);
          expect(handlers.shortcuts).toEqual([]);
          expect(event.preventDefault).not.toHaveBeenCalled();
        }
        const handlers = fakeHandlers();
        routeKeydown(fakeEvent({ shiftKey: true, key: "Insert", code: "Insert" }), capture, capture, handlers);
        expect(handlers.shortcuts).toEqual(["pane.paste"]);
      });
    ```
- lines: 15 + 7 + 17 = 39
- exec: `mechanical`. Exact text.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && npx vitest run tests/unit/keyboard/routing.test.ts 2>&1 | grep -E 'Test Files|Tests |FAIL'`
  Expected: tsc silent, `Test Files  1 passed (1)`, `Tests  20 passed (20)`, no `FAIL`.

**Commit boundary S5a. Do not commit.** Files: `gui/src/keyboard/routing.ts`, `gui/tests/unit/keyboard/routing.test.ts`. Suggested message: `fix: keep paste and scrollback keys native outside the terminal`.

### step 18
Goal: add the static diff-view root, the static commit box (built once, so a re-render never wipes the typed message), their DOM lookups, and their styles.

- files: `gui/index.html`, `gui/src/appDom.ts`, `gui/src/style.css`
- edit 1 (`index.html`, commit box between the branch line and the body):
  - old:
    ```
              <div id="source-control-branch" class="sc-branch" hidden></div>
              <div id="source-control-body"></div>
    ```
  - new:
    ```
              <div id="source-control-branch" class="sc-branch" hidden></div>
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
              <div id="source-control-body"></div>
    ```
- edit 2 (`index.html`, diff view inside `#terminal-wrap`):
  - old:
    ```
              <div id="perf-hud" hidden></div>
            </div>
    ```
  - new:
    ```
              <div id="perf-hud" hidden></div>
              <div id="diff-view" tabindex="-1" role="region" aria-label="Diff" hidden></div>
            </div>
    ```
- edit 3 (`appDom.ts`):
  - old: `export const sourceControlRefreshBtn = document.getElementById("source-control-refresh") as HTMLButtonElement;`
  - new:
    ```
    export const sourceControlRefreshBtn = document.getElementById("source-control-refresh") as HTMLButtonElement;
    export const sourceControlCommitEl = document.getElementById("source-control-commit") as HTMLDivElement;
    export const sourceControlMessageEl = document.getElementById("source-control-message") as HTMLTextAreaElement;
    export const sourceControlCommitBtn = document.getElementById("source-control-commit-btn") as HTMLButtonElement;
    export const diffViewEl = document.getElementById("diff-view") as HTMLDivElement;
    ```
- edit 4 (`style.css`). Append:
  ```css

  /* Source Control actions and commit box (git MVP spec §6.1). */

  .sc-row__action {
    visibility: hidden;
    flex-shrink: 0;
  }

  .sc-row:hover .sc-row__action,
  .sc-row:focus-within .sc-row__action {
    visibility: visible;
  }

  .sc-group-header .icon-btn {
    margin-left: auto;
  }

  .sc-commit {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 12px 6px;
    flex-shrink: 0;
  }

  .sc-commit[hidden] {
    display: none;
  }

  .sc-commit textarea {
    resize: vertical;
    min-height: 40px;
    max-height: 160px;
    padding: 4px 6px;
    border: 1px solid var(--menu-border);
    border-radius: 4px;
    background: var(--terminal-background);
    color: var(--terminal-foreground);
    font: inherit;
    font-size: var(--fs-xs);
  }

  .sc-commit .btn:disabled {
    opacity: 0.5;
    cursor: default;
    filter: none;
  }

  /* ---------------------------------------------------------------------- */
  /* Diff view (git MVP spec §6.2): covers the canvas, which stays alive    */
  /* under it. Above pane chrome (1) and the find bar (3), below the        */
  /* connection banner (5).                                                 */
  /* ---------------------------------------------------------------------- */

  #diff-view {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    background: var(--terminal-background);
    color: var(--terminal-foreground);
  }

  #diff-view[hidden] {
    display: none;
  }

  #diff-view:focus {
    outline: none;
  }

  .diff-view__header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px 0 12px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--tab-border);
    font-size: var(--fs-xs);
    color: var(--foreground);
  }

  .diff-view__path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diff-view__tag {
    color: var(--descriptionForeground);
  }

  .diff-view__header .icon-btn {
    margin-left: auto;
  }

  .diff-view__body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .diff-view__lines {
    width: max-content;
    min-width: 100%;
    padding: 4px 0;
  }

  .diff-row {
    display: flex;
    white-space: pre;
  }

  .diff-row__no {
    width: 6ch;
    flex-shrink: 0;
    padding-right: 1ch;
    text-align: right;
    color: var(--descriptionForeground);
    user-select: none;
  }

  .diff-row__text {
    padding: 0 12px 0 4px;
  }

  .diff-row--add {
    background: color-mix(in srgb, var(--terminal-ansiGreen) 15%, transparent);
  }

  .diff-row--del {
    background: color-mix(in srgb, var(--terminal-ansiRed) 15%, transparent);
  }

  .diff-row--hunk {
    color: var(--descriptionForeground);
  }

  .diff-row--meta {
    color: var(--descriptionForeground);
    font-style: italic;
  }

  .diff-view__note {
    padding: 8px 12px;
    color: var(--descriptionForeground);
  }
  ```
- lines: 10 + 1 + 4 + 140 = 155
- exec: `mechanical`. Exact text.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && echo TSC_OK`. Expected: `TSC_OK`.

### step 19
Goal: add the open-diff follow rule (spec §6.2 last bullet and §6.3 "Open diff") to the pure module, with tests.

- files: `gui/src/git/statusRefresh.ts`, `gui/tests/unit/git/statusRefresh.test.ts`
- edit (`statusRefresh.ts`). Append (add `import type { ChangeKind, GitStatus } from "./gitApi";` at the top):
  ```ts
  export interface OpenDiffRef {
    path: string;
    staged: boolean;
    kind: ChangeKind;
  }

  export type DiffFollow =
    | { action: "keep" }
    | { action: "close" }
    | { action: "refetch"; staged: boolean; kind: ChangeKind };

  /** After a status change: keep the open diff, re-fetch it only when the
   * file's list or kind changed, or close it when the file left both lists. */
  export function followOpenDiff(open: OpenDiffRef, status: GitStatus): DiffFollow {
    const same = (open.staged ? status.staged : status.unstaged).find((f) => f.path === open.path);
    if (same) return same.kind === open.kind ? { action: "keep" } : { action: "refetch", staged: open.staged, kind: same.kind };
    const other = (open.staged ? status.unstaged : status.staged).find((f) => f.path === open.path);
    if (other) return { action: "refetch", staged: !open.staged, kind: other.kind };
    return { action: "close" };
  }
  ```
- edit (`statusRefresh.test.ts`). Add a `describe("followOpenDiff")` with exactly these cases:
  - `keeps the diff when the file keeps its list and kind`
  - `re-fetches when the kind changed`
  - `follows the file into the other list` (unstaged to staged after a stage)
  - `closes when the file left both lists`
- lines: about 22 + 40
- exec: `judgment`. Test fixtures.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx vitest run tests/unit/git/statusRefresh.test.ts 2>&1 | grep -E 'Test Files|Tests '`
  Expected: `Test Files  1 passed (1)` and `Tests  10 passed (10)`.

### step 20
Goal: add the diff overlay renderer.

- files: `gui/src/ui/diffView.ts` (new)
- edit: create the file. Requirements:
  - Imports: `type { GitDiff } from "../git/gitApi"`, `parseUnifiedDiff` from `../git/diffParse`, `FONT_STACK` from `../render/renderer` (import only).
  - Export:
    ```ts
    export interface DiffViewModel {
      path: string;
      staged: boolean;
      untracked: boolean;
      /** `null` while loading. */
      diff: GitDiff | null;
    }
    export function renderDiffView(rootEl: HTMLElement, model: DiffViewModel, fontSizePx: number, onClose: () => void): void;
    ```
  - Set `rootEl.textContent = ""`, then build:
    - **Header** `div.diff-view__header`: `span.diff-view__path` (the path), `span.diff-view__tag` with `(staged)`, `(untracked)` or nothing, and a `button.icon-btn` with `aria-label="Close"`, `title="Close (Esc)"` and `<i class="codicon codicon-close">`. A click on the button calls `onClose`.
    - **Body** `div.diff-view__body` with `style.fontFamily = FONT_STACK` and `style.fontSize = ${fontSizePx}px`.
      - `diff === null`: a `div.diff-view__note` "Loading…".
      - `diff.binary`: a `div.diff-view__note` "Binary file, no text diff".
      - Otherwise a `div.diff-view__lines` with one `div.diff-row.diff-row--<kind>` per `DiffLine`. Each row has two `span.diff-row__no` (old, new; empty for `null` or for `hunk`/`meta`) and a `span.diff-row__text`. Map `context` to the class `diff-row--context`.
      - `diff.truncated`: append a last `div.diff-view__note` "Diff truncated at 2 MiB".
  - All text goes through `textContent`.
- lines: about 70
- exec: `judgment`. New file.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && echo TSC_OK`. Expected: `TSC_OK`.

### step 21
Goal: add the row, group and commit affordances to the section renderer.

- files: `gui/src/ui/sourceControl.ts`
- edit. Requirements:
  - Extend `SourceControlCallbacks` with:
    ```ts
    onOpenFile(file: FileChange, staged: boolean): void;
    onStage(files: FileChange[]): void;
    onUnstage(files: FileChange[]): void;
    ```
  - Group headers:
    - `Staged Changes (n)` gets a `button.icon-btn` with `codicon-remove`, `title`/`aria-label` "Unstage All Changes", which calls `onUnstage(staged)`.
    - `Changes (n)` gets a `button.icon-btn` with `codicon-add`, "Stage All Changes", which calls `onStage(unstaged without conflicted)`. Hide this button when that filtered list is empty.
  - Rows:
    - `tabindex="0"` and `role="button"`.
    - A click, or Enter/Space on the focused row, calls `onOpenFile(file, staged)`.
    - Every row except `conflicted` gets a `button.icon-btn.sc-row__action`: `codicon-add` "Stage Changes" (unstaged list), which calls `onStage([file])`, or `codicon-remove` "Unstage Changes" (staged list), which calls `onUnstage([file])`. Its click handler calls `event.stopPropagation()` so the row does not open the diff.
  - `aria-label` on every icon button.
- lines: about 45
- exec: `judgment`. Reading the step-13 code.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit 2>&1 | grep 'error TS' | grep -vc appSourceControl.ts`. Expected: `0`. The new required callbacks are missing in `appSourceControl.ts` until step 22, so tsc errors are allowed in that file only.

### step 22
Goal: wire the diff view, the stage and unstage actions, and the commit box in the orchestration.

- files: `gui/src/appSourceControl.ts`
- edit. Requirements:
  - New imports:
    - `showErrorNotice` and `showInfoNotice` from `./appApi`;
    - `diffViewEl`, `keyboardCapture`, `sourceControlCommitEl`, `sourceControlMessageEl` and `sourceControlCommitBtn` from `./appDom`;
    - `focusKeyboardCapture` from `./keyboard/focusCapture`;
    - `IS_MAC` from `./shortcuts`;
    - `gitDiff`, `gitStage`, `gitUnstage`, `gitCommit` and `type FileChange` from `./git/gitApi`;
    - `followOpenDiff` and `type OpenDiffRef` from `./git/statusRefresh`;
    - `renderDiffView` from `./ui/diffView`.
  - **Diff state:** `openDiff: (OpenDiffRef & { repo: string; untracked: boolean }) | null` and `diffSeq = 0` (drops stale diff responses).
  - `openFile(file, staged)`:
    1. Return if `view.kind !== "status"`.
    2. Set `openDiff = { path, staged, kind: file.kind, repo: view.status.repo!, untracked: file.kind === "untracked" }`.
    3. Show `diffViewEl` with `diff: null`, then `diffViewEl.focus()`.
    4. Call `fetchDiff()`.
  - `fetchDiff()`:
    - `const seq = ++diffSeq`, then `gitDiff(repo, path, staged, untracked)`.
    - On success, render only if `seq === diffSeq && openDiff` (font size `appState.renderer?.getFontSizePx() ?? appState.settings.fontSize`).
    - On error: `showErrorNotice(errorMessage(err))` and `closeDiff()` (spec §7: action errors toast).
  - `closeDiff()`:
    - No-op when nothing is open.
    - Otherwise `openDiff = null`, `++diffSeq`, `diffViewEl.hidden = true`, `diffViewEl.textContent = ""`, then `focusKeyboardCapture()`.
    - Set `openDiff = null` **before** the focus call, so the capture-focus listener below sees nothing open.
  - In `initSourceControl()`:
    - `diffViewEl` `keydown`: on `Escape`, `preventDefault()` and `closeDiff()`.
    - `keyboardCapture` `focus`: if a diff is open, close it without returning focus. Some other control (a tab click, a menu close) gave the terminal focus, so it must not type behind an open diff (spec §6.2 "the terminal gets no keys").
  - `onSnapshot`: when the workspace id or cwd changes, call `closeDiff()` (spec §6.2).
  - `onResult` (it runs only on a changed status): after `render()`, if a diff is open:
    - `status.repo === null`: `closeDiff()`.
    - Otherwise `followOpenDiff(openDiff, status)`: `close` calls `closeDiff()`, `refetch` updates `staged`/`kind` (`untracked = kind === "untracked"`) and calls `fetchDiff()`, and `keep` does nothing.
  - **Actions** (`repo` = `view.status.repo` of the rendered status):
    - `onStage(files)`: one `gitStage(repo, paths)` call with every path. There are no chunks (deviation 24).
    - `onUnstage(files)`: the paths plus each renamed file's `origPath`, in one `gitUnstage` call.
    - Each runs as `try { … } catch (err) { showErrorNotice(errorMessage(err)); } finally { refresher.request(); }` (spec §6.3 "in the finally block").
  - **Commit box:**
    - `committing = false`.
    - `updateCommitBox()`: `sourceControlCommitEl.hidden = view.kind !== "status"`. `sourceControlCommitBtn.disabled = committing || sourceControlMessageEl.value.trim() === "" || view.kind !== "status" || view.status.staged.length === 0`.
    - Call `updateCommitBox()` at the end of `render()`, on the textarea `input` event, and around a commit.
    - `commit()`:
      1. Return if the button is disabled.
      2. Set `committing = true` and call `updateCommitBox()`.
      3. `try { const r = await gitCommit(repo, sourceControlMessageEl.value); sourceControlMessageEl.value = ""; showInfoNotice(`Committed ${r.hash}`); } catch (err) { showErrorNotice(errorMessage(err)); } finally { committing = false; updateCommitBox(); refresher.request(); }`
    - Button `click` calls `commit()`. Textarea `keydown`: `event.key === "Enter" && (event.ctrlKey || event.metaKey)` calls `preventDefault()` and `commit()`.
    - On macOS, set `sourceControlMessageEl.placeholder = "Message (⌘Return to commit)"` in init (deviation 20).
  - Pass `onOpenFile: openFile`, `onStage` and `onUnstage` to `renderSourceControl`.
  - The commit box DOM is never rebuilt; only the branch line and the body re-render.
- lines: about 105
- exec: `judgment`. Async UI orchestration.
- verify: `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && echo TSC_OK`. Expected: `TSC_OK`.

### step 23
Goal: run the S5 slice check (offline). The live check (spec §9.2) runs in the main session only.

- files: none (verify only)
- edit: none
- lines: 0
- exec: `mechanical`. Commands only. The live part is not for the executor.
- verify (offline, executor). `routing.ts` is not in this diffstat because step 17 changed it on purpose:
  `cd /c/Users/Reinaldo/Backend/herdr/gui && git diff --stat -- src-tauri/src/engine.rs crates package.json src-tauri/Cargo.toml && echo "fmt:$(cargo fmt --check 2>&1 | grep '^Diff in' | grep -vc flutter.rs) clippy:$(cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^ +--> ' | grep -vc flutter.rs)" && cargo test --workspace 2>&1 | grep -E '^test result' && npx tsc --noEmit && npx vitest run 2>&1 | grep -E 'Test Files|Tests '`
  Expected:
  - no diffstat lines;
  - `fmt:0 clippy:0`;
  - every `test result: ok.`, and the herdr-gui lib line reads `317 passed`;
  - tsc silent;
  - `Test Files  68 passed (68)` and `Tests  827 passed (827)` (822 + 1 + 4).
- verify (live, **main session only**, after `npm run package:fast`): spec §9.2 steps 1–7 on `%TEMP%\cowbell-git-demo`, never on this repo. Also check:
  - **Layout (deviation 17):** with the section open and 20+ changes, the workspace list keeps at least half the sidebar, and both lists scroll on their own.
  - Esc in the diff view returns typing to the terminal (step 5).
  - Clicking a tab while a diff is open closes the diff.
  - Typing in the commit box never reaches the terminal. That includes letters, `Shift+Home`/`Shift+End` (they select text in the box) and `Shift+Insert` (it pastes into the box). On macOS, also check `Cmd+V` and `Cmd+Up/Down` (step 17).
  - A poll during typing does not clear the message.
  - **§9.2 step 7 caveat (finding H):** the section follows the pane's `cd` only when herdr learns the new cwd (the shell reports it, e.g. OSC 7). If the section still shows the old repo, check whether the shell emits OSC 7 before you report a bug.
  - Screenshots for steps 4–6, demo data only.

**Commit boundary S5b. Do not commit.** Files: `gui/index.html`, `gui/src/appDom.ts`, `gui/src/style.css`, `gui/src/ui/diffView.ts`, `gui/src/git/statusRefresh.ts`, `gui/tests/unit/git/statusRefresh.test.ts`, `gui/src/ui/sourceControl.ts`, `gui/src/appSourceControl.ts`. Suggested message: `feat: add the diff view, staging and the commit box`.

---

## Overall verify

```
cd /c/Users/Reinaldo/Backend/herdr/gui && echo "fmt:$(cargo fmt --check 2>&1 | grep '^Diff in' | grep -vc flutter.rs) clippy:$(cargo clippy --workspace -- -D warnings 2>&1 | grep -E '^ +--> ' | grep -vc flutter.rs)" && cargo test --workspace 2>&1 | grep -E '^test result' && npx tsc --noEmit && npx vitest run 2>&1 | grep -E 'Test Files|Tests '
```

Expected:
- `fmt:0 clippy:0`;
- every `test result: ok.`, with the herdr-gui lib line at `317 passed`;
- tsc silent;
- `Test Files  68 passed (68)` and `Tests  827 passed (827)`.

`npm run check` itself still fails, but only on the pre-existing `flutter.rs` fmt and clippy findings. It goes fully green once the main session fixes flutter.rs in a separate commit. After that, the live check (spec §9.2) passes in the main session.

---

## Follow-on phases P1–P6 (executable-level outlines)

Scope: the user's 2026-10-11 answers override the spec §0 exclusions of history views and per-hunk staging for these phases. In scope:
- the Commits history tab and the Files tab;
- per-file and per-hunk stage, unstage and discard;
- commit message history;
- amend and editing the last commit message.

Pull, push, stash and branch work are an optional P6.

How to execute: each phase first gets an exact-step plan in the P0 format (old/new text, line counts, verify output). The steps below are sliceable, and each one carries an exec-label guess and a verify command. P0 rules apply to every phase:
- every git call goes through `run_git`, which sets the env, the fsmonitor flag and the caps;
- pathspecs are `:(literal)` on stdin;
- every mutation takes `WRITE_LOCK`;
- action errors toast, and poll errors show inline;
- test repos follow deviation 21.

### Layout decision (closed): sidebar tabs Commits / Files

- The Source Control section header gets two tabs: **Files** (the P0 content: commit box, Staged Changes, Changes) and **Commits** (history). The active tab persists as `sourceControlTab: "files" | "commits"` (default `"files"`).
- The Commits tab starts with a pinned row "N changes · Commit Changes" that switches to Files (the handoff's pinned top row).
- Details: clicking a commit opens the `#diff-view` overlay in commit mode. It shows the summary, hash, author, date, full message and file list. Clicking a file shows that file's diff in the same overlay, with a Back button. Esc goes back one level, then closes the overlay. There are no per-file tabs (the handoff's right-pane tabs); one overlay with a back stack covers the flow.
- **Sidebar width.** Today: default 260 px (`gui/src/settings.ts:38`), min 180 and max 400 (`gui/src/appSidebarResize.ts:9-10`), and the width is remembered in `settings.sidebarWidth` (`appSidebarResize.ts:36`, applied at `gui/src/main.ts:117`). The width plan:
  - P1 raises `SIDEBAR_MAX_WIDTH` to 640, so the user can drag the sidebar wide enough for full commit rows. Nothing else in the resize code changes.
  - There is no auto-grow on first open. A width change resizes every pane's PTY, and the terminals reflow without the user asking.
  - The commit row works at 260 px: the summary truncates with an ellipsis, and below a 300 px container width (CSS container query on `#source-control`) the author and date hide.
- **Height.** The section keeps `max-height: 50%` (deviation 17). History needs height, so P1.9 is an optional vertical sash. Do it only if the P1 live check shows that 50% is too small.

### P1: history (about 2 days; P1b lane rail about 1 day)

Contracts (Rust, `git.rs`; all use `--no-show-signature --no-color`):
- `git_log(repo, skip: u32, limit: u32) -> Vec<CommitRow>`.
  - `CommitRow { hash, shortHash, parents: Vec<String>, author, authorEmail, timestamp: i64, summary, refs: Vec<String> }`.
  - Command: `log -z --format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D --skip=<skip> -n <limit> HEAD --`.
  - A repo with no commits returns `[]`. A `limit` outside 1..=500 gives `invalid_argument`.
- `git_show(repo, hash) -> CommitDetail { hash, parents, author, authorEmail, timestamp, message, files: Vec<FileChange> }`.
  - Command: `show -z --format=… --name-status -M --diff-merges=first-parent <hash> --`.
  - The hash must match `^[0-9a-f]{7,64}$` (64 covers SHA-256 repos); otherwise `invalid_hash`.
- `git_commit_diff(repo, hash, path) -> GitDiff`: `show --format= --no-ext-diff --no-textconv -U3 --diff-merges=first-parent <hash> -- :(literal)<path>`, capped like `git_diff`.

Steps:
- **P1.1** `git_log` plus its parser. Tests: order, merge parents, `%D` refs (`HEAD -> main, origin/main, tag: v1`), no commits, paging. exec `judgment`. verify `cd /c/Users/Reinaldo/Backend/herdr/gui/src-tauri && cargo test -p herdr-gui --lib git:: 2>&1 | grep 'test result'` → `ok`, count +5.
- **P1.2** `git_show` and `git_commit_diff`. First probe `--diff-merges=first-parent` (git ≥ 2.31) on the installed git. Tests: root commit, rename `R100` in `-z` name-status, merge files against the first parent, invalid hash, file diff with `@@`. exec `judgment`. verify as P1.1, count +5.
- **P1.3** Register the 3 commands in `lib.rs` and add the TS wrappers and types to `gitApi.ts`. exec `mechanical`. verify `cd /c/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit && echo TSC_OK`.
- **P1.4** The `sourceControlTab` setting (settings.rs and settings.ts, step-9 pattern), plus the header tabs (`role="tablist"`, two `role="tab"` buttons) and their CSS. exec `mechanical` once the text is written. verify `cargo test -p herdr-gui --lib settings::` and tsc.
- **P1.5** `src/ui/commitList.ts`: the pinned row, commit rows (bold summary, italic author, right-aligned relative date, ref chips) and "Load more" (200 per page), with a jsdom vitest `tests/unit/ui/commitList.test.ts`. The handoff's file-count badge is deferred, because it needs one diff per row. exec `judgment`. verify `npx vitest run tests/unit/ui/commitList.test.ts`.
- **P1.6** Orchestration. Fetch page 1 on tab open, after a commit or amend, on Refresh, and when the status JSON changes. Drop stale pages with a seq counter (the `diffSeq` pattern). exec `judgment`. verify tsc and vitest.
- **P1.7** Commit mode in the overlay, with the back stack (file diff → commit → closed). exec `judgment`. verify tsc.
- **P1.8** `SIDEBAR_MAX_WIDTH` 400 → 640, plus the container-query row CSS. exec `mechanical`. verify tsc, and in the live check, drag to 640 and confirm the width persists after a restart.
- **P1.9** (optional) A vertical sash between `#sidebar-list` and `#source-control`. Reuse the pointer-capture pattern of `wireSidebarResize` (`appSidebarResize.ts:21-41`) and persist `sourceControlHeight`. exec `judgment`. verify tsc and live.
- **P1.10** Slice check: the Overall verify command with the new counts, plus a live check of history, details, file diff and width.
- **P1b** `src/git/lanes.ts`: a pure `computeLanes(rows)`, with vitest cases for linear history, branch and merge, octopus merge, and a page boundary. Render one inline SVG per row with 6 colors (`--terminal-ansiBlue/Green/Yellow/Magenta/Cyan/Red`). Comment: `shortcut: lanes cover only loaded pages`. exec `judgment` ×2. verify `npx vitest run tests/unit/git/lanes.test.ts`.

### P2: hunk-level stage, unstage, discard (about 3 days)

Contracts:
- `git_apply_hunk(repo, path, source: Unstaged|Staged, hunk_index: u32, hunk_text: String, action: Stage|Unstage|Discard) -> ()`. The valid pairs are Unstaged+Stage, Staged+Unstage and Unstaged+Discard.
- `git_discard_file(repo, path, untracked: bool) -> DiscardResult { backupPath, afterBlob }`.
- `git_restore_backup(repo, path, backup_path, after_blob) -> ()`.

#### Safety design

1. **Patch source.** At action time, Rust re-runs the same diff as raw bytes: `diff -U3` for Unstaged and `diff --cached -U3` for Staged, with fsmonitor off and `:(literal)`. A Rust port of the step-7 rules splits it into the header (lines before the first `@@`) and hunks. The patch is `header + hunk N`. Rust never builds a patch from webview text: `finish_diff` decodes lossily (step 1) and the parser strips `\r` (step 7), so a patch built in TS would corrupt non-UTF-8 and CRLF files.
2. **Staleness.** The webview sends `hunk_index` plus the hunk text sliced from `GitDiff.text`, between `@@` boundaries with `\r` intact. It never rebuilds the text from `DiffLine[]`, which lost the `\r`. Rust compares that text with the lossy decode of the fresh hunk N. On a mismatch (the file changed after the diff was shown), Rust returns `stale_diff`, nothing applies, and the UI re-fetches the diff.
3. **Pre-flight.** Run `git apply --check` with the exact flags of the real call, with the patch on stdin:
   - stage: `--cached`;
   - unstage: `--cached -R`;
   - discard: `-R`.

   Then make the real call under `WRITE_LOCK`. Both calls always pass `--whitespace=nowarn`. Probe (2026-10-11): with `apply.whitespace=fix` in config, `git apply --cached` stripped trailing spaces from the staged line, and `--check` did not report it. Never pass `--reject`, `-C<n>`, `--ignore-whitespace`, `--3way` or `--recount` unless a test proves it is needed: a hunk applies exactly or not at all. Accepted risk: check and apply are not atomic against a terminal edit in between, and the lock covers GUI calls only.
4. **File-level fallback.** Hunk actions are hidden, and Rust returns `hunk_not_supported`, when any of these holds:
   - the diff header has `new file mode`, `deleted file mode`, `rename from`, `copy from`, `old mode`/`new mode`, `similarity index`, `Binary files`, `GIT binary patch` or `Subproject commit`;
   - the `index` line shows mode `120000` (a symlink);
   - the file is untracked or conflicted;
   - `GitDiff.truncated` is true.
5. **CRLF and no newline at end of file.** The raw bytes keep `\r`. The `\ No newline at end of file` line belongs to its hunk body, and the slice keeps it. Probe (2026-10-11, `core.autocrlf=false`):
   - a single-hunk patch with a no-EOL tail on a CRLF file applied with `--cached`;
   - `-R` then restored the worktree byte-identical to the index;
   - hunk 2 alone applied with its header unchanged.

   P2 tests must also cover `core.autocrlf=true` (common on Windows; deviation 21 sets `false`) for a hunk stage and a hunk discard. They must also cover a hunk after an earlier hunk that changes the line count.
6. **Discard is destructive and irreversible in git.** Worktree changes have no object in the repo. Rules:
   - **Confirm every discard** (hunk, file, untracked delete, Discard All) with `openConfirmPopover` (`gui/src/ui/confirmPopover.ts:49`). Cancel has focus on open, so a bare Enter cancels (`confirmPopover.ts:5-8`). The title names the file and the loss, e.g. "Discard 1 hunk in a.txt?" or "Delete untracked file b.txt?". Backspace (P5) only opens this popover.
   - **Back up before any discard.** Rust copies the current working-file bytes to `<data>/herdr-gui/discarded/<YYYYMMDD-HHMMSS>-<n>/<repo-relative path>`. `<data>` is `%LOCALAPPDATA%` on Windows, as `log_dir` does (`gui/src-tauri/src/lib.rs:278-290`), and `~/Library/Application Support` on macOS. Fail closed: if the copy fails, nothing is discarded.
   - **Undo.** Right after the discard, record `afterBlob` with `git hash-object --no-filters -- :(literal)<path>`, or `absent` for a deleted file. An "Undo discard" link row at the top of the section body copies the backup back. It does this only when the current file still matches `afterBlob`; otherwise it refuses and opens the backup folder. The notice API has no action slot (`gui/src/appApi.ts:26-33`), so the link lives in the section and stays until the next discard or a workspace switch.
   - **Untracked discard means deleting the file.** Rust checks three things first:
     - `git ls-files --others --exclude-standard -z -- :(literal)<path>` lists exactly that path, so a tracked or ignored file is never deleted;
     - `canonicalize(repo/path)` starts with `canonicalize(repo)`, so a symlinked or junction parent cannot redirect the delete outside the repo;
     - the target is a regular file.

     Then it makes the backup, then calls `remove_file`.
   - **Tracked file discard:** `git restore --worktree --pathspec-from-file=- --pathspec-file-nul`. It keeps the staged changes. Probe the flags on the installed git first.
   - **How recovery can fail:**
     - the user or the OS deletes the backup folder;
     - files over 64 MiB are refused, because without a backup there is no discard ("use a terminal");
     - the backup holds the whole file, so a manual restore after later edits overwrites those edits;
     - the exec bit and other file modes are not saved;
     - symlinks are refused;
     - P2 never prunes backups, so disk use grows;
     - a crash between backup and discard leaves an extra backup, which is harmless.
   - Rejected: `git stash create` plus `stash store`. It leaves untracked files out, it captures the whole worktree (restoring it conflicts), and it writes into the user's stash list. Also rejected: `git hash-object -w`. Dangling blobs are pruned by `gc` (2 weeks by default) and are hard to find.

Steps:
- **P2.1** Rust hunk splitter, header classification, staleness compare, and their unit tests. exec `judgment`. verify `cargo test -p herdr-gui --lib git::`.
- **P2.2** `git_apply_hunk` (check, then apply, with `--whitespace=nowarn`). Integration tests:
  - stage hunk 2 of 2, then unstage it;
  - discard a hunk;
  - `stale_diff`;
  - a CRLF file with no newline at EOF, under `core.autocrlf=false` and `=true`;
  - an `apply.whitespace=fix` repo keeps trailing spaces;
  - a new file gives `hunk_not_supported`.

  exec `judgment`. verify as P2.1.
- **P2.3** The backup module, `git_discard_file` and `git_restore_backup`. Tests:
  - a tracked discard keeps the staged part;
  - an untracked delete;
  - an ignored file is refused;
  - a backup write failure aborts the discard;
  - undo works, and undo is refused after an edit;
  - on `cfg(unix)`, a symlinked parent is refused.

  exec `judgment`. verify as P2.1.
- **P2.4** Register the commands and add the TS wrappers. exec `mechanical`. verify tsc.
- **P2.5** A hunk toolbar in the diff view (Stage Hunk, Unstage Hunk, Discard Hunk), the confirm popover, and the undo link. exec `judgment`. verify tsc, plus a vitest for the hunk-slicing helper `tests/unit/git/hunkSlice.test.ts`.
- **P2.6** A file-level Discard button on Changes rows and a Discard All button, both confirmed. exec `judgment`. verify tsc.
- **P2.7** Slice check (Overall verify) and a live check on a scratch repo: hunk stage and unstage, discard and undo, a CRLF file, an untracked delete.

### P3: message history and amend (about 1 day)

- **History, with no new storage.** `Ctrl+;` or a history button in the commit box opens a popover with the last 20 commit messages from `git_log` (P1). Picking one fills the textarea. A repo with no commits shows an empty list.
- **Amend.** An "Amend" toggle in the commit box. Turning it on fills an empty textarea with HEAD's full message (`git_show(HEAD)`). The button reads "Amend" and stays enabled with nothing staged, which covers editing the last commit message.
  - Contract change: `git_commit(repo, message, amend: bool)` adds `--amend`.
  - When `merge-base --is-ancestor HEAD @{u}` exits 0, a confirm popover warns: "HEAD is already on <upstream>; amending rewrites published history".
  - Amend is disabled with no commits and while `MERGE_HEAD` exists.
- Steps:
  - **P3.1** Rust: the amend flag and `git_head_on_upstream(repo) -> bool` (no upstream gives `false`), with tests (amend changes the message, keeps the tree; message-only amend; pushed detection with a local bare remote). exec `judgment`. verify `cargo test -p herdr-gui --lib git::`.
  - **P3.2** TS: the toggle, the prefill, the history popover and the confirm. exec `judgment`. verify tsc.
  - **P3.3** Slice check and live check.

### P4: word-level diff colors and sticky hunk header (about 1 day)

- `src/git/wordDiff.ts`: a pure `wordSpans(del, add)` that trims the common prefix and suffix (code-unit based, never splitting a surrogate pair). It pairs the i-th `del` with the i-th `add` inside each consecutive del-run and add-run of a hunk. Unequal runs pair only the overlap. When more than 70% of a line changed, it skips the highlight. No dependency.
- CSS: `.diff-word--add`/`--del` use the same hue at a stronger mix (`color-mix(... 35%, transparent)`) over the 15% line tint. This mirrors the handoff's 93% line and 85% character lightness.
- Sticky header: `.diff-row--hunk { position: sticky; top: 0; z-index: 1; background: var(--terminal-background); }`, with no JS. The later hunk header paints over the earlier one.
- Steps:
  - **P4.1** The pure function and `tests/unit/git/wordDiff.test.ts`. exec `judgment`. verify `npx vitest run tests/unit/git/wordDiff.test.ts`.
  - **P4.2** Render the spans in `diffView.ts`, plus the CSS. exec `judgment`. verify tsc, and live (a long diff keeps its header visible).
  - **P4.3** Slice check.

### P5: panel-local keyboard map (about 1 day)

- Rule: no rebinds. Keys act only while focus is inside `#source-control` or `#diff-view`, through a `keydown` listener on each root.
  - Routing step 4 lets unclaimed keys bubble (`gui/src/keyboard/routing.ts:161`).
  - A key in the global table still wins at step 2 whatever has focus (`routing.ts:80-90`), so table keys cannot be panel-local either; see the collision table.
  - WebView2 browser accelerators are off (`gui/src-tauri/src/lib.rs:212`), so `F5` and plain `Ctrl+letter` reach the listener.
- Map:
  - `Up`/`Down` move the row focus (roving `tabindex`).
  - `Enter` stages or unstages the focused row or hunk. This changes the P0 behavior, where Enter opens the diff (step 21). `Space` now opens the diff.
  - `Backspace` opens the discard confirm. `Shift+Enter` and `Shift+Backspace` in the diff act on the whole file.
  - `Ctrl+Enter` commits (P0). `Ctrl+;` opens the message history (P3).
  - `Ctrl+1` shows Files and `Ctrl+2` shows Commits. `Alt+Up/Down` go to the parent/child commit in Commits. `Ctrl+Shift+R` is Unstage All. `F5` refreshes.
  - `Esc` closes the innermost layer: popover, then overlay level, then overlay.
  - macOS uses the same keys inside the panel. `Cmd+digit` is tab focus there (`gui/src/shortcuts.ts:470`), so the tabs stay on `Ctrl+1/2`.
- Steps:
  - **P5.1** A pure `panelKeyAction(event, ctx)` in `src/git/panelKeys.ts`, with a vitest table `tests/unit/git/panelKeys.test.ts` that includes "table keys never map". exec `judgment`. verify `npx vitest run tests/unit/git/panelKeys.test.ts`.
  - **P5.2** Wire the listeners and the focus model, and add key hints to the tooltips. The cheat sheet reads only `SHORTCUTS`, so panel keys do not appear there. exec `judgment`. verify tsc, and live.
  - **P5.3** Slice check.

### P6 (optional): pull, push, stash, branch

Not planned in detail. If the user asks, the work would add `git_fetch`, `git_pull --ff-only`, `git_push`, `git_stash_push/pop` and `git_switch` behind the same runner. Each needs credential-prompt handling (`GIT_TERMINAL_PROMPT=0` makes auth fail fast), longer timeouts, and confirm popovers for anything that rewrites refs.

### Collision table: handoff keys versus `gui/src/shortcuts.ts`

Sources:
- the handoff `C:\Users\Reinaldo\AppData\Local\Temp\claude\C--Users-Reinaldo\1c5cdee4-3c84-48b9-ad02-d6d641fca07a\scratchpad\herdr-git-ux-handoff.md`;
- its raw keymap `sm_extract\pk\Default - Merge\Default (Windows).sublime-keymap`;
- the Windows table in `gui/src/shortcuts.ts`.

Resolution (user, 2026-10-11): panel-local only, with no rebinds of existing keys.

| Handoff key (Windows) | Handoff action | herdr today | Verdict |
|---|---|---|---|
| `Ctrl+0` | go to HEAD | `view.zoomReset` (`shortcuts.ts:194-200`) | Collision. Step 2 wins inside the panel too. Not mapped. |
| `Ctrl+Shift+A` | stage all modified | `agents.showList` (`:166-172`) | Collision. Not mapped; the Stage All button covers it. |
| `Ctrl+Shift+B` | new branch | `view.toggleSidebar` (`:173-179`) | Collision; branches are P6. Not mapped. |
| `Ctrl+Shift+F` | ref filter | `pane.find` (`:241-247`) | Collision. Not mapped. |
| `Ctrl+Shift+T` | restore tab | `tab.new` (`:81-87`) | Collision. Not mapped. |
| `Ctrl+Shift+W` | not in the handoff or its keymap; the usual close-file-tab pair | `tab.close` (`:88-94`) | Collision if added. Not mapped. |
| `Ctrl+Shift+PgUp` / `PgDn` | not in the handoff; the usual move-tab pair | `tab.moveLeft` / `tab.moveRight` (`:117-130`) | Collision if added. Not mapped. |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | next / previous tab (keymap lines 6-7) | `tab.next` / `tab.previous` (`:103-116`) | Collision. Not mapped. |
| `Ctrl+K Ctrl+A`, `Ctrl+K Ctrl+B` | stage all, toggle sidebar | No chord support: `findShortcut` matches one combo (`:521-530`), and `gui/src` has no `chord`. Plain `Ctrl+K` reaches the terminal (`tests/unit/keyboard/routing.test.ts:179-186`). `Ctrl+Shift+K` is `pane.clear` (`:249-255`). | Not mapped. A chord needs new routing state. |
| `Ctrl+Shift+R` | unstage all | free | Panel-local (P5). |
| `Ctrl+Shift+P`, `Ctrl+Shift+S` | palette, pop stash | free | Not mapped (no palette; stash is P6). |
| `Alt+Shift+Down` | second parent | free (the `Alt+Shift` class claims only `=`, `-`, `W`, `Z`) | Panel-local candidate (P5, Commits). |
| `Ctrl+1`..`Ctrl+4`, `Ctrl+8`, `Ctrl+9` | sidebar tabs, details, branch, message | free in the table; plain `Ctrl+digit` is a terminal key | Panel-local only: `Ctrl+1` Files, `Ctrl+2` Commits (P5). |
| `Ctrl+T`, `Ctrl+W`, `Ctrl+F`, `Ctrl+P`, `Ctrl+B`, `Ctrl+R`, `Ctrl+S`, `Ctrl+;` | tabs, search, palette, checkout, jump, stash, message history | shell keys (spec §1, `shortcuts.ts:5-10`) | Panel-local only. P5 maps `Ctrl+;` (P3). |
| `Ctrl+PgUp` / `PgDn` | file tabs | free; a terminal key | Not mapped (no file tabs; see Layout). |
| `Ctrl+Enter` | commit | free; a terminal key | Panel-local: the commit textarea (P0 step 22). |
| `Alt+Left/Right/Up/Down` | history back/forward, parent/child | free; shells use `Alt+arrows` | Panel-local: `Alt+Up/Down` in Commits (P5). |
| `Ctrl+Alt+F` | file filter | `Ctrl+Alt` is AltGr on Windows (`routing.ts:131-140`) | Not mapped. |
| `Enter`, `Shift+Enter`, `Backspace`, `Shift+Backspace`, `Space`, `Left`/`Right`, `Esc` | stage, discard, collapse, close innermost | bare keys | Panel-local (P5). |
| `F5`, `F7`, `F8`, `Shift+F11`, `Alt+Q` | refresh, pull, push, full context, wrap | free; F-keys reach the terminal when it has focus | `F5` panel-local (P5). Pull and push are P6; the others are not mapped. |

macOS: Ctrl always reaches the terminal (`shortcuts.ts:363-369`), and the table is Cmd-based (`MAC_ENTRIES`, `:409-449`: `Cmd+0`, `Cmd+F`, `Cmd+T/W`, `Cmd+K`, `Cmd+B`, `Cmd+Shift+A`). The panel-local map uses the same keys as Windows, and `Cmd+digit` stays tab focus (`:470`).

### Estimates

| Phase | Days |
|---|---|
| P0 (S1–S5, spec §10) | 2.5 |
| P1 history | 2.0 |
| P1b lane rail | 1.0 |
| P2 hunk stage/unstage/discard + safety | 3.0 |
| P3 message history + amend | 1.0 |
| P4 word diff + sticky header | 1.0 |
| P5 keyboard map | 1.0 |
| P6 pull/push/stash/branch | not estimated |
| **Total P0–P5** | **11.5** |

## Open risks

1. The pre-existing `flutter.rs` fmt and clippy failures keep `npm run check` red until the main session fixes them.
2. Finding J relies on git stopping once the read end closes (probe: 1.4 s instead of 4.9 s). A git build that ignored write errors would run a huge diff to the 15 s timeout and report `git_timeout`.
3. Step 17 changes global routing. `Shift+PgUp/PgDn/Home/End` no longer scroll the terminal while a tab or sidebar row has focus.
4. Finding H: the panel follows a `cd` only when herdr learns the new cwd. Finding F: a timeout kill can leave `.git/index.lock`.
5. No test covers the fsmonitor flag (a positive control needs a working fsmonitor hook fixture). No test covers `env_remove`: it needs process-global env changes, which race with parallel tests.
6. The section's 50% height cap may be too small for history (P1.9 is the fallback).
7. P2:
   - a terminal edit can land between `--check` and the real apply;
   - backups are never pruned;
   - files over 64 MiB cannot be discarded from the GUI;
   - recovery fails if the backup folder is deleted.
8. P3 only warns on amending a commit that is already on the upstream; it does not block it.
9. P5 changes row `Enter` from "open diff" (P0) to "stage/unstage", which breaks P0 habits.
10. Hooks, clean filters and repo config run at the terminal trust level (spec §3.7).
11. P1b lanes are approximate across page boundaries. `--diff-merges=first-parent` needs git ≥ 2.31, so P1.2 probes it first.
12. The container-query row layout needs a webview with container-query support. WebView2 has it; check WKWebView on the oldest macOS you target.
