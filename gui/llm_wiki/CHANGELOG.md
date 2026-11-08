# llm_wiki changelog

> One line per wiki update. Newest on top.

## 2026-11-08 - UI/UX critique fixes
- Auto-opened Done popover no longer claims Esc from the terminal: new `OpenAgentPopoverOptions.autoOpened` (fed from `appState.agentPopoverAutoOpened` in `appStatusBar.ts`); `statusbar.ts` skips outside Esc and sets `escapableFromOutside` false for it.
- `style.css`: white text on warning amber, `--errorForeground` for danger text, explicit `background` on `.btn--primary:hover` and `.btn--danger:hover`, 2px foreground focus ring on `.ws.is-selected` and `.tab.active`.
- Keyboard and aria: `tabs.ts` `aria-selected` and Left/Right focus moves; `sidebar.ts` Delete key and "Close Workspace…" context item open the existing close confirm; `runToolbar.ts` keeps `aria-label` in step with `title`.
- Theme: the herdr palette `orange` in `themes/herdr.ts` is now `#f0883e`. The blocked colour no longer equals the peach active-tab fill. `style.css` gives the rename input on the active tab a foreground border. `contrast.test.ts` checks blocked against `tab.activeBackground` at 1.3:1 or more.
- Modal: `modal.ts` `trapTab` wraps Tab and Shift+Tab at the first and last control. `.modal` has `tabIndex = -1` and takes focus after `openOverlay`. Ctrl, Alt and Meta Tab pass through. Test: `modal.test.ts`.
- Menu ARIA: `menu.ts` sets `menuitemcheckbox` with `aria-checked`, `aria-disabled` and `aria-haspopup`. `menus.ts` `wireMenuBar` sets title roles and `aria-expanded`. `#menubar` has `role="menubar"`. Left and Right move focus between titles.
- Run shortcuts: `run.play`, `run.hotReload` and `run.hotRestart` in `shortcuts.ts`. `appMenuBar.ts` calls `triggerRunAction` in `appFlutterRun.ts`, which calls `RunToolbar.trigger`. Tooltips show the key. Test: `runToolbar.test.ts`.

## 2026-11-06 - per-session Claude usage
- Taps (`herdr-usage.ps1`, `herdr-usage.sh`) also write `~/.claude/herdr-usage/<session_id>.json`, before the legacy file. `usage.rs`: `default_sessions_dir`, `parse_session_json`, `read_sessions` (24 h ignore, 7 d prune by mtime). `lib.rs` `run_usage_poll_loop` adds `sessions` to the `usage` event.
- `usage.ts`: `sessionForPane` (pane, unique cwd, latest) and the session formatters. `statusbar.ts`: `ctx NN%` for kinds `pane` and `cwd`; popover `ACCOUNT` block (5-hour, Weekly) plus a session block, each with `as of Nm ago`. `appStatusBar.ts` feeds the focused pane's session.
- `stepUsage.ts`: new `Update tap` button (the tap has no version marker). P3 (prompt cache, pr) deferred.
- `areas/usage-statusline.md` rewritten with fresh line refs; `code_map.md` rows still correct. Tests: `scripts/test-statusline.ps1`, `usagePopover.test.ts`, `statusbar.test.ts`.

## 2026-11-01 - snapshot bus and per-region render skip
- New `src/snapshotBus.ts` (`subscribeSnapshot`, `publishSnapshot`). `appEvents.ts` holds the one `snapshot` listener; four modules subscribe. `renderTabsNow` and `renderSidebarNow` skip when their JSON key is unchanged; `main.ts` render-guard release passes `force=true`. `areas/workspace-ui.md` updated; test `tests/unit/snapshotBus.test.ts`.

## 2026-11-01 - incremental Find File ranking
- `fuzzy.ts`: new `makeRanker`; `rankPaths` shares `byRank`. `quickOpen.ts`: 30 ms rank debounce, flush on Enter and arrows. Marker moved to `fuzzy.ts:75`. `areas/files.md` and `shortcut-markers.md` updated.

## 2026-11-01 - flutter and adb fallbacks on macOS
- `flutter.rs`: `resolve_adb` adds the Homebrew folders after the default SDK; `resolve_flutter` adds `flutter_extra_dirs` after `PATH`. New seams `resolve_adb_in`, `resolve_flutter_in`. `areas/flutter-android.md` updated.

## 2026-11-01 - gui CI workflow
- `build-test.md`: new CI section for `.github/workflows/gui.yml`; notes the fmt and clippy baseline failures.

