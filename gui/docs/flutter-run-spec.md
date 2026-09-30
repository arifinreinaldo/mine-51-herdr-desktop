# Flutter Run spec: device target and Play

Status: plan, 2026-09-29. Estimate: about 2 days. This spec comes before `git-mvp-spec.md`.

## 0. Goal

In a Flutter workspace, the user picks a device and presses Play. Cowbell then splits the current pane **down** and runs `flutter run -d <device>` in the new pane, labelled `flutter`. Toolbar buttons then send Hot Reload, Hot Restart and Stop to that run.

Out of scope: emulator launch, screen mirror, screenshot, recording, native Android (Gradle) runs, build modes (profile/release), flavors, and hot reload on save. Do not build them.

A native Android project without Flutter shows no toolbar in this slice.

Success criterion: the offline check (§8.1) passes, and the live check (§8.2) passes on a scratch Flutter project.

## 1. Facts verified on this machine (2026-09-29)

These drive the design. Do not re-guess them.

- **Devices come from `adb devices -l`, not `flutter devices`.** adb takes 66 ms; `flutter devices --machine` takes 5.5 s. The user chose adb. adb lists Android devices only, so Windows, Chrome and web are not run targets in this slice.
- The adb serial equals flutter's device id (`RF8W3085JEW` in both lists here). `flutter run -d <serial>` works as is.
- Sample output:
  ```
  List of devices attached
  RF8W3085JEW            device product:a14nsxx model:SM_A145F device:a14 transport_id:30

  ```
  The fields are separated by runs of spaces, not tabs. The display name comes from `model:`, with `_` shown as a space (`SM A145F`).
- `ANDROID_HOME` and `ANDROID_SDK_ROOT` are **unset** on this machine. adb is on `PATH` at `%LOCALAPPDATA%\Android\sdk\platform-tools\adb.exe`.
- Rust never runs `flutter`. Play types `flutter run` into the pane, and the pane's shell finds it on `PATH`. No `flutter.bat` resolution is needed.
- The endpoint call `pane.split` takes `{ target_pane_id, direction: "down", cwd, focus }` (`src/api/schema/panes.rs:19` in the herdr repo root). It returns `ResponseResult::PaneInfo { pane }`, serialized with `tag = "type"` (`src/api/schema/response.rs:43`). The expected JSON is `{ "type": "pane_info", "pane": { "pane_id": … } }`.
  - The GUI's `api()` (`src/appApi.ts:48` → `commands.rs:265`) returns what `endpoint_request` returns. **Confirm with one live call whether that is the whole envelope or only the `result`, before you depend on the shape.** Record the answer in a code comment.
- `pane.send_text { pane_id, text }` sends literal text. `pane.send_keys { pane_id, keys }` sends named keys, for example `"Enter"` (`src/app/api/panes.rs:2824`). `pane.rename { pane_id, label }` sets the pane label.
- A `flutter run` session reads single raw keystrokes: `r` hot reload, `R` hot restart, `q` quit. No Enter is needed.

## 2. Deliverables

Create:

| File | Content |
|---|---|
| `src-tauri/src/flutter.rs` | 2 Tauri commands (§3), adb resolution, `adb devices -l` parsing, project detection, tests |
| `src/flutter/flutterApi.ts` | TypeScript types and `invoke` wrappers |
| `src/flutter/runState.ts` | the pure per-workspace run-state logic (§5) |
| `src/flutter/runState.test.ts` | vitest for §5 |
| `src/ui/runToolbar.ts` | toolbar rendering: device dropdown and buttons (§4) |
| `src/appFlutterRun.ts` | orchestration: detection on workspace change, api calls, snapshot watching |

Touch:

| File | Change |
|---|---|
| `src-tauri/src/lib.rs` | `mod flutter;` and register the 2 commands |
| `src-tauri/src/engine.rs` | make `apply_no_window` (line 124) `pub(crate)`; no other change |
| `index.html` | `#run-toolbar` in the title bar, left of the window buttons |
| `src/style.css` | toolbar styles, using existing theme variables only |
| `src/main.ts` | one init call |
| `src/settings.ts` / `src-tauri/src/settings.rs` | persist `flutterDevices: Record<projectDir, deviceId>` (default `{}`) |

