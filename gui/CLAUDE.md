# Cowbell GUI

## llm_wiki (memory palace)

This app has an `llm_wiki/` — an LLM-maintained map of the codebase. Use it to search efficiently.

- **Before grep/search:** read `llm_wiki/map.md` FIRST — it routes intent → the 1–3 pages you need. Don't read the whole wiki.
- **Find the code behind a concept:** `llm_wiki/code_map.md` (path ↔ room).
- **After any change:** update the touched wiki pages + `llm_wiki/CHANGELOG.md`, then commit (`docs: sync llm_wiki …`). See the `karpathy-brain` skill's update op.
- The wiki overrides general knowledge for this repo; if it's wrong, fix it — don't route around it.

## Branching and platforms (Windows + macOS)

- `main` is the only long-lived branch. Feature branches are `feat/<topic>`, live days not weeks, and are deleted after merge.
- Pull `main` at the start of every session on both machines. Branch from the latest `main`.
- The core and each feature's data contract are shared. Platform code is only the edge:
  `IS_MAC` and `buildMacShortcuts` in `src/shortcuts.ts`, `src-tauri/src/*_macos.rs` and `*_win32.rs`, and the `.sh` and `.ps1` tap scripts.
- A feature that needs a new platform edge changes the shared contract first. Each platform then follows it.
- Update `llm_wiki/areas/*.md` and `llm_wiki/CHANGELOG.md` in the same commit as the code.
- CI (`.github/workflows/gui.yml`, macOS and Windows) must pass on both before merging to `main`.
- Do not create a Windows-only or macOS-only long-lived branch. Do not add platform checks to shared core code.
