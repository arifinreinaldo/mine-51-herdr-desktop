# Settings persistence

## Facts
- File: `<app data>/herdr-gui/settings.json` (`src-tauri/src/settings.rs:133,136`). The folder name `herdr-gui` is fixed on purpose.
- App data base: `%APPDATA%` on Windows, `~/Library/Application Support` on macOS, `~/.local/share` elsewhere (`src-tauri/src/settings.rs:117-127`).
- Rust struct `Settings` (line 26). Each field has a `serde` default, so an old file still loads.
- `load_settings_from` (line 143) and `save_settings_to` (line 200). Commands `settings_get` (213) and `settings_set` (222).
- A corrupt file gives defaults and `corrupted: true` (`src-tauri/src/settings.rs:108-112`). The frontend then shows a notice.
- Frontend mirror: `Settings` and `DEFAULT_SETTINGS` in `src/settings.ts` (lines 9, 36). `loadSettings` (52), `saveSettings` (56).
- Call `persistSettings()` to save from the UI (`src/appState.ts:85`).
- Secondary windows read the theme with `applySavedTheme` (`src/themes/savedTheme.ts:8`).

## Fields
`theme`, `workspaceFolders`, `workspaceColors`, `sidebarWidth`, `sidebarVisible`, `fontSize`, `agentSort`, `desktopNotifications`, `firstRunComplete`, `agentListPinned`, `flutterDevices`, `flutterFlavors`, `sourceControlOpen` (`src/settings.ts:9-29`).

## Edges
- A new field needs a change in both `settings.rs` and `src/settings.ts`. Keep the names in camelCase on the wire.
- Imported themes live in `<app data>/herdr-gui/themes/` (`src-tauri/src/theme_import.rs:123`).
