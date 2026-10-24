# Conventions - Cowbell GUI

## Structure
- One Rust module per feature in `src-tauri/src/lib.rs:3-26`.
- Each Tauri command is `#[tauri::command]` and listed once in `generate_handler!` (`src-tauri/src/lib.rs:83`).
- The frontend wraps each command in a typed function. Examples: `src/git/gitApi.ts:48`, `src/files/filesApi.ts:44`, `src/flutter/flutterApi.ts:23`.
- Pure logic lives in folders (`src/keyboard/`, `src/git/`, `src/files/`). Vitest tests it without a DOM (`vitest.config.ts:4-10`).
- Flat `src/app*.ts` files wire pure logic to the DOM.

## State
- Frontend state is the single `appState` object (`src/appState.ts:20`).
- Call `persistSettings()` to save settings (`src/appState.ts:85`).

## Errors
- Rust commands return `Result<_, ApiError>` (`src-tauri/src/commands.rs:183`).

## Comments
- A `// shortcut:` comment marks a deliberate simplification with a ceiling. See [[shortcut-markers]].
- Platform code: gate with `#[cfg(windows)]` (`src-tauri/src/lib.rs:18-22`).

## Gotchas
- Windows is the primary platform. macOS is in progress ([[macos-port]]).
- The data folder keeps the old name `herdr-gui` on purpose (`src-tauri/src/settings.rs:133`; `PRODUCT.md:28`).
- `mirror.rs` is the terminal grid mirror. `mirror_tools.rs` is the scrcpy tools window. Do not mix them (`src-tauri/src/mirror_tools.rs:3`).
