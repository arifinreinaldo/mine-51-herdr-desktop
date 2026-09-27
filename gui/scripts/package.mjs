#!/usr/bin/env node
// `npm run package` (spec addendum §11 item 1): fetches the pinned herdr
// zip, then runs a release `tauri build --no-bundle`, producing one
// self-contained portable `.exe` -- no NSIS installer, no shortcuts, no
// uninstaller, no registry entries.
//
// `CARGO_TARGET_DIR` is set to the **absolute** `gui/target-agent`: the
// Tauri CLI runs `cargo` from `src-tauri`, so a relative `target-agent`
// would land at `src-tauri/target-agent` instead of `gui/target-agent`.
// `CARGO_BUILD_JOBS=2` caps the peak build memory on this machine.
//
// `HERDR_GUI_EMBED_ENGINE=1` tells `src-tauri/build.rs` to copy the
// verified pinned zip + `install.ps1` into `OUT_DIR`, so `engine.rs`'s
// `include_bytes!` embeds the real engine payload in this build (spec
// §11.1) -- unset (as in `npm run check`), it embeds two empty
// placeholders instead.
//
// The built exe lands at `<target-agent>/release/herdr-gui.exe`; this
// script copies (never moves -- the plain build artifact stays where cargo
// put it) and renames it to
// `<target-agent>/release/portable/Herdr Desktop.exe`.
//
// That fixed name can already be open -- running it is exactly how someone
// notices they want a fresh build. Overwriting a running .exe on Windows
// fails with EBUSY/EPERM rather than silently succeeding (and the running
// process must never be killed to force it through). On that specific
// failure, this falls back to a timestamped sibling file instead of
// aborting the whole build.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const guiRoot = path.resolve(here, "..");
const targetDir = path.resolve(guiRoot, "target-agent");

function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: guiRoot,
    stdio: "inherit",
    // Finding #14: no `shell: true` -- `spawnSync` with an args array
    // needs no shell and no manual quoting, even when `guiRoot` (or a
    // future path) contains a space. `shell: true` on Windows joins
    // `[command, ...args]` with plain spaces before handing the string to
    // `cmd.exe`, with no quoting of its own; an unquoted path containing a
    // space would silently split into multiple arguments.
    env: {
      ...process.env,
      CARGO_TARGET_DIR: targetDir,
      CARGO_BUILD_JOBS: "2",
      HERDR_GUI_EMBED_ENGINE: "1",
    },
  });
  if (result.error) {
    console.error(`package: failed to start "${command}": ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`package: "${command} ${args.join(" ")}" failed (exit ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

// `process.execPath` (this same Node binary) with an explicit args array:
// no shell, so a path containing a space needs no quoting. Runs first, so
// the zip `build.rs` embeds is always the freshly-verified one.
run(process.execPath, [path.join(guiRoot, "scripts", "fetch-herdr-package.mjs")]);

// Tauri's CLI ships its own JS entry point (`@tauri-apps/cli/tauri.js`),
// so it too runs directly under this Node binary with an args array --
// no shell, and so no unquoted-path risk, and no dependence on `npx`
// resolving a `.cmd` shim on Windows.
const tauriCliEntry = path.join(guiRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
run(process.execPath, [tauriCliEntry, "build", "--no-bundle"]);

const builtExe = path.join(targetDir, "release", "herdr-gui.exe");
const portableDir = path.join(targetDir, "release", "portable");
const portableExe = path.join(portableDir, "Herdr Desktop.exe");
mkdirSync(portableDir, { recursive: true });

/** `Herdr Desktop-<yyyyMMdd-HHmm>.exe`, next to the fixed-name copy. */
function timestampedPortableExePath() {
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  return path.join(portableDir, `Herdr Desktop-${stamp}.exe`);
}

try {
  copyFileSync(builtExe, portableExe);
  console.log(`package: portable exe at ${portableExe}`);
} catch (err) {
  if (err?.code === "EBUSY" || err?.code === "EPERM") {
    // Someone (the user) is running the fixed-name exe right now -- copy
    // to a fresh, timestamped name instead of failing the whole build.
    const fallbackExe = timestampedPortableExePath();
    copyFileSync(builtExe, fallbackExe);
    console.log(
      `package: "${portableExe}" is in use and could not be replaced; ` +
        `wrote the new build to "${fallbackExe}" instead. Close the running ` +
        `app and re-run "npm run package" to update "${portableExe}" too.`,
    );
  } else {
    console.error(`package: failed to copy "${builtExe}" to "${portableExe}": ${err.message}`);
    process.exit(1);
  }
}
