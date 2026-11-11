# Claude usage bar and statusLine tap

## Purpose
The status bar shows Claude plan usage and the context use of the focused pane. A tap script in the Claude statusLine writes JSON files. Cowbell reads those files.

## Key files
- `src-tauri/src/usage.rs` - `default_usage_path` = `~/.claude/herdr-usage.json` (line 111). `default_sessions_dir` = `~/.claude/herdr-usage/` (116). `parse_usage_json` (159). `is_valid_session_id` (179). `parse_session_json` (201). `read_sessions` (235). `read_usage_file` (281).
- `src-tauri/src/lib.rs:293` - `run_usage_poll_loop` checks the legacy file every 2 s (sleep at line 310). On a change it calls `read_sessions` (line 303) and emits the `usage` event (line 306).
- `src/appEvents.ts:66` - listens to the `usage` event. `src/usage.ts` - `usageColor` (52), `formatUsage` (108), `worstActivePct` (136), `formatAsOfLabel` (178), `sessionForPane` (197), `formatSessionHeader` (222), `formatContextRow` (227), `formatCostRow` (234), `formatLinesRow` (245).
- `src/ui/statusbar.ts` - `appendUsageBlock` (130), `appendUsageRow` (150), `openUsagePopover` (163), `renderUsageStatusItem` (301).
- `src/appStatusBar.ts` - `renderUsageBarNow` (211), `wireUsageRefresh` (220).
- `src-tauri/src/statusline.rs` - the only code that writes `~/.claude/settings.json` (lines 1-5). `classify_command` (43), `install_tap` (299), `undo_tap` (491). Commands: `statusline_status` (565), `statusline_install` (591), `statusline_undo` (608).
- `src-tauri/resources/statusline/herdr-usage.ps1` and `herdr-usage.sh` - tap scripts. Windows embeds the `.ps1`, other systems the `.sh` (`statusline.rs:17-24`).
- `src/wizard/stepUsage.ts` - `renderUsageStep` (line 29), the setup step in the first-run wizard. The `Update tap` button is at line 65.
- Test: `scripts/test-statusline.ps1`, `tests/unit/usage.test.ts`, `tests/unit/usagePopover.test.ts`, `tests/unit/ui/statusbar.test.ts`.

## Session files
- The tap writes one file per Claude Code session: `~/.claude/herdr-usage/<session_id>.json`.
- Contract: `{"captured_at":<epoch s>,"pane_id":"<HERDR_PANE_ID>"|null,"session":<raw stdin object>}`.
- The id must match `^[A-Za-z0-9_-]{1,128}$`. Otherwise the tap writes no session file. `is_valid_session_id` applies the same rule.
- The pane rule is `^[A-Za-z0-9:_-]{1,128}$`. Otherwise `pane_id` is `null`.
- The tap writes a temporary file `<id>.json.tmp-<pid>`, then renames it. The ps1 tap writes only when stdin is a JSON object (`herdr-usage.ps1:65`).
- The tap writes the session file before the legacy file. The poll loop wakes only on the legacy file mtime.
- `parse_session_json` uses `serde_json::Value` pointer lookups. A missing or retyped field becomes `None`. A non-object root gives `None`.
- Raw field names come from https://code.claude.com/docs/en/statusline: `cwd` (else `workspace.current_dir`), `model.display_name`, `effort.level`, `fast_mode`, `context_window.used_percentage`, `context_window.context_window_size`, `cost.total_*`.
- `read_sessions` uses the file mtime as age. Older than 24 h: the file is ignored but kept. Older than 7 d: the file is deleted.
- `read_sessions` touches only `<valid id>.json` and `<valid id>.json.tmp-*`. It never parses a `.tmp-*` file. It sorts the result by `session_id`.
- The `usage` event keeps its old fields. It adds `sessions`: an array of `SessionUsage` (`src/usage.ts:25`). `sessions` is empty with no session files.

## Pane mapping and display
- `sessionForPane` (`src/usage.ts:197`) picks the session in this order:
  1. The newest session with the same `pane_id`: kind `pane`.
  2. Exactly one session with the same normalized cwd: kind `cwd`.
  3. The newest session overall: kind `latest`.
- The cwd compare changes `\` to `/`, strips the trailing `/`, and lowercases. This can match falsely on case-sensitive paths.
- `renderUsageBarNow` passes `{ ...usage, session }` to `renderUsageStatusItem`. `wireUsageRefresh` re-renders when `focused_pane_id` changes.
- The ctx rule: `renderUsageStatusItem` shows `ctx NN%` for kinds `pane` and `cwd`. It hides ctx for kind `latest`, and when `context.used_pct` is `null`.
- The model rule: `renderUsageStatusItem` shows `model.display_name` (for example `Opus 5.5`) as a `.usage-model` badge. The badge is the first child, left of the pulse icon. It uses the same kinds as ctx. It hides when the trimmed name is empty.
- The popover has an `ACCOUNT` block with the 5-hour and Weekly rows only. A second block shows Context, Cost and Lines. Its title is `THIS PANE` (kind `pane`) or `LAST ACTIVE SESSION`.
- Each block shows `as of Nm ago` from its own `captured_at`. The popover does not dim old blocks.

## Update tap
- The wizard step shows an `Update tap` button when the class is `herdr` (`stepUsage.ts:65`). The button asks for consent, then runs `runInstall`.
- `install_tap` on class `herdr` copies the current script and sets statusLine. It makes no new backup.

## Edges
- Cowbell never reads `~/.claude/.credentials.json` (`src-tauri/src/usage.rs:5`, `statusline.rs:5`). The file tap replaces OAuth for terms-of-service reasons (`PRODUCT.md:29`).
- The install runs only after an explicit click.
- The tap script has no version marker. The `Update tap` button is the only way to refresh an installed script.
- `HERDR_PANE_ID` can be stale after `pane.move` or a herdr restart. The mapping then falls back to cwd or latest. A pane id reuse can show an old session (under 24 h).
- If the legacy file is missing or invalid, `renderUsageStatusItem` shows no ctx, no model badge and no popover.
- macOS usage setup is not complete. Parts sit in the stash ([[macos-port]]).

## Deferred
- P3 is not built: prompt cache (warm, ttl, hit ratio) and `pr` (number, url, review state). The raw stdin already holds them. Only `usage.rs` and the frontend need changes.
