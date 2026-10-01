# Mirror screen recording: build spec

Status: APPROVED by the owner on 2026-10-01, with the amendments in **§14**. §14 comes from the two-model spec review (Opus and Fable) and from two more spikes on the owner's phone (§14.1). Where §14 and an earlier section disagree (§3.3 step 8, §3.4, §5.2, §5.3, §5.4, §8.2, §13), §14 wins. Read §14 first.
Scope: `gui/` only. Do not change herdr core (`src/`, `crates/` at the repo root).
Base: the current working tree of `feat/gui-phase1`, **including the owner's uncommitted changes** (`mirror_tools.rs`, `mirrorTools.ts`, `screenshotPanel.ts`, `style.css` and others; `screenshotModal.ts` is deleted). Do not revert or "clean up" any of them.
Read first: `docs/mirror-toolbar-spec.md` (the tools window), `docs/screenshot-spec.md` and `docs/screenshot-design.md` (the panel language), and §12 of this spec (the spike evidence). Where this spec and the owner's brief disagree, this spec wins (see §10).

## 0. Goal

The **Record** button in the mirror tools strip records the phone screen and the device audio to an `.mp4` file.

- Record is a toggle. A click starts a recording. A second click stops it.
- While it records, the button shows a solid red dot with a slow pulse, and an elapsed timer (`m:ss`) shows under the button.
- On stop, the tools window expands to a **result panel**: file name, duration, size, and the buttons **Show in folder**, **Copy path**, **Close**.
- The file goes to `Videos\Cowbell\recording-YYYYMMDD-HHMMSS.mp4`.
- The engine is a second, headless scrcpy process next to the mirror scrcpy. Cowbell stops it with a console Ctrl+C, which makes scrcpy write the MP4 index (`moov`). This is the central problem: an MP4 without `moov` does not play. §12 proves the stop method.
- The recording stops cleanly when the user clicks Stop, the mirror window closes, the tools window closes, or Cowbell exits.
- Windows only. On other targets the feature compiles as a no-op (`cfg(windows)` modules plus `cfg(not(windows))` stubs). Do not bundle scrcpy or ffmpeg.

Success criterion: the offline commands in §8.1 pass, and the owner confirms the live checklist in §8.2.

## 1. Deliverables

| File | Change |
|---|---|
| `src-tauri/src/record.rs` | **new**: constants, pure fns, `RecordingState`, recorder task, 3 commands, auto-stop and exit helpers, tests (§2, §3, §4) |
| `src-tauri/src/record_win32.rs` | **new**, `#[cfg(windows)]` only: console Ctrl+C, the console lock, local time, kill-on-close job (§5) |
| `src-tauri/src/mirror_tools.rs` | `run`: remember why the tracker stopped; stop the recorder after the window closes (§4.2) |
| `src-tauri/src/android.rs` | `check_device_id`, `resolve_adb_from_env`, `local_app_data` become `pub(crate)`. No other change |
| `src-tauri/src/lib.rs` | 2 `mod` lines, `.manage(...)`, 3 commands, the exit path (§4.3) |
| `src-tauri/Cargo.toml` | `windows` features only (§5.1) |
| `src-tauri/capabilities/mirror-tools.json` | the `description` string only: name the new event (§6.6). No permission change |
| `src/flutter/flutterApi.ts` | 4 wrappers and 2 types (§6.1) |
| `src/android/recordFormat.ts` | **new**: pure helpers (§6.2) |
| `src/ui/recordPanel.ts` | **new**: the result panel (§6.4) |
| `src/mirrorTools.ts` | Record toggle, timer, generic panel slot, ended event (§6.3) |
| `src/style.css` | `.mt-btn--recording`, `.mt-timer`, `.rec-*`; remove the 2 unused `aria-disabled` rules (§6.5) |
| `tests/unit/recordFormat.test.ts` | **new** (§7) |

Do NOT touch: `src-tauri/src/flutter.rs` (known `cargo fmt` and clippy failures that are not yours), `src-tauri/src/mirror.rs` (unrelated: the terminal `SurfaceMirror`), `src-tauri/src/engine.rs`, `src-tauri/src/mirror_tools_win32.rs`, `src/ui/screenshotPanel.ts`, `.impeccable/`, `gui/.impeccable/`, the herdr root `src/` and `crates/`, `package.json`, `tauri.conf.json`, `capabilities/default.json`, `src/main.ts`, icons. Existing tests stay unchanged. Do not commit. Do not start scrcpy, do not run the app, and do not run any `adb` command against the phone.

## 2. Pure functions (`record.rs`, unit-tested, all platforms)

Keep them free of Win32 and Tauri types.

```rust
pub const RECORD_START_TIMEOUT: Duration = Duration::from_secs(20);
pub const HEADER_POLL: Duration = Duration::from_millis(100);
pub const STOP_TIMEOUT: Duration = Duration::from_secs(5);
pub const EXIT_FINALIZE_TIMEOUT: Duration = Duration::from_secs(6);
pub const STDERR_TAIL_CHARS: usize = 2000;
/// A file that is not finalized and is smaller than this holds no usable video.
pub const DISCARD_BELOW_BYTES: u64 = 4096;
/// `moov` is read into memory. A 1-hour recording has a `moov` of a few MB.
pub const MOOV_READ_MAX: u64 = 64 * 1024 * 1024;
pub const MAX_NAME_SUFFIX: u32 = 99;
pub const RECORD_DIR_NAME: &str = "Cowbell";
pub const ENDED_EVENT: &str = "mirror-record-ended";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LocalTime { pub year: u16, pub month: u8, pub day: u8, pub hour: u8, pub minute: u8, pub second: u8 }

pub fn recording_file_name(t: LocalTime, n: u32) -> String
pub fn is_recording_file_name(name: &str) -> bool
pub fn recorder_args(device_id: &str, path: &Path) -> Vec<OsString>
pub fn push_tail(tail: &mut String, line: &str, max_chars: usize)
pub fn should_discard(bytes: u64, finalized: bool) -> bool

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mp4Check { pub finalized: bool, pub duration_ms: Option<u64>, pub audio: bool }
pub fn mp4_is_finalized<R: std::io::Read + std::io::Seek>(r: &mut R, len: u64) -> std::io::Result<Mp4Check>
```

### 2.1 Names

- `recording_file_name`: `recording-YYYYMMDD-HHMMSS.mp4`, every field zero-padded. `n <= 1` gives no suffix. `n >= 2` gives `recording-YYYYMMDD-HHMMSS-<n>.mp4`.
- `is_recording_file_name`: true only for `recording-` + 8 ASCII digits + `-` + 6 ASCII digits, then an optional `-` + 1 or 2 digits (no leading `0`), then `.mp4` (lower case only; this is the name Cowbell made). Everything else is false: `..\x.mp4`, `a/b.mp4`, `recording-2026.mp4`, `recording-20261001-114231.MP4`, `recording-20261001-114231-0.mp4`, an empty string.

### 2.2 `recorder_args`

Exactly this order. Build `--record=` with `OsString::push`, so a non-UTF-8 or non-ASCII Videos path survives. scrcpy gets each item as one `argv` entry (no shell), so spaces in the path need no quoting.

```text
-s <device_id>
--no-control            never send input to the phone
--no-window             no window; implies --no-video-playback
--no-audio-playback     the mirror already plays the audio on the PC; do not play it twice
--record-format=mp4
--record=<path>
```

Do not pass `--window-title`, `--time-limit`, `--no-audio`, `--audio-source` or `--max-size`. Defaults: H.264 video at the device's native size, and Opus audio from the `output` source, the same as the mirror (§12, runs E, F, G). The caller validated `device_id` with `check_device_id` (`is_valid_device_id`, `flutter.rs:55`: no leading `-`). `path` is built only from the known folder and `recording_file_name` (§3.3). No part of it comes from the page.

### 2.3 `push_tail`, `should_discard`

- `push_tail`: append `line` and a `\n`, then drop chars from the **front** until `tail.chars().count() <= max_chars`. Keeps the last lines of scrcpy's stderr for an error message.
- `should_discard(bytes, finalized)`: `!finalized && bytes < DISCARD_BELOW_BYTES`. Such a file holds only the 48-byte header or nothing (§12, runs C, H, J).

### 2.4 `mp4_is_finalized` (the box walker)

Never read the whole file: a long recording is hundreds of MB. Walk the **top-level** boxes with seeks.

