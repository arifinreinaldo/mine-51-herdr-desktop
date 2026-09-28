# Cowbell

Cowbell — a desktop for herdr.

A Windows desktop app for running many coding agents side by side — Claude Code,
Codex, OpenCode, Copilot CLI, Cursor, Gemini and more — built on top of
[herdr](https://github.com/herdrdev/herdr), the terminal runtime for coding agents.

Cowbell gives herdr a VS Code-style window: a workspace sidebar, editor-style
tabs, a crisp GPU-friendly terminal, and a status bar that tells you which agent
needs you next.

![Cowbell main window](gui/docs/screenshots/main-window.png)

> Screenshots use a demo session (`acme-api`, `web-dashboard`, …); the terminal shows
> this repository's own commit history.

## Features

### See every agent at a glance

The status bar counts agents by state — working, blocked, done, idle. Blocked
workspaces get an orange bar in the sidebar, and each tab shows its agent's status
dot. When an agent finishes, the agent list opens with a **DONE · just now** card;
press Enter to jump straight to it. If the window is in the background you get a
Windows notification instead.

![Agent list with done notifications](gui/docs/screenshots/agent-done.png)

### Claude plan usage, always visible

The status bar shows your 5-hour Claude usage and time left. Hover it for the
weekly limit and reset times. The numbers come from Claude Code's own status line —
Cowbell never reads or stores your Claude credentials.

![Claude usage popover](gui/docs/screenshots/claude-usage.png)

### Workspaces with colours, tabs with splits

Each workspace (one per project folder) gets its own colour, shown on the sidebar
and on the selected tab. Right-click a workspace to rename it or change its colour.
Right-click a tab to split it right or down, rename it, or zoom a pane. Tabs can be
dragged to reorder and closed with their ×.

| Workspace colours | Tab menu |
|---|---|
| ![Change a workspace colour](gui/docs/screenshots/workspace-colors.png) | ![Split a tab from its menu](gui/docs/screenshots/tab-menu.png) |

### Menus for everything

A VS Code-style menu bar: **Workspace**, **Tab**, **Pane**, **Agents**, **View**,
**herdr** and **Help**. *Workspace ▸ New Workspace…* opens a folder picker and turns
the folder into a workspace. The **herdr** menu mirrors herdr's own menu: settings,
setup, start/stop the server, start at login, and what's new.

| Workspace menu | herdr menu |
|---|---|
| ![Workspace menu](gui/docs/screenshots/workspace-menu.png) | ![herdr menu](gui/docs/screenshots/herdr-menu.png) |

### Guided provider setup

*herdr ▸ Setup…* checks the herdr engine, detects which agent CLIs are installed,
installs missing ones in a visible terminal tab (only after you confirm), connects
them to herdr for status detection, and signs you in with each CLI's own login.

![Setup — agent providers](gui/docs/screenshots/setup-providers.png)

### Keyboard first

Shortcuts only use Ctrl+Shift, Alt and a few function keys, so everyday keys like
Ctrl+C, Ctrl+R or Ctrl+T still reach Claude Code and your shell. Press
**Ctrl+Shift+/** for the searchable cheat sheet.

![Keyboard shortcuts cheat sheet](gui/docs/screenshots/keyboard-shortcuts.png)

| Shortcut | Action |
|---|---|
| `Alt+1` … `Alt+9` | Go to tab 1–8 / last tab |
| `Ctrl+Shift+1` … `Ctrl+Shift+9` | Go to workspace 1–8 / last workspace |
| ``Alt+` `` | Toggle between the last two tabs |
| `Ctrl+Shift+T` / `Ctrl+Shift+W` | New tab / close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+Shift+N` | New workspace from a folder |
| `Ctrl+Shift+↓` / `Ctrl+Shift+↑` | Next / previous workspace |
| `Ctrl+Shift+E` | Focus the sidebar (arrows + Enter) |
| `Alt+Shift+=` / `Alt+Shift+-` | Split right / split down |
| `Ctrl+Shift+J` | Jump to the next agent that needs you |
| `Ctrl+Shift+A` | Show the agent list |
| `Ctrl+Shift+/` | Keyboard shortcuts |

### More

- **Themes** — Dark Modern by default, plus herdr, Catppuccin Mocha, Tokyo Night,
  One Dark Pro and Dracula. *View ▸ Import VS Code Theme…* loads any VS Code theme
  (`.json` or `.vsix`).
- **Fast terminal** — device-pixel rendering with a glyph cache; box-drawing
  characters join without gaps; `Ctrl+Shift+Alt+P` shows a performance overlay.
- **Light on memory** — about 180 MB when idle; WebView2 drops to low-memory mode
  while the window is minimized.
- **Agents keep running** — closing the window never stops your agents; the herdr
  server keeps them alive.

## Download and run

Cowbell is a single portable `.exe` — no installer.

1. Download `Cowbell.exe` from the
   [Releases](https://github.com/arifinreinaldo/mine-51-herdr-desktop/releases) page.
2. Run it. The build is not code-signed yet, so Windows SmartScreen may warn you:
   choose **More info → Run anyway**.
3. Cowbell does not bundle herdr — it is a separate install. If herdr is not
   installed, the banner offers **Open Setup**, or *herdr ▸ Setup…*, which runs
   **Install herdr**: herdr's own official installer from
   [herdr.dev](https://herdr.dev), downloaded and run over HTTPS.

Requirements: Windows 10 or 11 (64-bit) with the WebView2 runtime (built into
Windows 11).

## Build from source

Requirements: Rust 1.96.1 (see `rust-toolchain.toml`), Node.js 20+, npm.

```powershell
cd gui
npm install
npm run check      # format, clippy, Rust + Vitest tests
npm run package    # portable exe -> gui/target-agent/release/portable/
```

`npm run package` regenerates the third-party notices file
(`gui/public/THIRD-PARTY-NOTICES.txt`) before building. It does not bundle a
herdr release — Cowbell installs herdr separately, at first run, from
herdr.dev. Specs and design notes live in [`gui/docs/`](gui/docs).

## How it works

Cowbell is a client of a normal herdr server. It connects over herdr's
stable client protocol (generation 1), renders the server's terminal grid on a
canvas, and sends keyboard input back. Workspaces, tabs, panes and agent detection
all live in herdr, so the terminal UI and the desktop app can share the same
sessions. See [`gui/docs/protocol-choice.md`](gui/docs/protocol-choice.md) for why
Cowbell uses this protocol.

```
gui/
  src/            TypeScript frontend (shell, sidebar, tabs, renderer, setup)
  src-tauri/      Rust backend (herdr connection, engine setup, settings)
  crates/herdr-wire/  herdr client protocol types
```

## Licence

This repository carries more than one licence:

- The herdr fork code at the repository root (everything outside `gui/`) is
  Apache-2.0. See the root [`LICENSE`](LICENSE).
- Cowbell's own code in `gui/` is licensed under **FSL-1.1-ALv2** (the
  Functional Source License, Apache-2.0 future licence) from this change
  onward. See [`gui/LICENSE`](gui/LICENSE). Each Cowbell release becomes
  Apache-2.0 two years after its own publication.
- Commits before this change are Apache-2.0.
- [`gui/crates/herdr-wire`](gui/crates/herdr-wire) stays Apache-2.0: it is a
  copy of herdr's own protocol code, not new Cowbell code. See
  [`gui/crates/herdr-wire/LICENSE`](gui/crates/herdr-wire/LICENSE) and its
  [`NOTICE`](gui/crates/herdr-wire/NOTICE).

Third-party notices for every bundled dependency are generated into
`gui/public/THIRD-PARTY-NOTICES.txt` (`npm run notices` in `gui/`), and are
also available from Cowbell's own Help ▸ Licenses… menu.

## Credits

Cowbell is a fork of [herdr](https://github.com/herdrdev/herdr) by the herdr
authors. The original herdr README is kept in
[`README.herdr.md`](README.herdr.md). Icons are
[Codicons](https://github.com/microsoft/vscode-codicons) © Microsoft (CC BY 4.0).

Cowbell is not affiliated with or endorsed by herdr or Herdr, Inc.
