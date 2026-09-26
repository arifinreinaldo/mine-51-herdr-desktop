# herdr GUI — Phase 1.6 plan: installer + first-run provider setup

Status: PLAN ONLY (Opus). Nothing here is built or scheduled. The next step is a
spec that goes through the usual pipeline, and only when the user asks for it.
Research source: the installer/onboarding research brief, with its key claims
re-checked against the source (cited below).

## 1. User decisions (settled)

- **Provider = agent CLI** (Claude Code, Codex, OpenCode, Copilot, Cursor,
  Gemini…). Each CLI signs in through its own login. The GUI never reads, stores,
  or forwards provider tokens.
- **Missing CLIs:** the wizard installs them for the user, in a **visible herdr
  pane**, after explicit consent per provider.
- **Bundle herdr** with the GUI installer.

## 2. Architecture

### 2.1 One herdr install, not a second copy

- The GUI installer (NSIS, `currentUser`, no admin; `tauri.conf.json` already
  targets `nsis`) carries the **fork-built herdr release package** as a bundled
  resource.
- On first run, the GUI installs that package through herdr's own per-user
  installer: `distribution/install.ps1 -LocalPackagePath … -LocalPackageFormat …
  -LocalPackageIdentity … -LocalPackageSha256 …` (the parameters are verified at
  `install.ps1:2-34`). It installs herdr into the standard layout
  (`%USERPROFILE%\.herdr\packages\standalone\releases\<ver>-<triple>\`) and
  handles the PATH, the `current` junction, and release retention. So there is
  **one** herdr on disk, which terminals, agent hooks, and the GUI all share.
- If a herdr install already exists, compare versions. An older herdr is upgraded
  only with the user's OK. A same or newer version is kept.
- Agent hooks inside herdr panes already find herdr through `HERDR_BIN_PATH`
  (`src/integration/env.rs:31`). Being on PATH matters only for shells outside
  herdr, and install.ps1 handles that.

### 2.2 Server start (fork change: one small CLI verb)

- **Do not** use a Tauri sidecar. Sidecars get killed or orphaned across updates
  and need shell permissions the GUI does not grant.
- Add `herdr server --detach` to the fork. It calls the existing
  `spawn_server_daemon()` + `wait_for_server_socket()`
  (`src/server/autodetect.rs:194,252`) and exits 0 when the server is ready.
  - This reuses herdr's Windows detach logic. When the caller runs inside a
    kill-on-close job object, that logic falls back to WMI `Win32_Process.Create`
    (`src/platform/windows.rs:1199-1270,1349`), so the server outlives the GUI.
    Reimplementing it in the GUI would miss that case.
- **The GUI on launch:**
  1. Probe the client pipe with the handshake it already does. Never check the
     `.sock` marker file.
  2. If nothing answers, run `herdr server --detach`.
  3. Connect.
- **Server lifetime:** closing the GUI leaves the server and the agents running.
  herdr menu ▸ Stop Server is explicit and asks for confirmation.
- **Start at login (optional toggle):** it launches the **GUI**, through
  `tauri-plugin-autostart` or an HKCU Run key, and the GUI starts the server on
  demand. **Never a Windows service:** Session 0 cannot host the user's PTYs or
  agent CLIs.

### 2.3 Updates

- **Problem (verified):** `herdr update` uses hard-coded upstream manifests
  (`src/update.rs:25-26`, `https://herdr.dev/latest.json`). A fork build that
  self-updates would replace itself with **upstream** and lose the fork changes.
- **Options** (a user decision, see §5):
  1. **Fork release channel:** make the manifest URL a build-time setting
     (`option_env!("HERDR_UPDATE_MANIFEST_URL")`, defaulting to upstream). Fork
     releases publish their own `latest.json` on the fork's GitHub Releases. This
     is about 1 core file plus the release tooling.
  2. **Disable self-update in fork builds.** A build flag makes `herdr update`
     print "updates come from the herdr GUI installer". The GUI installer becomes
     the only updater. This is about 1 core file.
- **GUI updates:** `tauri-plugin-updater` (Minisign-signed) against the fork's
  releases. The GUI updater also ships the matching herdr package and re-runs
  install.ps1, so the GUI and herdr always come from the same commit. Protocol
  gen-1 is frozen, but same-commit shipping removes the skew question entirely.

### 2.4 Uninstall

- Remove GUI-owned files only.
- **Never** touch `%APPDATA%\herdr` (sessions and config), `%APPDATA%\herdr-gui`
  (settings and themes), or `~/.claude`.
- herdr itself stays installed unless the user ticks "also uninstall herdr".
  That runs herdr's own removal and never deletes directories blindly (install.ps1's
  `Set-ManagedJunction` ownership checks are the pattern to follow).

## 3. First-run wizard

This is a VS Code-style walkthrough: a checklist with live completion state. Every
step can be skipped. It reopens from herdr menu ▸ Setup Providers….

1. **herdr engine:** "Installing herdr 0.9.x (fork)…" runs silently with a
   progress bar. It shows the detected existing install and the version decision.
