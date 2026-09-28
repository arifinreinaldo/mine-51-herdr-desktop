# Cowbell rebrand, herdr unbundling, and licence notices — spec

Status: READY. The owner approved every decision below on 2026-09-28.
Scope: `gui/` and the root `README.md` only. Do not change herdr core (`src/`, `crates/` at the repo root).

## Decisions (do not revisit)

- The product name is **Cowbell**. The tagline is "Cowbell — a desktop for herdr".
- The new GUI code uses the licence **FSL-1.1-ALv2** (Functional Source License 1.1, Apache 2.0 future licence).
- The `.exe` does **not** bundle herdr any more. "Install herdr" runs herdr's official installer from herdr.dev.
- The icon is done: `src-tauri/icons/*` were generated from `src-tauri/icons/cowbell.svg` / `cowbell-1024.png`. Do not change the icons.

## A. Branding

Change:
1. `src-tauri/tauri.conf.json`: `productName` = `Cowbell`, `identifier` = `dev.cowbell.app`, window `title` = `Cowbell`.
2. The dynamic window title (`"<tab> — <workspace> — herdr"`, find it in `src/`): the last part becomes `Cowbell`.
3. `scripts/package.mjs`: the portable output is `portable/Cowbell.exe`. The locked-file fallback is `portable/Cowbell-<yyyyMMdd-HHmm>.exe`. Update every message and comment that names "Herdr Desktop".
4. Help menu (`src/ui/menus.ts:300`): "About herdr GUI" becomes **"About Cowbell"**. Add **"Licenses…"** under it (see D).
5. About dialog text: "Cowbell — a desktop for herdr", the version, "Licensed under FSL-1.1-ALv2. herdr is © Herdr, Inc. and contributors, Apache-2.0.", and "Cowbell is not affiliated with or endorsed by herdr or Herdr, Inc.". It also has a "Licenses…" button.
6. Root `README.md`: rename the product to Cowbell. Add install steps that state herdr is a separate install. Keep the non-affiliation line. Add the licence section (see C).

