# Sidebar, tabs, workspaces, window chrome

## Purpose
herdr owns workspaces, tabs and panes. The GUI shows them and sends actions.

## Key files
- `src/ui/sidebar.ts` - `renderSidebar` (line 433), `sidebarAttention` (line 40). `src/appSidebarPanel.ts` - `renderSidebarNow` (line 116).
- `src/ui/tabs.ts` - `renderTabStrip` (line 195), inline rename (lines 85, 135). `src/appTabStrip.ts` - `renderTabsNow` (line 73), `wireTabStripControls` (line 202).
- `src/appWorkspaceFlows.ts` - `newWorkspaceFlow` (line 15), `importThemeFlow` (line 53).
- `src/workspace/` - pure helpers: `tabMove.ts`, `tabMru.ts`, `dedupe.ts`, `colors.ts`, `focusByIndex.ts`.
- `src/ui/menus.ts` - menu bar items (`wireMenuBar`, line 302). `src/appMenuBar.ts` - `menuBarContext` (line 84).
- `src/ui/titlebar.ts` - window buttons (`wireTitlebarControls`, line 8).
- `src-tauri/src/window_chrome.rs` - `window_minimize` (line 22), `window_toggle_maximize` (line 30), `window_close` (line 48), `open_settings` (line 81).
- `src/appState.ts` - `appState` (line 20), `optimisticTabOrder` (line 28).
- `src/notifications/` - done detector, bell flash, seen-done tabs. `src-tauri/src/notify.rs` - `notify_agent_done` (line 94).

## State
- herdr owns the order. The GUI shows `optimisticTabOrder` after a drop until the next snapshot clears it.
- `workspaceFolders` and `workspaceColors` live in settings ([[settings]]).

## Window chrome
- Windows uses a frameless window: `"decorations": false` (`src-tauri/tauri.conf.json:23`).
- macOS uses native decorations: `"decorations": true` and `titleBarStyle` Overlay (`src-tauri/tauri.macos.conf.json:12,15-16`).
- `main.ts` adds the CSS class `mac` on macOS (`src/main.ts:57`).

## Edges
- A render guard defers tab and sidebar redraws during an inline rename or tab drag (`src/ui/renderGuard.ts:1-7`, `src/main.ts:139-140`).
- Tests: `tests/unit/workspace/`, `tests/unit/notifications/`, `tests/unit/ui/`.
