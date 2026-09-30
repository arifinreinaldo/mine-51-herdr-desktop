# Android screenshot: build spec

Status: DRAFT, waiting for owner approval.
Scope: `gui/` only. Do not change herdr core (`src/`, `crates/` at the repo root).
Design authority: `gui/docs/screenshot-design.md` (layout, states, keyboard, a11y). Read it fully. This spec adds the contracts and the deviations. Where the two disagree, this spec wins (see §7).

## 0. Goal

In a Flutter workspace, the user presses **Screenshot** in the run toolbar. Cowbell captures the selected Android device with adb and opens a modal with the preview and three actions: **Copy** (image to the OS clipboard), **Save as…** (native file dialog), **Close**.

Flutter workspaces only. Native-project detection is a later feature. Do not build it. Do not bundle any tool.

## 1. Deliverables

| File | Change |
|---|---|
| `src-tauri/src/android.rs` | 3 commands, 1 state struct, 3 pure fns, tests (§2) |
| `src-tauri/src/clipboard.rs` | `write_clipboard_image_rgba` (§2.4) |
| `src-tauri/src/lib.rs` | `.manage(ScreenshotSlot::default())`, register 3 commands |
| `src-tauri/Cargo.toml` | one line: `png = "0.17"` (§2.4) |
| `src/flutter/flutterApi.ts` | 3 wrappers (§3.1) |
| `src/android/screenshotFormat.ts` | new: 2 pure helpers (§3.2) |
| `src/ui/screenshotModal.ts` | new: the modal (§3.3) |
| `src/ui/modal.ts` | optional 3rd parameter (§3.4) |
| `src/ui/runToolbar.ts` | Screenshot button (§3.5) |
| `src/appFlutterRun.ts` | `screenshot()` handler and view fields (§3.5) |
| `src/style.css` | `.modal--shot` and the classes from the design (§3.6) |
| `tests/unit/screenshotFormat.test.ts` | new (§5) |

Do NOT touch: `src-tauri/src/flutter.rs` (it has known fmt and clippy failures at lines 451 and 555 that are not yours; do not "fix" them), `.impeccable/`, the herdr root, existing tests, `package.json`, icons. Do not commit. Do not run `winget`, `adb install`, or start scrcpy.

## 2. Rust contracts (`android.rs`, `clipboard.rs`)

Existing helpers you reuse in `android.rs`: `check_device_id`, `resolve_adb_from_env`, `api_error`, `apply_no_window`. Read the file first.

### 2.1 Capture

```rust
#[tauri::command]
pub async fn android_screenshot(
    device_id: String,
    slot: tauri::State<'_, ScreenshotSlot>,
) -> Result<tauri::ipc::Response, ApiError>
```

1. `check_device_id`, then `resolve_adb_from_env` (`adb_not_found`, same message as `android_install_apk`).
2. Run `adb -s <id> exec-out screencap -p`. **`exec-out`, not `shell`**: `shell` turns `\n` into `\r\n` on some adb versions and corrupts the PNG.
3. **Do not use `flutter::run_capture`.** It converts stdout to a `String` with lossy UTF-8, which destroys binary data. Write a private `run_capture_bytes(cmd, timeout) -> Result<Vec<u8>, ApiError>` in `android.rs`: stdin null, stdout and stderr piped, `kill_on_drop(true)`, `apply_no_window`, `wait_with_output` under `tokio::time::timeout`.
   - Timeout 15 s, code `screenshot_timeout`.
   - Non-zero exit: code `screenshot_failed`, message = stderr cut to 2000 chars.
   - Stdout over 32 MiB: code `screenshot_failed`, message "screenshot too large".
   - `taskkill /T` is not needed: adb is one process with no grandchild.
4. `strip_to_png` (§2.2) on stdout. `None` gives code `not_a_png`, message "The device returned no image".
5. Store the PNG bytes in the slot (replacing any old value). Return `tauri::ipc::Response::new(bytes)` (raw bytes; the frontend receives an `ArrayBuffer`, not a JSON array).

### 2.2 Pure functions (unit-tested)

