//! Mirror screen recording (docs/record-spec.md): a second, headless scrcpy
//! writes the phone screen and audio to an `.mp4` in `Videos\Cowbell`. Cowbell
//! stops it with a console Ctrl+Break so scrcpy writes the MP4 index (`moov`).
//!
//! The pure functions and the types compile and run on every target. The
//! Win32 calls live in `record_win32.rs` (Windows only).

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
#[cfg(windows)]
use std::{process::Stdio, time::Instant};

#[cfg(windows)]
use tokio::process::Command as AsyncCommand;

use crate::commands::ApiError;
use crate::flutter::api_error;
#[cfg(windows)]
use crate::record_win32;
use crate::{android, mirror_tools};

/// `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`.
#[cfg(windows)]
const RECORDER_CREATION_FLAGS: u32 = 0x0800_0000 | 0x0000_0200;

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
/// The recorder ended by itself and left no usable file. Payload: `ApiError`.
pub const FAILED_EVENT: &str = "mirror-record-failed";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LocalTime {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

/// `recording-YYYYMMDD-HHMMSS.mp4`; `n >= 2` adds `-<n>` before the extension.
pub fn recording_file_name(t: LocalTime, n: u32) -> String {
    let base = format!(
        "recording-{:04}{:02}{:02}-{:02}{:02}{:02}",
        t.year, t.month, t.day, t.hour, t.minute, t.second
    );
    if n >= 2 {
        format!("{base}-{n}.mp4")
    } else {
        format!("{base}.mp4")
    }
}

/// True only for a name `recording_file_name` can make (lower case `.mp4`,
/// suffix 1 or 2 digits without a leading `0`).
pub fn is_recording_file_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("recording-") else {
        return false;
    };
    let Some(stem) = rest.strip_suffix(".mp4") else {
        return false;
    };
    let digits = |s: &str, n: usize| s.len() == n && s.bytes().all(|b| b.is_ascii_digit());
    let mut parts = stem.splitn(3, '-');
    let (date, time, suffix) = (parts.next(), parts.next(), parts.next());
    let (Some(date), Some(time)) = (date, time) else {
        return false;
    };
    if !digits(date, 8) || !digits(time, 6) {
        return false;
    }
    match suffix {
        None => true,
        Some(s) => (digits(s, 1) || digits(s, 2)) && !s.starts_with('0'),
    }
}

/// The recorder's scrcpy arguments. `--record=` is built with `OsString::push`
/// so a non-UTF-8 path survives. Each item is one `argv` entry (no shell).
pub fn recorder_args(device_id: &str, path: &Path) -> Vec<OsString> {
    let mut record = OsString::from("--record=");
    record.push(path.as_os_str());
    vec![
        OsString::from("-s"),
        OsString::from(device_id),
        // Never send input to the phone.
        OsString::from("--no-control"),
        // No window; implies --no-video-playback.
        OsString::from("--no-window"),
        // The mirror already plays the audio on the PC.
        OsString::from("--no-audio-playback"),
        // AAC is MP4-native; Opus-in-MP4 may play silent in Windows' players.
        OsString::from("--audio-codec=aac"),
        OsString::from("--record-format=mp4"),
        record,
    ]
}

/// Appends `line` and a newline, then drops chars from the front until the
/// tail holds at most `max_chars` chars.
pub fn push_tail(tail: &mut String, line: &str, max_chars: usize) {
    tail.push_str(line);
    tail.push('\n');
    let count = tail.chars().count();
    if count > max_chars {
        let cut = tail
            .char_indices()
            .nth(count - max_chars)
            .map_or(tail.len(), |(i, _)| i);
        tail.drain(..cut);
    }
}

/// A file that is not finalized and is smaller than `DISCARD_BELOW_BYTES`
/// holds only the 48-byte header or nothing.
pub fn should_discard(bytes: u64, finalized: bool) -> bool {
    !finalized && bytes < DISCARD_BELOW_BYTES
}

/// The note of a result. `None` when the file is finalized and the stop was
/// clean. Otherwise the last stderr line only, never the whole tail. A forced
/// stop always says so.
pub fn result_message(finalized: bool, forced: bool, tail: &str) -> Option<String> {
    let last = tail
        .lines()
        .map(str::trim)
        .rev()
        .find(|l| !l.is_empty())
        .unwrap_or("");
    if forced {
        Some(
            format!("Cowbell had to force-stop the recorder. {last}")
                .trim_end()
                .to_string(),
        )
    } else if finalized || last.is_empty() {
        None
    } else {
        Some(last.to_string())
    }
}

/// The error of a discarded recording. After a self-exit with a header, the
/// page waits in `recording`, so the error says why: the last stderr line.
pub fn discard_error(self_exit_after_header: bool, tail: &str) -> ApiError {
    let last = tail
        .lines()
        .map(str::trim)
        .rev()
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let message = match (self_exit_after_header, last.is_empty()) {
        (false, _) => "Recording stopped before it started",
        (true, true) => "The recorder stopped and no video was saved",
        (true, false) => last,
    };
    api_error("record_empty", message)
}

/// What the page hears when a recorder ends by itself after its header: the
/// result, or why there is none. A requested stop, or an end before the
/// header, tells the page nothing here: the commands answer those.
pub enum EndNotice<'a> {
    Ended(&'a RecordResult),
    Failed(&'a ApiError),
}

pub fn end_notice(
    self_exit: bool,
    header_seen: bool,
    outcome: &RecordOutcome,
) -> Option<EndNotice<'_>> {
    if !self_exit || !header_seen {
        return None;
    }
    Some(match outcome {
        Ok(result) => EndNotice::Ended(result),
        Err(err) => EndNotice::Failed(err),
    })
}

/// `app_exiting` once the app has started to close: a recorder started now
/// would be one `stop_all` never sees.
pub fn check_not_exiting(flag: &AtomicBool) -> Result<(), ApiError> {
    if flag.load(Ordering::SeqCst) {
        Err(api_error("app_exiting", "Cowbell is closing"))
    } else {
        Ok(())
    }
}

