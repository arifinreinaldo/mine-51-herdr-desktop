# herdr GUI — Phase 1.6 spec: installer `.exe`, engine management, first-run setup

Status: v2 (Opus, revised after the Fable review: 6 major and 11 minor findings
applied). Ready to execute.
Plan: `gui/docs/phase1_6-plan.md` (the decisions in §5 stand). This spec is the
**test-drive cut** of that plan. The user will install the `.exe` on a work
machine.

## 0. Scope change from the plan (user decision, 2026-09-26)

- The installer bundles the **official upstream herdr 0.9.1** Windows release
  zip, not a fork build. This machine has no Zig 0.16 or .NET SDK, and the fork
  does not differ from upstream yet. The GUI is already live-tested against 0.9.1.
- **Deferred** to the phase in which the fork diverges from upstream: the fork core
  changes (`herdr server --detach`, disabling self-update, the fork version label).
  Until then, **no file outside `gui/` changes in this phase.**
- **Memory footprint** is an explicit goal (§6).

## 1. Success criterion

1. `cd gui && npm run check` exits 0 (3 runs in a row).
2. `npm run package` produces
   `gui/target-agent/release/bundle/nsis/herdr_<ver>_x64-setup.exe`.
3. The main session installs that `.exe` on this machine (after the user agrees),
   launches it, and checks the following:
   - The engine step detects the already-installed herdr 0.9.1 and skips the
     install.
   - The GUI starts the default herdr server if one is not running.
   - The wizard lists the providers.
   - The usage-tap step detects the existing tap.
   - The memory script (§6.4) reports numbers within the budgets.
4. A clean-machine path is covered by tests and by a dry-run mode (§2.5), because
   a second machine is not available until the user's test drive.

## 2. Packaging

### 2.1 Bundled herdr package (pinned)

- The pin file `gui/packaging/herdr-package.json` holds:
  ```json
  {"version":"0.9.1",
   "url":"https://github.com/herdrdev/herdr/releases/download/v0.9.1/herdr-windows-x86_64.zip",
   "sha256":"04ce380cac5af27bfcf75d0951ac49b7afe4c984aee8852985806d4f71f93a6e"}
  ```
  The values come from `distribution/latest.json` (`releases."0.9.1"`) in this
  repository.
- `gui/scripts/fetch-herdr-package.mjs` downloads the URL into
  `gui/src-tauri/resources/herdr/herdr-windows-x86_64.zip`, verifies the SHA-256,
  and **fails the build** on a mismatch. It skips the download when a verified
  file already exists.
- The same script copies `../distribution/install.ps1` to
  `src-tauri/resources/herdr/install.ps1`. install.ps1 is herdr's own per-user
  installer. Its local mode needs no network (`install.ps1:24-37,761-837`).
- `tauri.conf.json` sets `bundle.resources: ["resources/herdr/*",
  "resources/statusline/*"]`, in list form. On Windows the resource dir is the
  exe dir. Resolve paths with
  `app.path().resolve("resources/herdr/install.ps1", BaseDirectory::Resource)`.
  Gitignore the whole `src-tauri/resources/herdr/` folder, including the copied
  install.ps1.

### 2.2 Installer (NSIS)

- Config: `bundle.targets: ["nsis"]`, `bundle.windows.nsis.installMode:
  "currentUser"` (no admin), `bundle.windows.webviewInstallMode:
  {"type":"downloadBootstrapper","silent":true}`.
- The install directory is `$LOCALAPPDATA\<productName>`. The exe stays
  `herdr-gui.exe`, because `mainBinaryName` is not set; §6.4 relies on that
  name.
- Set `productName: "herdr"` and a stable `identifier`. The identifier also
  becomes the AppUserModelID that toasts use.
- The installer creates a Start menu shortcut and **offers** a desktop shortcut
  (a finish-page checkbox, on by default). NSIS stamps the `identifier` onto both
  `.lnk` files as the AppUserModelID, and `tauri-plugin-notification` uses that
  same `identifier`. Use the
  existing `src-tauri/icons/*`; replacing the placeholder art is out of scope.
