// Resolves the herdr client protocol socket path exactly like
// `gui/src-tauri/src/socket.rs` (same precedence, same env vars). Node-side
// scripts (bench-startup.mjs, the e2e wdio config, the gui-test session
// guard) need this so they can refuse to run against the wrong herdr
// session. Keep this in sync with socket.rs if that precedence ever changes.

import path from "node:path";

export function resolveClientSocketPath(env = process.env) {
  const apiOverride = env.HERDR_SOCKET_PATH;
  const clientOverride = env.HERDR_CLIENT_SOCKET_PATH;
  const session = env.HERDR_SESSION;

  if (apiOverride) {
    const parsed = path.parse(apiOverride);
    return path.join(parsed.dir, `${parsed.name}-client.sock`);
  }
  if (clientOverride) {
    return clientOverride;
  }

  const configDir = env.XDG_CONFIG_HOME
    ? path.join(env.XDG_CONFIG_HOME, "herdr")
    : path.join(env.APPDATA ?? path.join(process.cwd(), ".herdr-gui-no-appdata"), "herdr");

  if (session && session !== "default") {
    return path.join(configDir, "sessions", session, "herdr-client.sock");
  }
  return path.join(configDir, "herdr-client.sock");
}

/**
 * Aborts (prints an error and exits 1) unless the resolved client socket
 * path is under the dedicated `gui-test` session (spec §9/§10: the GUI's
 * dev/bench/e2e tooling must never run against the user's default herdr
 * session).
 */
export function assertGuiTestSocketPath(commandLabel, env = process.env) {
  const resolved = resolveClientSocketPath(env);
  const normalized = resolved.split(path.sep).join("/");
  if (!normalized.includes("sessions/gui-test")) {
    console.error(
      `${commandLabel}: refusing to run.\n` +
        `Resolved client socket path:\n  ${resolved}\n` +
        `This does not contain "sessions/gui-test". Set HERDR_SESSION=gui-test ` +
        `(see scripts/dev-test.bat) and make sure HERDR_SOCKET_PATH / ` +
        `HERDR_CLIENT_SOCKET_PATH are not overriding it, before running this ` +
        `against the dedicated test session.`,
    );
    process.exit(1);
  }
  return resolved;
}
