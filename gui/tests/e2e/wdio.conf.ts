// WebdriverIO + tauri-driver smoke config (spec §9.9). Optional: not part of
// `npm run check`, not required for Phase 1 "done". See README.md in this
// directory for one-time setup (installing tauri-driver and msedgedriver)
// and how to run this against the dedicated `gui-test` herdr session.
//
// This spawns `tauri-driver` itself (the standard Tauri + WebdriverIO
// pattern: a plain child_process, not an extra wdio service package) and
// points WebView2 at the release build of the herdr-gui binary.

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertGuiTestSocketPath } from "../../scripts/resolve-socket-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const guiRoot = path.resolve(here, "..", "..");

const TAURI_DRIVER_PORT = 4444;
let tauriDriver: ChildProcess | undefined;

export const config: WebdriverIO.Config = {
  runner: "local",
  hostname: "127.0.0.1",
  port: TAURI_DRIVER_PORT,
  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [
    {
      // tauri-driver speaks the WebDriver protocol; WebView2's own
      // capability key selects the built application binary.
      "tauri:options": {
        application: path.join(
          guiRoot,
          "src-tauri",
          "target",
          "release",
          "herdr-gui.exe",
        ),
      },
    } as WebdriverIO.Capabilities,
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },

  onPrepare: () => {
    // Never start the herdr test session itself from here -- run
    // `scripts/test-session.bat` yourself first (README.md).
    assertGuiTestSocketPath("npm run e2e");
    tauriDriver = spawn("tauri-driver", [], { stdio: "inherit" });
  },

  onComplete: () => {
    tauriDriver?.kill();
  },
};
