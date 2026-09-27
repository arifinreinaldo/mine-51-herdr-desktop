# Herdr Desktop — Phase 1.7 plan: macOS `.app` + release CI

Status: PLAN ONLY. Nothing is built. The next step is a spec that goes through the
usual pipeline (Opus spec → Fable review → Sonnet execute → Opus review → verify),
and only when the user asks for it.

## 1. Goal

Ship Herdr Desktop for macOS as a self-contained **`Herdr Desktop.app`** (and a
`.dmg`) next to the Windows portable `.exe`. Both are built by **GitHub Actions** on
each release tag and attached to the GitHub Release, so no local Mac and no manual
upload are needed.

Success criterion:
- Pushing a tag `desktop-v*` produces a GitHub Release that contains
  `Herdr Desktop.exe` (Windows x64) and `Herdr Desktop.dmg` (universal: Apple Silicon
  and Intel).
- On a Mac, the `.app` installs the bundled herdr engine when herdr is missing,
  starts the server, connects, and passes the Phase 1.5 polish checklist with Mac
  conventions.

## 2. Blocker to fix first: upstream workflows in this repository

The fork carries herdr's own workflows in `.github/workflows/`. Some of them act on
**this** repository:

| Workflow | Trigger | Risk here |
|---|---|---|
| `release.yml` | tags `v*` | Runs herdr's release pipeline on our repo. |
| `preview.yml` | tags `preview-*` | Same, for previews. |
| `pr-gate.yml` | `pull_request_target` | Closes PRs from anyone not listed in herdr's `APPROVED_CONTRIBUTORS`. |
| `ci.yml`, `label-next-release-issues.yml`, `website-deploy.yml` | push to `master` | These are dormant today, because our default branch is `main`. |

Fix: move the upstream workflows out of `.github/workflows/` into
`.github/upstream-workflows/`, where GitHub does not run them but the content is kept
for later upstream merges. Add our own workflows instead. Until then, **release tags
use the `desktop-v*` prefix**. It matches no upstream trigger.

Risk: upstream merges that touch `.github/workflows/` conflict. Resolve them by
keeping ours and refreshing the copy in `upstream-workflows/`.

## 3. macOS port (code)

The work is concentrated in 9 Rust files (12 `cfg(windows)` sites) and the keyboard
layer. The renderer, sidebar, tabs, agent list, themes, and Setup UI do not change.