Do not touch: `crates/herdr-wire`, anything outside `gui/`, the herdr config, the renderer, the e2e scripts, and the dependency lists. No new dependencies. Do not implement `git-mvp-spec.md` either.

## 3. Rust contracts (`flutter.rs`)

Commands return `Result<T, ApiError>` (`commands.rs:183`) and use `#[serde(rename_all = "camelCase")]`.

```rust
#[tauri::command] async fn flutter_project(cwd: String) -> Result<Option<FlutterProject>, ApiError>
#[tauri::command] async fn android_devices() -> Result<Vec<AndroidDevice>, ApiError>

struct FlutterProject { dir: String, name: String }
struct AndroidDevice { id: String, name: String, state: String, emulator: bool }
// state: adb's word ("device", "unauthorized", "offline", ...). Only "device" is runnable.
```

### 3.1 Resolving adb

Look for adb in this order, and use the first file that exists:
1. `%ANDROID_HOME%\platform-tools\adb.exe`;
2. `%ANDROID_SDK_ROOT%\platform-tools\adb.exe`;
3. `adb.exe` on `PATH` (plain `Command::new("adb")` finds an `.exe`);
4. `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`.

On macOS and Linux, use the same order with `adb` and `~/Library/Android/sdk` or `~/Android/Sdk`.

Pass the env values into the resolution function as parameters, so tests do not change the process env. Do not cache the result: resolving is cheap.

Not found: error code `adb_not_found`.

### 3.2 `android_devices`

- Run `adb devices -l` with `stdin` null and `stdout` and `stderr` piped.
- Call `engine::apply_no_window`.
- Timeout 10 s: kill the child and return `adb_timeout`.
  - The first call can start the adb server daemon. This takes about 1–3 s and prints `* daemon started successfully` on stderr. That is normal. The daemon outlives Cowbell, as it does with Android Studio.
- A non-zero exit returns `adb_failed` with stderr, cut to 2000 chars.
- Parsing:
  - Skip every line before `List of devices attached`, and skip lines that start with `*`.
  - For each non-empty line after it, split on whitespace: field 0 is `id` and field 1 is `state`.
  - `name` comes from the `model:` field with `_` replaced by a space. If there is no `model:` field, use `id`.
  - `emulator` is true when `id` starts with `emulator-`.
- Keep every state, so the UI can explain `unauthorized`.
- Drop a device whose `id` fails `^[A-Za-z0-9._:\-]+$`, and log it with `tracing::warn`. This id is typed into a shell (§5.2), so this filter is the injection guard. Wireless adb ids such as `adb-XXX._adb-tls-connect._tcp` and `192.168.1.5:5555` pass it.

### 3.3 `flutter_project`

The search order is:
1. `cwd` and then each ancestor, up to the filesystem root;
2. if none matches, each immediate subfolder of `cwd`, sorted by name. Skip names that start with `.`, and skip `build`, `node_modules` and `ios`.

A folder matches when it has a `pubspec.yaml` that contains a line that, trimmed, equals `sdk: flutter`. A pure Dart package also has a `pubspec.yaml`, and it must not match.

- `name` comes from the first line that starts with `name:`, trimmed and with its quotes removed. If there is no such line, use the folder name.
- Read at most 256 KiB of each `pubspec.yaml`. An I/O error on one candidate skips that candidate. It does not fail the command.
- No match returns `Ok(None)`.

## 4. UI: `#run-toolbar`

The toolbar sits in the title bar, just left of the window buttons. It is hidden unless the active workspace has a Flutter project. It has the `data-tauri-drag-region` exclusion that the other title-bar buttons use.

Contents, left to right:
1. **Device dropdown**: a `codicon-device-mobile` icon and the selected device's name, or "No device".
   - Clicking it opens a menu, built with the existing `ui/menu.ts`. The menu lists the devices as `name — id`, then a separator and "Refresh devices".
   - While the device list loads, the label reads "Loading devices…" with `codicon-loading codicon-modifier-spin`.
2. **Play** (`codicon-play`), green, when the state is `idle` or `stopped`.
3. **Hot Reload** (`codicon-flame`), **Hot Restart** (`codicon-debug-restart`) and **Stop** (`codicon-debug-stop`, red), when the state is `running`. Play is hidden then.

Each button has a `title` that names the action.