/// `restart_gui` refuses while any recorder runs: the restart ends the process
/// without a finalize, and the recording would lose its index.
pub fn restart_guard(active: usize) -> Result<(), ApiError> {
    if active > 0 {
        Err(api_error("recording_active", "Stop the recording first."))
    } else {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mp4Check {
    pub finalized: bool,
    pub duration_ms: Option<u64>,
    pub audio: bool,
}

/// One box header found by `walk_boxes`. `pos` is the box start, `header`
/// the header length (8, or 16 with a large size), `size` the whole box.
#[derive(Clone, Copy)]
struct BoxHead {
    kind: [u8; 4],
    pos: u64,
    header: u64,
    size: u64,
}

/// Walks the boxes in `start..end` and calls `f` for each complete one. A
/// malformed or truncated box ends the walk without a call. `size == 0` means
/// the box runs to `end`. `f` may move the reader: the walk seeks every time.
fn walk_boxes<R: Read + Seek>(
    r: &mut R,
    start: u64,
    end: u64,
    mut f: impl FnMut(&mut R, BoxHead) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let mut pos = start;
    while pos.saturating_add(8) <= end {
        r.seek(SeekFrom::Start(pos))?;
        let mut head = [0u8; 8];
        r.read_exact(&mut head)?;
        let size32 = u32::from_be_bytes([head[0], head[1], head[2], head[3]]);
        let kind = [head[4], head[5], head[6], head[7]];
        let (header, size) = match size32 {
            0 => (8, end - pos),
            1 => {
                if pos.saturating_add(16) > end {
                    break;
                }
                let mut large = [0u8; 8];
                r.read_exact(&mut large)?;
                (16, u64::from_be_bytes(large))
            }
            n => (8, u64::from(n)),
        };
        if size < header || pos.saturating_add(size) > end {
            break;
        }
        f(
            r,
            BoxHead {
                kind,
                pos,
                header,
                size,
            },
        )?;
        pos += size;
    }
    Ok(())
}

/// Reads the payload of `head` (the bytes after its header).
fn read_payload<R: Read + Seek>(r: &mut R, head: BoxHead) -> std::io::Result<Vec<u8>> {
    r.seek(SeekFrom::Start(head.pos + head.header))?;
    let mut buf = vec![0u8; (head.size - head.header) as usize];
    r.read_exact(&mut buf)?;
    Ok(buf)
}

/// `level` 0: children of `moov`; 1: of `trak`; 2: of `mdia`.
fn scan_moov_children(buf: &[u8], level: u8, out: &mut Mp4Check) -> std::io::Result<()> {
    let mut cur = std::io::Cursor::new(buf);
    walk_boxes(&mut cur, 0, buf.len() as u64, |r, head| {
        match (level, &head.kind) {
            (0, b"mvhd") => {
                let p = read_payload(r, head)?;
                out.duration_ms = mvhd_duration_ms(&p);
            }
            (0, b"trak") => scan_moov_children(&read_payload(r, head)?, 1, out)?,
            (1, b"mdia") => scan_moov_children(&read_payload(r, head)?, 2, out)?,
            (2, b"hdlr") => {
                let p = read_payload(r, head)?;
                if p.get(8..12) == Some(b"soun") {
                    out.audio = true;
                }
            }
            _ => {}
        }
        Ok(())
    })
}

/// `mvhd` payload: version 0 has `timescale` at 12 and a `u32` duration at
/// 16; version 1 has `timescale` at 20 and a `u64` duration at 24.
fn mvhd_duration_ms(p: &[u8]) -> Option<u64> {
    let be32 = |at: usize| {
        p.get(at..at + 4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    };
    let (timescale, duration) = match *p.first()? {
        0 => (be32(12)?, u64::from(be32(16)?)),
        1 => {
            let b = p.get(24..32)?;
            (
                be32(20)?,
                u64::from_be_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]),
            )
        }
        _ => return None,
    };
    if timescale == 0 {
        return None;
    }
    u64::try_from(u128::from(duration) * 1000 / u128::from(timescale)).ok()
}

/// Walks the top-level boxes with seeks (never the whole file). Finalized
/// means a complete `ftyp` and a complete `moov`. A `moov` up to
/// `MOOV_READ_MAX` is read for the duration and the audio flag. An I/O error
/// propagates; the caller maps it to `finalized: false`.
pub fn mp4_is_finalized<R: Read + Seek>(r: &mut R, len: u64) -> std::io::Result<Mp4Check> {
    let mut has_ftyp = false;
    let mut has_moov = false;
    let mut moov: Option<Mp4Check> = None;
    walk_boxes(r, 0, len, |r, head| {
        match &head.kind {
            b"ftyp" => has_ftyp = true,
            b"moov" => {
                has_moov = true;
                let mut check = Mp4Check {
                    finalized: true,
                    duration_ms: None,
                    audio: false,
                };
                if head.size <= MOOV_READ_MAX {
                    scan_moov_children(&read_payload(r, head)?, 0, &mut check)?;
                }
                moov = Some(check);
            }
            _ => {}
        }
        Ok(())
    })?;
    let finalized = has_ftyp && has_moov;
    Ok(match moov {
        Some(check) if finalized => check,
        _ => Mp4Check {
            finalized: false,
            duration_ms: None,
            audio: false,
        },
    })
}

// ---------------------------------------------------------------------
// State and the recorder
// ---------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopCause {
    User,
    MirrorClosed,
    ToolsClosed,
    AppExit,
    DeviceLost,
    StartTimeout,
}

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
    /// `None` when the file is finalized and the stop was clean. Otherwise the
    /// last stderr line only (a forced stop says so first).
    pub message: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordStarted {
    pub path: String,
    pub file_name: String,
}

pub type RecordOutcome = Result<RecordResult, ApiError>;

#[derive(Clone)]
struct RecorderHandle {
    stop: tokio::sync::mpsc::UnboundedSender<StopCause>,
    done: tokio::sync::watch::Receiver<Option<RecordOutcome>>,
}

/// One recorder per device id. Rust owns it; the page owns only its DOM state.
/// Only the recorder task removes an entry.
#[derive(Default)]
pub struct RecordingState(Mutex<HashMap<String, RecorderHandle>>);

impl RecordingState {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, RecorderHandle>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// `false` when the device already has a recorder. Only the Windows start
    /// calls it, and the tests on every target.
    #[cfg_attr(not(windows), allow(dead_code))]
    fn try_insert(&self, id: &str, handle: RecorderHandle) -> bool {
        let mut map = self.lock();
        if map.contains_key(id) {
            return false;
        }
        map.insert(id.to_string(), handle);
        true
    }