1. Start at offset 0. While `pos + 8 <= len`: read `size: u32` big-endian and the 4-byte `type`.
   - `size == 1`: read a `u64` large size; the header is 16 bytes (needs `pos + 16 <= len`).
   - `size == 0`: the box runs to the end of the file. (scrcpy's unfinalized `mdat` has `size == 0`; §12.3.)
   - `size < header length`: malformed. Stop the walk.
   - `pos + size > len`: truncated. Stop the walk; this box does not count.
   - Record `ftyp` and `moov` (only when complete). `seek` to `pos + size`.
2. `finalized = has_ftyp && has_moov`.
3. When `moov` is complete and its size is at most `MOOV_READ_MAX`: read it into memory and walk its children with the same box rules.
   - `mvhd`: version byte at payload offset 0. Version 0: `timescale` is the `u32` at payload offset 12, `duration` the `u32` at 16. Version 1: `timescale` at 20 (`u32`), `duration` at 24 (`u64`). `duration_ms = duration * 1000 / timescale` in `u128`, then `u64`. `timescale == 0` or a short payload gives `None`.
   - `trak` → `mdia` → `hdlr`: the handler type is the 4 bytes at payload offset 8. `soun` sets `audio = true`.
   - A larger `moov` gives `duration_ms: None, audio: false`, still `finalized: true`.
4. Any I/O error propagates as `Err`. The caller maps `Err` to `finalized: false`.

Function name: the brief asked for `mp4_is_finalized`. It returns `Mp4Check`, because the result panel also needs the duration and the audio flag. Do not add a second walker.

## 3. State and the recorder (`record.rs`)

### 3.1 Types

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopCause { User, MirrorClosed, ToolsClosed, AppExit, DeviceLost, StartTimeout }

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordResult {
    pub path: String,
    pub file_name: String,
    pub bytes: u64,
    /// `mvhd` duration when finalized and known; else wall-clock seconds since the header appeared.
    pub seconds: f64,
    pub finalized: bool,
    /// The file has an audio track (`hdlr` `soun`).
    pub audio: bool,
    pub cause: StopCause,
    /// The stderr tail when scrcpy exited with a non-zero code or was killed; else `None`.
    pub message: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStarted { pub path: String, pub file_name: String }

pub type RecordOutcome = Result<RecordResult, ApiError>;

#[derive(Clone)]
struct RecorderHandle {
    stop: tokio::sync::mpsc::UnboundedSender<StopCause>,
    done: tokio::sync::watch::Receiver<Option<RecordOutcome>>,
}

/// One recorder per device id. Rust owns it; the page owns only its DOM state.
#[derive(Default)]
pub struct RecordingState(std::sync::Mutex<HashMap<String, RecorderHandle>>);
```

`ApiError` is `Clone` (`commands.rs:182`), so the `watch` value holds it directly.

### 3.2 Ownership and lock discipline

- **The recorder task is the only owner of the scrcpy `Child`** and the only code that removes a map entry. It removes the entry, then publishes the outcome on `done`.
- Commands and auto-stop never touch the child. They send a `StopCause` on `stop` and wait on a clone of `done`.
- The `RecordingState` mutex: lock, clone the handle, unlock. Never hold it across `.await`, a Win32 call or file I/O. Use `lock().unwrap_or_else(|e| e.into_inner())`, as `MirrorToolsState` does.
- The first `StopCause` received wins. Later ones are ignored, and their senders still get the same outcome from `done`.
- The console lock (§5.2) is a separate mutex. It serializes the console calls and the recorder spawn only.

### 3.3 `mirror_record_start`

```rust
#[tauri::command]
pub async fn mirror_record_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RecordingState>,
    device_id: String,
) -> Result<RecordStarted, ApiError>
```

1. `android::check_device_id(&device_id)?`.
2. `window.label() != mirror_tools::tools_label(&device_id)`: `not_mirror_tools`, "Only the mirror tools window can record". Only the page that shows the recording can start one.
3. `cfg(not(windows))`: `unsupported`, "Recording is Windows only".
4. The map already has `device_id`: `already_recording`, "A recording is already running for this device".
5. scrcpy: `android::resolve_scrcpy(PATH, local_app_data())`, else `scrcpy_not_found`, "scrcpy was not found".
6. Folder: `app.path().video_dir()`; on `Err`, `app.path().home_dir()?.join("Videos")`; both fail: `record_dir_failed`, "No Videos folder". Join `RECORD_DIR_NAME`, `create_dir_all`; failure: `record_dir_failed` with the I/O message.
7. Reserve the name: `t = record_win32::local_time()`. For `n` in `1..=MAX_NAME_SUFFIX`: `OpenOptions::new().write(true).create_new(true).open(dir.join(recording_file_name(t, n)))`. `AlreadyExists`: next `n`. Other errors (disk full, access denied): `record_dir_failed` with the message. Close the handle at once (scrcpy opens the file itself and truncates it). All taken: `record_dir_failed`, "Too many recordings in one second". Reason for the reservation: two devices, or a stop and a fast restart, inside one second must not share a name. scrcpy would overwrite the other file.
8. Command: `AsyncCommand::new(scrcpy).args(recorder_args(&device_id, &path))`; `env("ADB", adb)` when `android::resolve_adb_from_env()` is `Some` (one adb for everything; see `start_scrcpy`); `stdin(null)`, `stdout(null)`, `stderr(piped)`; `apply_no_window(&mut cmd)`. **Do not set `kill_on_drop`**: a kill leaves an unplayable file (§12, run J).
   - `CREATE_NO_WINDOW` (from `apply_no_window`) gives the recorder **its own hidden console**. The Ctrl+C in §5.2 needs that console. Do not add `DETACHED_PROCESS` or `CREATE_NEW_PROCESS_GROUP`: both stop Ctrl+C from reaching scrcpy.
9. Spawn **inside the console lock**: `let _guard = record_win32::console_lock(); record_win32::allow_ctrl_c_for_children(); let child = cmd.spawn();` and drop the guard. No `.await` while the guard lives (spawn is synchronous). Spawn error: remove the reserved file, `record_failed` with the message. §5.2 explains why the flag must be cleared before every spawn.
10. `record_win32::assign_to_kill_on_close_job(pid)` (slice 6; log a warning on failure and continue).
11. Create the channels, insert the handle, spawn `run_recorder` (§3.4) with `tauri::async_runtime::spawn`, and await its `started` oneshot.
    - `Ok(())`: return `RecordStarted { path, file_name }`.
    - `Err(e)`: return `e` (§3.4 lists the codes).

### 3.4 The recorder task

```rust
async fn run_recorder(
    app: tauri::AppHandle,
    device_id: String,
    path: PathBuf,
    mut child: tokio::process::Child,
    mut stop_rx: tokio::sync::mpsc::UnboundedReceiver<StopCause>,
    started_tx: tokio::sync::oneshot::Sender<Result<(), ApiError>>,
    done_tx: tokio::sync::watch::Sender<Option<RecordOutcome>>,
)
```

Setup: take `child.stderr` and spawn a drain task. It reads lines with `tokio::io::BufReader::lines` and calls `push_tail` into an `Arc<std::sync::Mutex<String>>` (lock per line, no `.await` while locked). The pipe must be drained for the whole recording, or scrcpy blocks when the pipe buffer fills.

**Phase Starting.** Loop with `tokio::select!` (all branches are cancel-safe):

- `child.wait()` returns: scrcpy exited before the header. Outcome `Err(record_failed, <stderr tail, or "scrcpy exited (<status>)">)`. Common causes: the device is unauthorized or offline, or a second scrcpy is refused.
- `stop_rx.recv()` gives a cause (the user cancelled, or an auto-stop): go to **Stop** with that cause. The start command returns `record_cancelled`, "Recording cancelled".
- `sleep(HEADER_POLL)`: if `metadata(path).len() > 0`, the header exists. Record `header_at = Instant::now()`, send `started_tx.send(Ok(()))`, go to **Recording**. If `RECORD_START_TIMEOUT` passed since spawn: go to **Stop** with `StartTimeout`. The start command returns `record_start_timeout`, "No video arrived from the phone in 20 s. Unlock the phone and try again".

Why the header and not "Recording started" on stdout: scrcpy prints that line at once, but writes nothing until the first video **and** audio packets arrive. A stop before that leaves an empty file: "Recording stopped before headers were processed" (§12, run C). The 48-byte header is the first moment a stop gives a playable file. On the emulator it took 4.2 to 10.3 s (§12.2), so 20 s is the timeout.

**Phase Recording.** `select!`:

- `child.wait()`: scrcpy exited by itself (the phone was unplugged, adb died, disk full). Cause `DeviceLost`. Go to **Finish**. After Finish, tell the tools window with `app.emit_to(tools_label(&device_id).as_str(), …)`: `ENDED_EVENT` with the `RecordResult` when a file was kept, or `FAILED_EVENT` (`mirror-record-failed`, payload `{ code, message }`, code `record_empty`, message the last stderr line) when the file was discarded by `should_discard`. Without the failure event the page would stay in `recording` until the user clicked Stop (§14.4). scrcpy finalizes the file itself in this case (§12, run K).
- `stop_rx.recv()`: go to **Stop** with that cause. No event: the caller gets the outcome from `done`.

**Stop.**

1. `tokio::task::spawn_blocking(move || record_win32::send_ctrl_break(pid))` (§14.2 item 1). Log an `Err` at `warn` and continue.
2. `tokio::time::timeout(STOP_TIMEOUT, child.wait())`. On timeout: `child.start_kill()`, then `child.wait().await`, and set `forced = true`.
3. Go to **Finish**.

The stderr drain gets a 300 ms join and then `abort()` before the tail is read: an adb daemon that inherited the pipe can keep it open for good.

**Finish** (inside `spawn_blocking` for the file work):

1. `bytes = metadata(path).len()` (0 when missing). `check = mp4_is_finalized(&mut File::open(path)?, bytes)`; an error gives `finalized: false`.
2. Starting phase (no header yet) or `should_discard(bytes, finalized)`: `remove_file(path)` (ignore errors). The outcome is the start error described above, or for a stop that the user asked for, `Err(record_empty, "Recording stopped before it started")`.
3. Otherwise `RecordResult`: `seconds` = `duration_ms / 1000.0` when finalized and known, else `header_at.elapsed().as_secs_f64()`; `message` = the stderr tail when `forced` or the exit status was not success, else `None`. A forced stop prefixes the message with "Cowbell had to force-stop the recorder. ".
4. Remove the map entry, then `done_tx.send_replace(Some(outcome))`. If `started_tx` was not used yet, send the start error on it.

Log every outcome at `info` (path, bytes, finalized, cause).

### 3.5 `mirror_record_stop`

```rust
#[tauri::command]
pub async fn mirror_record_stop(
    state: tauri::State<'_, RecordingState>,
    device_id: String,
) -> Result<RecordResult, ApiError>
```

`check_device_id`. No entry: `not_recording`, "No recording is running". Else `stop_and_wait(handle, StopCause::User, STOP_TIMEOUT + Duration::from_secs(2))`:

```rust
async fn stop_and_wait(h: RecorderHandle, cause: StopCause, wait: Duration) -> Option<RecordOutcome>
```

It sends `cause` (a closed channel is fine: the task is already finishing), then `timeout(wait, done.wait_for(|o| o.is_some()))` and clones the value. `None` on timeout. The command maps `None` to `stop_timeout`, "The recorder did not stop". This cannot happen while §3.4 holds (it kills after `STOP_TIMEOUT`); it is a guard only.

### 3.6 `reveal_in_folder` and Copy path

```rust
#[tauri::command]
pub async fn reveal_in_folder(app: tauri::AppHandle, path: String) -> Result<(), ApiError>
```

1. `p = PathBuf::from(&path)`. Reject (code `bad_path`, "Not a Cowbell recording") unless all hold: `p.is_absolute()`; `p.file_name()` is UTF-8 and passes `is_recording_file_name`; `p.is_file()`; and `std::fs::canonicalize(p.parent())` equals `std::fs::canonicalize(<videos dir>/Cowbell)` (same folder rule as §3.3 step 6; compare canonical forms because both carry `\\?\`).
2. `tokio::task::spawn_blocking(move || app.opener().reveal_item_in_dir(&p))` (`tauri_plugin_opener::OpenerExt`). Error: `reveal_failed` with the message.

Why not `explorer.exe /select,<path>`: `explorer.exe` parses its own command line, and a path with a comma or a quote needs Explorer-specific escaping. The opener plugin calls `SHOpenFolderAndSelectItems` directly (`tauri-plugin-opener-2.5.5/src/reveal_item_in_dir.rs:110-140`). Cowbell already uses it (`window_chrome.rs:93`). No process, no argument string.

**Copy path** reuses the existing command `write_clipboard_text(text: String) -> bool` (`commands.rs:586`). It is the single clipboard call site. No new Rust.

## 4. Auto-stop and exit

### 4.1 Helpers (`record.rs`)

```rust
/// Stops the device's recorder, if any, and waits up to `STOP_TIMEOUT + 1 s`.
pub async fn stop_for_device(app: &tauri::AppHandle, device_id: &str, cause: StopCause) -> Option<RecordOutcome>
/// Number of running recorders.
pub fn active_count(app: &tauri::AppHandle) -> usize
/// Sends `AppExit` to every recorder at once, then waits for all of them until one shared deadline.
pub async fn stop_all(app: &tauri::AppHandle, budget: Duration)
/// Exits the app once: at once when nothing records, else after `stop_all(EXIT_FINALIZE_TIMEOUT)`.
pub fn exit_after_finalize(app: &tauri::AppHandle)
```

`stop_all`: clone all handles under one lock, release, send `AppExit` on each, then `timeout_at(deadline, done.wait_for(..))` for each in turn. The deadline is shared, so N recorders still finish in about `budget`. The Ctrl+C calls run one after another under the console lock (about 0.1 s each, §5.2).

`exit_after_finalize`: `static EXITING: AtomicBool`. If `EXITING.swap(true)` was already true: return. If `active_count == 0`: `app.exit(0)`. Else spawn a task: `stop_all(&app, EXIT_FINALIZE_TIMEOUT).await; app.exit(0)`.

Non-Windows: `stop_for_device` returns `None`, `active_count` returns 0, `exit_after_finalize` calls `app.exit(0)` behind the same guard.

### 4.2 `mirror_tools::run`

Change only the Windows `run` and its loop. Add a local `let mut cause = StopCause::MirrorClosed;`. In the loop: the `child.wait()` branch keeps `MirrorClosed`; the "window is gone" branch sets `ToolsClosed`; `Tick::Stop` keeps `MirrorClosed`. After the loop, keep the existing order (destroy the window, `state.release(&label)`), then add:

```rust
crate::record::stop_for_device(&app, &device_id, cause).await;
```

Order reason: the window hides first, so a finalize of up to 5 s never leaves a frozen strip on screen. The recorder does not need the window. If the scrcpy window closed because the phone left, the recorder is already finishing (`DeviceLost`), and `stop_for_device` just waits.

Do not change the early returns: before the tools window exists, no page can start a recording.

### 4.3 `lib.rs`

- `pub mod record;` and `#[cfg(windows)] pub mod record_win32;`, alphabetical.
- `.manage(record::RecordingState::default())` after the `MirrorToolsState` line.
- Register `record::mirror_record_start`, `record::mirror_record_stop`, `record::reveal_in_folder` after `mirror_tools::mirror_tools_resize`.
- `app.run` event match:

```rust
tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. }
    if label == "main" => record::exit_after_finalize(app_handle),
tauri::RunEvent::ExitRequested { code: None, api, .. } if record::active_count(app_handle) > 0 => {
    api.prevent_exit();
    record::exit_after_finalize(app_handle);
}
tauri::RunEvent::Exit => { log_guard.take(); }
```

`exit(0)` stays the final step (`mirror-toolbar-spec.md` §5.4: with a tools window open, Tauri would otherwise keep the process alive). `ExitRequested { code: None }` is the "last window closed" path (`tauri-2.11.6/src/app.rs:225-232`). `exit(0)` gives `code: Some(0)`, so the guard does not loop. While the finalize runs, the main window is already gone and the tools windows stay up. The process ends at most `EXIT_FINALIZE_TIMEOUT` (6 s) after the main window closes.

Not covered, by design: `engine::restart_gui` calls `app.restart()`, which `prevent_exit` cannot stop (`app.rs:86-94`). A restart during a recording loses the file's index; the job (§5.4) kills the recorder. Do not edit `engine.rs`. A Task Manager kill or a crash: the same.

## 5. Win32 (`record_win32.rs`, `#[cfg(windows)]`)

### 5.1 `Cargo.toml`

Extend the existing `windows` feature list (same crate `windows 0.61.3`, nothing new downloads):

```toml
    "Win32_System_Console",          # record_win32.rs: Ctrl+C to the recorder
    "Win32_System_SystemInformation", # GetLocalTime for the file name
    "Win32_System_JobObjects",       # kill-on-close job (slice 6)
    "Win32_System_Threading",        # OpenProcess; JOBOBJECT_EXTENDED_LIMIT_INFORMATION needs it
    "Win32_Security",                # CreateJobObjectW's SECURITY_ATTRIBUTES parameter
```

Verified in `windows-0.61.3`: `AttachConsole(u32) -> Result<()>`, `FreeConsole`, `GenerateConsoleCtrlEvent(u32, u32)`, `SetConsoleCtrlHandler(PHANDLER_ROUTINE, bool)`, `GetConsoleWindow`, `CTRL_C_EVENT = 0`, `ATTACH_PARENT_PROCESS` (`System/Console/mod.rs`); `GetLocalTime() -> SYSTEMTIME` (`System/SystemInformation/mod.rs:43`); `CreateJobObjectW` (needs `Win32_Security`), `SetInformationJobObject`, `AssignProcessToJobObject`, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, `JobObjectExtendedLimitInformation` (`System/JobObjects/mod.rs`); `OpenProcess` (`System/Threading/mod.rs:1192`). Confirm with `cargo tree -i windows@0.61.3 --target x86_64-pc-windows-msvc`. If cargo resolves a second `windows` version, stop and report.

### 5.2 Ctrl+C: the stop method (proven in §12)

```rust
pub fn console_lock() -> std::sync::MutexGuard<'static, ()>
/// `SetConsoleCtrlHandler(None, false)`. Call under `console_lock`, right before spawning a recorder.
pub fn allow_ctrl_c_for_children()
/// Sends CTRL_C_EVENT to the console of `pid`. Takes `console_lock` itself.
pub fn send_ctrl_c(pid: u32) -> Result<(), String>
```

`console_lock`: a `static CONSOLE_LOCK: std::sync::Mutex<()>`; recover a poisoned lock with `into_inner`.

`send_ctrl_c`, in this exact order, all under the lock:

1. `had_console = !GetConsoleWindow().is_invalid()` (debug builds have a console; release builds do not, `main.rs:2`).
2. `FreeConsole()` (ignore the result: a GUI process has no console, and that is fine).
3. `AttachConsole(pid)`. Error: return `Err` (the process is gone, or it has no console).
4. `SetConsoleCtrlHandler(None, true)`: **Cowbell ignores Ctrl+C from now on.** Without this, the event also reaches Cowbell, which is now attached to the same console, and Cowbell dies with `STATUS_CONTROL_C_EXIT` (§12, run B).
5. `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)`. Group 0 = every process on that console: scrcpy and the adb clients it started. The mirror scrcpy has its own console and does not get it (§12: the mirror pid stayed alive in every run).
6. `FreeConsole()`.
7. `std::thread::sleep(Duration::from_millis(100))` before the lock drops. The event reaches each attached process on its own thread. The sleep makes sure Cowbell has received (and ignored) it before any later code clears the ignore flag (§3.3 step 9). scrcpy exited 25 to 84 ms after the event (§12.2).
8. If `had_console`: `let _ = AttachConsole(ATTACH_PARENT_PROCESS);` (debug builds only; best effort, unverified).
9. Return `Ok(())` when step 5 succeeded, else `Err` with the Win32 error.

**Counterintuitive, and the reason for `allow_ctrl_c_for_children`:** the "ignore Ctrl+C" flag is inherited by child processes. After step 4, Cowbell ignores Ctrl+C for the rest of its life. A recorder spawned later would inherit the flag, ignore the next stop, and leave an unplayable file. Run H in §12 reproduced exactly that: Generate succeeded, scrcpy ignored it for 20 s, the file had no `moov`. So every recorder spawn clears the flag first, under the same lock (§3.3 step 9). Cowbell can also inherit the flag from whatever launched it (a terminal, `tauri dev`); the clear covers that too. Other children Cowbell spawns (adb, the mirror scrcpy) may inherit the ignore flag. Nothing sends them Ctrl+C, so that is harmless.

Do **not** replace step 4 with a handler routine that returns `TRUE`. In §12 run B, a handler routine did not protect the caller, and the host died with `0xC000013A`. The `NULL` form is the documented and proven one.

### 5.3 Local time

```rust
pub fn local_time() -> crate::record::LocalTime   // GetLocalTime(); wYear, wMonth, wDay, wHour, wMinute, wSecond
```

Non-Windows: `record.rs` never calls it (the start command returns `unsupported` first).

### 5.4 Kill-on-close job (slice 6)

```rust
/// Puts `pid` in one process-wide job with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
pub fn assign_to_kill_on_close_job(pid: u32) -> Result<(), String>
```

A `static JOB: OnceLock<isize>` holds the job handle, created on first use with `CreateJobObjectW(None, PCWSTR::null())` and `SetInformationJobObject(JobObjectExtendedLimitInformation)` with `BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Then `OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid)`, `AssignProcessToJobObject`, `CloseHandle` on the process handle. Never close the job handle: Windows closes it when Cowbell's process ends, and the job then kills any recorder still alive.

Why: the recorder has no time limit. If Cowbell crashes or is killed, an orphan recorder would grow its file until the phone is unplugged. The file of a crashed session is lost either way (no `moov`). The job keeps the disk safe. On a normal exit, `stop_all` runs first, so the job kills nothing. Nested jobs work on Windows 8 and later; a failure only logs a warning.

## 6. Frontend

### 6.1 `flutterApi.ts`

```ts
export type StopCause = "user" | "mirror_closed" | "tools_closed" | "app_exit" | "device_lost" | "start_timeout";
export interface RecordResult {
  path: string; fileName: string; bytes: number; seconds: number;
  finalized: boolean; audio: boolean; cause: StopCause; message: string | null;
}
export interface RecordStarted { path: string; fileName: string }

