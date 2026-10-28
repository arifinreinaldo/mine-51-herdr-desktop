# Code map (address book)

> A changed file points to a page. Paths are relative to `gui/`.

| Code path | Purpose | Page |
|---|---|---|
| `src-tauri/src/lib.rs`, `main.rs` | app start, command registry | [[architecture]] |
| `src-tauri/src/commands.rs`, `dispatch.rs`, `conn.rs`, `socket.rs`, `mirror.rs`, `surface_encode.rs`, `crates/herdr-wire/` | herdr link, grid mirror | [[protocol]] |
| `src-tauri/src/engine.rs` | find, install, start herdr | [[protocol]] |
| `src/keyboard/`, `src/shortcuts.ts`, `src/input/keymap.ts`, `src/appMenuBar.ts` | key routing, shortcuts | [[keyboard]] |
| `src/colors.ts`, `src/render/`, `src/themes/`, `src/appLookups.ts`, `src-tauri/src/theme_import.rs` | canvas, colors, themes | [[render-themes]] |
| `src/ui/sidebar.ts`, `tabs.ts`, `menus.ts`, `titlebar.ts`, `src/appSidebarPanel.ts`, `src/appTabStrip.ts`, `src/workspace/`, `src/notifications/`, `src-tauri/src/window_chrome.rs`, `notify.rs` | chrome, workspaces | [[workspace-ui]] |
| `src/files/`, `src/ui/file*.ts`, `quickOpen.ts`, `viewerFind.ts`, `src/appFiles.ts`, `src-tauri/src/files.rs` | file tree, viewer | [[files]] |
| `src/git/`, `src/ui/sourceControl.ts`, `diffView.ts`, `src/appSourceControl.ts`, `src-tauri/src/git.rs` | Source Control | [[source-control]] |
| `src/flutter/`, `src/appFlutterRun.ts`, `src/ui/runToolbar.ts`, `flavorPicker.ts`, `src/mirrorTools.ts`, `src/android/`, `src-tauri/src/flutter.rs`, `android.rs`, `mirror_tools*.rs`, `record*.rs` | run toolbar, scrcpy | [[flutter-android]] |
| `src/dbInspector.ts`, `db-inspector.html`, `src-tauri/src/android_db.rs` | SQLite inspector | [[sqlite-inspector]] |
| `src/usage.ts`, `src/ui/statusbar.ts`, `src/appStatusBar.ts`, `src-tauri/src/usage.rs`, `statusline.rs`, `src-tauri/resources/statusline/` | usage bar | [[usage-statusline]] |
| `src/settings.ts`, `src/appState.ts`, `src-tauri/src/settings.rs` | settings | [[settings]] |
| `package.json`, `vite.config.ts`, `vitest.config.ts`, `src-tauri/tauri*.conf.json`, `scripts/` | build, test | [[build-test]] |
| `src-tauri/src/macos.rs`, `src/macShell.ts`, `src/nativeMenu.ts`, `src/wizard/usageSetup.ts` | macOS port (untracked) | [[macos-port]] |
| `src/wizard/` | first-run wizard | TBD |
| `src/mouse/`, `src/paneChrome/`, `src/copyMode.ts`, `src/scroll.ts` | mouse, selection, copy mode | TBD |
| `src/links.ts`, `src/appTerminalMouse.ts` (Ctrl+click and Ctrl+hover), `open_external_url` and `open_local_path` in `src-tauri/src/commands.rs` | terminal links: URL via herdr, `C:\...` file path via client match | TBD |
| `src-tauri/src/clipboard.rs`, `memory.rs`, `folder_picker.rs` | small helpers | TBD |
| `docs/`, `PRODUCT.md` | specs (can be old) | [[doc-mismatches]] |
