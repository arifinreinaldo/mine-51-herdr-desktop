#!/usr/bin/env node
// CLI wrapper around `assertGuiTestSocketPath`, for the .bat launchers
// (plain batch has no equivalent env-var-precedence logic of its own).
// Usage: node scripts/assert-gui-test-session.mjs "<label for the error message>"

import { assertGuiTestSocketPath } from "./resolve-socket-path.mjs";

const label = process.argv[2] ?? "gui-test session guard";
assertGuiTestSocketPath(label);
console.log(`${label}: resolved client socket path is under sessions/gui-test, proceeding.`);
