# Architecture - Cowbell GUI

> Cowbell is a Tauri desktop app. It is a GUI over herdr, the agent-aware terminal multiplexer. Stack: Rust (Tauri 2), TypeScript (Vite), Vitest.

## Entry points
- Rust: `src-tauri/src/main.rs` starts `lib.rs::run` (`src-tauri/src/lib.rs:47`). It registers the Tauri commands (`src-tauri/src/lib.rs:84`).
- Frontend: `src/main.ts` runs `main()`. It wires input, menus and events (`src/main.ts:106-190`).
- Extra pages: `mirror-tools.html`, `db-inspector.html` and `device-explorer.html` build as separate windows (`vite.config.ts:13-24`).

## Shape
- `src-tauri/src/` - Rust backend. One module per feature ([[code_map]]).
- `src/` - TypeScript frontend. Flat `app*.ts` files wire features. Folders hold pure logic.
- `crates/herdr-wire/` - copy of the herdr wire types ([[protocol]]).
- `tests/unit/` - Vitest. `tests/golden/` - frame fixtures. `tests/e2e/` - WebdriverIO.
- `docs/` - specs and plans. They can be old ([[doc-mismatches]]).

## Primary data flow
1. The Rust backend connects to the herdr client socket and keeps a `SurfaceMirror` of the terminal grid (`src-tauri/src/dispatch.rs:83`, `src-tauri/src/mirror.rs:63`).
2. `dispatch.rs` encodes each frame and pushes it to the frontend over a Tauri channel (`src-tauri/src/dispatch.rs:430`).
3. `TerminalRenderer` draws the grid on a canvas (`src/render/renderer.ts:160`).
4. Key presses go from `keyboard/routing.ts` to the Rust `send_input` command (`src-tauri/src/commands.rs:225`).
5. Workspace, tab and pane actions use the `api` command. It forwards one JSON method to herdr (`src-tauri/src/commands.rs:265`).
6. herdr sends a `shell.snapshot.v1` snapshot. The frontend keeps it in `appState.snapshot` (`src/appState.ts:20-22`).

## State ownership
- herdr owns terminals, panes, tabs and workspaces.
- Rust `Inner` owns the connection and the grid mirror (`src-tauri/src/commands.rs:33`).
- The `appState` object owns frontend state (`src/appState.ts:20`).
- `settings.json` owns user choices ([[settings]]).

## Room shape (for new pages in `areas/`)
- Purpose. Key files. State. Edges.