```rust
/// Bytes from the first PNG signature onward, or None.
pub fn strip_to_png(data: &[u8]) -> Option<&[u8]>
/// A safe file name: only [A-Za-z0-9._-], must end in ".png" (any case).
/// Anything else returns "screenshot.png".
pub fn sanitize_file_name(name: &str) -> String
/// Decodes a PNG to (width, height, RGBA8 bytes).
pub fn decode_png_rgba(png: &[u8]) -> Result<(u32, u32, Vec<u8>), String>
```

**Counterintuitive: `strip_to_png` must search for the signature `89 50 4E 47 0D 0A 1A 0A`, not only check byte 0.** On phones with more than one display (foldables, some Android 10+ builds), `screencap` prints a text line such as `[Warning] Multiple displays were found…` to stdout *before* the PNG. A check at offset 0 would reject a good screenshot. Source: AOSP `frameworks/base/cmds/screencap/screencap.cpp` (owner to confirm; not reproduced on the test phone). Cost of the search is negligible.

`decode_png_rgba`: use the `png` crate with `Transformations::EXPAND | Transformations::STRIP_16`. Accept `Rgba` (copy) and `Rgb` (add alpha 255); any other colour type returns `Err("unsupported PNG colour type")`. A 1080×2400 RGBA image is about 10 MB; that is expected.

### 2.3 Slot, copy and save

```rust
#[derive(Default)]
pub struct ScreenshotSlot(std::sync::Mutex<Option<Vec<u8>>>);
```

Ownership: **Rust holds the latest PNG; the frontend never sends the bytes back.** One slot, replaced on every capture, never cleared (about 3 MB; `// ponytail: one slot, cleared on next capture`). Reason: sending 3 MB back through JSON IPC is slow and pointless.

```rust
#[tauri::command] pub async fn screenshot_copy(slot: State<'_, ScreenshotSlot>) -> Result<(), ApiError>
#[tauri::command] pub async fn screenshot_save(app: tauri::AppHandle, slot: State<'_, ScreenshotSlot>, suggested_name: String) -> Result<Option<String>, ApiError>
```

- Both: empty slot gives code `no_screenshot`, message "No screenshot to use". Clone the bytes out of the lock, then release the lock before slow work. Never hold the mutex across `.await` or a dialog.
- `screenshot_copy`: `tokio::task::spawn_blocking` → `decode_png_rgba` → `clipboard::write_clipboard_image_rgba`. Failure gives code `copy_failed`.
- `screenshot_save`:
  1. `name = sanitize_file_name(&suggested_name)`.
  2. Start dir = `app.path().picture_dir()` joined `Cowbell` (`tauri::Manager` for `.path()`); `create_dir_all` it; if `picture_dir()` is `None`, use no start dir.
  3. `app.dialog().file().set_file_name(name).add_filter("PNG image", &["png"])` plus `.set_directory(start)` when known; `blocking_save_file()` (same pattern as `folder_picker.rs`; the command is `async`, which moves it off the UI thread).
  4. `None` (cancelled) returns `Ok(None)`. Otherwise append `.png` if the chosen path has no `png` extension, `std::fs::write`, and return `Ok(Some(path_string))`. Write failure gives code `save_failed`.

### 2.4 Clipboard image (`clipboard.rs`)

`clipboard.rs` is the single native-clipboard call site (see its header). Add next to `write_clipboard_bytes`:

```rust
pub fn write_clipboard_image_rgba(width: u32, height: u32, rgba: Vec<u8>) -> Result<(), String>
```

using `arboard::Clipboard::new()?.set_image(arboard::ImageData { width: width as usize, height: height as usize, bytes: rgba.into() })`. Follow how the existing text function opens the clipboard. No new arboard feature is needed (the `image-data` default feature is on; check `Cargo.lock`: arboard already depends on `image`).

`Cargo.toml`: add `png = "0.17"`. `Cargo.lock` already resolves `png 0.17.16` through arboard's `image`, so this downloads nothing new. Confirm with `cargo tree -i png` and report the result. If cargo resolves a second copy, stop and report instead of adding it.

### 2.5 Registration (`lib.rs`)

`.manage(android::ScreenshotSlot::default())` next to `.manage(app_state)`, and add `android::android_screenshot`, `android::screenshot_copy`, `android::screenshot_save` after `android::install_scrcpy` in the handler list.