Loading the device list:
- The list loads when a Flutter workspace becomes active, each time the dropdown opens (adb is fast), and when the user picks "Refresh devices".
- One fetch runs at a time. A second trigger during a fetch does nothing.
- The list is global, not per workspace.

Choosing a device:
- The choice persists per project `dir` in `flutterDevices`.
- When the saved id is not in the list, use the first device whose state is `device`. Do not overwrite the saved value in that case. The phone can come back later.
- With no devices, Play is disabled, with the title "No devices. Connect a device, then Refresh devices".

Errors:
- `adb_not_found` shows the toolbar with the label "adb not found" and Play disabled. Its title says "Install Android SDK platform-tools".
- A device whose state is not `device` shows in the menu, greyed out and not selectable, as `name (unauthorized)` or `name (offline)`. For `unauthorized`, the title says "Accept the USB debugging prompt on the phone, then Refresh devices".
- A `flutter` that is missing from `PATH` is not detected in advance. The pane shows the shell's own "not recognized" error, and that is enough.
- Other fetch errors go to `showErrorNotice` once and set the label "Devices unavailable".

The narrow-window rule: below 900 px of window width, hide the device name text and keep the icon. The name stays in `title`.

## 5. Run state (`runState.ts`, pure) and actions

### 5.1 State

The state lives in the frontend only, as `Map<workspaceId, RunEntry>`:

```ts
type RunEntry = { paneId: string; projectDir: string; deviceId: string; status: "running" | "stopped" };
```

A workspace with no entry is `idle`.

Pure functions (these are the tested surface):
- `onPlay(map, ws, paneId, projectDir, deviceId)` sets the entry to `running`.
- `onStop(map, ws)` sets `stopped`. It keeps `paneId` so the next Play can reuse the pane.
- `reconcile(map, livePaneIds: Set<string>)` deletes every entry whose `paneId` is no longer in the snapshot. That happens when the user closes the flutter pane or its tab.
- `statusFor(map, ws)` returns `"idle" | "running" | "stopped"`.

Call `reconcile` on each snapshot update.

ponytail: this is not persisted. After a GUI restart, every workspace is `idle`, and the old flutter pane is just a pane. Persist the map if that turns out to annoy.

ponytail: `running` means "we started it and did not press Stop". If the user types `q` in the pane or the app crashes, the toolbar still says running. Stop then types `q` at a shell prompt, which is harmless because no Enter follows. The upgrade path is to read the pane tail with `pane.read` and look for flutter's exit line.

### 5.2 Play

1. Find the target pane:
   - `stopped` state with the pane still alive: reuse that pane. Skip step 2.
   - Otherwise: the focused pane of the active tab.
2. `api("pane.split", { target_pane_id, direction: "down", cwd: project.dir, focus: false })`. Take the new `pane_id` (see §1 for the response shape).
   - `focus: false` keeps the keyboard in the user's current pane.
   - Then `api("pane.rename", { pane_id, label: "flutter" })`.
3. Wait for the shell prompt before typing:
   - A new pane's shell (pwsh) needs time to start, and text sent too early can be lost or garbled.
   - Poll `pane.read` for that pane every 100 ms, for up to 5 s, until its text is non-empty. Then type.
   - Check `src/api/schema/panes.rs:347` (`PaneReadParams`) for the params. If `pane.read` is unusable from the GUI, a fixed 800 ms delay is the fallback. Record which one you used and why.
4. For a reused pane, first `pane.send_keys { keys: ["Escape"] }`. That clears a leftover `q` at the prompt; Escape clears the line in PSReadLine and in cmd.
5. `pane.send_text { text: "flutter run -d " + deviceId }`, then `pane.send_keys { keys: ["Enter"] }`.
   - The command is the same in pwsh, cmd and bash, so the shell choice does not matter.
   - `deviceId` already passed the §3.2 character filter. **Check it again here** with the same regex before sending. The toolbar's device may come from saved settings, and settings are editable on disk.
6. `onPlay(...)`.

Any step that fails calls `showErrorNotice` with the endpoint error, and the state stays unchanged. If the split succeeded but a later step failed, leave the pane open. It has a shell, and the user can see it.

### 5.3 Hot Reload, Hot Restart and Stop

- `pane.send_text` with `r`, `R` or `q` to `entry.paneId`.
- Stop then calls `onStop`.
- Guard against double-clicks: disable all three buttons for 300 ms after a click.

