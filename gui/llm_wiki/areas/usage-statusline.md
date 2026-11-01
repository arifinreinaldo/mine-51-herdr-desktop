# Claude usage bar and statusLine tap

## Purpose
The status bar shows Claude plan usage. A tap script in the Claude statusLine writes a JSON file. Cowbell reads that file.

## Key files
- `src-tauri/src/usage.rs` - `default_usage_path` = `~/.claude/herdr-usage.json` (line 63). `parse_usage_json` (106). `read_usage_file` (127).
- `src-tauri/src/lib.rs:264` - `run_usage_poll_loop` checks the file every 2 s (sleep at line 279). It emits the `usage` event (line 275).
- `src/appEvents.ts:64` - listens to the `usage` event. `src/usage.ts` - `usageColor` (24), `formatUsage` (80), `worstActivePct` (108).
- `src/ui/statusbar.ts` - `renderUsageStatusItem` (267). `src/appStatusBar.ts` - `wireUsageRefresh` (217).
- `src-tauri/src/statusline.rs` - the only code that writes `~/.claude/settings.json` (lines 1-4). `classify_command` (39), `install_tap` (250), `undo_tap` (400). Commands: `statusline_status` (457), `statusline_install` (476), `statusline_undo` (490).
- `src-tauri/resources/statusline/herdr-usage.ps1` and `herdr-usage.sh` - tap scripts. Windows embeds the `.ps1`, other systems the `.sh` (`statusline.rs:17-20`).
- `src/wizard/stepUsage.ts` - `renderUsageStep` (line 26), the setup step in the first-run wizard.
- Test: `scripts/test-statusline.ps1`, `tests/unit/usage.test.ts`, `tests/unit/usagePopover.test.ts`.

## Edges
- Cowbell never reads `~/.claude/.credentials.json` (`src-tauri/src/usage.rs:5`, `statusline.rs:4`). The file tap replaces OAuth for terms-of-service reasons (`PRODUCT.md:29`).
- The install runs only after an explicit click.
- macOS usage setup is not complete. Parts sit in the stash ([[macos-port]]).