/** Mirror tools window only. Resolves when the file has its header (the recording is real). */
export function mirrorRecordStart(deviceId: string): Promise<RecordStarted>    // invoke("mirror_record_start", { deviceId })
export function mirrorRecordStop(deviceId: string): Promise<RecordResult>      // invoke("mirror_record_stop", { deviceId })
export function revealInFolder(path: string): Promise<void>                     // invoke("reveal_in_folder", { path })
/** Plain invoke: `invokeSafe` writes to `#error-notices`, which the tools page does not have. */
export function writeClipboardText(text: string): Promise<boolean>              // invoke<boolean>("write_clipboard_text", { text })
```

Rejections are `{ code, message }` (`ApiError`).

### 6.2 `src/android/recordFormat.ts` (pure, no DOM)

```ts
/** "m:ss". Minutes are not capped (75:03). Negative or NaN gives "0:00". Floors to whole seconds. */
export function formatElapsed(ms: number): string
/** 1024-based, one decimal from KB up: "0 B", "999 B", "1.0 KB", "12.4 MB", "1.5 GB". */
export function formatBytes(bytes: number): string
export type RecState = "idle" | "starting" | "recording" | "stopping" | "result" | "error";
export interface RecordButtonView { pressed: boolean; busy: boolean; recording: boolean; icon: string; title: string }
/** The Record button for each state. `result` and `error` look like `idle`. */
export function recordButtonView(state: RecState): RecordButtonView
```

`recordButtonView`:

| state | pressed | busy | recording | icon | title |
|---|---|---|---|---|---|
| `idle`, `result`, `error` | false | false | false | `circle-filled` | `Record` |
| `starting` | true | true | false | `loading` | `Starting… (click to cancel)` |
| `recording` | true | false | true | `circle-filled` | `Stop recording` |
| `stopping` | true | true | false | `loading` | `Saving the recording…` |

### 6.3 `mirrorTools.ts`

Keep everything that is there. Changes:

**Panel slot.** Replace `panel: ScreenshotPanel | undefined` with `panel: { dispose(): void; focusInitial(): void } | undefined` plus `panelKind: "shot" | "record" | undefined`. Extract `openPanel(kind, mount)`:

1. If not expanded: `setSide(await mirrorToolsResize(true))`, `expanded = true`, unhide `.mt-panel`. Errors propagate to the caller.
2. Else: `panel?.dispose()`, empty `.mt-panel` (`textContent = ""`), and remove its `shot-body*`/`rec-body` classes (the panels add them to the container; re-mounting into the same element must start clean).
3. `panel = mount(panelEl)`, `panelKind = kind`, Screenshot `aria-pressed` = `kind === "shot"`, `window.setTimeout(() => panel?.focusInitial(), 0)`.

`collapse()` disposes whatever panel is open and sets `panelKind = undefined`. Screenshot click: `panelKind === "shot"` → `capture()`; else `openPanel("shot", …)` (this also replaces an open result panel). Esc keeps closing any panel. **Esc never stops a recording.**

**Rule for both panels** (the brief asked to decide it):
- Starting a recording does not touch the panel area. An open screenshot panel stays usable during a recording (screencap and scrcpy run side by side).
- When a recording ends (Stop, or the ended event), the result panel **replaces** whatever panel is open, the screenshot panel included.
- A Screenshot click replaces an open result panel.
- One panel at a time; the window size does not change between them.

**Record button DOM.** Remove `aria-disabled` and the "coming soon" code. Add after the button:

```text
button.mt-btn.mt-btn--record   aria-label "Record"  aria-pressed  (aria-busy while busy)  title from recordButtonView
p.mt-timer                     hidden unless state is "recording" or "stopping"
```

`render()` applies `recordButtonView(recState)`: `aria-pressed`, `aria-busy` (`"true"` or removed), `title`, the icon class (`codicon codicon-loading codicon-modifier-spin` when `busy`, else `codicon codicon-circle-filled`), and `.mt-btn--recording` when `recording`.

**Timer.** `startedAt = performance.now()` when `mirrorRecordStart` resolves. A `window.setInterval(tick, 500)` sets `timer.textContent = formatElapsed(performance.now() - startedAt)` (computed from the clock, never by counting ticks). The interval stops in `stopping`; the frozen value stays until the result shows. Clear it on every exit from `recording`.

**Live region** (the existing `.shot-sr` in the strip). Clear it, then set the text in a `setTimeout(…, 0)` (the existing pattern: a screen reader does not repeat the same text). Texts: `Recording started`, `Recording cancelled`, `Saving the recording`, `Recording saved, <fileName>, <formatElapsed>` (or `Recording may be damaged, <fileName>`), `Recording failed. <message>`.

**Click handler** (`recState`):

- `idle`, `result`, `error`: `recState = "starting"`, render, announce nothing yet. `await mirrorRecordStart(params.deviceId)`:
  - Resolves: `"recording"`, start the timer, announce `Recording started`.
  - `record_cancelled`: `"idle"`, announce `Recording cancelled`.
  - Other error: `"error"`, `showNote("Failed", errorMessage(err))`, announce `Recording failed. <message>`.
- `starting`: cancel. `recState = "stopping"`, render. `await mirrorRecordStop(deviceId)`; any result or error ends in `"idle"` (the start call above reports `record_cancelled`; ignore `record_empty` and `not_recording` here).
- `recording`: `recState = "stopping"`, render, announce `Saving the recording`. `await mirrorRecordStop(deviceId)`:
  - Resolves: `showResult(result)`.
  - `not_recording`: the recorder ended on its own a moment ago. If `lastEnded` is set, `showResult(lastEnded)`; else `"idle"`.
  - Other error: `"error"`, note `Failed` with the message as `title`, announce.
- `stopping`: ignore the click.

**Ended event.** `await listen<RecordResult>(ENDED_EVENT, …)` next to the existing `mirror-tools-side` listener. Always store the payload in `lastEnded`. If `recState` is `"recording"`: `showResult(payload)`. In any other state, do nothing more (a stop in flight returns the same result).

**Failed event.** `await listen<unknown>("mirror-record-failed", …)`. If `recState` is `"recording"`: stop the timer, `recState = "idle"`, render, show the note `Failed` with the message (`recordFailureText(payload)`) as its `title`, and announce `Recording failed. <message>`. In any other state, do nothing (a stop in flight gets `record_empty` from its own call).

**`showResult(result)`**: stop the timer, `recState = "result"`, render. Then `openPanel("record", (el) => mountRecordPanel(el, { result, onClose: () => void collapse() }))`. If `openPanel` rejects with `no_room`: show the note `Saved` with `result.path` as its `title`; announce as above. The file is saved either way.

Do not import anything new beyond `recordFormat.ts`, `recordPanel.ts` and the `flutterApi.ts` wrappers (the import rules of `mirror-toolbar-spec.md` §6.3 still hold).

### 6.4 `src/ui/recordPanel.ts`

```ts
export interface RecordPanelOptions { result: RecordResult; onClose: () => void }
export interface RecordPanel { focusInitial(): void; dispose(): void }
export function mountRecordPanel(container: HTMLElement, opts: RecordPanelOptions): RecordPanel
```

It reuses the screenshot panel's classes, so it looks like the same family: stacked body, matte frame, a meta block under the frame, the button row, a quiet Close. It must not import `screenshotPanel.ts` or `./modal`. DOM through `createElement` and `textContent` only (`message` is scrcpy's stderr, untrusted):

```text
container  + .shot-body .shot-body--stacked .rec-body
  .shot-preview
    .shot-frame
      .shot-placeholder .rec-status         (+ .shot-placeholder--error when !finalized)
        i.codicon  device-camera-video  (finalized)  |  warning  (not finalized)
        span       "Recording saved"            |  "The recording may be damaged"
        span.shot-error-text  message           (only when message is not null; title = full message)
  .shot-actions .rec-actions
    .shot-meta                               rows: fileName (title = path) · formatElapsed(seconds*1000) · formatBytes(bytes) · "No audio" when !audio
    button.btn.shot-btn.btn--primary   folder-opened  "Show in folder"   title "Show in folder"
    button.btn.shot-btn                copy           "Copy path"        title "Copy the file path"
    p.shot-failure  role="alert"  hidden
    div.shot-sr     aria-live="polite"
    button.btn.shot-btn.shot-btn--close  close  "Close"