- **Uninstall** removes only the GUI's own files. It never touches
  `%APPDATA%\herdr`, `%APPDATA%\herdr-gui`, `%USERPROFILE%\.herdr`, or `~/.claude`.
  Uninstalling herdr itself is not offered in this phase. (The Tauri uninstaller's
  "delete app data" option removes only `%APPDATA%\<identifier>` and
  `%LOCALAPPDATA%\<identifier>`, the WebView2 profile. GUI settings live in
  `%APPDATA%\herdr-gui`, so the rule holds with no extra work.)
- `npm run package`:
  1. runs `fetch-herdr-package.mjs`;
  2. runs `tauri build` (release, bundled) through a node script,
     `scripts/package.mjs`. The script sets `CARGO_TARGET_DIR` to the
     **absolute** `path.resolve(guiRoot, 'target-agent')`, because tauri-cli runs
     cargo from `src-tauri`, so a relative path would land in
     `src-tauri/gui/target-agent`. It also sets **`CARGO_BUILD_JOBS=2`** to cap
     the peak build memory; this machine runs close to its RAM limit.
  3. The bundle lands at
     `<target-agent>/release/bundle/nsis/herdr_<ver>_x64-setup.exe`.
  4. The **first** build downloads the NSIS toolchain (`nsis-3.11.zip` and
     `nsis_tauri_utils`) into `%LOCALAPPDATA%\tauri\NSIS`, so it needs network
     access.
- Updates: none in this phase. A new installer is installed over the old one.

### 2.3 Release profile

`gui/Cargo.toml` already sets `lto=true`, `codegen-units=1`, `opt-level=3`,
`strip=true`, and `panic="abort"`. Keep these. Do not switch to `opt-level="s"`,
because the renderer and the decoder need speed. Binary size is not the memory
problem (§6).

## 3. Engine management (Rust, new module `engine.rs`)

### 3.1 Locate herdr

Resolve the herdr binary in this order:

1. The env var `HERDR_BIN`.
2. `%LOCALAPPDATA%\Programs\Herdr\bin\herdr.exe`, the visible junction that
   install.ps1 creates (`install.ps1:726-731`).
3. `herdr.exe` on `PATH`.

Run `<bin> --version` with a 3 s timeout and `CREATE_NO_WINDOW`. Parse the
semver. The result is one of `Missing`, `Found{path, version}`, or
`Broken{path, error}`.

### 3.2 Install or upgrade

- The engine needs an install when it is `Missing`, when it is `Broken`, or when
  `version < bundled version`. A same or newer version is kept and never
  downgraded.