Keep unchanged (these are internal names, not branding; a move breaks users):
- The crate and lib names (`herdr-gui`, `herdr_gui_lib`) and the Cargo binary name.
- The data folders: `%APPDATA%\herdr-gui` (settings, imported themes, and the Claude usage tap file that the user's installed statusLine writes to) and `%LOCALAPPDATA%\herdr-gui\logs`. **Counterintuitive:** moving these breaks the Claude usage bar, because `~/.claude/settings.json` points the statusLine at this path.
- Everything that names the **herdr program**: the `herdr` CLI, `%APPDATA%\herdr`, the socket paths, the "herdr" menu (it controls the herdr server), and `HERDR_SESSION`.
- The historical specs in `docs/phase*.md`.

### A1. "Start at Login" migration

`tauri-plugin-autostart` writes an HKCU `...\CurrentVersion\Run` value. Its value name probably comes from the product name, so the rename orphans the old entry.
1. Read the plugin source in `~/.cargo/registry` and prove which name it uses. Cite `file:line` in your report.
2. On startup, if a Run value exists under the **old** name and points to a path that ends in `.exe`, delete it and enable autostart under the new name.
3. Do this once, silently. Add a unit test of the decision logic (pure function: old value present/absent → action).

The WebView2 profile moves with the identifier. Only conveniences in localStorage reset. This is accepted; do not migrate it.

## B. Stop bundling herdr

Remove:
- The embed path: `HERDR_GUI_EMBED_ENGINE` in `scripts/package.mjs` and `src-tauri/build.rs`, the `EMBEDDED_*` statics and SHA-256 payload verification in `src-tauri/src/engine.rs` (~:222-310, :375-395, :830-840), `packaging/herdr-package.json`, `scripts/fetch-herdr-package*.mjs`, `src-tauri/resources/herdr/`, and any `resources` entry in `tauri.conf.json`, `.gitignore` or `package.json` that exists only for them.
- The tests for the removed code.

Add:
- "Install herdr" runs exactly this, through the existing streaming runner. Keep its timeout, `CREATE_NO_WINDOW`, the breakaway fallback, and the `engine-install-log` events:
  `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "irm https://herdr.dev/install.ps1 | iex"`
  Pass it as an **argument array**. The URL is a `const` and HTTPS only. This is the command in herdr's README (`README.herdr.md:48`).
- On failure, the error notice includes the log tail and the text "See https://herdr.dev for manual install."
- The Setup/wizard copy says: "Installs herdr with its official installer from herdr.dev."
- A unit test that asserts the exact argument array.

Keep: the detection of an installed herdr (`visible_bin_dir`, `herdr --version`) and everything after the install.

## C. Licences

1. `gui/LICENSE`: the full **FSL-1.1-ALv2** text from https://fsl.software (the template for "FSL-1.1-ALv2"). Fill in Licensor `arifinreinaldo`, Software `Cowbell`, and year 2026. Fetch it; do not write it from memory.
2. `gui/crates/herdr-wire/`: add a `LICENSE` that copies the repo root `LICENSE` (Apache-2.0). Add a `NOTICE`: "Derived from herdr `src/protocol/wire.rs` and `src/protocol/endpoint.rs`. Licensed under Apache-2.0." Set `license = "Apache-2.0"` in its `Cargo.toml`.
3. `src-tauri/Cargo.toml`: `license-file = "../LICENSE"`. `gui/package.json`: `"license": "SEE LICENSE IN LICENSE"`.
4. Root `README.md` licence section:
   - The herdr fork code at the repo root is Apache-2.0 (root `LICENSE`).
   - Cowbell in `gui/` is FSL-1.1-ALv2 (`gui/LICENSE`) from this change onward. Each release becomes Apache-2.0 two years after its publication.
   - Commits before this change are Apache-2.0.
   - `gui/crates/herdr-wire` stays Apache-2.0.

## D. Third-party notices and Help ▸ Licenses

1. `scripts/gen-notices.mjs` (Node, **no new dependency**):
   - Run `cargo metadata --format-version 1 --offline --filter-platform x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml`.
   - Walk the resolve graph from `herdr-gui` over normal and build dependencies (not dev).
   - For each package, write name, version, `license`, and `repository`, plus the text of each `LICENSE*`, `LICENCE*`, `COPYING*` and `NOTICE*` file in its package directory.
   - npm: only the packages bundled into `dist/` (`@vscode/codicons` and `@tauri-apps/api`), read from `node_modules`. Include the Codicons CC-BY-4.0 credit.
   - Include herdr's Apache-2.0 text once, with the line "Cowbell talks to herdr (https://github.com/herdrdev/herdr); herdr is installed separately."
   - **Deduplicate identical licence texts.** List the packages that share a text above it. Output: `public/THIRD-PARTY-NOTICES.txt` (Vite copies `public/` to `dist/`).
   - Commit the generated file.
   - `npm run notices` runs the script. `scripts/package.mjs` runs it before the build.
2. Help ▸ **Licenses…** and the About dialog button open a modal with the existing modal pattern (see `src/ui/shortcutsModal.ts`). The modal shows:
   - a summary line on top ("Cowbell: FSL-1.1-ALv2 · herdr: Apache-2.0 · third-party notices below");
   - the fetched `/THIRD-PARTY-NOTICES.txt` in a scrollable `<pre>`.

   Esc closes it. It uses theme tokens only.

## E. Protocol note

`gui/docs/protocol-choice.md`, in ASD-STE100 style, at most one page:
- Cowbell speaks herdr's generation-1 client endpoint protocol through `crates/herdr-wire`, which copies herdr's `src/protocol/wire.rs`.
- herdr documents generation 1 as stable (`src/protocol/endpoint.rs` doc comment, and `docs/next/website/src/content/docs/socket-api.mdx` "Protocol stability").
- herdr recommends its CLI socket API for third-party bridges. Cowbell uses the endpoint protocol because it needs the composited surface stream and input with low latency.
- Risk: a future herdr can retire generation 1 only for a security reason. On a protocol mismatch, Cowbell shows its existing handshake error.

## Acceptance (run these yourself; paste the raw output)

1. `cd gui && npm run check` exits 0 (fmt, clippy -D warnings, cargo test, tsc, vitest).
2. `npm run notices` writes `public/THIRD-PARTY-NOTICES.txt`. Report its line count and package count.
3. `npm run package:fast` builds, and the result is at `target-agent/release/portable/Cowbell.exe`. The build must not need `HERDR_GUI_EMBED_ENGINE` or the herdr zip.
4. Update the default exe path in `scripts/e2e-live.mjs` if the built binary name changed. Run `npm run e2e:live` only if **no** Cowbell/Herdr Desktop window is open (check the processes; never kill a process that you did not start). Otherwise report "e2e skipped: app open".
5. `git grep -n "Herdr Desktop" -- gui README.md` returns only the historical `docs/phase*` specs and this spec.

## Hard constraints

- No commits. No new npm or cargo dependencies. Do not install tools (`cargo-about`, `license-checker` and the like).
- Network: only the fetch of the FSL text.
- Do not edit `%APPDATA%`, `~/.claude`, or the registry by hand. Do not run the installer. Do not start or stop herdr servers. Never use the default herdr session.
- Do not change the icons, the data folder paths, or the files outside `gui/` except the root `README.md`.