```

- **Show in folder**: `revealInFolder(result.path)`. Busy spinner on the glyph while it runs (as `doCopy` does in `screenshotPanel.ts`). Error: the failure line with `errorMessage(err)`.
- **Copy path**: `writeClipboardText(result.path)`. `true`: the glyph becomes `codicon-check shot-done` and the label `Copied` for 1600 ms, announce `Path copied`. `false`: the failure line `Could not copy the path`.
- **Close**: `opts.onClose()`.
- `focusInitial()`: focus Show in folder. `dispose()`: set `closed`, clear the flash timer. Results that arrive after `dispose` change nothing.
- The panel adds no `document` key listener. Esc is handled by `mirrorTools.ts`.

### 6.5 `style.css`

Existing tokens only; no new colours, fonts or shadows. Keep the `.mt-*` and `.shot-*` conventions and the polish in the tree (28 px strip buttons, matte frame, quiet Close).

- Delete the two `.mt-btn[aria-disabled="true"]` rules and their comment (`style.css:1661-1670`). Only the Record placeholder used them (`grep aria-disabled src` finds only `mirrorTools.ts:73`, which this change removes). Keep `.mt-btn--record .codicon { color: var(--herdr-danger); }`: the dot is now solid, not dimmed.
- `.mt-btn--recording .codicon { animation: mt-pulse 1.6s ease-in-out infinite; }` with `@keyframes mt-pulse { 50% { opacity: 0.45; } }`. In `@media (prefers-reduced-motion: reduce)`: `.mt-btn--recording .codicon { animation: none; }`. The pressed background and the inset accent edge come from the existing `[aria-pressed="true"]` rules, so a static recording state is still clear.
- `.mt-btn[aria-busy="true"] { cursor: progress; }`.
- `.mt-timer { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--menu-foreground); margin-top: -4px; }` and `.mt-timer[hidden] { display: none; }`. Strip budget at 132 px: padding 8 + 28 + gap 8 + 28 + gap 8 + timer about 14 = 94 px, plus the note when it shows. `STRIP_HEIGHT` does not change.
- `.shot-body--stacked .rec-actions { grid-template-columns: 1fr 1fr; }` and `.rec-actions .shot-btn--close { grid-column: 1 / -1; }`. Reason: three columns in 296 px give 93 px each, and "Show in folder" needs about 118 px. Show in folder and Copy path share row 1; the quiet Close spans row 2.
- `.rec-status { gap: 8px; }`, `.rec-status .codicon { font-size: 28px; }`. The frame keeps the placeholder's size from `.shot-body--stacked .shot-placeholder`, so switching between the two panels does not move the buttons.

### 6.6 Capabilities

No new permission. Custom commands need no ACL entry: Tauri checks the ACL for a local-origin app command only when the app defines an ACL manifest (`tauri-2.11.6/src/webview/mod.rs:1819-1826`), and `build.rs` calls plain `tauri_build::build()`. `listen` for `mirror-record-ended` is covered by `core:event:allow-listen` in `capabilities/mirror-tools.json:5-6` (the permission is not per event name). Edit only that file's `description`: "…`core:event:allow-listen` for the `mirror-tools-side` and `mirror-record-ended` events…". `write_clipboard_text` and `reveal_in_folder` are app commands, so they need nothing either. The opener plugin is called from Rust, so the webview gets no `opener:*` permission (`default.json:4`).

## 7. Tests (required)

Rust, `record.rs` `mod tests`, table-driven where the list is long:

- `recording_file_name`: `LocalTime { 2026, 1, 5, 3, 4, 5 }`, n 1 gives `recording-20260105-030405.mp4`; n 2 gives `recording-20260105-030405-2.mp4`; n 0 gives no suffix; December 31 23:59:59 pads correctly.
- `is_recording_file_name`: the 2 names above are true; `recording-20260105-030405-99.mp4` true; false for `..\recording-20260105-030405.mp4`, `a/recording-20260105-030405.mp4`, `recording-20260105-030405.MP4`, `recording-2026010-030405.mp4`, `recording-20260105-030405-0.mp4`, `recording-20260105-030405-100.mp4`, `recording-20260105-030405.mp4.exe`, `""`.
- `recorder_args`: the exact list for `RF8W3085JEW` and `C:\Users\A B\Videos\Cowbell\recording-20260105-030405.mp4`; the path stays one item; `--no-control`, `--no-window` and `--no-audio-playback` are present; no `--window-title`.
- `push_tail`: keeps the last chars; a multi-byte char is never split; a short tail is unchanged.
- `should_discard`: table over (0, false), (48, false), (4095, false), (4096, false), (48, true), (100_000, false).
- `mp4_is_finalized` (build boxes in the test with a `bx(type, payload) -> Vec<u8>` helper; feed a `std::io::Cursor`):
  - **The real unfinalized file from §12.3**, as a byte literal: `finalized: false`.
  - `ftyp + free + mdat + moov(mvhd v0, timescale 1000, duration 4533, trak/mdia/hdlr "soun")`: finalized, `Some(4533)`, `audio: true`.
  - Same with only a `vide` handler: `audio: false`.
  - `mvhd` version 1 (64-bit duration): correct ms.
  - `timescale 0`: finalized, `duration_ms: None`.
  - `moov` declared longer than the file (truncated): not finalized.
  - A `size == 1` large-size `mdat` before `moov`: finalized.
  - `mdat` with `size == 0` (to EOF) and no `moov`: not finalized.
  - A box with `size 4` (smaller than its header): not finalized, no panic, no endless loop.
  - Empty input and 7 bytes of garbage: not finalized.
- `RecordingState`: a second start for one device id is refused (test the small pure helper `try_insert(&RecordingState, id, handle) -> bool` if building a `State` is impractical).
- `mirror_record_stop` for an unsafe id returns `bad_device_id`; for an unknown id returns `not_recording` (build the state directly, or test `stop_and_wait`'s caller helper).
- `reveal_in_folder` validation as a pure helper `check_recording_path(path: &Path, dir: &Path) -> Result<(), ApiError>` tested with a temp dir: a good file passes; a `.txt`, a file outside the dir, a relative path, a missing file and a `..` path give `bad_path`.

Vitest, `tests/unit/recordFormat.test.ts`: `formatElapsed` (0, 999, 1000, 59_999, 60_000, 75*60_000+3_000 gives `75:03`, -5, NaN); `formatBytes` (0, 999, 1024, 1536, 12.4 MB, 1.5 GB); `recordButtonView` for all six states, and `result`/`error` equal `idle`.

No DOM test for the panel (`vitest.config.ts` uses the `node` environment).

## 8. Acceptance

### 8.1 Offline (run these yourself; report raw output)

Run from `gui/`:

1. `cargo test --lib -p herdr-gui record` gives 0 failures and lists the new tests by name.
2. `cargo test --lib -p herdr-gui` gives 0 failures (the mirror_tools and android tests still pass).
3. `cargo fmt --check -- src-tauri/src/record.rs src-tauri/src/record_win32.rs src-tauri/src/mirror_tools.rs src-tauri/src/android.rs src-tauri/src/lib.rs` prints nothing. (A plain `cargo fmt --check` also prints the known `flutter.rs` diffs; those are not yours.)
4. `cargo clippy --workspace -- -D warnings` reports errors only in `flutter.rs` (the 2 known spots, near lines 449 and 555).
5. `cargo tree -i windows@0.61.3 --target x86_64-pc-windows-msvc` shows one `windows` version, and the build downloads nothing.
6. `npx tsc --noEmit` is clean.
7. `npx vitest run` passes: the 750 existing tests plus the new ones.
8. `npm run build` succeeds.

**Not verifiable offline:** everything in §8.2, the console Ctrl+C from the real Cowbell process (proven only from a C# GUI-subsystem model, §12), the debug-build console re-attach (§5.2 step 8), the job object, and a `cfg(not(windows))` build (only `x86_64-pc-windows-msvc` is installed; review the stubs by eye).

### 8.2 Live checklist (owner)

Start Cowbell with `npm run tauri dev`, open a Flutter workspace, connect the phone, unlock it.

1. Mirror. Click Record: the spinner shows ("Starting…"), then within a few seconds the solid red dot pulses and the timer counts `0:01`, `0:02`… scrcpy keeps the focus and keeps playing sound once (not twice).
2. Play something with sound on the phone for about 10 s. Click Record again: the spinner shows briefly, then the result panel shows "Recording saved", the file name, a duration near 10 s, and a size.
3. Open the file from `Videos\Cowbell` in the Windows Media Player or Films & TV app: video and sound play, and the length matches.
4. Show in folder: Explorer opens with the file selected. Copy path: paste into Notepad gives the full path.
5. Esc closes the panel. Record, then Screenshot during the recording: the screenshot panel works; Stop replaces it with the result panel.
6. Record, then close the scrcpy window: the strip closes; within about 5 s the file in `Videos\Cowbell` plays.
7. Record, then Alt+F4 on the strip: same result.
8. Record, then close Cowbell: Cowbell exits within about 6 s; the file plays.
9. Record, then unplug the phone: the result panel shows (the file is finalized by scrcpy); or, if the strip closed with the mirror, the file plays.
10. Click Record and click again during "Starting…": it cancels, and no file is left behind.
11. Phone screen off or locked during a recording: the recording continues, and the video is black or frozen. **Note only; no detection.**
12. Reduced motion on (Windows Settings, Accessibility, Visual effects, Animation effects off): the dot does not pulse.
13. With a screen reader (Narrator): Record announces "Record, toggle button", and the live region reads "Recording started" and "Recording saved, …".

## 9. Edge cases

| Case | Behaviour | Source |
|---|---|---|
| Second scrcpy beside the mirror | Works; the mirror keeps running | §12, runs F, G |
| Phone unauthorized, offline, or a second scrcpy refused | scrcpy exits early: `record_failed` with the stderr tail | §3.4 Starting |
| Stop before the header exists (cancel) | scrcpy exits, the empty file is deleted, `record_cancelled` | §12, run C; §3.4 |
| No header within 20 s | `record_start_timeout`, the empty file is deleted | §3.4 |
| Ctrl+C ignored (inherited flag) | Prevented: the flag is cleared before every spawn | §12, run H; §5.2 |
| Recorder does not exit in 5 s after Ctrl+C | Killed; result `finalized: false`, "may be damaged" panel, the file is kept if ≥ 4 KB | §3.4 Stop |
| Phone unplugged / adb dies mid-recording | scrcpy finalizes and exits (code 2); the ended event shows the result | §12, run K |
| Mirror window closed | Tools window closes, then the recorder stops cleanly | §4.2 |
| Tools window closed (Alt+F4) | Recorder stops cleanly | §4.2 |
| Main window closed / app exit | Recorders finalize, at most 6 s, then `exit(0)` | §4.3 |
| `restart_gui`, crash, Task Manager kill | File not finalized; the job kills the recorder | §4.3, §5.4 |
| Two recordings in the same second | Different names (`-2`), reserved with `create_new` | §3.3 step 7 |
| Videos folder missing or unwritable, disk full at start | `record_dir_failed` | §3.3 |
| Disk fills during a recording | scrcpy fails and exits; the ended event shows a not-finalized result with scrcpy's message (unverified) | §3.4 |
| Phone without audio capture (Android 10 and older) | scrcpy records video only (no `--require-audio`); the meta shows "No audio" | §2.2, §6.4 |
| Static phone screen | The video track is short; the audio track keeps the duration right (run D shows 0.23 s of video without audio) | §12, run D |
| No room for the result panel | Note "Saved" with the path in its `title` | §6.3 |
| Path passed to `reveal_in_folder` is not a Cowbell recording | `bad_path` | §3.6 |
| Esc during a recording | Closes a panel only; never stops the recording | §6.3 |

## 10. Deviations and decisions

1. **Ctrl+C through the recorder's console is the primary stop**, not `WM_CLOSE`. Both finalize the file (§12). Ctrl+C needs no window (no flash, no SDL renderer decoding video for nothing) and exits in 25 to 84 ms; `WM_CLOSE` took 1040 ms.
2. **Plan B, documented, not built:** if the live check shows Ctrl+C failing, switch `recorder_args` to a hidden window (`--window-title=<unique>`, `--window-borderless`, 1×1 at 0,0), hide it with `ShowWindow(SW_HIDE)` when `find_window` sees it, and stop with `PostMessageW(WM_CLOSE)`. Run I proved it. The window was not yet visible when found 3.8 s after spawn, but a 1×1 flash cannot be ruled out.
3. **Ordered stop fallback:** Ctrl+C → wait `STOP_TIMEOUT` → kill. A kill always gives an unplayable file (run J). The result then says so; Cowbell never claims a damaged file is fine.
4. **The recording "starts" when the file has its header**, not at spawn. The timer starts then. Before that, the UI shows "Starting…" and a click cancels.
5. **`reveal_in_folder` uses the opener plugin's `reveal_item_in_dir`**, not `explorer.exe /select,…` (§3.6).
6. **`reveal_in_folder` accepts only Cowbell recordings** (the name pattern, inside `Videos\Cowbell`), so the command cannot open arbitrary paths.
7. **`mp4_is_finalized` returns a struct** (`Mp4Check`), and it reads top-level boxes with seeks, plus `moov` (≤ 64 MiB) in memory.
8. **No new crate.** The file-name time comes from `GetLocalTime`, not `chrono`; 5 more `windows` features of the same crate version.
9. **The kill-on-close job** is an addition to the brief (§5.4). It is slice 6 and can be dropped alone.
10. **No result panel after an auto-stop that closed the tools window** (mirror closed, Alt+F4, app exit). The window is gone. The file is saved and logged at `info`. A main-window notice is a later feature.
11. **The result panel keeps the expanded window size**, and its frame matches the screenshot placeholder, so the two panels swap without a jump.
12. **Record button labels:** `aria-label` stays "Record"; the toggle state is `aria-pressed`, and the tooltip says "Stop recording" while recording.
13. **The emulator stood in for the phone in the spike.** The phone `RF8W3085JEW` was `offline` for the whole session (its transport id kept changing), and no owner mirror was running. §12.1 states this. The stop mechanism is a Windows console and scrcpy behaviour, so it does not depend on the device. The audio and resolution facts do (§11).

## 11. Risks and how this could be wrong

- **Second audio capture on the real phone.** On the emulator (Android 16), a recorder with the default `output` audio source ran beside a mirror that also captures audio (run F). A Samsung build may refuse a second capture. Symptoms: `record_start_timeout` (if scrcpy waits for audio forever) or a file with "No audio" (if scrcpy falls back to video only). Checklist steps 1 to 3 catch it. Fix in one line: add `--audio-source=playback` (run G: works beside the mirror) or, as a last resort, `--no-audio`.
- **Ctrl+C from the real Cowbell process.** Proven from a C# GUI-subsystem exe that spawns scrcpy with `CREATE_NO_WINDOW`, the same flags as Cowbell. Rust and WebView2 threads add nothing to the console path, but this is not tested in Cowbell itself. Symptom: the stop takes 5 s and the panel says "may be damaged". Check the log for the `send_ctrl_c` warning. Fallback: §10 item 2.
- **Debug builds lose their console output after the first stop** (`FreeConsole`). Logs go to `%LOCALAPPDATA%\herdr-gui\logs\herdr-gui.log` anyway. The re-attach in §5.2 step 8 is best effort and unverified. Release builds have no console, so they are not affected.
- **Start latency.** On the emulator the header took 4.2 to 10.3 s, and twice more than 10 s right after boot. A real phone is usually faster. If the owner sees frequent `record_start_timeout`, raise `RECORD_START_TIMEOUT`.
- **Duration on a static screen.** scrcpy sends video frames only when the screen changes. With audio, `mvhd` covers the real length (run E: 4.53 s); without audio, a static screen gives a short video (run D: 0.23 s for about 0.5 s of header-to-stop time). `seconds` reports `mvhd`, so a silent, static recording can show a shorter duration than the timer did.
- **Large files and `moov` size.** `MOOV_READ_MAX` is 64 MiB; a `moov` above it still counts as finalized, but without a duration. Not seen in the spike (moov 0.8 to 6.7 KB for short files).
- **The console lock and the 100 ms sleep** serialize all stops. With N recorders, an exit takes about N × 0.1 s plus the slowest finalize. Fine for one person with one or two phones.
- **The "ignore Ctrl+C" flag stays set in Cowbell** after the first stop and is inherited by later non-recorder children (adb, the mirror scrcpy). Nothing sends them Ctrl+C today. If a later feature does, it must clear the flag before its own spawn, as §3.3 step 9 does.

## 12. Evidence (the spike, 2026-10-01)

### 12.1 Setup

- scrcpy 4.1 (`…\Genymobile.scrcpy_…\scrcpy-win64-v4.1\scrcpy.exe`, SDL 3.4.12, libavcodec 62.28). adb 36.0.2 at `%LOCALAPPDATA%\Android\sdk\platform-tools\adb.exe`.
- The phone `RF8W3085JEW` was `offline` throughout (`adb devices -l`: `offline transport_id:73` … `115`, the id climbing every few seconds). No owner scrcpy was running (`Get-Process scrcpy` returned nothing). No command touched the phone.
- Target: the local `Pixel_6a` AVD (`emulator -avd Pixel_6a -no-window -no-snapshot-save -no-boot-anim`), Android 16, booted in about 40 s. A **stand-in mirror** (my own process): `scrcpy -s emulator-5554 --no-control "--window-title=Cowbell mirror emulator-5554"`.
- **Host model of Cowbell:** `RecHost.exe`, C# compiled with `Add-Type -OutputType WindowsApplication` (GUI subsystem, no console: it logged `hasConsole=False`). It spawns scrcpy with `ProcessStartInfo { UseShellExecute = false, CreateNoWindow = true }`, which is `CREATE_NO_WINDOW` (Cowbell's `apply_no_window`, `engine.rs:125-132`), stdout and stderr piped. It polls the file size every 50 ms, stops scrcpy after N seconds, and logs the time from signal to exit.
- Recorder arguments in every run: `-s emulator-5554 --no-control --record=<file> --record-format=mp4 --no-window --no-audio-playback` (run I: a 1×1 borderless window instead of `--no-window`).
- Validity check: a top-level MP4 box walker (C#, the same rules as §2.4), plus `hdlr` and `stsd` for the track list.

### 12.2 Results

| Run | Stop method | Notes | Signal → exit | Exit code | File | Walker |
|---|---|---|---|---|---|---|
| A | Ctrl+C, NULL-ignore, from a PowerShell host spawned under Git Bash | ignore flag inherited, not cleared | no exit in 10 s, killed | -1 | 48 B | ftyp, free, mdat; **no moov** |
| B | Ctrl+C with a handler routine returning TRUE (no NULL-ignore) | flag cleared before spawn | n/a | host died `0xC000013A` | 0 B | nothing |
| C | Ctrl+C, NULL-ignore | flag cleared; stopped at 10 s, before the header | 25 ms | 0 | 0 B | nothing; stderr: "Recording stopped before headers were processed" |
| D | Ctrl+C, NULL-ignore, `--no-audio` | header at 9.6 s | 63 ms | 0 | 55 862 B | ftyp free mdat moov; **FINALIZED**; 0.23 s; vide avc1 1080×2400 |
| E | Ctrl+C, NULL-ignore, mirror closed | header at 7.1 s | 84 ms | 0 | 88 347 B | **FINALIZED**; 4.53 s; vide avc1 1080×2400 + soun Opus |
| F | Ctrl+C, NULL-ignore, **beside the mirror** | header at 6.6 s | 30 ms | 0 | 92 029 B | **FINALIZED**; 8.65 s; soun Opus + vide avc1 1080×2400 |
| G | as F, `--audio-source=playback` | header at 6.7 s | 50 ms | 0 | 89 609 B | **FINALIZED**; 7.29 s; vide avc1 + soun Opus |
| H | Ctrl+C, NULL-ignore, **flag NOT cleared** (GUI host launched from PowerShell) | header at 10.3 s | no exit in 20 s, killed | -1 | 48 B | **no moov** |
| I | `WM_CLOSE` to a 1×1 borderless window, hidden with `SW_HIDE` | window found at 3.8 s (`visible=False`); header at 7.8 s | 1040 ms | 0 | 89 388 B | **FINALIZED**; 6.69 s; vide + soun; stderr: "Killing the server..." |
| J | `TerminateProcess` (the `taskkill /F` baseline) | header at 4.2 s | 8 ms | -1 | 48 B | ftyp free mdat(size 0); **no moov** |
| K | none: `adb -s emulator-5554 emu kill` at 11 s (device lost) | header at 9.1 s | self-exit | 2 | 58 247 B | **FINALIZED**; 2.30 s; vide + soun; stdout "Recording complete", stderr "Device disconnected" |

In every run the stand-in mirror pid (38112, later 91524) was alive before and after the recorder run.

Log of run F (the target configuration), trimmed:

```text
[     13 ms] spawn: scrcpy -s "emulator-5554" --no-control "--record=…\f_audio_beside_mirror_again.mp4" --record-format=mp4 --no-window --no-audio-playback
[   2808 ms] size=0
[   6623 ms] size=48
[  12117 ms] ctrl-c(null): FreeConsole=True AttachConsole=True(err 187) Ignore=True Generate=True(err 187) FreeConsole=True
[  12143 ms] exited=True after 30 ms
INFO: Recording complete to mp4 file: …\f_audio_beside_mirror_again.mp4
bytes=92029; top=[ftyp:24 free:0 mdat:85262 moov:6711]; mvhd v0 timescale=1000 duration=8646 (8.65s); trak handler=soun codec=Opus; trak handler=vide codec=avc1 1080x2400 => FINALIZED
```

(`err 187` is the stale last-error value; both calls returned `True`.)

### 12.3 Byte-level facts for the walker

The unfinalized file of run J, all 48 bytes (use it as a test vector):

```text
00000000: 0000 0020 6674 7970 6973 6f6d 0000 0200  ... ftypisom....
00000010: 6973 6f6d 6973 6f32 6176 6331 6d70 3431  isomiso2avc1mp41
00000020: 0000 0008 6672 6565 0000 0000 6d64 6174  ....free....mdat
```

`ftyp` (32 B), `free` (8 B), then `mdat` with `size == 0` ("to the end of the file"), and no `moov`. A finalized file (run E): `ftyp` 32 at 0, `free` 8 at 32, `mdat` 84 110 at 40, `moov` 4 197 at 84 150. Its `mvhd` starts `0000006c 6d766864 00000000 …`: version 0, `timescale = 0x3e8` (1000), `duration = 0x11b5` (4533 ms).

### 12.4 Conclusions

1. A second headless scrcpy works beside a running mirror and does not disturb it.
2. **Ctrl+C to the recorder's own console finalizes the MP4** in 25 to 84 ms, from a process with no console, if and only if (a) the caller sets `SetConsoleCtrlHandler(NULL, TRUE)` before `GenerateConsoleCtrlEvent` (else the caller dies, run B) and (b) the recorder was spawned without an inherited ignore flag (else scrcpy ignores it, runs A and H).
3. `WM_CLOSE` also finalizes (1040 ms) but needs a window: plan B.
4. `TerminateProcess` never finalizes: the 48-byte header only.
5. A device loss finalizes by itself (exit code 2).
6. A stop before the first audio and video packets gives an empty file. The header appears 4 to 10 s after spawn on the emulator.
7. Defaults: H.264 (`avc1`) at the device's native size (1080×2400 on the emulator; the phone's size is unverified) and Opus audio.
8. Clean-stop bound: 5 s per recorder (`STOP_TIMEOUT`, about 60 times the slowest observed Ctrl+C exit), 6 s for the app exit.

Cleanup: every process the spike started was stopped (the emulator with `emu kill`, the stand-in mirrors with `taskkill /PID`, each recorder by its own stop or kill). Files exist only in the session scratchpad.

### 12.5 Confirmation on the real phone (2026-10-01, Samsung SM-A145F, serial RF8W3085JEW)

The phone was online (`adb devices -l`: `device product:a14nsxx model:SM_A145F`). The same `RecHost.exe` harness ran with `ADB` set to the SDK adb (so scrcpy's bundled adb 37.0.0 never touched the adb 36.0.2 server). A stand-in mirror (`scrcpy -s RF8W3085JEW --no-control`) ran beside every recorder; each run lasted 12 to 14 s with `--no-control`.

| Run | Stop method | Host exit | Signal to scrcpy exit | File | Walker |
|---|---|---|---|---|---|
| p1 | `ctrlc` (no NULL-ignore) | **`0xC000013A`: the host died** | not logged | 180 876 B | FINALIZED, 11.04 s |
| p2 | `ctrlcnull` | 0 | 11 ms (file closed about 120 ms) | 181 379 B | FINALIZED, 10.51 s |
| p3 | `ctrlcnull` | 0 | 19 ms (file closed about 121 ms) | 181 078 B | FINALIZED, 10.36 s |

Confirmed on the phone:
1. A second headless scrcpy runs beside the mirror. The mirror pid stayed alive in all three runs, and `adb devices` stayed `device`.
2. Defaults: video `avc1` at **1080×2408** (the phone's native size) and **Opus audio** with `--no-audio-playback`. The second audio capture beside the mirror works on this phone, so the audio risk in section 11 did not occur here.
3. The header appeared about 3.3 s after spawn (p1 log: `size=48` at 3305 ms), faster than the emulator's 4 to 10 s. Keep the 20 s start timeout.
4. **The NULL-ignore step is mandatory.** Run p1 (plain Ctrl+C) killed the sending process, which in Cowbell would be the app itself. Runs p2 and p3 (`SetConsoleCtrlHandler(NULL, TRUE)` before `GenerateConsoleCtrlEvent`) left the sender alive.
5. File size: about 18 KB per second for a mostly static screen (about 180 KB for 10 s). A busy screen will be larger.
6. Not covered by this test: the Rust implementation (the harness is C#), a stop before the header, and the app-exit path. The live checklist in section 8 covers them.

No process remained after the test: only my stand-in mirror ran, and it was stopped by its pid.

## 13. Effort and order

Effort: about 1.5 to 2 days for the executor, plus 30 minutes for the owner's live check.

Each slice builds, passes §8.1, and can be reverted alone:

1. **Pure functions and tests:** `record.rs` with §2 and the types of §3.1, `pub mod record;`, `recordFormat.ts` and its vitest. No behaviour change.
2. **Win32 and the stop method:** `record_win32.rs` (§5.2, §5.3) and the `Console` and `SystemInformation` features. Not called yet.
3. **Rust wiring:** `RecordingState`, `run_recorder`, the 3 commands, the `android.rs` visibility change, the `lib.rs` registration. Callable, but no UI calls it.
4. **UI:** `flutterApi.ts`, `recordPanel.ts`, the `mirrorTools.ts` changes, the CSS, the capability description. The feature is live; the auto-stops are not.
5. **Auto-stop and pre-exit finalize:** `mirror_tools::run` (§4.2) and the `lib.rs` exit path (§4.3).
6. **Kill-on-close job:** §5.4 and the `JobObjects`, `Threading`, `Security` features.

## 14. Amendments after the spec review (2026-10-01)

The first build (slices 1 to 6) followed §1 to §13. These amendments change that build. Each item says what to change and why.

### 14.1 Evidence: two more spikes on the owner's phone (SM-A145F, RF8W3085JEW)

Harness: `rec-spike\Host2.exe` (C#, GUI subsystem, no console; `CreateProcessW` with `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`) and `RecHost.exe`. `ADB` pointed to the SDK adb. A stand-in mirror ran beside every recorder; each run lasted 12 s with `--no-control`.

| Run | Stop method | Audio | Host | Signal to scrcpy exit | Exit code | Walker |
|---|---|---|---|---|---|---|
| p4 | `ctrlcnull` (the current method) | `--audio-codec=aac` | alive | 27 ms | 0 | FINALIZED, 8.51 s, `avc1` 1080×2408 + `mp4a` |
| p5 | **`CTRL_BREAK_EVENT` to the child's own process group** (no ignore flag) | `--audio-codec=aac` | alive (`HOST ALIVE AT END`) | 24 ms | 0 | FINALIZED, 10.55 s, `avc1` + `mp4a` |
| p6 | same as p5 | `--audio-codec=aac` | alive | 25 ms | 0 | FINALIZED, 10.48 s, `avc1` + `mp4a` |

Conclusions:
1. **Signal one child, not the process.** Spawn the recorder with `CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`. To stop it: `FreeConsole`, `AttachConsole(pid)`, `GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid)`, `FreeConsole`. The sender is not in the child's group, so it never receives the event and needs no `SetConsoleCtrlHandler`. scrcpy finalizes the MP4 and exits with code 0. This removes the process-wide ignore flag, the clear-before-spawn rule and the 100 ms settle.
2. **AAC audio records and finalizes** (`mp4a` track). Opus-in-MP4 may play silent in Windows' own players; AAC is MP4-native.
3. The mirror pid stayed alive and `adb devices` stayed `device` in every run.

### 14.2 Changes (accepted by the owner)

1. **Stop method (replaces §5.2 and §3.3 step 8).**
   - Spawn the recorder with `creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP)` in ONE call. `apply_no_window` sets the flags with a plain assignment, so calling it and then adding the second flag overwrites it. Set both flags together for the recorder only.
   - Delete `allow_ctrl_c_for_children` and every `SetConsoleCtrlHandler` call. Delete the 100 ms settle and the "clear before every spawn" rule. Keep `console_lock()` around the attach, send and detach, because the console attach is process-wide. Keep the debug-build re-attach.
   - `send_ctrl_c` becomes `send_ctrl_break`: `FreeConsole`, `AttachConsole(pid)`, `GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid)`, `FreeConsole`, then re-attach the debug console when there was one. The process group id equals the pid because the recorder is the group leader.
   - Keep the 5 s `STOP_TIMEOUT` and the "wait, then kill, then flag as may be damaged" fallback.
   - A comment on the `GenerateConsoleCtrlEvent` call must say: the recorder is its own group leader, so only it receives the event, and the sender needs no ignore flag (see §14.1).
2. **Audio codec (amends §2.2 `recorder_args`).** Add `--audio-codec=aac` to the argument list. Update the exact-argument test.
3. **Job object (amends §5.4).** Set `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK` together with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Reason: an adb server started by the recorder's adb client would otherwise join the job and be killed when Cowbell exits, which drops the mirror and any `flutter run` session. State in a comment that adb clients started before the job assignment escape it, and that this is harmless.
4. **Slice order (amends §13).** Slice 5 (auto-stop and exit) comes before slice 4 (UI). The first build already contains both, so no code change is needed; keep it for any future slice work.
5. **Live checklist (amends §8.2).** Add these steps and run them on the release `tauri build` exe, not only on `tauri dev`:
   - Two recordings in one session (Record, Stop, Record, Stop). Both files must play. This guards the "second recording ignored the stop" failure.
   - Stop, then Record again within 1 s, then Stop. The files must play and Cowbell must stay alive.
   - Open the file in the Windows Media Player or Films and TV app and check that it has sound (AAC).
   - While recording, run `adb kill-server`, then click Stop. The file must be valid and the mirror window must survive. (The recorder's adb client may restart the adb server inside the recorder's process group; this checks that the stop does not take it down.)
6. **Small fixes, fold in now:**
   - §3.4 Finish: for every stop cause, a forced kill that leaves only the header (`should_discard`) gives the code `record_empty`.
   - §3.4 Finish `message`: `None` when `finalized` and not forced. Otherwise the last stderr line only, never the 2000-char tail.
   - §3.4 step 4: emit the `ended` event BEFORE removing the entry, so a late Stop still reads `done`.
   - §3.6 `reveal_in_folder`: reject any path whose first component is not a normal disk prefix (`Prefix::Disk` or `Prefix::VerbatimDisk`) before any file system call, and run the file system calls inside `spawn_blocking`. Reject `Component::ParentDir` explicitly, so the `..` test and the code agree.
   - §4.2: stop the recorder before `state.release(label)`, so a mirror re-opened within the stop wait does not get `already_recording`.
   - `mirror_record_start`: take the std `console_lock` inside `spawn_blocking`, not on the tokio worker.
   - §3.1: delete the dead "`ApiError` is not `Clone`" fallback text. `ApiError` is `Clone` (`commands.rs:182`).
   - State the stderr drain's 300 ms join timeout and `abort()` in §3.4 (the first build already has them).
7. **Keep as is (the reviewers flagged, the owner keeps):** the `mp4_is_finalized` walker with `duration_ms` and `audio`. The timer and the file length differ on a static screen, so the panel needs the file's own duration.

### 14.3 Blast radius (walked, with sources)

Why the change is safe: every child process Cowbell spawns gets its own hidden console or none (`CREATE_NO_WINDOW` in `apply_no_window`, `engine.rs:125-132`; `spawn_server` uses `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS`, `engine.rs:344`), and the recorder is its own group leader. A group-addressed `CTRL_BREAK_EVENT` therefore reaches only the recorder and its adb clients. Confidence: ran it for the signal (§14.1, C# model on the real phone), walked it for the child consoles (two reviewers, from the code), not yet run in Rust or on a release build (§14.2 item 5).

### 14.4 Amendments after the code review (2026-10-01)

A two-model code review and a blast-radius pass ran code against the build. The owner accepted all items.

1. **Stale std handles.** `send_ctrl_break` saves the three std handles first and a drop guard puts them back after the last `FreeConsole`, on every exit path. Reason: a GUI process starts with null std handles, `AttachConsole` fills them, `FreeConsole` closes the console but keeps the values, and later spawns then fail with os error 6 (this broke `restart_gui`).
2. **Non-Windows build.** `crate::flutter::api_error` is imported on every target, because shared code calls it. A target other than Windows cannot be built here, so this is checked by reading only.
3. **Failed self-exit.** A recorder that exits by itself after its header and leaves a discarded file emits `mirror-record-failed`. Reason: the page stayed in `recording` (dot and timer running) until the user clicked Stop and got `not_recording`.
4. **Exiting check.** `mirror_record_start` returns `app_exiting` ("Cowbell is closing") before `try_insert` once the exit flag is set. Reason: a recorder started during the exit would be one `stop_all` never sees.
5. **Restart GUI.** `restart_gui` returns `recording_active` ("Stop the recording first.") while any recorder runs. Reason: `app.restart()` cannot be held back, so the file would lose its index.
6. **Housekeeping.** Stale comments and tests fixed (`RecordResult.message` doc, the `--window-title` assertion, the always-true state test), and the discard `remove_file` runs in `spawn_blocking`.

Live checklist, new steps (run on the release `tauri build` exe):
- Record, Stop, then open the wizard and click Restart GUI: Cowbell must relaunch.
- Click Restart GUI while recording: it must refuse with "Stop the recording first.".