2. **Providers:** one card per supported agent, with the top six expanded first
   (Claude Code, Codex, OpenCode, Copilot CLI, Cursor CLI, Gemini CLI). The other
   12 herdr integrations sit behind "More".
   - **Detect:** check the binary on PATH plus `--version`: `claude`, `codex`,
     `opencode`, `copilot`, `cursor-agent` (**not** `agent`, which collides),
     and `gemini`.
   - **Install** (consent per card): the official command runs in a visible pane.
     - Claude: `irm https://claude.ai/install.ps1 | iex`, the native installer,
       which needs no Node.
     - Codex: `npm i -g @openai/codex`, which needs Node ≥ 22.
     - OpenCode: `npm i -g opencode-ai`.
     - Copilot: `npm i -g @github/copilot`, which needs Node ≥ 22.
     - Cursor: `irm 'https://cursor.com/install?win32=true' | iex`.
     - Gemini: `npm i -g @google/gemini-cli`.

     **Prerequisite check:** if Node ≥ 22 is missing for an npm-based CLI, offer
     `winget install OpenJS.NodeJS.LTS` first, with the same consent pattern. Show
     the exact command before it runs.
   - **Connect to herdr:** `integration.install {name}` (on the GUI's allowed
     methods list). It is reversible through `herdr integration uninstall`. Show
     the files it will touch, such as `~/.claude/settings.json` hooks; they are
     JSONC-merged and versioned (`src/integration/claude_settings.rs`).
   - **Sign in:** open a pane that runs the provider's own login: `claude` (then
     `/login`), `codex login`, `opencode auth login`, `copilot login`,
     `cursor-agent login`, or `gemini`. Mark the step done when the pane exits
     with 0, or when the user clicks "I've signed in".
3. **Claude usage bar (only if Claude is selected):**
   - Read `~/.claude/settings.json` `statusLine` first.
   - **Empty:** offer to install the tap (`herdr-usage.py`).
   - **Taken by another tool:** show which tool. Offer to *chain* it: our wrapper
     writes the usage file, then calls the existing command with the same stdin.
     Never overwrite it silently.
   - Always back up the settings file before writing, and show "Undo".
4. **First workspace:** the folder picker, then an optional "start <default agent>
   here" that opens a tab running `claude` / `codex` / ….
5. **Done:** a summary of what was installed and changed, each item with an undo
   link.

## 4. Implementation slices (each one independently shippable)

1. **Fork core:** `herdr server --detach` + the update-channel decision (§2.3) +
   tests.
2. **GUI:** server auto-start on launch, herdr menu ▸ Stop Server, and the
   start-at-login toggle.
3. **Packaging:** the NSIS config (currentUser, WebView2 `downloadBootstrapper`,
   icons, identifier, AppUserModelID for toasts), the bundled herdr package, the
   first-run install through install.ps1, and the uninstall hooks.
4. **Wizard:** provider cards (detect, install, connect, sign in), prerequisites,
   and a re-run entry point.
5. **Usage-tap installer:** the statusLine detect, chain, backup, and undo flow.
6. **Signing and updates:** Azure Trusted Signing (about US$10/month; individuals
   are eligible) and the GUI updater with a Minisign key.

Slices 1–2 are useful on their own, even without an installer.

## 5. Decisions (the user delegated these to Opus, 2026-09-26)

1. **Updates: option 2.** Disable self-update in fork builds (`herdr update`
   prints "updates come from the herdr GUI installer"). The GUI updater is the
   **only** updater, and it ships the GUI and herdr from the same commit. Option 1
   (a fork release channel) is added only if a CLI-only user of the fork appears.
2. **Existing herdr:** the wizard replaces it with the fork build after one
   confirmation. install.ps1 keeps previous releases, so rolling back means
   switching the `current` junction. herdr menu ▸ About shows which build is
   active.
3. **Code signing:** unsigned while the app is for the user only. Add Azure Trusted
   Signing before the app is shared with anyone else.
4. **Providers:** the top 6 cards up front (Claude Code, Codex, OpenCode, Copilot
   CLI, Cursor CLI, Gemini CLI), with the other 12 herdr integrations behind
   "More".

## 6. Risks and how this plan could be wrong

- The need for WMI detach comes from herdr's own code, not from a reproduced
  failure. If a Tauri-launched process is never in a kill-on-close job, plain
  `DETACHED_PROCESS` would suffice. The new verb works either way.
- The provider install commands and minimum Node versions change often. The
  wizard should load them from a small, updatable table, not hard-code them.
- The per-user PATH that install.ps1 writes needs a new shell (or a
  `WM_SETTINGCHANGE` broadcast, which install.ps1 does) before `herdr` resolves in
  already-open terminals.
- Anthropic's consumer-token rule (Feb 2026) is the reason the GUI never handles
  Claude tokens. Re-read the current legal page before shipping anything that
  touches Claude authentication.
- `statusLine` is a single-owner setting. Chaining depends on the other tool
  tolerating being called through a wrapper. Most tools only read stdin, but
  this is unverified per tool.
