# Source Control

## Purpose
A sidebar section lists git changes for the current workspace. A diff view shows one file. The user can stage, unstage and commit.

## Key files
- `src-tauri/src/git.rs` - commands: `git_status` (line 392), `git_diff` (437), `git_stage` (548), `git_unstage` (567), `git_commit` (592). `parse_porcelain` (line 119).
- `src/git/gitApi.ts` - typed wrappers (line 48 onward). `diffParse.ts` - `parseUnifiedDiff` (line 13). `statusRefresh.ts` - `createStatusRefresher` (line 24), `followOpenDiff` (line 80).
- `src/ui/sourceControl.ts` - `renderSourceControl` (line 157). `src/ui/diffView.ts` - `renderDiffView` (line 29).
- `src/appSourceControl.ts` - `initSourceControl` (line 206), `closeDiff` (line 111), poll interval `POLL_MS` = 3000 (line 31).
- Shortcut: `view.sourceControl` (`src/shortcuts.ts:181`). Setting: `sourceControlOpen` ([[settings]]).

## Limits
- A diff stops at 2 MiB (`src-tauri/src/git.rs:56`).
- A commit times out after 120 s (line 501). A message holds up to 64 KiB (line 503).
- One global `WRITE_LOCK` serializes stage, unstage and commit (line 506).
- A group shows up to 500 rows (`src/ui/sourceControl.ts:23`).

## Edges
- Each path goes through `validate_path` first (`src-tauri/src/git.rs:63`).
- Markers: [[shortcut-markers]] (`appSourceControl.ts:30,183`, `git.rs:309,310,496,505`, `sourceControl.ts:148`, `diffParse.ts:9`).
- Tests: `tests/unit/git/`, Rust tests in `git.rs`.
- Specs: `docs/git-mvp-spec.md`, `docs/git-mvp-plan.md`, `docs/git-p1-plan.md`. The code is ahead of the specs ([[doc-mismatches]]).
