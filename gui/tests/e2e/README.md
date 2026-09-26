# E2E smoke test (optional)

Not part of `npm run check`, not required for Phase 1 "done" (spec §9.9).
Exercises the built app against a live, dedicated herdr test session.

## One-time setup (run these yourself; the agent that scaffolded this does
## not install system binaries)

1. Install `tauri-driver` (a Rust binary, not an npm package):
   ```
   cargo install tauri-driver
   ```
2. Install `msedgedriver` matching your installed WebView2 runtime version
   (153.x per spec §9.9). Check your WebView2 version first:
   ```
   reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv
   ```
   Then download the matching driver from
   https://developer.microsoft.com/microsoft-edge/tools/webdriver/ and put
   `msedgedriver.exe` on your `PATH`. `tauri-driver` shells out to it.
3. Install the e2e npm devDependencies (not installed by the main `npm
   install` for `npm run check`, since e2e is optional):
   ```
   npm install --save-dev @wdio/cli @wdio/local-runner @wdio/mocha-framework
   ```

## Running

1. In one terminal: `scripts\test-session.bat` (starts `herdr --session
   gui-test server` in the foreground; leave it running). Never point this
   at your default herdr session.
2. Build the release binary once: `npm run tauri build`.
3. In another terminal: `npm run e2e`.

The config (`wdio.conf.ts`) and the smoke spec
(`specs/smoke.spec.ts`) refuse to run unless the resolved client socket path
is under `sessions\gui-test` (see `scripts/resolve-socket-path.mjs`), and the
CLI assertion in the spec always passes `--session gui-test` explicitly, so
it can never touch your default session's panes.
