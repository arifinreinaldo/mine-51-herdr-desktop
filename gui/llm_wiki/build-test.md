# Build and test

Run all commands from `gui/` unless the line says otherwise.

## Test commands
| Check | Command | Source |
|---|---|---|
| TypeScript tests | `npx vitest run` (also `npm run test:ts`) | `package.json:14` |
| TypeScript types | `npx tsc --noEmit` | `package.json:12` |
| Rust compile check | `cargo check` in `gui/src-tauri` | - |
| Rust tests | `cargo test --workspace` (`npm run test:rust`) | `package.json:13` |
| Full gate | `npm run check` (fmt, clippy, cargo test, tsc, vitest) | `package.json:12` |
| Statusline script (Windows) | `npm run test:ps` | `package.json:15` |
| E2E smoke (optional) | `npm run e2e` | `tests/e2e/README.md:1-3` |

- Vitest includes only `tests/unit/**/*.test.ts` (`vitest.config.ts:10`). The environment is `node`.
- Golden frame fixtures live in `tests/golden/`.

## Build
- Dev: `npm run dev` (Vite) and `npm run tauri dev`. The dev URL is `http://localhost:1420` (`src-tauri/tauri.conf.json:8`).
- Windows portable exe: `npm run package` runs `scripts/package.mjs`. It builds with `--no-bundle` (line 86) into `gui/target-agent` (line 7) and copies `Cowbell.exe` to `release/portable` (lines 92-93). `npm run package:fast` skips LTO.
- macOS app: `npx tauri build --bundles app`. Output: `gui/target/release/bundle/macos/Cowbell.app` (`.claude/skills/build-mac/SKILL.md:9`, repo root).
- After a macOS build, compare the timestamp of `Cowbell.app/Contents/MacOS/herdr-gui` with the build start. An old timestamp is not a pass.
- Config: `src-tauri/tauri.conf.json` (Windows base), `src-tauri/tauri.macos.conf.json` (macOS overrides).
- Other scripts: `scripts/bench-startup.mjs` (startup budget), `scripts/gen-notices.mjs` (licences), `scripts/e2e-live.mjs`.

## Not verified
- The macOS bundle folder `gui/target/release/bundle/macos/` held no app when this page was written (2026-10-24).