## 3. Frontend contracts

### 3.1 `flutterApi.ts`

```ts
export function androidScreenshot(deviceId: string): Promise<ArrayBuffer>   // invoke("android_screenshot", { deviceId })
export function screenshotCopy(): Promise<void>                              // invoke("screenshot_copy")
export function screenshotSave(suggestedName: string): Promise<string | null> // invoke("screenshot_save", { suggestedName })
```

Tauri maps camelCase to snake_case for command arguments (`deviceId`, `suggestedName`); this matches the existing `android_mirror` wrapper. A rejection is `{ code, message }` (the `ApiError`).

### 3.2 `src/android/screenshotFormat.ts` (pure, no DOM)

```ts
/** "screenshot-YYYYMMDD-HHMMSS.png" in LOCAL time, zero-padded. */
export function screenshotFileName(date: Date): string
/** True when the mean of (r+g+b)/3 over all pixels is below `threshold` (default 3, range 0-255). Alpha is ignored. An empty array is not black. */
export function isBlackFrame(rgba: Uint8ClampedArray, threshold = 3): boolean
```

### 3.3 `src/ui/screenshotModal.ts`

```ts
export function openScreenshotModal(opts: { deviceName: string; deviceId: string }): () => void
```

Builds the modal exactly as `screenshot-design.md` §2 to §5 describe, using `openModal("Screenshot", …, { className: "modal--shot", onClose })`. Behaviour the design leaves to you, decided here:

- On open: state Capturing, and call `androidScreenshot(deviceId)` at once. The `Retry` button calls it again.
- The result resolves to an `ArrayBuffer`. Make `new Blob([buf], { type: "image/png" })` and `URL.createObjectURL`. Revoke the previous URL when a new capture arrives and in `onClose`.
- **Race:** if the modal closed before the capture returned, drop the result silently (a `closed` flag set in `onClose`). Ignore results from a superseded capture with a generation counter, like `appFlutterRun.ts` `adbGeneration`.
- Meta block: device name, `naturalWidth × naturalHeight` (read on the `img` `load` event; do not decode in Rust), capture time `HH:MM:SS`.
- Black-frame hint: after `load`, draw the image into a 16×36 canvas, `getImageData`, call `isBlackFrame`. Wrap in try/catch: a canvas failure must not hide the image.
- Copy calls `screenshotCopy()`; Save calls `screenshotSave(screenshotFileName(new Date()))`. A `null` result changes nothing. Both use the busy, success (1600 ms) and inline-error states from the design. Clear timers in `onClose`.
- Keyboard: `Ctrl+C` and `Ctrl+S` on the modal (a `keydown` listener added on `document` in the capture phase; removed in `onClose`), each with `preventDefault`, only while state is Ready.
- Initial focus: Copy, after `window.setTimeout(..., 0)` (the modal is not in the document while the builder runs; see `flavorPicker.ts`).
- DOM only through `createElement` and `textContent`. Never assign `innerHTML` with device text (the adb error message is untrusted).
- Error messages from `ApiError` use `errorMessage` from `appApi.ts`.

### 3.4 `modal.ts`

Change the signature to `openModal(title, buildBody, options?: { className?: string; onClose?: () => void })`.

- `className` is added to the `.modal` element.
- `onClose` runs once inside `dispose`, before focus returns to the terminal.
- Set `role="dialog"`, `aria-modal="true"` and `aria-labelledby` (give the `h2` an id) on the `.modal` element for **every** modal. This is one deliberate change to the other modals (see §7). No visual change.

Existing callers pass two arguments and must keep working unchanged.

### 3.5 `runToolbar.ts` and `appFlutterRun.ts`

- `RunToolbarView` gets `screenshotDisabled: boolean` and `screenshotTitle: string`. `RunToolbarHandlers` gets `onScreenshot: () => void`.
- Button: `makeButton("run-btn--shot", "device-camera", …)`, appended right after the Mirror button. `render` sets `disabled` and `title`.
- `appFlutterRun.ts`: `screenshot()` mirrors `mirror()`'s guards (`selectedDevice()`, state `"device"`, `isValidDeviceId`), then `openScreenshotModal({ deviceName: device.name, deviceId: device.id })`. Disabled rule: same as Mirror, except it is not tied to `mirrorBusy`. Title: `Screenshot <device name>`. Update both `toolbar.render` call sites (the hidden view too).

