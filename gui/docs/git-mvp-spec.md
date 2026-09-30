# Git MVP spec: Source Control panel

Status: plan, 2026-09-29. Estimate: 2–3 days.

## 0. Goal

The user can see what changed in the active workspace's repo, read a diff, stage and unstage files, and commit. All of this happens without leaving Cowbell.

Out of scope: push, pull, fetch, branch switching, stash, discard changes, per-hunk staging, merge conflict tools, a file watcher, Monaco, and history or log views. Do not build them.

Success criterion: the offline check (§9.1) passes, and the live check (§9.2) passes on a scratch repo.

## 1. Which repo

- The panel follows the **active workspace**: the workspace with `focused: true` in `appState.snapshot.workspaces`.
- The start folder is that workspace's `new_workspace_cwd` (`RawWorkspace` in `src/appTypes.ts:22`).
  - herdr resolves this from the focused pane's cwd (`src/app/creation.rs:81-101` in the herdr repo root).
  - Counterintuitive: when the user runs `cd` in the focused pane, the start folder changes. This is intended. The panel always shows the repo that the user works in now.
  - Do not use `RawPane`. The TypeScript type has no `cwd` field.
- Rust resolves the repo root with `git -C <start> rev-parse --show-toplevel`. Every later command uses that root.
- A start folder outside a git repo is not an error. `git_status` returns `{ repo: null }` and the panel shows "Not a git repository" and the start folder.
- `git` not on PATH: `git_status` returns an `ApiError` with code `git_not_found`. The panel shows "Git is not installed" and a link to https://git-scm.com.

## 2. Deliverables

Create:

| File | Content |
|---|---|
| `src-tauri/src/git.rs` | 5 Tauri commands (§3), the process runner, the porcelain parser, and the unit and integration tests |
| `src/git/gitApi.ts` | TypeScript types for §3 and thin `invoke` wrappers |
| `src/git/diffParse.ts` | pure unified-diff parser (§5) |
| `src/git/diffParse.test.ts` | vitest for the parser |
| `src/ui/sourceControl.ts` | the sidebar section rendering (§6.1) |
| `src/ui/diffView.ts` | the diff overlay rendering (§6.2) |
| `src/appSourceControl.ts` | orchestration: toggle, poll, active-workspace tracking, action handlers |

Touch:

| File | Change |
|---|---|
| `src-tauri/src/lib.rs` | `mod git;` and register the 5 commands in `invoke_handler` |
| `src-tauri/src/engine.rs` | make `apply_no_window` (line 124) `pub(crate)` so `git.rs` reuses it; no other change |
| `index.html` | the `#source-control` section inside `#sidebar`, and the `#diff-view` element inside `#terminal-wrap` |
| `src/style.css` | styles for both, using the existing theme CSS variables only |
| `src/shortcuts.ts` | a `view.sourceControl` entry, `Ctrl+Shift+G` (free today; verified against the list) |
| `src/ui/menus.ts` | View ▸ Source Control, next to Toggle Sidebar |
| `src/main.ts` | one call to init `appSourceControl` |
| `src/keyboard/routing.ts` | only if needed so keys do not reach the terminal while the diff view has focus (§6.2) |
| `src/settings.ts` / `src-tauri/src/settings.rs` | persist `sourceControlOpen: boolean` (default `false`) with the other UI settings |

Do not touch: `crates/herdr-wire`, anything outside `gui/`, the herdr config, the e2e scripts, the renderer, the dependency lists in `Cargo.toml` or `package.json`. No new dependencies.

## 3. Rust contracts (`git.rs`)

All commands are `async`, return `Result<T, ApiError>` (the existing type, `commands.rs:183`), and serialize with `#[serde(rename_all = "camelCase")]`.

```rust
#[tauri::command] async fn git_status(cwd: String) -> Result<GitStatus, ApiError>
#[tauri::command] async fn git_diff(repo: String, path: String, staged: bool, untracked: bool) -> Result<GitDiff, ApiError>
#[tauri::command] async fn git_stage(repo: String, paths: Vec<String>) -> Result<(), ApiError>
#[tauri::command] async fn git_unstage(repo: String, paths: Vec<String>) -> Result<(), ApiError>
#[tauri::command] async fn git_commit(repo: String, message: String) -> Result<CommitResult, ApiError>

struct GitStatus { repo: Option<String>, branch: Option<String>, ahead: u32, behind: u32,
                   unborn: bool, staged: Vec<FileChange>, unstaged: Vec<FileChange> }
struct FileChange { path: String, orig_path: Option<String>, kind: ChangeKind }
enum ChangeKind { Added, Modified, Deleted, Renamed, Copied, TypeChanged, Untracked, Conflicted }  // serialized lowercase
struct GitDiff { text: String, truncated: bool, binary: bool }
struct CommitResult { hash: String, summary: String }
```

