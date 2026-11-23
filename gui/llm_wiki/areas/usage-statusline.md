# Claude usage bar and statusLine tap

## Purpose
The status bar shows Claude plan usage and the context use of the focused pane. A tap script in the Claude statusLine writes JSON files. Cowbell reads those files.

## Key files
- `src-tauri/src/usage.rs` - `default_usage_path` = `~/.claude/herdr-usage.json`. `default_sessions_dir` = `~/.claude/herdr-usage/`. `parse_usage_json`. `is_valid_session_id`. `parse_session_json`. `read_sessions`. `read_usage_file`.
- `src-tauri/src/lib.rs` - `run_usage_poll_loop` checks the legacy file every 2 s. On a change it calls `read_sessions` and emits the `usage` event.
- `src/appEvents.ts` - listens to the `usage` event. `src/usage.ts` - `usageColor`, `formatUsage`, `worstActivePct`, `formatAsOfLabel`, `sessionForPane`, `formatSessionHeader`, `formatContextRow`, `formatCostRow`, `formatLinesRow`.
- `src/ui/statusbar.ts` - `appendUsageBlock`, `appendUsageRow`, `openUsagePopover`, `renderUsageStatusItem`.
- `src/appStatusBar.ts` - `renderUsageBarNow`, `wireUsageRefresh`.
- `src-tauri/src/statusline.rs` - the only code that writes `~/.claude/settings.json` (lines 1-5). `classify_command`, `install_tap`, `undo_tap`. Commands: `statusline_status`, `statusline_install`, `statusline_undo`.
- `src-tauri/resources/statusline/herdr-usage.ps1` and `herdr-usage.sh` - tap scripts. Windows embeds the `.ps1`, other systems the `.sh` (`statusline.rs`).
- `src/wizard/stepUsage.ts` - `renderUsageStep`, the setup step in the first-run wizard. It holds the `Update tap` button.
- `statusline.rs` also holds `TAP_VERSION_MARKER` and `installed_script_outdated`.
- Test: `scripts/test-statusline.ps1`, `tests/unit/usage.test.ts`, `tests/unit/usagePopover.test.ts`, `tests/unit/ui/statusbar.test.ts`.

## Session files
- The tap writes one file per Claude Code session: `~/.claude/herdr-usage/<session_id>.json`.
- Contract: `{"captured_at":<epoch s>,"pane_id":"<HERDR_PANE_ID>"|null,"session":<raw stdin object>}`.
- The id must match `^[A-Za-z0-9_-]{1,128}$`. Otherwise the tap writes no session file. `is_valid_session_id` applies the same rule.
- The pane rule is `^[A-Za-z0-9:_-]{1,128}$`. Otherwise `pane_id` is `null`.
- The tap writes a temporary file `<id>.json.tmp-<pid>`, then renames it. The ps1 tap writes only when stdin is a JSON object.
- The tap writes the session file before the legacy file. The poll loop wakes only on the legacy file mtime.
- `parse_session_json` uses `serde_json::Value` pointer lookups. A missing or retyped field becomes `None`. A non-object root gives `None`.
- Raw field names come from https://code.claude.com/docs/en/statusline: `cwd` (else `workspace.current_dir`), `model.display_name`, `effort.level`, `fast_mode`, `context_window.used_percentage`, `context_window.context_window_size`, `cost.total_*`.
- `read_sessions` uses the file mtime as age. Older than 24 h: the file is ignored but kept. Older than 7 d: the file is deleted.
- `read_sessions` touches only `<valid id>.json` and `<valid id>.json.tmp-*`. It never parses a `.tmp-*` file. It sorts the result by `session_id`.
- The `usage` event keeps its old fields. It adds `sessions`: an array of `SessionUsage` (`src/usage.ts`). `sessions` is empty with no session files.