## 2026-11-01 - merge git-source-control into gui-phase1; mac open-path gate
- Merged `feat/git-source-control` (open-path gate, install status, device explorer, smart search) into `feat/gui-phase1`, which holds the macOS work. No conflicts.
- `is_safe_local_file` (`commands.rs`): the `C:\` drive-letter rule is now `#[cfg(windows)]`. On unix the gate needs an absolute path; the extension allowlist and the symlink check still apply. New test `local_file_gate_unix`.
- Mirror tools strip on macOS: new `mirror_tools_macos.rs` docks the strip beside scrcpy via `CGWindowListCopyWindowInfo` (owner pid + layer 0; title only when visible), in points with scale 1.0; the work area is divided by the monitor's own scale. No Screen Recording or Accessibility prompt. Spec: `docs/mirror-tools-macos-spec.md`. Windows code unchanged. Record stays Windows only.
- `android.rs`: `find_tool` takes several dirs; `resolve_scrcpy` also checks `/opt/homebrew/bin` and `/usr/local/bin` on macOS (`resolve_scrcpy_in` is the test seam).
- `POSIX_PATH` also matches after a backtick, `=` and `<`; a backtick ends the path. Gate test: a `.txt` symlink to a `.sh` is rejected.
- `areas/macos-port.md`, `areas/flutter-android.md`, `code_map.md`, `docs/mirror-toolbar-spec.md` updated.
- `links.ts`, `appTerminalMouse.ts`: Cmd+click and Cmd+hover on macOS (`isLinkModifier`); `pathAtColumn` and `pathAtWrappedRows` also match absolute `/` paths (`POSIX_PATH`). Restored from a stash that the merge had left behind. Added the `install:mac` script to `package.json`.
- `code_map.md`: the terminal-links row now says `C:\...` or `/...` file paths.

## 2026-10-30 - device explorer: tree, app data, device root, drop
- `areas/device-explorer.md`: rewritten for the tree with three roots; new commands `android_debuggable_apps`, `android_push_dropped`; new Limits (two path rules, `permission_denied`, app-data pull, `not_pullable`, drop); fresh line refs.
- `map.md` and `code_map.md`: new route text; added `capabilities/device-explorer.json`.
- `shortcut-markers.md`: added `APP_PULL_MAX_ITEMS` (`device_explorer.rs:27`); `TRANSFER_TIMEOUT` is now `:23`, `MAX_ENTRIES` `:25`; 24 markers.
- `areas/sqlite-inspector.md`: `lib.rs:184` to `:186`; noted that the device explorer shares `pull_file`.
- `areas/usage-statusline.md`: `lib.rs` refs +2 (`:264`, `:279`, `:275`).
- `doc-mismatches.md`: `docs/device-explorer-spec.md` is read-only; phases 2 and 3 superseded it.

## 2026-10-29 - device explorer: upload, sync, delete
- `areas/device-explorer.md`: new commands `android_push_paths`, `android_delete_path`; refreshed its line refs and the Limits.
- Renamed marker `PULL_TIMEOUT` to `TRANSFER_TIMEOUT` (`device_explorer.rs:22`); `MAX_ENTRIES` is now `:24`.
- Moved `lib.rs` refs by +3 in `sqlite-inspector.md` and `usage-statusline.md`.

## 2026-10-29 - smart Find File
- `fuzzy.ts`: a multi-word query ("rad page") matches the file name word by word, and a word can match a folder name. One word must hit the name.
- Added the command `fs_grep` (`git grep`, git roots only, 3+ characters). `quickOpen.ts` lists the hits under "In files", and `onOpenAt` opens the file at the line.
- Moved line refs in `areas/files.md` and the `fuzzy.ts` marker row (`:42` to `:72`).

## 2026-10-29 - device explorer
- Added the room `areas/device-explorer.md` for the Explorer button, `device_explorer.rs` and `device-explorer.html`.
- Added rows to map, code_map and shortcut-markers (`PULL_TIMEOUT`, `MAX_ENTRIES`; 23 markers). Added the room to index.
- Moved line refs: `lib.rs` (+1 after `mod device_explorer`), `android_db.rs` (+3 after line 331, rustfmt), `vite.config.ts` (now 13-24), `createRunToolbar`, `wireFlutterRun`, `mirror-install` listener, `flutterApi.ts` db wrappers.
- Fixed `lib.rs:3-26` to `4-31` (module list) and the `cfg(windows)` range to `19-24`. Both were stale before this change.

## 2026-10-28 - APK installs only on the scrcpy window
- Removed the APK install from the Cowbell window (`android_install_apk`, `installApks`, `splitApks`). A dropped file is pasted like any file.
- The strip now reads the install status from the stdout and stderr log of scrcpy (`follow_scrcpy_log`). Updated flutter-android, doc-mismatches, shortcut-markers (21 markers), map.

## 2026-10-27 - file-path links
- Added the Ctrl+click file-path link to `code_map` and one `shortcut-markers` row (19 markers).

## 2026-10-24 - wiki scaffolded and seeded
- Created map, index, code_map, architecture, conventions, protocol, doc-mismatches, shortcut-markers, build-test, settings and the feature rooms in `areas/`.
