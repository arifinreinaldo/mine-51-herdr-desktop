# Spec: per-session Claude usage (P1 backend + P2 frontend)

Status: draft from `pipeline-planner` (Opus), 2026-11-06. Not yet executed. P3 deferred.
Raw-field names come from grepping Claude Code 2.1.319 (`claude.exe`). That is reverse-engineered, not a documented contract.

## Amendments (accepted 2026-11-06 after Opus review; THESE SUPERSEDE the text below)

1. **Cut `spend_limit` entirely** (gateway-only). Remove it from contracts 2-4, `SpendLimit`/`parse_spend_limit`/`RawRateLimits.spend_limit` and its tests in step 4 (keep the existing `ignores_spend_limit` test and behaviour unchanged), `formatSpendLimitRow` + tests, and the "Spend limit" popover row. `UsageState` gains only `sessions` and `session`. The ACCOUNT block has the 5-hour and Weekly rows only.
2. **No stale dimming.** Drop `isStale`, `STALE_AFTER_SECONDS`, the `is-stale` class, the `.usage-popover__block.is-stale` CSS rule (step 10 keeps only the `.usage-ctx` rules; its grep count becomes 3) and the stale tests. Keep the per-block `as of Nm ago` text.
3. **Step 1 guard:** only write the session file when `$parsed -is [pscustomobject]` AND `$inputText.Trim().StartsWith('{')` AND the id matches. Add to step 2 a case: input `[{"session_id":"s6"}]` writes no session file and exits 0.
4. **Step 9:** replace the whole 4-field object literal at `appStatusBar.ts:~211-216` with `{ ...usage, session }` so `sessions` is carried. Verify by test that `renderUsageStatusItem` receives `sessions`.
5. **Step 4:** session "age" for the 24 h ignore and 7 d prune is the file's mtime (not `captured_at`).
6. **Source of raw field names:** the official statusline docs (https://code.claude.com/docs/en/statusline), not reverse engineering. Pane mapping stays on `HERDR_PANE_ID` (alternative via herdr's `report-agent-session` hook rejected: needs server/protocol work). Known gap: after `pane.move` or a herdr restart the env id can be stale; the mapping then falls to cwd/latest.
7. Execution groups (disjoint files, may run in parallel): G1 = steps 1-3; G2 = steps 4-5; G3 = steps 6-12; G4 = step 13 after G1-G3 pass.

## Header

**goal:** The tap also writes one file per Claude session. The `usage` event carries `spend_limit` and `sessions`. The popover shows an ACCOUNT block and a session block. The status bar shows `ctx NN%` for the focused pane.

**touch:**
- `src-tauri/resources/statusline/herdr-usage.ps1`, `herdr-usage.sh`
- `scripts/test-statusline.ps1`
- `src-tauri/src/usage.rs`, `src-tauri/src/lib.rs` (poll loop only)
- `src/usage.ts`, `src/appTypes.ts`, `src/ui/statusbar.ts`, `src/appStatusBar.ts`, `src/style.css`, `src/wizard/stepUsage.ts`
- `tests/unit/usagePopover.test.ts`, `tests/unit/ui/statusbar.test.ts`
- `llm_wiki/areas/usage-statusline.md`, `llm_wiki/CHANGELOG.md`

**untouched:** `statusline.rs` (`include_bytes!` at :17-24 picks up new script bytes), `commands.rs`, `dispatch.rs`, `appEvents.ts`, `appState.ts`, the legacy `~/.claude/herdr-usage.json` shape, the chain code in both taps, the untracked files in git status, everything outside `gui/`. Never read `~/.claude/.credentials.json`. No commit steps.

## Contracts

1. **Session file** `~/.claude/herdr-usage/<session_id>.json` = `{"captured_at":<epoch s>,"pane_id":"<HERDR_PANE_ID>"|null,"session":<raw stdin object>}`.
   - id rule `^[A-Za-z0-9_-]{1,128}$`, else no per-session write. Pane rule `^[A-Za-z0-9:_-]{1,128}$`, else `null`.
   - tmp file `<id>.json.tmp-<pid>` (must not end in `.json`).
2. **`usage` event payload: flat and additive.** Existing top-level fields stay. New: `spend_limit` and `sessions`.
   ```json
   {"five_hour":{...},"seven_day":{...},"captured_at":1,"status":"ok",
    "spend_limit":null | {"used_pct":12.0,"resets_at":N|null,"used_usd":6.0|null,"limit_usd":50.0|null,"period":"monthly"|null},
    "sessions":[{"session_id":"<file stem>","pane_id":"w18:p1B"|null,"captured_at":N|null,"cwd":"..."|null,
      "model":{"display_name":"Opus"|null},"effort_level":"high"|null,"fast_mode":false|null,
      "context":{"used_pct":42.0|null,"size":200000|null},
      "cost":{"usd":1.23|null,"duration_ms":N|null,"api_duration_ms":N|null,"lines_added":N|null,"lines_removed":N|null}}]}
   ```
   `sessions` is always an array sorted by `session_id`. `spend_limit` exists only when `rate_limits.spend_limit.used_percentage` is a number.
3. **Raw to payload:** `cwd` = `/cwd` else `/workspace/current_dir`; `model.display_name` = `/model/display_name`; `effort_level` = `/effort/level`; `fast_mode` = `/fast_mode` (bool); `context.used_pct` = `/context_window/used_percentage`; `context.size` = `/context_window/context_window_size`; `cost.*` = `/cost/total_cost_usd|total_duration_ms|total_api_duration_ms|total_lines_added|total_lines_removed`; `spend_limit` = `/rate_limits/spend_limit/{used_percentage,resets_at,used_usd,limit_usd,period}`.
4. **TS types** (`src/usage.ts`): `UsageState` gains optional `spend_limit`, `sessions`, `session?: SessionMatch | null` (set only by `renderUsageBarNow`). `UsageEventPayload` becomes an alias of `UsageState`. `RawPane` gains `cwd`, `foreground_cwd` (already on the wire).
5. **Signatures.** Rust: `default_sessions_dir()`, `is_valid_session_id(&str)`, `parse_session_json(session_id, json) -> Option<SessionUsage>`, `read_sessions(dir, now: SystemTime) -> Vec<SessionUsage>`. TS: `sessionForPane(sessions, paneId, paneCwd): SessionMatch | null`, `SessionMatch = {session, kind: "pane"|"cwd"|"latest"}`.
6. **Pane mapping.** Pane ids match (`public_pane_id` = `{workspace_id}:p{n}`; env set at `src/pane.rs:212-214`, snapshot `focused_pane_id`). Order: (1) newest session with exact `pane_id`, kind `pane`, header `THIS PANE`; (2) exactly one session with same normalized cwd, kind `cwd`; (3) newest overall, kind `latest`. Kinds 2-3 use header `LAST ACTIVE SESSION`.

## Edge cases and counterintuitive points

- Several sessions with one `pane_id`: take newest by `captured_at`, never `read_dir` order.
- `served:<id>` session ids fail the id rule: per-session write skipped.
- PowerShell `-match`: use `\z`, not `$`. Windows python: open with `encoding="utf-8"`; separate id from JSON with a tab.
- `npm run test:ps` inside herdr inherits `HERDR_PANE_ID`: `Invoke-Tap` must remove it for the null case.
- **Write the session file before the legacy file.** The poll loop wakes only on the legacy file's mtime (`lib.rs:296-297`).
- **Use `serde_json::Value` pointer lookups, not derived structs,** for session files and `spend_limit`. A derived `spend_limit` would make the whole legacy file `Invalid` on a type change.
- **The installed tap is never refreshed** (no version marker; script bytes written only inside `install_tap`, `statusline.rs:336`; `statusline.rs:3-4` forbids writes without a click). This machine runs the old hand-installed `python .../herdr-usage.py` (`~/.claude/settings.json:71`), so step 11 adds an explicit "Update tap" button. `install_tap` on class `Herdr` already refreshes the script and repoints statusLine without a new backup.
- ctx shows for kind `pane` and `cwd`; hidden for `latest`.
- Legacy file missing/invalid: `statusbar.ts:301-314` returns early, so no ctx and no popover (accepted).
- Pane id reuse after a herdr restart can map an old session (<24h) to a new pane; block dims after 10 min.

## Steps

**1. ps1 tap writes the per-session file** (before the legacy file). File: `herdr-usage.ps1`. exec: judgment.
- A: header comment gains "It also writes one ~/.claude/herdr-usage/<session_id>.json per Claude Code session."
- B: immediately before `    $outPath = Join-Path $claudeDir "herdr-usage.json"` insert:
```powershell
    # One file per Claude Code session, ~/.claude/herdr-usage/<session_id>.json:
    # {"captured_at":<epoch s>,"pane_id":<HERDR_PANE_ID or null>,"session":<raw stdin>}.
    # Written before the legacy file: the GUI rereads the sessions when that file
    # changes. Its own try/catch keeps the legacy file and the chain running.
    try {
        $sessionId = [string]$parsed.session_id
        if ($sessionId -match '^[A-Za-z0-9_-]{1,128}\z') {
            $sessionDir = Join-Path $claudeDir "herdr-usage"
            if (-not (Test-Path -LiteralPath $sessionDir)) {
                New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null
            }
            $paneJson = "null"
            if ([string]$env:HERDR_PANE_ID -match '^[A-Za-z0-9:_-]{1,128}\z') {
                $paneJson = '"' + $env:HERDR_PANE_ID + '"'
            }
            # $parsed is set only when stdin parsed as JSON, so the raw text splices in as is.
            $sessionJson = '{"captured_at":' + $capturedAt + ',"pane_id":' + $paneJson + ',"session":' + $inputText.Trim() + '}'
            $sessionPath = Join-Path $sessionDir "$sessionId.json"
            $sessionTmp = "$sessionPath.tmp-$PID"
            [IO.File]::WriteAllBytes($sessionTmp, $utf8NoBom.GetBytes($sessionJson))
            if (Test-Path -LiteralPath $sessionPath) {
                [IO.File]::Replace($sessionTmp, $sessionPath, $null)
            } else {
                [IO.File]::Move($sessionTmp, $sessionPath)
            }
        }
    } catch {
        # Skip the per-session file only.
    }
```
- verify (Git Bash): `cd /c/Users/Reinaldo/Backend/herdr/gui && H=$(mktemp -d) && W=$(cygpath -w "$H") && printf '%s' '{"session_id":"s-1","cwd":"C:\\x","rate_limits":{}}' | USERPROFILE="$W" HOME="$W" HERDR_PANE_ID='w1:p1' powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File src-tauri/resources/statusline/herdr-usage.ps1; cat "$H/.claude/herdr-usage/s-1.json"; echo; ls "$H/.claude/herdr-usage"; rm -rf "$H"`. Expect `{"captured_at":<10 digits>,"pane_id":"w1:p1","session":{...}}` and only `s-1.json`.

**2. PS harness cases.** File: `scripts/test-statusline.ps1`. exec: judgment.
- `Invoke-Tap` gains `[string]$PaneId = ""`; after `$psi.EnvironmentVariables["HOME"] = $HomeDir` add: `if ($PaneId) { $psi.EnvironmentVariables["HERDR_PANE_ID"] = $PaneId } else { $psi.EnvironmentVariables.Remove("HERDR_PANE_ID") }`.
- Test 4: input `{"session_id":"sess-1","cwd":"C:\\repo","model":{"display_name":"Opus"},"context_window":{"used_percentage":42},"rate_limits":{}}` with `-PaneId "w18:p1B"`. Assert exit 0, empty stdout, session file exists, `pane_id`, `model.display_name`, `context_window.used_percentage`, `captured_at` within 30 s, legacy file exists, no `*.tmp-*` left.
- Test 5: `{"session_id":"sess-2"}` without PaneId asserts `pane_id` is null; `{"session_id":"..\\evil"}` asserts exit 0, folder holds only `sess-2.json`, `.claude\evil.json` absent.
- verify: `cd C:/Users/Reinaldo/Backend/herdr/gui && npm run test:ps` ends `All statusline tap assertions passed.` (tests 1-3 stay green: chain still byte-exact).

**3. sh tap writes the per-session file** (jq or python branch), before the legacy file. File: `herdr-usage.sh`. exec: judgment (no jq on this machine; only the python branch runs).
- Insert before `out="$claude_dir/herdr-usage.json"`: pane sanitize via `case`; `sid`/`sjson` from `jq -j '.session_id // empty'` + `jq -c --argjson t "$(date +%s)" --arg p "$pane" '{captured_at:$t,pane_id:(if $p=="" then null else $p end),session:.}'`, else one `"$py" -c` call (utf-8, tab-separated `id<TAB>json`); `case "$sid"` rejects empty or non-`[A-Za-z0-9_-]`; write `"$sdir/$sid.json.tmp-$$"` then `mv -f`. Length of `$sid` <= 128.
- verify: run the script under Git Bash with `HOME` set to a temp dir for ids `s-1` (pane `w1:p1`), `../evil`, `s-2` (no pane). Expect s-1 has `"pane_id":"w1:p1"`, s-2 has `"pane_id":null`, `ls` shows exactly `s-1.json s-2.json`, legacy file still `{"captured_at":N,"rate_limits":{}}`.

**4. usage.rs parsing, 24 h ignore, 7 d prune, tests.** File: `src-tauri/src/usage.rs`. exec: judgment.
- Imports `serde_json::Value`, `std::time::{Duration, SystemTime}`; consts `SESSION_STALE_AFTER` (24 h), `SESSION_PRUNE_AFTER` (7 d).
- Structs (all `Debug, Clone, PartialEq, Serialize`; session ones also `Default`): `SpendLimit`, `SessionModel`, `SessionContext`, `SessionCost`, `SessionUsage` with fields exactly as contract 2.
- `UsageState` gains `spend_limit: Option<SpendLimit>`, `sessions: Vec<SessionUsage>` (set in `missing()`, `invalid()`, `parse_usage_json`). `RawRateLimits.spend_limit: Option<Value>`; ignore-comment replaced; `parse_spend_limit` via pointer helpers `f64_at`, `i64_at`, `str_at`.
- `default_sessions_dir()`, `is_valid_session_id`, `parse_session_json` (non-object root -> `None`; `used_pct` through `clamp_pct`).
- `read_sessions(dir, now)`: `read_dir` error -> `vec![]`; split name at first `.`; only touch `<valid id>.json` and `<valid id>.json.tmp-*`; non-files skipped; age > 7 d -> `remove_file`; `.tmp-*` or age > 24 h -> skip; parse and push; sort by `session_id`.
- Tests: `parses_spend_limit` (rename of `ignores_spend_limit`); `a_retyped_spend_limit_never_invalidates_the_file`; `parses_a_full_session_file`; `a_session_with_every_field_missing_parses_to_nones` (`{}`, `{"session":{}}`, `{"session":null}`); `unknown_fields_and_retyped_fields_are_ignored`; `a_malformed_session_file_is_skipped`; `session_ids_follow_the_file_name_rule`; `read_sessions_keeps_fresh_files_and_skips_bad_names`; `a_session_older_than_24h_is_ignored_but_kept`; `a_session_older_than_7d_is_pruned`; `a_missing_sessions_dir_is_empty`; `default_sessions_dir_is_under_dot_claude`. Temp dirs named with `std::process::id()`; age files through the `now` parameter, no sleeps.
- verify: `cd C:/Users/Reinaldo/Backend/herdr/gui && cargo fmt && cargo test -p herdr-gui --lib usage::` -> `test result: ok.`, 0 failed.

**5. Poll loop attaches sessions.** File: `src-tauri/src/lib.rs`. exec: mechanical.
- After `let path = usage::default_usage_path();` add `let sessions_dir = usage::default_sessions_dir();`.
- `let state = usage::read_usage_file(&path);` -> `let mut state = ...;` then `state.sessions = usage::read_sessions(&sessions_dir, std::time::SystemTime::now());`. Update doc at :285.
- verify: `cargo clippy --workspace -- -D warnings` -> `Finished`, no warnings.

**6. TS types, mapping, formatters.** File: `src/usage.ts`. exec: judgment.
- Add `SpendLimit`, `SessionUsage`, `SessionMatch`, the optional `UsageState` fields. Add `STALE_AFTER_SECONDS = 600`, `isStale`, `sessionForPane` (pane newest -> cwd exactly 1 -> latest; `normalizeCwd` = `\`->`/`, strip trailing `/`, lowercase), `formatTokens`, `formatSessionHeader`, `formatContextRow` (`–` / `42%` / `42% of 200k`), `formatCostRow` (`$1.23 · 47m (api 18m)`, null when usd and duration null), `formatLinesRow` (`+312 −88`), `formatSpendLimitRow`.
- verify: `npx tsc --noEmit` exit 0.

**7. Wire types.** File: `src/appTypes.ts`. exec: mechanical. `RawPane` gains `cwd: string | null; foreground_cwd: string | null;` before `focused`. Replace `interface UsageEventPayload` with `export type { UsageState as UsageEventPayload } from "./usage";`. verify: `npx tsc --noEmit`.

**8. Popover blocks and ctx item.** File: `src/ui/statusbar.ts`. exec: judgment.
- Import the new formatters. Add `appendUsageBlock(popover, title, capturedAt, now)` (div `.usage-popover__block`, `is-stale` from `isStale`, header with `formatAsOfLabel`) and `appendUsageRow(block, label, value|null, meterPct|null)`.
- In `openUsagePopover` replace the header-through-weekly code with an `ACCOUNT` block (5-hour, Weekly, Spend limit rows) and, when `usage.session` is set, a block titled `formatSessionHeader(match)` with Context (meter), Cost, Lines rows.
- In `renderUsageStatusItem` after the 5h part: if `usage.session` and kind != `latest` and `context.used_pct !== null`, append `span.usage-ctx.is-<usageColor>` with text `ctx NN%`.
- verify: `npx tsc --noEmit && npx vitest run tests/unit/ui/statusbar.test.ts` (existing tests still pass).

**9. Feed the focused pane's session.** File: `src/appStatusBar.ts`. exec: mechanical.
- Import `sessionForPane` from `./usage` and `subscribeSnapshot` from `./snapshotBus`. `renderUsageBarNow` computes `session = sessionForPane(usage.sessions ?? [], focusedPaneId, pane?.foreground_cwd ?? pane?.cwd ?? null)` and passes `{...usage, session}`.
- In `wireUsageRefresh` add a `subscribeSnapshot` handler that re-renders only when `focused_pane_id` changes.
- verify: `npx tsc --noEmit`.

**10. Styles.** File: `src/style.css`. exec: mechanical. Add `.usage-ctx` (+ `.is-warning`, `.is-danger` using `--statusBarItem-*Background`) and `.usage-popover__block.is-stale { opacity: 0.55; }`. verify: `grep -c "usage-ctx\|usage-popover__block" src/style.css` -> 4.

**11. "Update tap" button.** File: `src/wizard/stepUsage.ts`. exec: mechanical. In the "already installed" branch add a button that removes itself and calls `renderConsent(...)` with text "Copy this version's usage tap script to ~/.claude/statusline/ (and set statusLine to run it). No new backup is made." wired to `runInstall(body)`. verify: `npx tsc --noEmit`.

**12. Vitest.** Files: `tests/unit/usagePopover.test.ts`, `tests/unit/ui/statusbar.test.ts`. exec: judgment.
- `sessionForPane`: exact pane beats newer session; newest of two same-pane; unique normalized cwd -> `cwd`; ambiguous cwd -> `latest`; null paneId works; empty -> null.
- formatters: `formatContextRow` (4 cases), `formatCostRow`, `formatLinesRow`, `formatSpendLimitRow`, `formatSessionHeader` (pane + latest), `isStale` (601/599/null).
- statusbar: ctx `75%` has class `is-warning`; none for `latest`, null pct, no session; popover has 2 blocks containing `ACCOUNT`, header, `75% of 200k`, cost, lines; `captured_at: NOW-601` -> `is-stale`.
- verify: `npx vitest run` -> 0 failed.

**13. Wiki.** Files: `llm_wiki/areas/usage-statusline.md`, `llm_wiki/CHANGELOG.md`. exec: judgment (STE prose, code names verbatim). Refresh stale line refs; document the session file, folder, `read_sessions` (24 h / 7 d), `sessionForPane`, the ctx rule, the Update tap button and the no-version-marker edge; note P3 deferred. Add a `## 2026-11-06 - per-session Claude usage` changelog entry. verify: grep for `herdr-usage/` and `sessionForPane`.

## Overall verify

```
cd C:/Users/Reinaldo/Backend/herdr/gui && cargo fmt --check && cargo clippy --workspace -- -D warnings && cargo test --workspace && npx tsc --noEmit && npx vitest run && npm run test:ps
```
Then step 3's Git Bash check and the live check: build, wizard > Claude usage > Update tap > Install; in a herdr pane run `claude`, send one message; newest file under `~/.claude/herdr-usage/` must have `pane_id` equal to that pane's `HERDR_PANE_ID`; focused pane shows `ctx NN%`; popover shows `ACCOUNT` and `THIS PANE`.

## Risks

- Raw field names are from a minified binary; a Claude update can rename them (rows then hide).
- `HERDR_PANE_ID` in the statusLine child is inferred; the live check confirms it.
- cwd normalization is unverified against real Windows `foreground_cwd`; lowercasing can false-match on case-sensitive paths.
- Undo still fails on this machine after update (no herdr backup exists).
- Skipped: `outdated` detection in the status wire (button always shown), wider popover, a cargo test for the sh tap, jq-branch testing.

## Deferred (P3)

Cache warm/ttl/hit_ratio and `pr {number, url, review_state, kind}`. Raw stdin already carries them; only `usage.rs` and the frontend change.
