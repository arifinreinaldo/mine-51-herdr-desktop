#!/usr/bin/env node
// `npm run package` (spec addendum §11 item 1): runs `npm run notices` (spec
// D), then a release `tauri build --no-bundle`, producing one self-contained
// portable `.exe` -- no NSIS installer, no shortcuts, no uninstaller, no
// registry entries.
//
// `CARGO_TARGET_DIR` is set to the **absolute** `gui/target-agent`: the
// Tauri CLI runs `cargo` from `src-tauri`, so a relative `target-agent`
// would land at `src-tauri/target-agent` instead of `gui/target-agent`.
// `CARGO_BUILD_JOBS=2` caps the peak build memory on this machine.
//
// Cowbell rebrand (spec cowbell-rebrand-spec.md §B): this build no longer
// bundles a herdr release. "Install herdr" (`src-tauri/src/engine.rs`) runs
// herdr's own official installer from herdr.dev at runtime instead.
//
// The built exe lands at `<target-agent>/release/herdr-gui.exe` (the Cargo
// binary name is unchanged -- spec "Keep unchanged: the crate and lib names
// ... and the Cargo binary name"); this script copies (never moves -- the
// plain build artifact stays where cargo put it) and renames it to
// `<target-agent>/release/portable/Cowbell.exe`.
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
// `--fast` (npm run package:fast): a test build in about a minute instead of
// half an hour. It turns off the release profile's fat LTO and single codegen
// unit (gui/Cargo.toml) and lifts the 2-job cap. The exe is somewhat larger
// and marginally slower. Publish only a default (full) build.
const fast = process.argv.includes("--fast");
const fastEnv = fast
  ? {
      CARGO_PROFILE_RELEASE_LTO: "false",
      CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16",
      CARGO_PROFILE_RELEASE_INCREMENTAL: "true",
    }
  : { CARGO_BUILD_JOBS: "2" };

function run(command, args, extraEnv = {}) {
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
      ...extraEnv,
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

// Spec D: "scripts/package.mjs runs it before the build" -- regenerates
// `public/THIRD-PARTY-NOTICES.txt` from the current dependency graph before
// every packaged build, so a stale notices file never ships.
run(process.execPath, [path.join(guiRoot, "scripts", "gen-notices.mjs")]);

// Tauri's CLI ships its own JS entry point (`@tauri-apps/cli/tauri.js`),
// so it too runs directly under this Node binary with an args array --
// no shell, and so no unquoted-path risk, and no dependence on `npx`
// resolving a `.cmd` shim on Windows.
const tauriCliEntry = path.join(guiRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
run(process.execPath, [tauriCliEntry, "build", "--no-bundle"], {
  CARGO_TARGET_DIR: targetDir,
  ...fastEnv,
});

const builtExe = path.join(targetDir, "release", "herdr-gui.exe");
const portableDir = path.join(targetDir, "release", "portable");
const portableExe = path.join(portableDir, "Cowbell.exe");
mkdirSync(portableDir, { recursive: true });

/** `Cowbell-<yyyyMMdd-HHmm>.exe`, next to the fixed-name copy. */
function timestampedPortableExePath() {
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  return path.join(portableDir, `Cowbell-${stamp}.exe`);
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
