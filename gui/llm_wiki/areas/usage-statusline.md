# Claude usage bar and statusLine tap

## Purpose
The status bar shows Claude plan usage. A tap script in the Claude statusLine writes a JSON file. Cowbell reads that file.

## Key files
- `src-tauri/src/usage.rs` - `default_usage_path` = `~/.claude/herdr-usage.json` (line 63). `parse_usage_json` (131). `read_usage_file` (233). Per-session: `SessionUsage` (48), `parse_session_json` (152), `read_sessions` (200).
- `src-tauri/src/lib.rs:291` - `run_usage_poll_loop` checks the file every 2 s. It emits the `usage` event.
- `src/appEvents.ts:66` - listens to the `usage` event and calls `recordUsageSamples` (69). `src/usage.ts` - `usageColor` (24), `formatUsage` (80), `worstActivePct` (108), `isUsageStale` (161), `addUsageSample` (183), `formatBurnEta` (193), `recordUsageSamples` (207), `burnEtaFor` (215).
- `src/ui/statusbar.ts` - `renderUsageStatusItem` (301), `appendBurnEta` (126). `src/appStatusBar.ts` - `wireUsageRefresh` (221).
- `src-tauri/src/statusline.rs` - the only code that writes `~/.claude/settings.json` (lines 1-4). `classify_command` (39), `install_tap` (304), `undo_tap` (496), `TAP_VERSION_MARKER` (29), `installed_script_outdated` (536). Commands: `statusline_status` (586), `statusline_install`, `statusline_undo`.
- `src-tauri/resources/statusline/herdr-usage.ps1` and `herdr-usage.sh` - tap scripts. Windows embeds the `.ps1`, other systems the `.sh` (`statusline.rs:17-20`).
- `src/wizard/stepUsage.ts` - `renderUsageStep` (line 26), the setup step in the first-run wizard.
- Test: `scripts/test-statusline.ps1` (not extended for session files; the `.ps1` is untested), `tests/unit/usage.test.ts`, `tests/unit/usagePopover.test.ts`.

## Behavior
- No `five_hour` window: the item shows `5h no data` and no meter. It never draws a 0% meter.
- `isUsageStale`: `captured_at` older than `USAGE_STALE_SECONDS` (15 min) adds `is-stale` (dim) and a title `as of N m ago`. The 30 s `wireUsageRefresh` tick applies it.
- Burn-rate ETA: the popover shows `at this pace: 100% in ~XhYm` under a window. `usageSamples` holds up to 12 `(captured_at, used_pct)` samples per window in memory only. A repeated `captured_at` is ignored. A lower `used_pct` restarts the samples. The line shows only when the rate is above 0, the samples span 2 min or more, and 100% comes before `resets_at`.

- Session facts (usage phase 2): the tap also writes `~/.claude/herdr-usage/<session_id>.json` with only `captured_at`, `model`, `cost_usd`, `lines_added`, `lines_removed`, `context_pct`. It reads `session_id`, `model.display_name`, `cost.total_cost_usd`, `cost.total_lines_added`, `cost.total_lines_removed`, `context_window.used_percentage` from the statusLine stdin. The nesting is from the Claude docs and is not checked against a live payload. Every field is optional. The tap skips the file when `session_id` is not `[A-Za-z0-9_-]{1,128}`. It never writes prompt, cwd or transcript data. The file `herdr-usage.json` keeps its old shape.
- `read_usage_file` adds `sessions` to the `usage` event: the newest 20 files by mtime, none older than 24 h, newest first. Cost below 0 is dropped; `context_pct` is clamped to 0-100. The list is absent when empty. The poll loop still watches only the main file; the tap writes the session file first.
- Popover (`appendSessionBlock` in `src/ui/statusbar.ts`): a `Last session` block for the newest session (model, cost, lines, context) and a `Today` row. `Today` sums `cost_usd` of sessions updated on the local date (`todayCost` in `src/usage.ts`). Nothing shows without sessions.
- Tap version: both scripts carry the line `herdr-usage-tap v2`. `statusline_status` returns `scriptOutdated` when the installed script lacks `TAP_VERSION_MARKER`. The wizard step shows `Update script` for an installed tap with an old script. It calls `statusline_install`, which rewrites the script and keeps `settings.json`. Bump the marker in both scripts and in `statusline.rs` on each script change. The tap never prunes old session files.

## Edges
- Cowbell never reads `~/.claude/.credentials.json` (`src-tauri/src/usage.rs:5`, `statusline.rs:4`). The file tap replaces OAuth for terms-of-service reasons (`PRODUCT.md:29`).
- The install runs only after an explicit click.
- macOS usage setup is not complete. Parts sit in the stash ([[macos-port]]).
