# macOS port

## Known state (2026-11-01)
- Windows is the primary platform. The macOS port runs on branch `feat/gui-phase1`.
- Wired on macOS: native menu, Dock badge and usage wizard (`src-tauri/src/macos.rs`, `src/macShell.ts`, `src/nativeMenu.ts`, `src/wizard/usageSetup.ts`; `pub mod macos` in `lib.rs`), the shortcut map, `tauri.macos.conf.json`, `app_data_base`.
- File paths in the terminal open on Cmd+click (`isLinkModifier` in `src/links.ts`). The Rust gate `is_safe_local_file` (`commands.rs`) requires an absolute path on unix.
- The mirror tools strip works on macOS: `src-tauri/src/mirror_tools_macos.rs` finds the scrcpy window by pid with `CGWindowListCopyWindowInfo` and needs no permission. Live check pending (needs a device). Record is still Windows only.
- Build and install: `npm run install:mac` (`scripts/install-mac.sh`). The script does not stop a running Cowbell reliably; quit it first (single instance).
- `git stash@{0}` and `stash@{1}` hold old copies of this work. They can be dropped after you check them.

## Config
- `src-tauri/tauri.macos.conf.json:12,15-16` - native decorations, Overlay title bar, hidden title.
- Build command: `npx tauri build --bundles app`. Output: `gui/target/release/bundle/macos/Cowbell.app`. See [[build-test]].

## Edges
- Unit tests always run the Windows shortcut table (`src/shortcuts.ts:493-494`).
- Several Rust modules have Windows-only parts (`src-tauri/src/lib.rs:19-24`). Check `#[cfg]` gates before you add a macOS path.
- Plan: `docs/phase1_7-plan.md` (old; see [[doc-mismatches]]).
