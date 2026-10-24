# Cowbell GUI

## llm_wiki (memory palace)

This app has an `llm_wiki/` — an LLM-maintained map of the codebase. Use it to search efficiently.

- **Before grep/search:** read `llm_wiki/map.md` FIRST — it routes intent → the 1–3 pages you need. Don't read the whole wiki.
- **Find the code behind a concept:** `llm_wiki/code_map.md` (path ↔ room).
- **After any change:** update the touched wiki pages + `llm_wiki/CHANGELOG.md`, then commit (`docs: sync llm_wiki …`). See the `karpathy-brain` skill's update op.
- The wiki overrides general knowledge for this repo; if it's wrong, fix it — don't route around it.