### 3.6 `style.css`

Add the classes the design needs. Use only existing tokens. Do not restyle `.modal`; add `.modal--shot`. No new colours.

## 4. Edge cases

| Case | Behaviour | Source |
|---|---|---|
| Text before the PNG on stdout | Stripped by `strip_to_png` | §2.2 |
| Device offline or unauthorised | adb fails, message shown in the Capture-failed state | design §3 |
| App blocks screenshots (`FLAG_SECURE`) | Black image, hint line | design §3, §6 |
| User closes the modal mid-capture | Result dropped | §3.3 |
| File dialog cancelled | `Ok(None)`, no UI change | §2.3 |
| `suggested_name` with `..\` or a path | `sanitize_file_name` returns `screenshot.png` | §2.2 |
| Pictures folder missing | `create_dir_all`; on failure the dialog opens with no start dir | §2.3 |
| Copy before any capture | `no_screenshot` | §2.3 |

## 5. Tests (required)

Rust, in `android.rs` `mod tests` (and one in `clipboard.rs` only if it has a test module already; do not touch the real clipboard in a test):
- `strip_to_png`: PNG at offset 0; PNG after a `[Warning] …\n` prefix; no signature gives `None`; empty gives `None`.
- `sanitize_file_name`: accepts `screenshot-20260930-143207.png`; `..\evil.png`, `a/b.png`, `x.txt`, empty and `.PNG` case all behave as §2.2 says (case: `Shot.PNG` is accepted).
- `decode_png_rgba`: build a 2×2 RGBA PNG and a 2×2 RGB PNG with `png::Encoder` in the test; check width, height, and that the RGB case gets alpha 255. A garbage input returns `Err`.
- `android_screenshot` with an unsafe id returns `bad_device_id`; `screenshot_copy` with an empty slot returns `no_screenshot` (build the `State` in the test the way Tauri allows; if that is impractical, test a small pure `take_slot(&ScreenshotSlot) -> Result<Vec<u8>, ApiError>` helper instead and use that in both commands).

Vitest `tests/unit/screenshotFormat.test.ts`: `screenshotFileName` pads single digits (use `new Date(2026, 0, 5, 3, 4, 5)` gives `screenshot-20260105-030405.png`); `isBlackFrame` true for all-zero, false for mid-grey, false for empty, alpha ignored, threshold respected.

## 6. Acceptance (run these yourself; report raw output)

1. `cd gui/src-tauri; cargo test --lib android` gives 0 failures and shows the new tests by name.
2. `cd gui/src-tauri; cargo test --lib clipboard` still passes.
3. `cd gui; cargo fmt --check` prints diffs for `flutter.rs` only.
4. `cd gui; cargo clippy --workspace -- -D warnings` reports errors only at `flutter.rs:451` and `flutter.rs:555`.
5. `cd gui; npx tsc --noEmit` is clean.
6. `cd gui; npx vitest run` passes.
7. `cd gui; cargo tree -i png` shows one `png 0.17.x`.

Read-only device check (allowed): with the phone `RF8W3085JEW` connected, run `adb -s RF8W3085JEW exec-out screencap -p > $env:TEMP\shot.png` and report the first 16 bytes in hex and the size. This proves `exec-out` is binary-clean on this phone. Do not run any other command that changes the phone.

**Not verifiable offline, hand to the owner:** the modal in the running app, Copy pasting into another app, the Save dialog, a black-frame app, an unauthorised device. `npm run package` is run by the reviewer, not the executor.

## 7. Deviations from the design doc

1. **`openModal` gains `role`, `aria-modal` and `aria-labelledby` for all modals**, not only this one. Design §5 wanted the other modals unchanged. `openModal` builds the body before the `.modal` element has a parent, so a body builder cannot reach the `.modal` element to set them. Doing it in `openModal` is smaller and fixes a gap for every modal. No visual change.
2. `openModal` gets `onClose` so the modal can remove its `document` key listener and revoke its object URL on every close path (Esc, backdrop, button).