`repo` is the path returned in `GitStatus.repo`. `path` values are repo-relative with `/` separators, exactly as git prints them.

### 3.1 The process runner

One private function runs every git call:

- Program `git`, arguments as an array. Never build a shell string.
- `-C <repo>` first, then `-c core.quotepath=false`, then the subcommand.
- Put `--` before every path list.
- Env: `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C` (the error text must be English so tests can match it).
- `stdin` null, except for commit (§3.6). `stdout` and `stderr` piped.
- Call `engine::apply_no_window`. Without it, every call opens a console window on Windows.
- Timeout: 15 s for all commands, 120 s for commit (hooks and GPG signing can be slow). On a timeout, kill the child and return code `git_timeout`.
- A spawn error with `ErrorKind::NotFound` returns code `git_not_found`.
- Non-zero exit returns code `git_failed`; the message is the trimmed stderr, cut to 2000 chars. The one exception is §3.3.

### 3.2 Input validation (trust boundary)

The webview is the caller, so treat every argument as untrusted:

- `repo` must equal the canonical `rev-parse --show-toplevel` of itself. Re-run `rev-parse` on each call; do not cache. On a mismatch, return `invalid_repo`.
- Each `path` must be non-empty and relative, with no `..` segment and no NUL. It must not start with `/`, `\`, or a drive letter. On a bad path, return `invalid_path`. The `--` separator also stops a path like `-rf` from being read as an option.
- `paths` must be non-empty, with at most 1000 entries.
- `message` must be non-empty after trimming, and at most 64 KiB.

### 3.3 `git_status`

1. `rev-parse --show-toplevel` in `cwd`. If it fails with "not a git repository", return `GitStatus { repo: None, .. }` with empty lists. It is not an error.
2. `status --porcelain=v1 -z --branch --untracked-files=all`.
3. Parse the output:
   - The first record starts with `## `:
     - `## main...origin/main [ahead 2, behind 1]` gives the branch, ahead and behind.
     - `## No commits yet on main` gives `unborn: true` and branch `main`.
     - `## HEAD (no branch)` gives branch `None`.
   - Each other record is `XY path`. Counterintuitive: for `R` and `C` in X or Y, the **next** NUL-separated field is the original path. It is a separate record, not part of this one. Consume it as `orig_path`.
   - X is the staged column and Y is the unstaged column. One file can appear in both lists (for example `MM`).
   - `??` is Untracked, in `unstaged` only.
   - The pairs `DD AU UD UA DU AA UU` are Conflicted, in `unstaged` only.
   - `!!` never appears without `--ignored`. Ignore it if it does.
4. Sort each list by path.

`GIT_OPTIONAL_LOCKS=0` matters. Without it, `git status` takes `index.lock` to refresh the index, and the 3 s poll then races with an agent that runs `git commit` in a terminal pane.

### 3.4 `git_diff`

- `staged`: `diff --cached --no-color --no-ext-diff --no-textconv -U3 -- <path>`.
- Unstaged tracked file: `diff --no-color --no-ext-diff --no-textconv -U3 -- <path>`.
- `untracked`: `diff --no-index --no-color --no-ext-diff -- /dev/null <path>`. Counterintuitive: `--no-index` exits **1** when the files differ, which is always here. Treat exit 1 as success for this form only. Git for Windows accepts `/dev/null` here (verify in a test).
- If the output contains a line that starts with `Binary files ` and there is no `@@` line, set `binary: true`.
- Cap `text` at 2 MiB. Cut at the last `\n` before the cap and set `truncated: true`.
- Decode stdout as UTF-8 with `String::from_utf8_lossy`. Never fail on bad bytes.

### 3.5 `git_stage` and `git_unstage`

- Stage: `add -- <paths…>`. This works for untracked, modified and deleted files.
- Unstage, normal repo: `restore --staged -- <paths…>`.
- Unstage, unborn repo (no commits): `rm --cached -q -- <paths…>`. Counterintuitive: `restore --staged` fails with "could not resolve HEAD" in a repo with no commits. Detect the unborn state with `rev-parse --verify -q HEAD` (non-zero exit means unborn).
- One tokio `Mutex<()>` (a `static` or in the managed state) serializes all mutating commands: stage, unstage and commit. `git_status` and `git_diff` do not take it.
  - ponytail: global lock; per-repo locks if multi-repo throughput ever matters.

### 3.6 `git_commit`

- `commit -F -`. Write `message` to stdin, then close stdin.
- Hooks run as usual. Do not pass `--no-verify`.
- Then `log -1 --format=%h%x00%s`, split on NUL, return `CommitResult`.
- "nothing to commit" is `git_failed` with git's own stderr. The UI prevents it in normal use (§6.1).