| Area | macOS behaviour | Where |
|---|---|---|
| herdr socket path | Unix socket under herdr's config dir: `$XDG_CONFIG_HOME/herdr` or `~/.config/herdr` (`src/config/io.rs:13-39`), with sessions under `sessions/<name>/`. The same precedence as herdr's `socket_paths.rs`. | `socket.rs`, `conn.rs` (the `interprocess` crate already supports Unix sockets) |
| Engine detection | `HERDR_BIN` → `~/.local/bin/herdr` (herdr's `install.sh` default, `distribution/install.sh:6`) → `PATH`. | `engine.rs` |
| Engine install | Bundle the pinned mac binary: `herdr-macos-aarch64` / `herdr-macos-x86_64` for 0.9.1, which are **bare binaries, not zips** (`distribution/latest.json`). Pick the one for the current architecture, re-verify its SHA-256, and install it to `~/.local/bin/herdr` (mode 755), the same layout as `install.sh`. Do not pipe `install.sh`; it downloads. | `engine.rs`, `build.rs`, the fetch script (per-arch pins) |
| Server start | Spawn `herdr server` in its own session (`setsid` via `pre_exec`, stdio to /dev/null) so it outlives the app. There are no creation flags. | `engine.rs` |
| Settings and logs | `~/Library/Application Support/herdr-gui/` and `~/Library/Logs/herdr-gui/`. | `settings.rs`, `lib.rs` |
| Claude usage tap | `herdr-usage.sh` (POSIX sh + `python3` or `jq`, whichever exists; nothing if neither). `statusLine.command` = `sh "<abs path>"`. The chain sidecar and the backup/undo logic are shared. | `statusline.rs`, resources |
| Window chrome | Native traffic lights with `titleBarStyle: "Overlay"` and a hidden title. Keep our in-window menu bar, or move menus to the **macOS menu bar** through the Tauri menu API (decision D2). | `window_chrome.rs`, `tauri.conf.json` (macOS section) |
| Memory saving | WebView2's memory-target API does not exist on WKWebView. Keep the paint pause while hidden. | `memory.rs` (cfg-gated no-op) |
| Fonts | `"SF Mono", Menlo, Monaco` before Cascadia. | theme and renderer font stack |
| Single instance / autostart / notifications / dialog | The Tauri plugins support macOS. For autostart, use a LaunchAgent. | config only |
| Toasts | A Notification Center permission prompt appears on first use. | none |

## 4. Keyboard on macOS

Option+digit and Option+letter **type characters** on a Mac, and Cmd is the app
modifier. So the shortcut table gets a per-platform modifier:

| Windows | macOS |
|---|---|
| Ctrl+Shift+T / W | Cmd+T / Cmd+W |
| Alt+1…9 (tab N) | Cmd+1…9 |
| Ctrl+Shift+1…9 (workspace N) | Cmd+Option+1…9 |
| Ctrl+Tab / Ctrl+Shift+Tab | Cmd+Shift+] / Cmd+Shift+[ (and Ctrl+Tab) |
| Alt+` (last tab) | Ctrl+` |
| Ctrl+Shift+E / J / A / B / / | Cmd+Shift+E / J / A / B / / |
| Alt+Shift+= / - (split) | Cmd+D / Cmd+Shift+D (iTerm2 convention) |

Terminal apps never see Cmd (it is not sent through a PTY), so Cmd shortcuts are
conflict-free. **Every Ctrl+ key still goes to the terminal.** The shortcuts table
becomes `{win, mac}` per entry, with a test that no mac entry uses plain Option+key.

## 5. Build and CI

- `.github/workflows/desktop-release.yml`, on tag `desktop-v*`, runs two jobs:
  - `windows-latest`: `npm ci`, `npm run check`, `npm run package`, then upload
    `Herdr Desktop.exe`.
  - `macos-latest` (arm64 runner, cross-builds x86_64):
    `rustup target add x86_64-apple-darwin`, `npm ci`, `npm run check`, then
    `tauri build --target universal-apple-darwin --bundles app,dmg`, then upload the
    `.dmg` (and the zipped `.app`).
  - A final job creates the GitHub Release for the tag and attaches both artifacts
    with generated notes.
- `.github/workflows/desktop-ci.yml`, on PRs and pushes to `main` that touch `gui/`,
  runs `npm run check` on Windows and macOS.
- Engine payloads are fetched per platform and SHA-verified in CI, as today.
- **Signing:**
  - Windows stays unsigned by user decision until the app is shared.
  - macOS is unsigned by default: document the "right-click → Open" or `xattr -dr
    com.apple.quarantine` step.
  - Optional signing and notarization need an Apple Developer account (US$99/year).
    Its secrets (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`)
    go into the job's env. `tauri-action` supports them.

## 6. Decisions for the user (defaults in brackets)

- **D1:** Apple Developer signing and notarization now, or unsigned first? [Unsigned
  first.]
- **D2:** Menus on macOS: the native macOS menu bar (Mac-like; the in-window bar
  hidden on Mac), or the same in-window menu bar as Windows? [The native menu bar.]
- **D3:** Minimum macOS version? [macOS 12 Monterey; WKWebView features used by the
  renderer are fine there.]
- **D4:** Move the upstream workflows out of `.github/workflows/`? [Yes, before the
  first release tag.]

## 7. Slices (independently mergeable)

1. Neutralize the upstream workflows (§2), then add `desktop-release.yml` building
   **Windows only**. This immediately replaces manual releases.
2. Cross-platform paths and connection (§3 socket, settings, logs). This is
   compile-time `cfg`, with no behaviour change on Windows.
3. Mac engine bundle, install, and server spawn (§3 engine).
4. Mac window chrome, menus, fonts, and the keyboard table (§3, §4).
5. The Mac usage tap (`herdr-usage.sh`).
6. Add the macOS job to CI and produce the universal `.app`/`.dmg`, then an
   end-to-end check on a Mac (or a macOS runner with a smoke test that launches the
   app, connects to a headless herdr, and captures a screenshot).

## 8. Risks

- **No local Mac:** live verification depends on CI runners. UI polish on macOS
  (font metrics, traffic-light spacing, Retina DPR 2) needs at least one human look.
  Plan a screenshot artifact from CI.
- **The universal build** doubles the Rust compile time on the runner (about
  15–25 minutes per release).
- **Unsigned `.app`:** Gatekeeper friction for others. It is fine for personal use.
- **herdr's macOS server spawn semantics** (launchd vs setsid) are not verified.
  Read herdr's own `spawn_server_daemon` on Unix before implementing.
- **Upstream merges** touching `.github/workflows/` and `README.md` will conflict.
  Keep ours.
