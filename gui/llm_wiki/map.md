# Cowbell GUI - llm_wiki map (floor plan)

> Read this page first. Find your question below. Read only the 1-3 pages it names.
> Stack: Tauri 2 (Rust backend, TypeScript and Vite frontend, Vitest). Seeded: 2026-10-24.
> Scope: `gui/` only. The herdr core in `../src` is out of scope. See [[protocol]] for the one link.

## Route by question

| Question | Page |
|---|---|
| How do the Rust backend, the frontend and herdr fit together? | [[architecture]] |
| How does the GUI talk to herdr (socket, frames, handshake)? | [[protocol]] |
| A key does the wrong thing. Where do shortcuts and double-Shift live? | [[keyboard]] |
| Terminal colors, canvas drawing, themes, ANSI 0-15 | [[render-themes]] |
| Sidebar, tabs, workspaces, menu bar, title bar | [[workspace-ui]] |
| File tree, file viewer, Find File, big-file paging | [[files]] |
| Source Control panel, diff view, stage and commit | [[source-control]] |
| Flutter run toolbar, scrcpy mirror, APK install status from scrcpy's log, screenshot, record | [[flutter-android]] |
| SQLite inspector on an Android device | [[sqlite-inspector]] |
| Device explorer: browse an Android device (shared storage, app data of debug builds, device root), save files to the PC, upload, sync, drop and delete | [[device-explorer]] |
| Claude usage bar and statusLine tap | [[usage-statusline]] |
| Settings file, defaults, persistence | [[settings]] |
| Build, package, test commands | [[build-test]] |
| macOS port: what works, what sits in the stash | [[macos-port]] |
| A `// shortcut:` comment. What is its ceiling? | [[shortcut-markers]] |
| Which file owns this path? | [[code_map]] |
| Where do docs disagree with the code? | [[doc-mismatches]] |
| Naming and patterns to follow | [[conventions]] |

## Always
- Code is truth. A spec in `docs/` may be old. Check [[doc-mismatches]].
- After a code change, run the `karpathy-brain` update operation.
