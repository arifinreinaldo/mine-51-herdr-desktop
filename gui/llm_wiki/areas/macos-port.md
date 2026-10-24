# macOS port

## Known state (2026-10-24)
- Windows is the primary platform. The macOS port is in progress.
- Four files are untracked and not wired: `src-tauri/src/macos.rs`, `src/macShell.ts`, `src/nativeMenu.ts`, `src/wizard/usageSetup.ts`. A test is also untracked: `tests/unit/nativeMenu.test.ts`.
- The wiring sits in `git stash@{0}`. It is not in the working tree. The stash base is `cb8cfa4b` on branch `feat/gui-phase1`. The current branch is `feat/git-source-control`.
- The stash changes 15 files, among them `lib.rs`, `statusline.rs`, `tauri.macos.conf.json`, `main.ts`, `ui/menus.ts`, `ui/statusbar.ts`, `wizard/stepUsage.ts`.
- Check with `git stash show --stat stash@{0}` before you trust this list.

## What is in the working tree
- `src-tauri/src/lib.rs:3-26` has no `mod macos`. So `dock_badge`, `dock_bounce` and `set_native_menu` are not registered commands (`src-tauri/src/macos.rs:39,56,75`).
- No file imports `src/macShell.ts`, and only `macShell.ts` and the test import `src/nativeMenu.ts`. No file imports `src/wizard/usageSetup.ts`.
- Committed macOS work: the shortcut map (`src/shortcuts.ts:474`, `IS_MAC` at 495), `tauri.macos.conf.json`, and `app_data_base` for macOS (`src-tauri/src/settings.rs:120-125`).

## Config
- `src-tauri/tauri.macos.conf.json:12,15-16` - native decorations, Overlay title bar, hidden title.
- Build command: `npx tauri build --bundles app`. Output: `gui/target/release/bundle/macos/Cowbell.app`. See [[build-test]].

## Edges
- Unit tests always run the Windows shortcut table (`src/shortcuts.ts:493-494`).
- Several Rust modules have Windows-only parts (`src-tauri/src/lib.rs:18-22`). Check `#[cfg]` gates before you add a macOS path.
- Plan: `docs/phase1_7-plan.md` (old; see [[doc-mismatches]]).