    fn get(&self, id: &str) -> Option<RecorderHandle> {
        self.lock().get(id).cloned()
    }

    #[cfg(windows)]
    fn remove(&self, id: &str) {
        self.lock().remove(id);
    }

    fn all(&self) -> Vec<RecorderHandle> {
        self.lock().values().cloned().collect()
    }
}

/// Sends `cause`, then waits up to `wait` for the recorder's outcome. A closed
/// channel is fine: the task is already finishing. `None` on timeout.
async fn stop_and_wait(
    h: RecorderHandle,
    cause: StopCause,
    wait: Duration,
) -> Option<RecordOutcome> {
    let _ = h.stop.send(cause);
    let mut done = h.done;
    let waited = tokio::time::timeout(wait, done.wait_for(|o| o.is_some())).await;
    match waited {
        Ok(Ok(outcome)) => (*outcome).clone(),
        _ => None,
    }
}

/// The folder for recordings: `Videos\Cowbell`, else `~\Videos\Cowbell`.
fn recordings_dir(app: &tauri::AppHandle) -> Result<PathBuf, ApiError> {
    use tauri::Manager;

    let paths = app.path();
    let videos = paths
        .video_dir()
        .or_else(|_| paths.home_dir().map(|h| h.join("Videos")))
        .map_err(|_| api_error("record_dir_failed", "No Videos folder"))?;
    Ok(videos.join(RECORD_DIR_NAME))
}

/// Creates (empty) the first free `recording-…` file in `dir`, so two
/// recordings in one second never share a name. scrcpy opens the file itself
/// and truncates it.
pub fn reserve_file(dir: &Path, t: LocalTime) -> Result<PathBuf, ApiError> {
    for n in 1..=MAX_NAME_SUFFIX {
        let path = dir.join(recording_file_name(t, n));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => return Ok(path),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(api_error("record_dir_failed", err.to_string())),
        }
    }
    Err(api_error(
        "record_dir_failed",
        "Too many recordings in one second",
    ))
}

/// The state lookup of `mirror_record_stop`.
fn lookup_for_stop(state: &RecordingState, device_id: &str) -> Result<RecorderHandle, ApiError> {
    android::check_device_id(device_id)?;
    state
        .get(device_id)
        .ok_or_else(|| api_error("not_recording", "No recording is running"))
}

/// Starts a recording. Resolves when the file has its header (the recording
/// is real). Only the mirror tools window of the device can call it.
#[tauri::command]
pub async fn mirror_record_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, RecordingState>,
    device_id: String,
) -> Result<RecordStarted, ApiError> {
    android::check_device_id(&device_id)?;
    if window.label() != mirror_tools::tools_label(&device_id) {
        return Err(api_error(
            "not_mirror_tools",
            "Only the mirror tools window can record",
        ));
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state);
        Err(api_error("unsupported", "Recording is Windows only"))
    }
    #[cfg(windows)]
    {
        start_recording(app, &state, device_id).await
    }
}

#[cfg(windows)]
async fn start_recording(
    app: tauri::AppHandle,
    state: &RecordingState,
    device_id: String,
) -> Result<RecordStarted, ApiError> {
    check_not_exiting(&EXITING)?;
    let (stop_tx, stop_rx) = tokio::sync::mpsc::unbounded_channel();
    let (done_tx, done_rx) = tokio::sync::watch::channel(None);
    // Claim the device first, so two clicks cannot both spawn a recorder.
    let handle = RecorderHandle {
        stop: stop_tx,
        done: done_rx,
    };
    if !state.try_insert(&device_id, handle) {
        return Err(api_error(
            "already_recording",
            "A recording is already running for this device",
        ));
    }
    // Blocking work (folder, file reservation, spawn under the console lock)
    // stays off the tokio worker.
    let prepared = {
        let (app, device_id) = (app.clone(), device_id.clone());
        tokio::task::spawn_blocking(move || prepare_recorder(&app, &device_id))
            .await
            .unwrap_or_else(|err| Err(api_error("record_failed", err.to_string())))
    };
    let (path, child) = match prepared {
        Ok(ready) => ready,
        Err(err) => {
            state.remove(&device_id);
            return Err(err);
        }
    };
    let started = RecordStarted {
        path: path.to_string_lossy().into_owned(),
        file_name: file_name_of(&path),
    };
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    tauri::async_runtime::spawn(run_recorder(
        app, device_id, path, child, stop_rx, started_tx, done_tx,
    ));
    match started_rx.await {
        Ok(Ok(())) => Ok(started),
        Ok(Err(err)) => Err(err),
        Err(_) => Err(api_error("record_failed", "The recorder task ended")),
    }
}

#[cfg(windows)]
fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Steps 5 to 9 of the start: scrcpy, the folder, the reserved file name and
/// the spawn. Synchronous (the caller runs it in `spawn_blocking`).
#[cfg(windows)]
fn prepare_recorder(
    app: &tauri::AppHandle,
    device_id: &str,
) -> Result<(PathBuf, tokio::process::Child), ApiError> {
    let scrcpy = android::resolve_scrcpy(
        std::env::var_os("PATH").as_deref(),
        android::local_app_data().as_deref(),
    )
    .ok_or_else(|| api_error("scrcpy_not_found", "scrcpy was not found"))?;
    let dir = recordings_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|err| api_error("record_dir_failed", err.to_string()))?;
    let path = reserve_file(&dir, record_win32::local_time())?;
    let mut cmd = AsyncCommand::new(&scrcpy);
    cmd.args(recorder_args(device_id, &path));
    // One adb for everything, as `android::start_scrcpy` does.
    if let Some(adb) = android::resolve_adb_from_env() {
        cmd.env("ADB", adb);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    // No `kill_on_drop`: a kill leaves an unplayable file (record-spec §12
    // run J). `CREATE_NO_WINDOW` gives the recorder its own hidden console,
    // and `CREATE_NEW_PROCESS_GROUP` makes it a group leader, so the stop can
    // signal it alone. Both flags go in one call: `creation_flags` assigns,
    // so `apply_no_window` plus a second call would drop the first flag.
    cmd.creation_flags(RECORDER_CREATION_FLAGS);
    // The console attach is process-wide: do not spawn while a stop has the
    // console attached.
    let spawned = {
        let _guard = record_win32::console_lock();
        cmd.spawn()
    };
    match spawned {
        Ok(child) => {
            // A failure only logs: the recording works without the job.
            if let Some(pid) = child.id() {
                if let Err(err) = record_win32::assign_to_kill_on_close_job(pid) {
                    tracing::warn!("recorder job object failed: {err}");
                }
            }
            Ok((path, child))
        }
        Err(err) => {
            let _ = std::fs::remove_file(&path);
            Err(api_error("record_failed", err.to_string()))
        }
    }
}