### 3.7 Security note (for the reviewer)

- Git runs repo-local config. Examples are `core.fsmonitor`, hooks, and `diff.external`.
- `--no-ext-diff` and `--no-textconv` block the diff drivers.
- `core.fsmonitor` and the hooks run exactly as they do when the user types `git status` in a pane of the same workspace. That is the same trust level, so we accept it.
- Git's own `safe.directory` check still applies. A repo owned by another user fails with git's error text, and the panel shows it.

## 4. TypeScript API (`src/git/gitApi.ts`)

The types mirror §3 in camelCase. The wrappers are `gitStatus(cwd)`, `gitDiff(repo, path, staged, untracked)`, `gitStage(repo, paths)`, `gitUnstage(repo, paths)` and `gitCommit(repo, message)`. Each one is a single `invoke` call. Errors go through the existing `errorMessage` and `showErrorNotice` in `src/appApi.ts`.

## 5. Diff parser (`src/git/diffParse.ts`)

```ts
export type DiffLine =
  | { kind: "hunk"; text: string }
  | { kind: "context" | "add" | "del"; text: string; oldNo: number | null; newNo: number | null }
  | { kind: "meta"; text: string };            // headers, "\ No newline at end of file"
export function parseUnifiedDiff(text: string): DiffLine[];
```

- The parser drops the `diff --git`, `index`, `---` and `+++` header lines, but keeps `new file mode`, `deleted file mode`, `rename from` and `rename to` as `meta`.
- `@@ -a,b +c,d @@ ctx` sets the counters. The count is optional: `@@ -1 +1 @@` means a count of 1.
- A `-` line increments `oldNo`, a `+` line increments `newNo`, and a space line increments both. A `\` line is `meta` with no counter change.
- CRLF: strip a trailing `\r` from each line before classifying it. Keep the line text otherwise unchanged.
- Tests cover: a modify hunk, a new file (`@@ -0,0 +1,3 @@`), a deleted file, several hunks, `\ No newline at end of file`, a count-less hunk header, CRLF input, and empty input (returns `[]`).

## 6. UI

### 6.1 The Source Control section (`#source-control` in `#sidebar`)

- It sits below `#sidebar-list` and above `#sidebar-footer`. It uses the same header style as WORKSPACES: a chevron, the label `SOURCE CONTROL`, and a refresh icon button (`codicon-refresh`).
- It is hidden unless `sourceControlOpen` is true. `Ctrl+Shift+G` and View ▸ Source Control toggle it. The state persists.
- Header line 2: the `codicon-git-branch` icon, the branch, and `↑ahead ↓behind` when they are non-zero. The repo folder name is also shown, with the full path in `title`.
- The body has two groups, **Staged Changes (n)** and **Changes (n)**. Each group header has one button: `−` Unstage All or `+` Stage All.
- Each file row shows:
  - a status letter (A M D R C T U !), coloured with the theme's git decoration colours or `--fg-muted` when those are absent;
  - the file name, then the directory in muted text;
  - on hover, the `+` (stage) or `−` (unstage) icon button.
- Clicking a row opens the diff (§6.2). A Conflicted row opens its diff but has no stage button; its tooltip is "Resolve conflicts in a terminal".
- The commit box above the groups:
  - a `<textarea>` with placeholder `Message (Ctrl+Enter to commit)`;
  - a **Commit** button, disabled when the message is blank, `staged` is empty, or a commit is running.
  - `Ctrl+Enter` in the textarea commits. After a successful commit, clear the textarea and show the existing toast "Committed <hash>".
  - Keys typed in the textarea must not reach the terminal. Check that `keyboard/routing.ts` step 3 only routes when `activeElement` is `#keyboard-capture`. If it does, nothing changes.
- Empty states: "Not a git repository", "Git is not installed", "No changes", and "No workspace".
- Large lists: render at most 500 rows per group, then a muted row "and N more". ponytail: no virtual list; add one if repos with more than 500 changes turn out to be common.

### 6.2 The diff view (`#diff-view` in `#terminal-wrap`)

- An absolutely positioned layer that covers the canvas. The canvas stays alive under it.
- Header: the path, `(staged)` or `(untracked)`, and a ✕ button. `Esc` closes the view. Closing returns focus with the existing `focusCapture` helper.
- Body: one row per `DiffLine`, in a monospace font using the terminal font family and size. There are two gutter columns (old number, new number) and the line text with `white-space: pre`. Horizontal scrolling happens inside the body.
- Row styles: `add` and `del` use tinted backgrounds from theme variables, `hunk` is muted, and `meta` is italic and muted.
- `binary: true` shows "Binary file, no text diff". `truncated: true` adds a last row "Diff truncated at 2 MiB".
- While the view is open, the terminal gets no keys. The view root has `tabindex="-1"` and takes focus on open.
- The view closes when the active workspace changes.
- When the file leaves both lists on a refresh (it was committed or reverted in a terminal), the view closes.