### 5.4 Workspace switch

The toolbar always shows the active workspace:
- It re-runs `flutter_project(new_workspace_cwd)` when the active `workspace_id` or its `new_workspace_cwd` changes.
- Stale result: tag each request with the cwd it used, and drop a response whose cwd no longer matches the active workspace.
- Cache results in a `Map<cwd, FlutterProject | null>`, so switching back and forth does not re-read disk.
  - ponytail: no invalidation. A `pubspec.yaml` created during the session needs a workspace switch plus a cache clear. Add a cache clear on window focus if needed.

## 6. Security (for the reviewer)

- The only shell-typed value is `deviceId`, and §3.2 and §5.2 both filter it with a strict character set.
- The project `dir` goes to `pane.split` as `cwd`. It is a path parameter, not shell text.
- `flutter_project` reads files under a path that the webview supplies. It is read-only, capped at 256 KiB, and reads only `pubspec.yaml`. That is acceptable.
- No new capability permissions are needed in the webview.

## 7. Tests

### 7.1 Rust (`flutter.rs`, `#[cfg(test)]`)

- Device parsing:
  - the sample from §1 gives id `RF8W3085JEW`, name `SM A145F`, state `device`;
  - `emulator-5554 device product:sdk_gphone64 model:sdk_gphone64_x86_64` gives `emulator: true`;
  - an `unauthorized` line with no `model:` field gives name = id;
  - `* daemon not running; starting now` lines before the header are ignored;
  - the header only (no devices) gives `[]`;
  - a wireless id `adb-R58N._adb-tls-connect._tcp` is kept;
  - an id with `;` is dropped.
- Project detection, with temp folders under `std::env::temp_dir()` and no new dev-dependency:
  - a match in `cwd`;
  - a match 2 ancestors up;
  - a match in a subfolder;
  - a Dart-only `pubspec.yaml` does not match;
  - `.dart_tool` and `build` are skipped;
  - the name comes from `name: "my_app"` with its quotes removed.
- adb resolution: temp folders with a fake `adb.exe`. Check that `ANDROID_HOME` wins over `PATH`, and that the `LOCALAPPDATA` fallback is used when the others are empty. Pass the values in as parameters.

### 7.2 TypeScript

- `runState.test.ts`:
  - play gives running;
  - stop gives stopped with the pane kept;
  - `reconcile` without the pane gives idle;
  - two workspaces stay independent.
- One vitest for the §5.2 id regex: accept `RF8W3085JEW`, `emulator-5554`, `windows`, `adb-X._adb-tls-connect._tcp`; reject `a b`, `x;rm`, `$(x)`, and the empty string.

## 8. Acceptance

### 8.1 Offline

```
cd gui && npm run check
```

All steps must pass.

### 8.2 Live (main session, after `npm run package:fast`, **gui-test** herdr session only)

1. `flutter create %TEMP%\cowbell-flutter-demo`, then open a workspace on that folder.
2. The toolbar appears, and the dropdown lists **SM A145F** within 1 s.
3. Pick the phone. The user approved a live run on the phone on 2026-09-29. The run installs the demo app on it.
4. Press Play. A pane splits **below**, is labelled `flutter`, and shows `flutter run -d RF8W3085JEW` running. Keyboard focus stays in the original pane.
5. When the app is up, edit `lib/main.dart`, then press Hot Reload. The pane shows "Reloaded". Press Hot Restart. The pane shows "Restarted".
6. Press Stop. The app exits, the pane stays, and Play is back. Press Play again: the same pane is reused.
7. Close the flutter pane. The toolbar shows Play (idle).
8. Switch to a workspace that is not Flutter. The toolbar hides.

Record a screenshot for steps 4 and 6, using demo data only.

## 9. Estimate

| Part | Days |
|---|---|
| `flutter.rs` with tests | 0.5 |
| Toolbar, device menu, settings | 0.5 |
| Run state, Play flow, prompt wait | 0.5 |
| Workspace switching, polish, live check | 0.5 |
| **Total** | **2** |

Next slice (not here): screen mirror, screenshot and recording (Phase 6 spike first), emulator launch, and native Gradle run.

## 10. Addendum (2026-09-29): adb first, then flutter devices, merged