/// Why the Starting phase ended without a header. `early_exit` is the status
/// when scrcpy exited by itself.
#[cfg(windows)]
fn start_error(
    early_exit: Option<&std::process::ExitStatus>,
    cause: Option<StopCause>,
    tail: &str,
) -> ApiError {
    match (early_exit, cause) {
        (Some(status), _) => {
            let tail = tail.trim();
            let message = if tail.is_empty() {
                format!("scrcpy exited ({status})")
            } else {
                tail.to_string()
            };
            api_error("record_failed", message)
        }
        (None, Some(StopCause::StartTimeout)) => api_error(
            "record_start_timeout",
            "No video arrived from the phone in 20 s. Unlock the phone and try again",
        ),
        _ => api_error("record_cancelled", "Recording cancelled"),
    }
}

/// Size of the file and its MP4 check. An error gives `finalized: false`.
#[cfg(windows)]
fn inspect_file(path: &Path) -> (u64, Mp4Check) {
    let bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let check = std::fs::File::open(path)
        .and_then(|mut f| mp4_is_finalized(&mut f, bytes))
        .unwrap_or(Mp4Check {
            finalized: false,
            duration_ms: None,
            audio: false,
        });
    (bytes, check)
}

/// The only owner of the scrcpy `Child`, and the only code that removes the
/// map entry. Phases: Starting (wait for the header), Recording, Stop, Finish.
#[cfg(windows)]
async fn run_recorder(
    app: tauri::AppHandle,
    device_id: String,
    path: PathBuf,
    mut child: tokio::process::Child,
    mut stop_rx: tokio::sync::mpsc::UnboundedReceiver<StopCause>,
    started_tx: tokio::sync::oneshot::Sender<Result<(), ApiError>>,
    done_tx: tokio::sync::watch::Sender<Option<RecordOutcome>>,
) {
    use tauri::{Emitter, Manager};
    use tokio::io::AsyncBufReadExt;

    let pid = child.id();
    // The pipe must be drained for the whole recording, or scrcpy blocks when
    // the pipe buffer fills.
    let tail = Arc::new(Mutex::new(String::new()));
    let mut drain = child.stderr.take().map(|stderr| {
        let tail = tail.clone();
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut tail = tail.lock().unwrap_or_else(|e| e.into_inner());
                push_tail(&mut tail, &line, STDERR_TAIL_CHARS);
            }
        })
    });

    let spawned_at = Instant::now();
    let mut started_tx = Some(started_tx);
    let mut header_at: Option<Instant> = None;
    let mut cause: Option<StopCause> = None;
    let mut exit: Option<std::process::ExitStatus> = None;
    loop {
        tokio::select! {
            status = child.wait() => {
                exit = status.ok();
                break;
            }
            got = stop_rx.recv() => {
                cause = Some(got.unwrap_or(StopCause::AppExit));
                break;
            }
            // Starting only. scrcpy writes nothing until the first video and
            // audio packets arrive, and a stop before that leaves an empty
            // file (record-spec §12 run C). So "started" is the header.
            _ = tokio::time::sleep(HEADER_POLL), if header_at.is_none() => {
                let len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                if len > 0 {
                    header_at = Some(Instant::now());
                    if let Some(tx) = started_tx.take() {
                        let _ = tx.send(Ok(()));
                    }
                } else if spawned_at.elapsed() >= RECORD_START_TIMEOUT {
                    cause = Some(StopCause::StartTimeout);
                    break;
                }
            }
        }
    }
    // No cause: scrcpy exited by itself (the phone left, adb died, disk full).
    let self_exit = cause.is_none();

    // Stop: Ctrl+Break to the recorder's group, then a kill after STOP_TIMEOUT.
    let mut forced = false;
    if !self_exit {
        if let Some(pid) = pid {
            match tokio::task::spawn_blocking(move || record_win32::send_ctrl_break(pid)).await {
                Ok(Ok(())) => {}
                Ok(Err(err)) => tracing::warn!("recorder stop failed for {device_id}: {err}"),
                Err(err) => tracing::warn!("recorder stop task failed for {device_id}: {err}"),
            }
        }
        match tokio::time::timeout(STOP_TIMEOUT, child.wait()).await {
            Ok(status) => exit = status.ok(),
            Err(_) => {
                forced = true;
                let _ = child.start_kill();
                exit = child.wait().await.ok();
            }
        }
    }
    // The drain gets a 300 ms join, then `abort()`. An adb daemon that
    // inherited the pipe can keep it open for good, so the wait for the last
    // lines must be short and must end.
    if let Some(task) = drain.as_mut() {
        let _ = tokio::time::timeout(Duration::from_millis(300), &mut *task).await;
        task.abort();
    }
    let tail = tail.lock().unwrap_or_else(|e| e.into_inner()).clone();

    // Finish.
    let (bytes, check) = {
        let path = path.clone();
        tokio::task::spawn_blocking(move || inspect_file(&path))
            .await
            .unwrap_or((
                0,
                Mp4Check {
                    finalized: false,
                    duration_ms: None,
                    audio: false,
                },
            ))
    };
    let final_cause = cause.unwrap_or(StopCause::DeviceLost);
    let start_err = header_at.is_none().then(|| {
        let early_exit = if self_exit { exit.as_ref() } else { None };
        start_error(early_exit, cause, &tail)
    });
    let outcome: RecordOutcome = if start_err.is_some() || should_discard(bytes, check.finalized) {
        let doomed = path.clone();
        let _ = tokio::task::spawn_blocking(move || std::fs::remove_file(doomed)).await;
        // Every cause gives `record_empty` here. The start call gets its own
        // error (`start_err`) on `started_tx`.
        Err(discard_error(self_exit && header_at.is_some(), &tail))
    } else {
        let seconds = match (check.finalized, check.duration_ms, header_at) {
            (true, Some(ms), _) => ms as f64 / 1000.0,
            (_, _, Some(at)) => at.elapsed().as_secs_f64(),
            _ => 0.0,
        };
        let message = result_message(check.finalized, forced, &tail);
        Ok(RecordResult {
            path: path.to_string_lossy().into_owned(),
            file_name: file_name_of(&path),
            bytes,
            seconds,
            finalized: check.finalized,
            audio: check.audio,
            cause: final_cause,
            message,
        })
    };
    match &outcome {
        Ok(r) => tracing::info!(
            "recording ended: {} bytes={} finalized={} cause={:?}",
            r.path,
            r.bytes,
            r.finalized,
            r.cause
        ),
        Err(err) => tracing::info!(
            "recording discarded: {} cause={:?}: {}",
            path.display(),
            final_cause,
            err.message
        ),
    }
    // The ended event goes out BEFORE the entry is removed, so a Stop that
    // arrives late still finds the entry and reads `done`. The entry goes
    // before the outcome: a caller that sees the outcome can start again.
    match end_notice(self_exit, header_at.is_some(), &outcome) {
        Some(EndNotice::Ended(result)) => {
            let label = mirror_tools::tools_label(&device_id);
            let _ = app.emit_to(label.as_str(), ENDED_EVENT, result);
        }
        Some(EndNotice::Failed(err)) => {
            let label = mirror_tools::tools_label(&device_id);
            let _ = app.emit_to(label.as_str(), FAILED_EVENT, err);
        }
        None => {}
    }
    app.state::<RecordingState>().remove(&device_id);
    if let (Some(tx), Some(err)) = (started_tx.take(), &start_err) {
        let _ = tx.send(Err(err.clone()));
    }
    done_tx.send_replace(Some(outcome.clone()));
}