### 6.3 Refresh and timing (`appSourceControl.ts`)

`git_status` runs:
- when the section opens;
- when the active workspace changes (compare `workspace_id` or `new_workspace_cwd` against the last values);
- after each stage, unstage or commit (in the `finally` block, so it also runs after an error);
- on window `focus`;
- every 3 s while the section is open and `document.hidden` is false.

Ordering rules:
- **In flight:** only one `git_status` runs at a time. A trigger during a run sets a `dirty` flag, which causes exactly one follow-up run.
- **Stale result:** tag each request with the `cwd` it used. Drop a response when its `cwd` no longer matches the active workspace's `new_workspace_cwd`. Without this, a slow result for workspace A can paint over workspace B.
- **Same result:** skip re-render when the JSON of the new status equals the last one. This stops the list from flickering every 3 s.
- **Open diff:** re-fetch the diff after a refresh only when the refresh changed that file's kind. Do not re-fetch on every poll.

ponytail: 3 s poll, not a file watcher. If the poll cost shows up in the perf HUD on large repos, add `notify`-based watching.

## 7. Error display

- `git_failed`, `git_timeout` and `invalid_*` errors from actions go to `showErrorNotice` with git's own message.
- Poll errors do not toast. They set an inline error line in the section, and the next successful poll clears it. Without this rule, an `index.lock` held by an agent spams a toast every 3 s.

## 8. Tests

### 8.1 Rust (in `git.rs`, `#[cfg(test)]`)

Parser tests on literal porcelain bytes:
- `M ` and ` M` and `MM`;
- `A `, `D `, `??`;
- `R  new\0old\0` gives `orig_path`, and the record after it still parses;
- `UU`;
- all four `##` branch forms;
- a path with a space and a non-ASCII path (`quotepath=false` keeps it raw).

Integration tests against a real temp repo:
- Create the repo with `std::env::temp_dir()` plus a unique name. No new dev-dependency.
- Run `git init -b main`, and set `user.name` and `user.email` locally in the repo.
- Cover:
  1. status on an empty folder that is not a repo gives `repo: None`;
  2. status on an unborn repo with one untracked file;
  3. stage in an unborn repo, then unstage (the `rm --cached` path);
  4. commit gives a 7+ char hash, and status is then clean;
  5. modify, then an unstaged diff that contains `@@`;
  6. stage, then a staged diff;
  7. an untracked diff through `--no-index` (the exit-1 case) that contains `+` lines;
  8. `invalid_path` for `../x`, `C:\x` and `/x`;
  9. `invalid_repo` for a subfolder of the repo.
- Skip the integration tests with a printed note when `git --version` fails. Do not fail.

### 8.2 TypeScript

- `diffParse.test.ts` as listed in §5.
- A vitest for the refresh ordering in `appSourceControl.ts`: the stale-cwd drop and the one-follow-up `dirty` rule, with the `invoke` wrapper mocked.

## 9. Acceptance

### 9.1 Offline

```
cd gui && npm run check
```

All of it must pass: fmt, clippy `-D warnings`, cargo test, tsc and vitest.

### 9.2 Live (main session, after `npm run package:fast`)

Run this on a scratch repo, never on this repo or the user's work:

1. `git init -b main %TEMP%\cowbell-git-demo`, then add `a.txt` and commit it once.
2. In the **gui-test** herdr session, open a workspace on that folder.
3. Press `Ctrl+Shift+G`. The section shows `main`, "No changes".
4. From a pane, run `echo hi >> a.txt` and `echo x > b.txt`. Within 3 s, Changes (2) shows `M a.txt` and `U b.txt`.
5. Click `a.txt`. The diff shows a `+hi` row with line numbers. Press Esc: the diff closes and typing reaches the terminal.
6. Click `+` on both files. Staged Changes (2) shows. Type a message and press `Ctrl+Enter`. The toast shows a hash, and `git -C … log --oneline` shows the commit.
7. `cd` the pane to a folder that is not a repo. The section shows "Not a git repository".

Record the evidence as a screenshot for each of steps 4–6, using demo data only.

## 10. Estimate

| Part | Days |
|---|---|
| `git.rs` with parser and tests | 0.75 |
| Section UI, actions, commit box | 0.75 |
| Diff parser and view | 0.5 |
| Refresh and ordering, polish, live check | 0.5 |
| **Total** | **2.5** |

Deferred (not in this spec): a file watcher, discard changes, push and pull, branch switching, per-hunk staging, Monaco diff, and history.