- **The install needs explicit consent in the wizard.**
- Run: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` (absolute
  path) with `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File
  <res>\install.ps1 -LocalPackagePath <res>\herdr-windows-x86_64.zip
  -LocalPackageFormat zip -LocalPackageIdentity <pin.version>
  -LocalPackageSha256 <pin.sha256>`, with `CREATE_NO_WINDOW`.
- Stream stdout and stderr lines to the wizard log. A non-zero exit fails the
  step and shows the last 20 lines.
- **Counterintuitive:** install.ps1 updates `PATH` in the registry, but not in the
  GUI's own process. After the install, resolve the binary through step 3.1(2),
  the junction path, not through `PATH`.

### 3.3 Server lifecycle

- **Probe:** reuse the reconnect loop's existing connect-and-hello (2 s timeout,
  `dispatch.rs:80-115`, `conn.rs:236`). Never test the `.sock` marker file.
- **One entry point:** one `ensure_server_started()` holds the start-once guard.
  The reconnect loop's `Err` arm and wizard step 1 both use it.
- **Start when down:** spawn `<bin> server` with creation flags
  `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB`. This
  matches herdr's own daemon (`src/platform/windows.rs:1374`). Headless mode never
  reads stdin or enters raw mode (`src/server/headless.rs:4`). If CreateProcess fails with access denied, the job
  forbids breakaway, so retry without `CREATE_BREAKAWAY_FROM_JOB` and log it.
  Stdio goes to null. Then probe every 250 ms, for up to 15 s.
  - The server must **outlive the GUI**. A GUI launched from Explorer or the Start
    menu runs in no kill-on-close job, so a detached child survives. (herdr's own
    WMI fallback, `src/platform/windows.rs:1199-1270`, is the deferred fork
    improvement for the rare job case.)
  - **Environment:** pass through the GUI's environment. Set
    `HERDR_SESSION` only when the GUI itself was started with it; that keeps the
    tests on `gui-test`. Never inject provider tokens.
- **Auto-start:** the reconnect loop uses probe → start → connect. It starts the
  server **once** per launch. After that, a server that went down shows the
  existing banner plus a "Start herdr" button, never a silent restart loop.
- **herdr menu ▸ Stop Server…** asks for confirmation ("N agents running will stop")
  and then runs `<bin> server stop`. It is an API request, so pass the GUI's
  `HERDR_SESSION`/`HERDR_SOCKET_PATH` env (`gui/src-tauri/src/socket.rs`).
- **herdr menu ▸ Start at Login ✓** uses `tauri-plugin-autostart` (HKCU Run) to
  launch the **GUI** at login. The server starts on demand. Never register a
  Windows service.

### 3.4 Tests (Rust)

- Semver compare and the upgrade decision table.
- Binary resolution order, using a fake filesystem or dependency injection.
- The install.ps1 argument builder, with exact args and paths that contain spaces.
- The creation-flags fallback on access denied, through an injected spawner.
- The once-per-launch start guard.

## 4. First-run wizard

- **Trigger:** `settings.firstRunComplete !== true`, or herdr menu ▸ Setup….
- **Shape:** a full-window overlay using the VS Code walkthrough pattern. The left
  column lists the steps with their completion state; the right side shows the
  active step. Every step can be skipped. "Finish later" closes the wizard and
  keeps `firstRunComplete=false` until the Done step. It uses the theme tokens
  and matches the Phase 1.5 look.

### 4.1 Step 1 — herdr engine

- Show the result of §3.1: "herdr 0.9.1 found at …" (step complete), or "herdr
  is not installed" with an [Install herdr 0.9.1] button (§3.2) and a live log.
- Then run the server start (§3.3) and show "Server running".

### 4.2 Step 2 — Agent providers

- **Data source:** `integration.list {}`. It is on the client-shell list.
  - Each `IntegrationInfo` has `{target, label, command, available: bool, state:
    not_installed|current|outdated}`.
  - `available` means the agent CLI is on PATH. `state` is herdr's hook
    integration.
  - `target` values are **snake_case** (`"claude"`, `"opencode"`,
    `"antigravity_cli"`): `IntegrationTarget` has `rename_all = "snake_case"`
    (`src/api/schema/integrations.rs:31`, the same in v0.9.1). Match cards by these
    strings, and send them back verbatim.
- **Cards:** the top 6 are expanded, in this order: `claude`, `codex`,
  `opencode`, `copilot`, `cursor`, and Gemini. Gemini is not a herdr target, so
  its card has no "Connect" action, and the GUI detects it with a fixed
  `gemini --version`. The rest go behind "More (N)".
- **Per card:**
  - **Detected / Not installed**, from `available`.
  - **[Install…]** (only when it is not installed):
    1. Show the exact command from the provider table (§4.2.1) and ask for
       consent.
    2. Run `tab.create {focus:true, label:"install <provider>"}` in the focused
       workspace. Wait (≤ 2 s) for the snapshot to report the new tab's
       `focused_pane_id`.
    3. Wait for that pane's first surface frame (shell startup), with a 5 s cap.
       The `tab.create` result key is not confirmed; grep `Method::TabCreate` in
       `src/api/server.rs` to find it.
    4. Type the command into that pane through the **existing input path**
       (`ClientShellPaneInput`: `TextCommit(command)`, then `Key Enter`). The GUI
       has no `pane.send_text` on the client-shell list, but this is exactly how
       the user's own typing travels. The user watches it run.
    5. While the wizard is open, poll `integration.list` every 5 s until the card
       turns `available`. There is also a [Re-check] button.
  - **[Connect to herdr]** (when it is available and `state != current`):
    `integration.install {target}`. Show the `details.messages`. Say plainly that
    this adds herdr hooks to the provider's settings and that it is reversible
    with `herdr integration uninstall <name>`.
  - **[Sign in]:** open a new tab and type the provider's login command (§4.2.1).
    Mark the card done when the user clicks "I've signed in". The GUI never reads
    tokens.
- **Node prerequisite:** providers installed through npm need Node ≥ 22 (Codex,
  Copilot), ≥ 20 (Gemini), or ≥ 18 (OpenCode). This machine has Node 20.10, so the
  Codex and Copilot cards offer the upgrade.
  - A Rust command `node_version()` runs `node --version`. It is a fixed command
    with no user input.
  - If Node is missing or too old, the card first offers `winget install --id
    OpenJS.NodeJS.LTS -e`, with the same consent-then-type-in-a-pane flow.
  - Say that a newly opened tab is needed afterwards, because `PATH` changes.

#### 4.2.1 Provider table (`gui/src/wizard/providers.ts`, data only)

| Card | herdr target | Detect | Install (Windows) | Sign in |
|---|---|---|---|---|
| Claude Code | claude | `claude` | `irm https://claude.ai/install.ps1 \| iex` | `claude` (then `/login`) |
| Codex | codex | `codex` | `npm install -g @openai/codex` | `codex login` |
| OpenCode | opencode | `opencode` | `npm install -g opencode-ai` | `opencode auth login` |
| Copilot CLI | copilot | `copilot` | `npm install -g @github/copilot` | `copilot` (then `/login`) |
| Cursor CLI | cursor | `agent` (herdr's own `available` checks `cursor`, `src/integration/registry.rs:24`) | `irm 'https://cursor.com/install?win32=true' \| iex` | `agent login` |
| Gemini CLI | — | `gemini` | `npm install -g @google/gemini-cli` | `gemini` |

For herdr targets the card's `available` comes from herdr, never from the
Detect column. The column is for humans and for Gemini.
The table is data, not logic. Commands change often, so they live in one file.
Each row has a `source` URL comment. The rows come from the Phase 1.6 research
brief. The executor must not invent a command that is not in this table.

### 4.3 Step 3 — Claude usage bar (shown only when Claude is available)

- **Read** `~/.claude/settings.json` with a Rust command. Parse it with
  `serde_json`. If parsing fails, abort this step with a message and never write.
  Classify `statusLine.command` as one of these:
  - `none`
  - `herdr` (contains `herdr-usage`, i.e. already installed)
  - `other` (show the command, truncated to 120 characters)
- **Self-contained tap:** it needs no Python, because the work machine may not
  have it.
  - Ship `resources/statusline/herdr-usage.ps1`. **It must run under Windows
    PowerShell 5.1.**
  - **Read stdin as bytes:** `$ms=[IO.MemoryStream]::new();
    [Console]::OpenStandardInput().CopyTo($ms); $bytes=$ms.ToArray()`. Decode
    with `[Text.UTF8Encoding]::new($false)` for parsing only. Do not use
    `$input` or `[Console]::In`: under 5.1 they decode with the console code
    page.
  - **Write** `{"captured_at":<epoch s>,"rate_limits":{…}}` to
    `~/.claude/herdr-usage.json`. That is the same shape as the existing tap
    and `gui/src-tauri/src/usage.rs`. Write a temp file with
    `[IO.File]::WriteAllBytes`, then commit it with
    `[IO.File]::Replace($tmp,$out,$null)` when `$out` exists, else
    `[IO.File]::Move`. (`Move-Item -Force` is not atomic.)
  - **Chain:** if `~/.claude/statusline/herdr-usage.chain.txt` exists, read its
    single line and run it with `System.Diagnostics.Process`
    (`cmd.exe /d /s /c "<line>"`, stdin and stdout redirected). Write the
    **raw stdin bytes** to the child, then copy the child's stdout bytes to
    `[Console]::OpenStandardOutput()`. With no chain file, print nothing.
  - The whole body sits in `try{}catch{}` and ends with `exit 0`. It never
    throws.
- **[Install] with consent:**
  1. Copy the script to `~/.claude/statusline/herdr-usage.ps1`.
  2. Back up `settings.json` to `settings.json.herdr-backup-<yyyyMMddHHmmss>`
     (unique name).
  3. When the class was `other`, write the previous command verbatim to
     `~/.claude/statusline/herdr-usage.chain.txt`.
  4. Set `statusLine = {"type":"command","command":"powershell -NoProfile
     -NonInteractive -ExecutionPolicy Bypass -File <abs path with forward
     slashes>"}`. Claude Code runs status lines through **Git Bash** when it is
     installed, and that eats backslashes (code.claude.com/docs/en/statusline,
     "Windows configuration"). No `-Chain` argument and no nested quotes.
  5. Write atomically, and keep **every other key and the key order unchanged**
     (§7 `preserve_order`), with 2-space indentation. Claude Code settings are
     strict JSON, where comments are a syntax error, so `serde_json` is the right
     parser.
- **[Undo]:** restore the newest `herdr-backup` file and delete the chain
  sidecar.
- **Exception to Phase 1 §8:** this step is the only code allowed to write
  `~/.claude/settings.json` or `~/.claude/statusline/`, and only after an explicit
  click. It never reads `.credentials.json`.

### 4.4 Step 4 — First workspace

This is the existing New Workspace… flow (the folder picker plus dedup). Then an
optional "Start <first connected provider> here" types the provider's command into
the new workspace's pane.

### 4.5 Step 5 — Done

Show a summary list of what was installed or changed, with an Undo link where one
exists (the usage tap). Set `firstRunComplete=true`.

## 5. Security

- **Commands the GUI runs:** only fixed commands built in Rust from the pinned
  data, namely `herdr --version`, `herdr server`, `herdr server stop`, the
  install.ps1 invocation, and `node --version`. The webview never passes a command
  string to Rust.
- **Commands typed into panes:** only table rows, and only after consent. They
  are visible to the user in the pane.
- **Settings edits:** JSON parsed and re-serialized (no string splicing), with a
  backup and an atomic write.
- **Downloads:** the only download is the build-time herdr zip, checked against
  the pinned SHA-256. At runtime the GUI downloads nothing itself. The provider
  installers download inside the user's visible pane.

## 6. Memory footprint (release)

1. **WebView2 memory target:** when the window is minimized or hidden, set
   `ICoreWebView2_19::SetMemoryUsageTargetLevel(LOW)`; restoring the window sets
   `NORMAL`. Reach it with
   `webview.with_webview(|w| w.controller().CoreWebView2()?.cast::<ICoreWebView2_19>())`.
   Add `webview2-com = "0.38"` (Windows only), the version wry resolves, so there
   is no second copy. Do not mix it with `TrySuspend`.
2. **No painting while minimized:** stop scheduling rAF paints while
   `document.hidden` or minimized. Keep applying frames to the mirror, then do one
   full paint on restore. (Do **not** release the glyph atlas: it is ≤ about
   4.5 MB, so it is not worth the code.)
3. **Browser arguments:** set `app.windows[].additionalBrowserArgs`. It
   **replaces** wry's default string, so include that default verbatim:
   `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`
   (`wry-0.55.1/src/webview2/mod.rs:294-297`). The
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` env var is **appended** by WebView2,
   so debugging keeps working. and add `--disable-background-networking --disable-component-update
   --disable-sync --disable-default-apps --no-first-run`. Do not disable the GPU:
   the canvas needs it. The `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` env var used
   for debugging must keep working.
4. **Measurement:** `gui/scripts/measure-memory.ps1` sums the private bytes and
   the working set of `herdr-gui.exe` plus its `msedgewebview2.exe` descendants.
   It walks the tree with `Get-CimInstance Win32_Process` (`ParentProcessId`,
   `PrivatePageCount`), because `Get-Process` has no parent PID. It reports the
   herdr **server** (about 110–130 MB private) as a separate line, **outside**
   the budget. It samples:
   - idle, 10 s after startup;
   - after `Get-ChildItem -Recurse C:\Windows\System32 | Select -First 3000` runs
     in the pane;
   - 30 s after minimizing.

   It prints a table. **Provisional budgets** (report the actual values; a miss is
   a finding, not a failure to hide):
   - idle private ≤ 260 MB (a bare WebView2 host already takes about 225 MB on
     this machine);
   - minimized after 30 s ≤ 120 MB;
   - no growth > 10% across 3 repeats of the output burst.

   The main session runs it on the installed release build.

## 7. Dependencies (new)

- Rust: `tauri-plugin-autostart = "2"` (resolves 2.5.1; not the 3.0 alpha),
  `webview2-com = "0.38"` (Windows only), and
  `serde_json = { version = "1", features = ["preserve_order"] }` (so
  settings.json keeps its key order). Use `windows`/`windows-sys` only if they are already in
  the tree, for the creation flags.
- No npm additions.

## 8. Do NOT

- **Touch anything outside `gui/`.** `distribution/install.ps1` is only **read**
  and copied by the fetch script at build time.
- **Change `~/.claude/**`**, except in §4.3's consented flow. Tests use a temp
  HOME.
- **Contact the user's default herdr session from tests.** Tests use fakes, and
  the live check is the main session's job.
- **Run the installer, install herdr, or install providers.** The executor never
  runs `npm run package` output, install.ps1, winget, or npm installs. It builds
  and tests only. `npm run package` may be run to prove the bundle builds; its
  output is **not executed**.
- **Commit.**

## 9. Tests (added to `npm run check`)

- **Rust:** everything in §3.4, plus:
  - The statusLine classifier.
  - The settings.json edit: other keys preserved, **key order preserved**,
    backup naming, atomic write, parse failure → no write, and the chain sidecar
    written and removed on undo.
  - Pin-file parsing.
- **PowerShell:** a Pester-free test, `scripts/test-statusline.ps1`, run by
  `npm run test:ps`, **not** by check. It pipes sample JSON through
  `herdr-usage.ps1` in a temp HOME and asserts the output file. It also checks the
  chain mode with a chain file containing `more`, and the byte-exact UTF-8
  round trip of a non-ASCII payload. The main session runs it.
- **Vitest:**
  - Wizard step state machine (skip, finish later, done).
  - Provider card state from `IntegrationInfo` (every state combination),
    including snake_case targets such as `antigravity_cli`.
  - The consent gating: no command is typed before consent.
  - The "More (N)" grouping.
  - The node-version gate.

## 10. Risks

- `CREATE_BREAKAWAY_FROM_JOB` can fail under some launchers. The fallback without
  it can leave the server tied to the GUI's job there. It is logged.
- Provider install commands and Node minimums drift over time. They live in one
  data file.
- On a managed work machine, the policy can block unsigned installers or
  `ExecutionPolicy Bypass`. Code signing is deferred by the user's decision.
- The first `npm run package` downloads the herdr zip (about 10 MB) from GitHub.
  It needs network at build time only.

## 11. Addendum v3 (user decisions, 2026-09-27): portable exe, setup on demand

1. **Portable `.exe` instead of an installer.** `npm run package` produces one
   self-contained file, `gui/target-agent/release/portable/Herdr Desktop.exe`,
   built with `tauri build --no-bundle`. There is no NSIS output, and no
   shortcuts, uninstaller, or registry entries except the optional Start at Login
   Run key.
   - **Engine payload embedded.** The package script sets
     `HERDR_GUI_EMBED_ENGINE=1`. In that case, a `build.rs` in `src-tauri` copies
     the verified `resources/herdr/herdr-windows-x86_64.zip` and `install.ps1`
     into `OUT_DIR`. Without the variable (as in `npm run check` or a fresh clone
     with no zip), it writes empty placeholder files. `engine.rs` embeds them with
     `include_bytes!(concat!(env!("OUT_DIR"), …))`.
   - **At install time,** extract the two files to
     `%TEMP%\herdr-gui-engine-<pin.version>\`. Re-verify the zip SHA-256 against
     the pin before running install.ps1 exactly as in §3.2. The directory is
     deleted after the install.
   - **An empty payload** (a dev build) → engine status gets
     `installAvailable:false`, and Setup shows "This build has no bundled herdr
     engine. Install herdr from herdr.dev". It never crashes.
   - `bundle.resources` and the NSIS config are removed from `tauri.conf.json`.
     The statusline tap is already embedded with `include_bytes!`.
   - Settings and logs stay in `%APPDATA%\herdr-gui` (user choice).
2. **No first-run wizard.** The setup flow opens only from herdr menu ▸ Setup…,
   titled "Setup". Remove the auto-open on first launch (`firstRunComplete` is no
   longer read to decide that; keep the field for compatibility). The flow
   itself is unchanged.
3. **Guidance without the wizard.** When the engine status is `Missing`/`Broken`
   and the server is unreachable, the connection banner says "herdr engine is not
   installed" and offers an [Open Setup] button in place of [Start herdr]. When
   the engine is found but the server is down, it keeps [Start herdr].
4. **Single instance** (a bug found in the live check). A second launch fails to
   create its webview (`0x800700AA`, the profile is in use). Add
   `tauri-plugin-single-instance` (2.x), registered **first** in the builder: a
   second launch focuses and un-minimizes the existing window, then exits.
5. **Tests:** the payload-present and payload-absent paths (engine status
   `installAvailable`), the temp extraction and re-verification (a tampered
   payload is rejected), the banner state for Missing vs down, and a check that
   the wizard never opens on startup.