/// Stops the recorder of the device. Resolves with the finished recording.
#[tauri::command]
pub async fn mirror_record_stop(
    state: tauri::State<'_, RecordingState>,
    device_id: String,
) -> Result<RecordResult, ApiError> {
    let handle = lookup_for_stop(&state, &device_id)?;
    stop_and_wait(
        handle,
        StopCause::User,
        STOP_TIMEOUT + Duration::from_secs(2),
    )
    .await
    .unwrap_or_else(|| Err(api_error("stop_timeout", "The recorder did not stop")))
}

/// The rules of `reveal_in_folder`: an absolute path to a file named like a
/// Cowbell recording, inside `dir`. Compared in canonical form, because both
/// sides carry `\\?\`.
pub fn check_recording_path(path: &Path, dir: &Path) -> Result<(), ApiError> {
    let bad = || api_error("bad_path", "Not a Cowbell recording");
    // Pure checks first: nothing touches the file system (a UNC or device
    // path could reach the network) until the path looks like ours.
    if !path.is_absolute()
        || !has_disk_prefix(path)
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(bad());
    }
    let named = path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(is_recording_file_name);
    if !named || !path.is_file() {
        return Err(bad());
    }
    let parent = path.parent().and_then(|p| std::fs::canonicalize(p).ok());
    let want = std::fs::canonicalize(dir).ok();
    match (parent, want) {
        (Some(a), Some(b)) if a == b => Ok(()),
        _ => Err(bad()),
    }
}

/// True when the path starts with a drive letter (`C:\` or `\\?\C:\`). Other
/// prefixes (UNC, device paths) are refused. Always true off Windows, where a
/// path has no prefix.
fn has_disk_prefix(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        matches!(
            path.components().next(),
            Some(Component::Prefix(p))
                if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        )
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        true
    }
}

/// Shows the recording in Explorer, selected. Only Cowbell recordings.
#[tauri::command]
pub async fn reveal_in_folder(app: tauri::AppHandle, path: String) -> Result<(), ApiError> {
    use tauri_plugin_opener::OpenerExt;

    let p = PathBuf::from(&path);
    let dir = recordings_dir(&app)?;
    // The file system calls of the check run off the tokio worker too.
    tokio::task::spawn_blocking(move || {
        check_recording_path(&p, &dir)?;
        app.opener()
            .reveal_item_in_dir(&p)
            .map_err(|err| api_error("reveal_failed", err.to_string()))
    })
    .await
    .map_err(|err| api_error("reveal_failed", err.to_string()))?
}

// ---------------------------------------------------------------------
// Auto-stop and exit
// ---------------------------------------------------------------------

/// Stops the device's recorder, if any, and waits up to `STOP_TIMEOUT + 1 s`.
pub async fn stop_for_device(
    app: &tauri::AppHandle,
    device_id: &str,
    cause: StopCause,
) -> Option<RecordOutcome> {
    use tauri::Manager;

    let handle = app.state::<RecordingState>().get(device_id)?;
    stop_and_wait(handle, cause, STOP_TIMEOUT + Duration::from_secs(1)).await
}

/// Number of running recorders.
pub fn active_count(app: &tauri::AppHandle) -> usize {
    use tauri::Manager;

    app.state::<RecordingState>().lock().len()
}

/// Sends `AppExit` to every recorder at once, then waits for all of them
/// until one shared deadline.
pub async fn stop_all(app: &tauri::AppHandle, budget: Duration) {
    use tauri::Manager;

    let handles = app.state::<RecordingState>().all();
    let deadline = tokio::time::Instant::now() + budget;
    for h in &handles {
        let _ = h.stop.send(StopCause::AppExit);
    }
    for h in handles {
        let mut done = h.done;
        let _ = tokio::time::timeout_at(deadline, done.wait_for(|o| o.is_some())).await;
    }
}

static EXITING: AtomicBool = AtomicBool::new(false);

