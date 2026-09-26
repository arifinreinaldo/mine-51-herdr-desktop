#!/usr/bin/env node
// Startup bench (spec §9.10): builds the release binary, runs it 5 times
// with HERDR_GUI_BENCH=1 against the dedicated `gui-test` herdr session,
// prints each run plus the median, and exits 1 if the median
// first_paint_ms >= 1000 or attach_ms >= 300.
//
// Never run this against the user's default session: it refuses to start
// unless the resolved client socket path is under sessions/gui-test (start
// scripts/test-session.bat first, and run this via scripts/dev-test.bat's
// sibling env, or with HERDR_SESSION=gui-test set yourself).

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertGuiTestSocketPath } from "./resolve-socket-path.mjs";

const RUNS = 5;
const FIRST_PAINT_MS_LIMIT = 1000;
const ATTACH_MS_LIMIT = 300;

const here = path.dirname(fileURLToPath(import.meta.url));
const guiRoot = path.resolve(here, "..");
// `gui/` is the Cargo workspace root (Cargo.toml's `[workspace] members =
// ["src-tauri", "crates/herdr-wire"]`), so the build artifacts land under
// `gui/target/`, not `gui/src-tauri/target/` (code review finding #5).
const releaseBinary = path.join(guiRoot, "target", "release", "herdr-gui.exe");

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function main() {
  assertGuiTestSocketPath("npm run bench:startup");

  console.log("Building the release binary (npm run tauri build)...");
  const build = spawnSync("npm", ["run", "tauri", "build"], {
    cwd: guiRoot,
    stdio: "inherit",
    shell: true,
  });
  if (build.status !== 0) {
    console.error("bench:startup: release build failed");
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < RUNS; i++) {
    const run = spawnSync(releaseBinary, [], {
      env: { ...process.env, HERDR_GUI_BENCH: "1" },
      encoding: "utf-8",
    });
    if (run.error) {
      console.error(`run ${i + 1}: failed to launch ${releaseBinary}: ${run.error.message}`);
      process.exit(1);
    }
    const lastLine = run.stdout.trim().split("\n").filter(Boolean).pop();
    let parsed;
    try {
      parsed = JSON.parse(lastLine ?? "");
    } catch {
      console.error(`run ${i + 1}: could not parse HERDR_GUI_BENCH=1 output: ${JSON.stringify(lastLine)}`);
      console.error(run.stderr);
      process.exit(1);
    }
    console.log(`run ${i + 1}: first_paint_ms=${parsed.first_paint_ms} attach_ms=${parsed.attach_ms}`);
    results.push(parsed);
  }

  const medianFirstPaint = median(results.map((r) => r.first_paint_ms));
  const medianAttach = median(results.map((r) => r.attach_ms));
  console.log(`median: first_paint_ms=${medianFirstPaint} attach_ms=${medianAttach}`);

  if (medianFirstPaint >= FIRST_PAINT_MS_LIMIT || medianAttach >= ATTACH_MS_LIMIT) {
    console.error(
      `bench:startup FAILED: median first_paint_ms must be < ${FIRST_PAINT_MS_LIMIT} ` +
        `(got ${medianFirstPaint}) and attach_ms < ${ATTACH_MS_LIMIT} (got ${medianAttach})`,
    );
    process.exit(1);
  }
  console.log("bench:startup OK");
}

main();