The user asked for both sources. This section overrides §0, §1, §3 and §4 where they differ. flutter devices (Windows, Chrome) are run targets again.

### 10.1 Rust: a third command

```rust
#[tauri::command] async fn flutter_devices() -> Result<Vec<AndroidDevice>, ApiError>
```

- It returns the same `AndroidDevice` shape. For each entry, `state` is `"device"`, `name` is flutter's `name`, and `emulator` is flutter's `emulator`.
- Resolve `flutter` like this: look at each `PATH` entry for `flutter.bat` on Windows (`flutter` elsewhere), and take the first file that exists.
  - Counterintuitive: Rust's `Command::new("flutter")` does **not** find a `.bat`, because it only appends `.exe`.
  - Pass `PATH` in as a parameter, for the tests. Not found gives `flutter_not_found`.
- Run `<flutter.bat> devices --machine`. Use `apply_no_window`, a 30 s timeout (`flutter_timeout`), and `flutter_failed` with stderr on a non-zero exit.
  - Rust 1.77+ escapes `.bat` arguments safely, and these arguments are constants. Do not use `cmd /c` with a built string.
- Parse stdout from the first `[` to the last `]`. flutter can print a banner or "Waiting for another flutter command to release the startup lock..." before the JSON.
- Keep only `isSupported == true`. Apply the same id filter (`^[A-Za-z0-9._:\-]+$`) and the same `tracing::warn` as §3.2.
- Sample: `[{"name":"SM A145F","id":"RF8W3085JEW","isSupported":true,"targetPlatform":"android-arm64","emulator":false,...},{"name":"Windows","id":"windows",...},{"name":"Chrome","id":"chrome",...}]`. The call took 5.5 s on this machine.

### 10.2 Frontend: load and merge

- A load calls `android_devices` and `flutter_devices` **in parallel**.
- **When adb returns:** render the list right away. While flutter is still pending, the menu shows a last greyed row "Looking for more devices…" with the spin icon.
- **When flutter returns:** merge. The result is the adb entries in adb order, then each flutter entry whose `id` is **not** already in the list, in flutter's order. Duplicates are ignored, and the adb entry wins.
- **Failures:**
  - `flutter_not_found` or any `flutter_devices` error: keep the adb list, no toast, and `tracing` or `console.warn` only.
  - adb error with flutter success: show the flutter list, and set the §4 error label only when both fail.
- **Stale results:** a generation counter drops results from an older load. This applies when the user presses "Refresh devices" while the previous flutter call is still running.
- **When each source runs:**
  - Opening the dropdown re-runs **adb only**, and merges with the last flutter result.
  - A Flutter workspace becoming active, and "Refresh devices", run both.
  - ponytail: the flutter result is cached for the session. Refresh devices is the way to update it.
- Put the merge in a pure function in `src/flutter/runState.ts` (or a sibling `devices.ts`): `mergeDevices(adb, flutter)`. Test it with vitest:
  - flutter's `RF8W3085JEW` is dropped when adb has it;
  - `windows` and `chrome` are appended after the adb entries;
  - an empty adb list gives the flutter list;
  - a null flutter list (pending or failed) gives the adb list.
- Default device choice (§4) is unchanged: the saved id, else the first device whose state is `device`. That is an adb device when a phone is connected.

### 10.3 Tests added to §7.1

Flutter parsing:
- the sample array;
- a text prefix before `[`;
- `isSupported: false` filtered out;
- an id with `;` dropped;
- empty stdout gives `flutter_failed`.

`flutter.bat` resolution with a fake file in a temp folder, with `PATH` passed as a parameter.

## 11. Correction found in the live test (2026-09-29)

The GUI's endpoint connection accepts only the methods in `CLIENT_SHELL_METHODS` (`src/server/client_commands.rs:15` in the herdr repo root). Any other method fails with `unsupported_method`: "method … is not available on this machine".

`pane.read`, `pane.send_text` and `pane.send_keys` are **not** on that list. The implementation therefore:
- types through the GUI's own `send_input` command (`ClientShellPaneInput`), with `TextCommit` for text and `keyEvent("Enter" | "Esc")` for keys;
- waits a fixed 800 ms for the new shell instead of polling `pane.read`, the same as the wizard.

Check every endpoint method against that list before you specify it.