/// Exits the app once: at once when nothing records, else after
/// `stop_all(EXIT_FINALIZE_TIMEOUT)`.
pub fn exit_after_finalize(app: &tauri::AppHandle) {
    if EXITING.swap(true, Ordering::SeqCst) {
        return;
    }
    if active_count(app) == 0 {
        app.exit(0);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        stop_all(&app, EXIT_FINALIZE_TIMEOUT).await;
        app.exit(0);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const T: LocalTime = LocalTime {
        year: 2026,
        month: 1,
        day: 5,
        hour: 3,
        minute: 4,
        second: 5,
    };

    #[test]
    fn file_name_pads_and_suffixes() {
        let dec = LocalTime {
            year: 2026,
            month: 12,
            day: 31,
            hour: 23,
            minute: 59,
            second: 59,
        };
        let cases = [
            (T, 1, "recording-20260105-030405.mp4"),
            (T, 2, "recording-20260105-030405-2.mp4"),
            (T, 0, "recording-20260105-030405.mp4"),
            (T, 99, "recording-20260105-030405-99.mp4"),
            (dec, 1, "recording-20261231-235959.mp4"),
        ];
        for (t, n, want) in cases {
            assert_eq!(recording_file_name(t, n), want, "n {n}");
        }
    }

    #[test]
    fn recording_file_name_check() {
        let good = [
            "recording-20260105-030405.mp4",
            "recording-20260105-030405-2.mp4",
            "recording-20260105-030405-99.mp4",
        ];
        for name in good {
            assert!(is_recording_file_name(name), "{name}");
        }
        let bad = [
            "..\\recording-20260105-030405.mp4",
            "a/recording-20260105-030405.mp4",
            "recording-20260105-030405.MP4",
            "recording-2026010-030405.mp4",
            "recording-20260105-030405-0.mp4",
            "recording-20260105-030405-05.mp4",
            "recording-20260105-030405-100.mp4",
            "recording-20260105-030405.mp4.exe",
            "recording-2026.mp4",
            "",
        ];
        for name in bad {
            assert!(!is_recording_file_name(name), "{name:?}");
        }
    }

    #[test]
    fn made_names_pass_the_check() {
        for n in 0..=MAX_NAME_SUFFIX {
            assert!(is_recording_file_name(&recording_file_name(T, n)), "{n}");
        }
    }

    #[test]
    fn recorder_args_are_exact() {
        let path = Path::new(r"C:\Users\A B\Videos\Cowbell\recording-20260105-030405.mp4");
        let args = recorder_args("RF8W3085JEW", path);
        let want: Vec<OsString> = [
            "-s",
            "RF8W3085JEW",
            "--no-control",
            "--no-window",
            "--no-audio-playback",
            "--audio-codec=aac",
            "--record-format=mp4",
            r"--record=C:\Users\A B\Videos\Cowbell\recording-20260105-030405.mp4",
        ]
        .into_iter()
        .map(OsString::from)
        .collect();
        assert_eq!(args, want);
        // The path stays one item, spaces and all.
        assert_eq!(args.len(), 8);
        assert!(args.iter().any(|a| a == "--audio-codec=aac"));
        assert!(!args
            .iter()
            .any(|a| a.to_string_lossy().starts_with("--window-title")));
    }

    #[test]
    fn tail_keeps_the_last_chars() {
        let mut tail = String::new();
        push_tail(&mut tail, "abc", 100);
        assert_eq!(tail, "abc\n");
        push_tail(&mut tail, "defgh", 6);
        assert_eq!(tail, "defgh\n");
        push_tail(&mut tail, "xy", 6);
        assert_eq!(tail, "gh\nxy\n");
    }

    #[test]
    fn tail_never_splits_a_multibyte_char() {
        let mut tail = String::new();
        push_tail(&mut tail, "ééé", 3);
        assert_eq!(tail, "éé\n");
        push_tail(&mut tail, "日本語", 2);
        assert_eq!(tail, "語\n");
        assert!(tail.is_char_boundary(0));
    }

    #[test]
    fn discard_only_small_unfinalized_files() {
        let cases = [
            (0, false, true),
            (48, false, true),
            (4095, false, true),
            (4096, false, false),
            (48, true, false),
            (100_000, false, false),
        ];
        for (bytes, finalized, want) in cases {
            assert_eq!(
                should_discard(bytes, finalized),
                want,
                "{bytes} {finalized}"
            );
        }
    }

    fn bx(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut v = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend_from_slice(kind);
        v.extend_from_slice(payload);
        v
    }

    fn mvhd_v0(timescale: u32, duration: u32) -> Vec<u8> {
        let mut p = vec![0u8; 4]; // version 0 + flags
        p.extend_from_slice(&[0; 8]); // creation, modification
        p.extend_from_slice(&timescale.to_be_bytes());
        p.extend_from_slice(&duration.to_be_bytes());
        p.extend_from_slice(&[0; 80]);
        bx(b"mvhd", &p)
    }

    fn mvhd_v1(timescale: u32, duration: u64) -> Vec<u8> {
        let mut p = vec![1u8, 0, 0, 0];
        p.extend_from_slice(&[0; 16]); // creation, modification (u64 each)
        p.extend_from_slice(&timescale.to_be_bytes());
        p.extend_from_slice(&duration.to_be_bytes());
        p.extend_from_slice(&[0; 80]);
        bx(b"mvhd", &p)
    }

    fn trak(handler: &[u8; 4]) -> Vec<u8> {
        let mut h = vec![0u8; 8]; // version/flags, pre_defined
        h.extend_from_slice(handler);
        h.extend_from_slice(&[0; 13]);
        bx(b"trak", &bx(b"mdia", &bx(b"hdlr", &h)))
    }

    fn file(parts: &[Vec<u8>]) -> Vec<u8> {
        parts.concat()
    }

    fn check(data: &[u8]) -> Mp4Check {
        mp4_is_finalized(&mut Cursor::new(data), data.len() as u64).unwrap()
    }

    fn unfinalized() -> Mp4Check {
        Mp4Check {
            finalized: false,
            duration_ms: None,
            audio: false,
        }
    }

    /// The real 48-byte file of a killed recorder (spec 12.3).
    const UNFINALIZED_48: [u8; 48] = [
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02,
        0x00, 0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, 0x61, 0x76, 0x63, 0x31, 0x6d, 0x70,
        0x34, 0x31, 0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65, 0x00, 0x00, 0x00, 0x00, 0x6d,
        0x64, 0x61, 0x74,
    ];

    #[test]
    fn real_unfinalized_file_is_not_finalized() {
        assert_eq!(check(&UNFINALIZED_48), unfinalized());
    }

    fn finalized_file(handlers: &[&[u8; 4]]) -> Vec<u8> {
        let mut moov = mvhd_v0(1000, 4533);
        for h in handlers {
            moov.extend(trak(h));
        }
        file(&[
            bx(b"ftyp", b"isom\0\0\x02\0isomiso2avc1mp41"),
            bx(b"free", b""),
            bx(b"mdat", &[7; 100]),
            bx(b"moov", &moov),
        ])
    }

    #[test]
    fn finalized_file_gives_duration_and_audio() {
        assert_eq!(
            check(&finalized_file(&[b"vide", b"soun"])),
            Mp4Check {
                finalized: true,
                duration_ms: Some(4533),
                audio: true
            }
        );
    }

    #[test]
    fn video_only_file_has_no_audio() {
        let c = check(&finalized_file(&[b"vide"]));
        assert!(c.finalized && !c.audio);
        assert_eq!(c.duration_ms, Some(4533));
    }

    #[test]
    fn mvhd_version_1_uses_the_64_bit_duration() {
        let data = file(&[
            bx(b"ftyp", b"isom"),
            bx(b"moov", &mvhd_v1(48000, 3 * 48000 + 24000)),
        ]);
        let c = check(&data);
        assert!(c.finalized);
        assert_eq!(c.duration_ms, Some(3500));
    }

    #[test]
    fn zero_timescale_gives_no_duration() {
        let data = file(&[bx(b"ftyp", b"isom"), bx(b"moov", &mvhd_v0(0, 4533))]);
        assert_eq!(
            check(&data),
            Mp4Check {
                finalized: true,
                duration_ms: None,
                audio: false
            }
        );
    }

    #[test]
    fn short_mvhd_gives_no_duration() {
        let data = file(&[bx(b"ftyp", b"isom"), bx(b"moov", &bx(b"mvhd", &[0; 10]))]);
        let c = check(&data);
        assert!(c.finalized);
        assert_eq!(c.duration_ms, None);
    }

    #[test]
    fn truncated_moov_is_not_finalized() {
        let mut data = finalized_file(&[b"soun"]);
        data.truncate(data.len() - 5);
        assert_eq!(check(&data), unfinalized());
    }

    #[test]
    fn large_size_mdat_before_moov_is_finalized() {
        let mut mdat = 1u32.to_be_bytes().to_vec();
        mdat.extend_from_slice(b"mdat");
        mdat.extend_from_slice(&(16u64 + 10).to_be_bytes());
        mdat.extend_from_slice(&[9; 10]);
        let data = file(&[bx(b"ftyp", b"isom"), mdat, bx(b"moov", &mvhd_v0(1000, 10))]);
        let c = check(&data);
        assert!(c.finalized);
        assert_eq!(c.duration_ms, Some(10));
    }

    #[test]
    fn mdat_to_end_without_moov_is_not_finalized() {
        let mut data = bx(b"ftyp", b"isom");
        data.extend_from_slice(&0u32.to_be_bytes());
        data.extend_from_slice(b"mdat");
        data.extend_from_slice(&[1; 200]);
        assert_eq!(check(&data), unfinalized());
    }

    #[test]
    fn box_smaller_than_its_header_stops_the_walk() {
        let mut data = bx(b"ftyp", b"isom");
        data.extend_from_slice(&4u32.to_be_bytes());
        data.extend_from_slice(b"free");
        data.extend_from_slice(&bx(b"moov", &mvhd_v0(1000, 10)));
        assert_eq!(check(&data), unfinalized());
    }

    #[test]
    fn moov_without_ftyp_is_not_finalized() {
        let data = bx(b"moov", &mvhd_v0(1000, 10));
        assert_eq!(check(&data), unfinalized());
    }

    #[test]
    fn empty_and_garbage_input_is_not_finalized() {
        assert_eq!(check(&[]), unfinalized());
        assert_eq!(check(&[1, 2, 3, 4, 5, 6, 7]), unfinalized());
    }

    #[test]
    fn io_error_propagates() {
        // The declared length is longer than the data: reading moov fails.
        let data = finalized_file(&[b"soun"]);
        let cut = &data[..data.len() - 5];
        let r = mp4_is_finalized(&mut Cursor::new(cut), data.len() as u64);
        assert!(r.is_err());
    }

    fn test_handle() -> RecorderHandle {
        let (stop, _rx) = tokio::sync::mpsc::unbounded_channel();
        let (_tx, done) = tokio::sync::watch::channel(None);
        RecorderHandle { stop, done }
    }

    #[test]
    fn state_refuses_a_second_recorder_for_one_device() {
        let state = RecordingState::default();
        assert!(state.try_insert("a", test_handle()));
        assert!(!state.try_insert("a", test_handle()));
        assert!(state.try_insert("b", test_handle()));
        assert_eq!(state.all().len(), 2);
        #[cfg(windows)]
        {
            state.remove("a");
            assert!(state.try_insert("a", test_handle()));
        }
    }

    #[test]
    fn stop_lookup_checks_the_id_then_the_state() {
        let state = RecordingState::default();
        let err = lookup_for_stop(&state, "bad id;").err().unwrap();
        assert_eq!(err.code, "bad_device_id");
        let err = lookup_for_stop(&state, "-x").err().unwrap();
        assert_eq!(err.code, "bad_device_id");
        let err = lookup_for_stop(&state, "RF8W3085JEW").err().unwrap();
        assert_eq!(err.code, "not_recording");
        assert!(state.try_insert("RF8W3085JEW", test_handle()));
        assert!(lookup_for_stop(&state, "RF8W3085JEW").is_ok());
    }

    #[test]
    fn stop_and_wait_returns_the_outcome_and_times_out() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        rt.block_on(async {
            let (stop, mut stop_rx) = tokio::sync::mpsc::unbounded_channel();
            let (done_tx, done) = tokio::sync::watch::channel(None);
            let h = RecorderHandle { stop, done };
            // No outcome: times out and the cause was sent.
            let got = stop_and_wait(h.clone(), StopCause::User, Duration::from_millis(30)).await;
            assert!(got.is_none());
            assert_eq!(stop_rx.recv().await, Some(StopCause::User));
            // An outcome published: returned.
            done_tx.send_replace(Some(Err(api_error("record_empty", "x"))));
            let got = stop_and_wait(h, StopCause::AppExit, Duration::from_secs(1)).await;
            assert_eq!(got.unwrap().err().unwrap().code, "record_empty");
        });
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cowbell-record-test-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reserve_file_takes_the_next_free_name() {
        let dir = temp_dir("reserve");
        let a = reserve_file(&dir, T).unwrap();
        let b = reserve_file(&dir, T).unwrap();
        assert_eq!(a.file_name().unwrap(), "recording-20260105-030405.mp4");
        assert_eq!(b.file_name().unwrap(), "recording-20260105-030405-2.mp4");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reserve_file_gives_up_after_the_last_suffix() {
        let dir = temp_dir("full");
        for n in 1..=MAX_NAME_SUFFIX {
            std::fs::write(dir.join(recording_file_name(T, n)), b"").unwrap();
        }
        let err = reserve_file(&dir, T).unwrap_err();
        assert_eq!(err.code, "record_dir_failed");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reserve_file_reports_a_missing_folder() {
        let dir = temp_dir("missing").join("nope");
        assert_eq!(reserve_file(&dir, T).unwrap_err().code, "record_dir_failed");
    }

    #[test]
    fn recording_path_rules() {
        let dir = temp_dir("path");
        let other = temp_dir("other");
        let name = "recording-20260105-030405.mp4";
        let good = dir.join(name);
        std::fs::write(&good, b"x").unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        std::fs::write(other.join(name), b"x").unwrap();
        assert!(check_recording_path(&good, &dir).is_ok());
        let bad_paths = [
            dir.join("notes.txt"),
            other.join(name),
            PathBuf::from(name),
            dir.join("recording-20260105-030406.mp4"),
            dir.join("..").join(other.file_name().unwrap()).join(name),
            // Resolves to the good file, but a `..` is refused outright.
            dir.join("..").join(dir.file_name().unwrap()).join(name),
            dir.join(".."),
        ];
        for p in bad_paths {
            let err = check_recording_path(&p, &dir).unwrap_err();
            assert_eq!(err.code, "bad_path", "{p:?}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::remove_dir_all(&other).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn recording_path_needs_a_disk_prefix() {
        let name = "recording-20260105-030405.mp4";
        let dir = temp_dir("prefix");
        std::fs::write(dir.join(name), b"x").unwrap();
        // A plain drive path and its verbatim form pass.
        assert!(has_disk_prefix(&dir.join(name)));
        let verbatim = std::fs::canonicalize(dir.join(name)).unwrap();
        assert!(has_disk_prefix(&verbatim));
        assert!(check_recording_path(&verbatim, &dir).is_ok());
        // UNC and device paths are refused before any file system call.
        for p in [
            format!(r"\\server\share\{name}"),
            format!(r"\\?\UNC\server\share\{name}"),
            format!(r"\\.\C:\{name}"),
        ] {
            let err = check_recording_path(Path::new(&p), &dir).unwrap_err();
            assert_eq!(err.code, "bad_path", "{p}");
            assert!(!has_disk_prefix(Path::new(&p)), "{p}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn result_message_rules() {
        let tail = "INFO: a\nWARN: b\nDevice disconnected\n\n";
        // Finalized and clean: no note.
        assert_eq!(result_message(true, false, tail), None);
        // Not finalized: the last line only.
        assert_eq!(
            result_message(false, false, tail).as_deref(),
            Some("Device disconnected")
        );
        assert_eq!(result_message(false, false, ""), None);
        // Forced: says so, with the last line only, even when finalized.
        assert_eq!(
            result_message(true, true, tail).as_deref(),
            Some("Cowbell had to force-stop the recorder. Device disconnected")
        );
        assert_eq!(
            result_message(false, true, "").as_deref(),
            Some("Cowbell had to force-stop the recorder.")
        );
    }

    #[test]
    fn discard_error_says_why_after_a_self_exit() {
        let tail = "INFO: x\nERROR: Disk full\n\n";
        let e = discard_error(true, tail);
        assert_eq!(
            (e.code.as_str(), e.message.as_str()),
            ("record_empty", "ERROR: Disk full")
        );
        let e = discard_error(true, "");
        assert_eq!(e.message, "The recorder stopped and no video was saved");
        let e = discard_error(false, tail);
        assert_eq!(e.code, "record_empty");
        assert_eq!(e.message, "Recording stopped before it started");
    }

    #[test]
    fn end_notice_only_for_a_self_exit_after_the_header() {
        let ok: RecordOutcome = Ok(RecordResult {
            path: "p".into(),
            file_name: "f".into(),
            bytes: 1,
            seconds: 1.0,
            finalized: true,
            audio: true,
            cause: StopCause::DeviceLost,
            message: None,
        });
        let err: RecordOutcome = Err(api_error("record_empty", "x"));
        assert!(matches!(
            end_notice(true, true, &ok),
            Some(EndNotice::Ended(_))
        ));
        assert!(matches!(
            end_notice(true, true, &err),
            Some(EndNotice::Failed(e)) if e.code == "record_empty"
        ));
        for (self_exit, header) in [(false, true), (true, false), (false, false)] {
            assert!(end_notice(self_exit, header, &ok).is_none());
            assert!(end_notice(self_exit, header, &err).is_none());
        }
    }

    #[test]
    fn exiting_flag_refuses_a_new_recording() {
        let flag = AtomicBool::new(false);
        assert!(check_not_exiting(&flag).is_ok());
        flag.store(true, Ordering::SeqCst);
        let e = check_not_exiting(&flag).unwrap_err();
        assert_eq!(
            (e.code.as_str(), e.message.as_str()),
            ("app_exiting", "Cowbell is closing")
        );
    }

    #[test]
    fn restart_is_refused_while_recording() {
        assert!(restart_guard(0).is_ok());
        for active in [1, 2] {
            let e = restart_guard(active).unwrap_err();
            assert_eq!(
                (e.code.as_str(), e.message.as_str()),
                ("recording_active", "Stop the recording first.")
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn start_error_codes() {
        let c = start_error(None, Some(StopCause::StartTimeout), "");
        assert_eq!(c.code, "record_start_timeout");
        let c = start_error(None, Some(StopCause::User), "");
        assert_eq!(c.code, "record_cancelled");
        use std::os::windows::process::ExitStatusExt;
        let status = std::process::ExitStatus::from_raw(1);
        let c = start_error(Some(&status), None, "  ERROR: unauthorized \n");
        assert_eq!(
            (c.code.as_str(), c.message.as_str()),
            ("record_failed", "ERROR: unauthorized")
        );
        let c = start_error(Some(&status), None, "");
        assert!(c.message.starts_with("scrcpy exited"));
    }
}