## Pane mapping and display
- `sessionForPane` (`src/usage.ts`) picks the session in this order:
  1. The newest session with the same `pane_id`: kind `pane`.
  2. Exactly one session with the same normalized cwd: kind `cwd`.
  3. The newest session overall: kind `latest`.
- The cwd compare changes `\` to `/`, strips the trailing `/`, and lowercases. This can match falsely on case-sensitive paths.
- `renderUsageBarNow` passes `{ ...usage, session }` to `renderUsageStatusItem`. `wireUsageRefresh` re-renders when `focused_pane_id` changes.
- The ctx rule: `renderUsageStatusItem` shows `ctx NN%` for kinds `pane` and `cwd`. It hides ctx for kind `latest`, and when `context.used_pct` is `null`.
- The model rule: `renderUsageStatusItem` shows `model.display_name` (for example `Opus 5.5`) as a `.usage-model` badge. The badge is the first child, left of the pulse icon. It uses the same kinds as ctx. It hides when the trimmed name is empty.
- The popover has an `ACCOUNT` block with the 5-hour and Weekly rows, a burn-rate ETA line under each, and a `Today` cost row. A second block shows Context, Cost and Lines. Its title is `THIS PANE` (kind `pane`) or `LAST ACTIVE SESSION`.
- Each block shows `as of Nm ago` from its own `captured_at`. The popover does not dim old blocks.

## No data, stale, ETA, Today
- No `five_hour` window: the item shows `5h no data` and no meter. It never draws a 0% meter.
- `captured_at` older than `USAGE_STALE_SECONDS` (15 min) adds `is-stale` (dim) and the title `as of N m ago`.
- `recordUsageSamples` (called in `appEvents.ts`) keeps up to 12 samples per window in memory only.
- A repeated `captured_at` is ignored. A lower `used_pct` restarts the samples.
- The popover shows `at this pace: 100% in ~XhYm` only when the rate is above 0, the samples span 2 min or more, and 100% comes before `resets_at`.
- `Today` sums `cost.usd` of sessions whose `captured_at` falls on the local date (`todayCost`).

## Update tap
- Both tap scripts carry the line `herdr-usage-tap v3`. It is `TAP_VERSION_MARKER` in `statusline.rs`.
- `statusline_status` returns `scriptOutdated` when the installed script lacks the marker.
- The wizard step shows an `Update tap` button when the class is `herdr` and `scriptOutdated` is true. The button asks for consent, then runs `runInstall`.
- `install_tap` on class `herdr` copies the current script and sets statusLine. It makes no new backup.
- Bump the marker in both scripts and in `statusline.rs` on each script change.

## Edges
- Cowbell never reads `~/.claude/.credentials.json` (`src-tauri/src/usage.rs:5`, `statusline.rs:5`). The file tap replaces OAuth for terms-of-service reasons (`PRODUCT.md:29`).
- The install runs only after an explicit click.
- The `Update tap` button is the only way to refresh an installed script. It shows only when the marker is missing.
- `HERDR_PANE_ID` can be stale after `pane.move` or a herdr restart. The mapping then falls back to cwd or latest. A pane id reuse can show an old session (under 24 h).
- If the legacy file is missing or invalid, `renderUsageStatusItem` shows no ctx, no model badge and no popover.
- `parse_session_json` returns `None` when `/session` is not a JSON object. A flat v2 file therefore never parses as an empty session.
- `Today` adds each session's cumulative cost when its last capture is today. A session begun yesterday counts in full.

## Privacy
- Each per-session file holds the raw `statusLine` JSON. It includes `cwd`, `transcript_path` and the workspace dirs.
- The file stays in `~/.claude`. Cowbell never sends it over the wire.
- `usage.rs` extracts only the whitelisted fields.
- Never put `~/.claude` under git.

## Deferred
- P3 is not built: prompt cache (warm, ttl, hit ratio) and `pr` (number, url, review state). The raw stdin already holds them. Only `usage.rs` and the frontend need changes.
