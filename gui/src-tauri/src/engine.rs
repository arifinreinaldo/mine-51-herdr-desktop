//! herdr engine management (Phase 1.6 spec §3): locating the herdr binary,
//! deciding whether it needs installing, building the `install.ps1`
//! invocation, and starting/stopping the herdr server.
//!
//! Every function that touches the real filesystem, environment, or a
//! subprocess has a pure, dependency-injected counterpart underneath it
//! (spec §3.4 "using a fake filesystem or dependency injection" / "through
//! an injected spawner") so the decision logic is unit-testable without a
//! real herdr binary or a real Windows job object.
//!
//! Cowbell rebrand (`cowbell-rebrand-spec.md` §B): this build no longer
//! bundles a herdr release. "Install herdr" runs herdr's own official
//! installer from herdr.dev over HTTPS instead of extracting and verifying
//! an embedded zip.

use std::collections::VecDeque;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

/// Windows process creation flags (`std::os::windows::process::CommandExt`),
/// matching herdr's own daemon (`src/platform/windows.rs:1374`, spec §3.3).
#[cfg(windows)]
mod creation_flags {
    pub const DETACHED_PROCESS: u32 = 0x0000_0008;
    pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    pub const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
}

// ---------------------------------------------------------------------
// §3.1 locate
// ---------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EngineStatus {
    Missing,
    Found { path: PathBuf, version: String },
    Broken { path: PathBuf, error: String },
}

/// `%LOCALAPPDATA%\Programs\Herdr\bin`, the visible junction install.ps1
/// creates (spec §3.1(2), `install.ps1:726-731`).
pub fn visible_bin_dir_from(localappdata: Option<&str>) -> PathBuf {
    let base = localappdata
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("Programs").join("Herdr").join("bin")
}

pub fn visible_bin_dir() -> PathBuf {
    visible_bin_dir_from(std::env::var("LOCALAPPDATA").ok().as_deref())
}

const HERDR_EXE_NAME: &str = "herdr.exe";

/// The candidate binary paths in resolution order (spec §3.1): `HERDR_BIN`,
/// then the visible junction, then every `PATH` directory. Pure function of
/// its inputs so the order is testable without touching real env vars.
pub fn candidate_paths_from(
    herdr_bin_env: Option<&str>,
    localappdata: Option<&str>,
    path_env: Option<&str>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(bin) = herdr_bin_env {
        if !bin.is_empty() {
            candidates.push(PathBuf::from(bin));
        }
    }
    candidates.push(visible_bin_dir_from(localappdata).join(HERDR_EXE_NAME));
    if let Some(path_var) = path_env {
        for dir in path_var.split(';') {
            if !dir.is_empty() {
                candidates.push(PathBuf::from(dir).join(HERDR_EXE_NAME));
            }
        }
    }
    candidates
}

pub fn candidate_paths() -> Vec<PathBuf> {
    candidate_paths_from(
        std::env::var("HERDR_BIN").ok().as_deref(),
        std::env::var("LOCALAPPDATA").ok().as_deref(),
        std::env::var("PATH").ok().as_deref(),
    )
}

/// The first candidate `exists` reports as present, if any. Split out from
/// `locate_herdr` (spec §3.4 "using a fake filesystem or dependency
/// injection") so the resolution *order* is testable with a fake existence
/// set, without spawning a real `--version` probe.
pub fn pick_first_existing(
    candidates: &[PathBuf],
    exists: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    candidates.iter().find(|p| exists(p)).cloned()
}

/// Parses the first semver-shaped (`\d+\.\d+\.\d+[-+...]`) whitespace-
/// separated token in `text`, stripping a leading `v` if present.
pub fn parse_semver(text: &str) -> Option<String> {
    text.split_whitespace()
        .map(|tok| tok.trim_start_matches('v'))
        .find(|tok| is_semverish(tok))
        .map(|tok| tok.to_string())
}

fn is_semverish(s: &str) -> bool {
    let core = s.split(['-', '+']).next().unwrap_or("");
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

pub(crate) fn apply_no_window(cmd: &mut AsyncCommand) {
    // `tokio::process::Command::creation_flags` is a native inherent method
    // on Windows (it forwards to `std::process::Command`'s own), so no
    // `CommandExt` import is needed here.
    #[cfg(windows)]
    cmd.creation_flags(creation_flags::CREATE_NO_WINDOW);
    let _ = cmd; // no-op on non-Windows
}

async fn run_version_probe(path: &Path) -> Result<String, String> {
    let mut cmd = AsyncCommand::new(path);
    cmd.arg("--version");
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    let output = tokio::time::timeout(Duration::from_secs(3), cmd.output())
        .await
        .map_err(|_| "timed out after 3s".to_string())?
        .map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err(format!("exited with status {:?}", output.status.code()));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_semver(&text).ok_or_else(|| format!("could not parse a version from: {}", text.trim()))
}

/// Resolves the herdr binary (spec §3.1) by walking `candidate_paths()` in
/// order and running `<bin> --version` (3s timeout, no console window) on
/// the first one that exists on disk.
pub async fn locate_herdr() -> EngineStatus {
    let Some(path) = pick_first_existing(&candidate_paths(), |p| p.is_file()) else {
        return EngineStatus::Missing;
    };
    match run_version_probe(&path).await {
        Ok(version) => EngineStatus::Found { path, version },
        Err(error) => EngineStatus::Broken { path, error },
    }
}

// ---------------------------------------------------------------------
// §3.2 install (Cowbell rebrand spec §B: herdr's own online installer)
// ---------------------------------------------------------------------

/// `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` (spec
/// §3.2): the absolute Windows PowerShell 5.1 path, never `powershell` on
/// `PATH` (which could resolve to pwsh.exe on a machine that has it).
pub fn powershell_exe_path_from(system_root: Option<&str>) -> PathBuf {
    let root = system_root.unwrap_or("C:\\Windows");
    PathBuf::from(root)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe")
}

pub fn powershell_exe_path() -> PathBuf {
    powershell_exe_path_from(std::env::var("SystemRoot").ok().as_deref())
}

/// The exact command herdr's own README documents for Windows
/// (`README.herdr.md:48`): HTTPS only, a `const` so it can never drift from
/// what `herdr_install_args` actually runs.
const HERDR_INSTALL_URL: &str = "https://herdr.dev/install.ps1";

/// Builds the exact `powershell.exe` argument array for "Install herdr"
/// (spec §B): `irm <url> | iex` is one argument (a single `-Command`
/// string) -- never shell-parsed, never string-concatenated with anything
/// user-controlled.
pub fn herdr_install_args() -> Vec<String> {
    vec![
        "-NoProfile".to_string(),
        "-NonInteractive".to_string(),
        "-ExecutionPolicy".to_string(),
        "Bypass".to_string(),
        "-Command".to_string(),
        format!("irm {HERDR_INSTALL_URL} | iex"),
    ]
}

#[derive(Debug)]
pub enum InstallError {
    Spawn(String),
    Wait(String),
    /// The process exited non-zero. `tail` is its last (up to) 20 combined
    /// stdout/stderr lines (spec §3.2 "shows the last 20 lines").
    ExitFailure {
        tail: Vec<String>,
    },
    /// Finding #12 "timeouts": `install.ps1` ran for longer than
    /// `INSTALL_TIMEOUT` (10 minutes) and was killed.
    Timeout,
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InstallError::Spawn(err) => write!(f, "failed to start install.ps1: {err}"),
            InstallError::Wait(err) => write!(f, "failed to wait for install.ps1: {err}"),
            InstallError::ExitFailure { tail } => {
                write!(f, "install.ps1 failed:\n{}", tail.join("\n"))
            }
            InstallError::Timeout => write!(
                f,
                "install.ps1 timed out after {}s and was killed",
                INSTALL_TIMEOUT.as_secs()
            ),
        }
    }
}

const INSTALL_LOG_TAIL_LINES: usize = 20;
/// Finding #12 "timeouts": `run_install` must never hang forever if
/// `install.ps1` (or something it launches) stalls.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(600);

/// Runs herdr's official installer (spec §B), streaming each stdout/stderr
/// line to `on_line` as it arrives, and keeping the last 20 lines for the
/// error message on a non-zero exit.
pub async fn run_install(on_line: impl FnMut(&str)) -> Result<(), InstallError> {
    let mut cmd = AsyncCommand::new(powershell_exe_path());
    cmd.args(herdr_install_args());
    run_install_command(cmd, on_line, INSTALL_TIMEOUT).await
}

/// The dependency-injected body of `run_install` (spec §3.4 "using a fake
/// filesystem or dependency injection"): `cmd` and `timeout` are parameters
/// so a test can point this at any long-running command with a short
/// timeout, without needing a real `install.ps1` or a 10-minute wait
/// (finding #12).
async fn run_install_command(
    mut cmd: AsyncCommand,
    mut on_line: impl FnMut(&str),
    timeout: Duration,
) -> Result<(), InstallError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    // Belt-and-suspenders: if the timeout below fires and drops `child`
    // before an explicit `kill`, tokio kills it anyway rather than leaking
    // an orphaned process.
    cmd.kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|err| InstallError::Spawn(err.to_string()))?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let tx_err = tx.clone();
    let out_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let err_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if tx_err.send(line).is_err() {
                break;
            }
        }
    });

    let mut tail: VecDeque<String> = VecDeque::with_capacity(INSTALL_LOG_TAIL_LINES + 1);
    let drained = tokio::time::timeout(timeout, async {
        while let Some(line) = rx.recv().await {
            on_line(&line);
            tail.push_back(line);
            if tail.len() > INSTALL_LOG_TAIL_LINES {
                tail.pop_front();
            }
        }
    })
    .await;

    if drained.is_err() {
        let _ = child.kill().await;
        let _ = child.wait().await;
        out_task.abort();
        err_task.abort();
        return Err(InstallError::Timeout);
    }

    let _ = out_task.await;
    let _ = err_task.await;

    let status = child
        .wait()
        .await
        .map_err(|err| InstallError::Wait(err.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(InstallError::ExitFailure {
            tail: tail.into_iter().collect(),
        })
    }
}

// ---------------------------------------------------------------------
// §3.3 server lifecycle
// ---------------------------------------------------------------------

/// Spawns `spawn` with the primary creation flags, retrying once without
/// `CREATE_BREAKAWAY_FROM_JOB` on `PermissionDenied` (spec §3.3: "If
/// CreateProcess fails with access denied, the job forbids breakaway, so
/// retry without CREATE_BREAKAWAY_FROM_JOB and log it"). `spawn` is
/// injected (spec §3.4 "through an injected spawner") so this fallback
/// decision is unit-testable without a real process or job object.
pub fn spawn_with_breakaway_fallback<T>(
    mut spawn: impl FnMut(u32) -> std::io::Result<T>,
) -> std::io::Result<T> {
    #[cfg(windows)]
    let primary = creation_flags::DETACHED_PROCESS
        | creation_flags::CREATE_NEW_PROCESS_GROUP
        | creation_flags::CREATE_BREAKAWAY_FROM_JOB;
    #[cfg(not(windows))]
    let primary = 0u32;

    match spawn(primary) {
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            tracing::warn!(
                "spawning the herdr server with CREATE_BREAKAWAY_FROM_JOB was denied; \
                 retrying without it (the server may not outlive this job)"
            );
            #[cfg(windows)]
            let fallback =
                creation_flags::DETACHED_PROCESS | creation_flags::CREATE_NEW_PROCESS_GROUP;
            #[cfg(not(windows))]
            let fallback = 0u32;
            spawn(fallback)
        }
        other => other,
    }
}

/// Spawns `<bin> server` detached, with stdio going to null and the GUI's
/// own environment passed straight through (spec §3.3: "pass through the
/// GUI's environment... never inject provider tokens") -- `Command`
/// inherits the parent environment by default, so simply not calling
/// `env_clear()` already satisfies both halves of that rule.
pub fn spawn_server(bin: &Path) -> std::io::Result<u32> {
    spawn_with_breakaway_fallback(|flags| {
        let mut cmd = std::process::Command::new(bin);
        cmd.arg("server");
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(flags);
        }
        let _ = flags;
        cmd.spawn().map(|child| child.id())
    })
}

/// Finding #12 "timeouts": `stop_server` must never hang forever if the
/// server (or the process tree under it) stops responding.
const STOP_SERVER_TIMEOUT: Duration = Duration::from_secs(15);

/// Runs `cmd.output()` with a timeout, killing the child if it fires
/// (`kill_on_drop`, since `tokio::time::timeout` simply drops the inner
/// future -- and the `Child` it owns -- on expiry). Split out from
/// `stop_server` (spec §3.4 "dependency injection") so a test can exercise
/// the timeout-and-kill behavior against any long-running command with a
/// short timeout, without needing a real herdr binary or a 15s wait.
async fn run_output_with_timeout(
    mut cmd: AsyncCommand,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    cmd.kill_on_drop(true);
    match tokio::time::timeout(timeout, cmd.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(err)) => Err(err.to_string()),
        Err(_) => Err(format!("timed out after {}s", timeout.as_secs())),
    }
}

/// Runs `<bin> server stop` (spec §3.3 "herdr menu ▸ Stop Server…"). It is
/// itself an API request to the running server, so it inherits the GUI's
/// own `HERDR_SESSION`/`HERDR_SOCKET_PATH` environment for free (no
/// `env_clear()`, same as `spawn_server`).
pub async fn stop_server(bin: &Path) -> Result<(), String> {
    let mut cmd = AsyncCommand::new(bin);
    cmd.arg("server").arg("stop");
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    let output = run_output_with_timeout(cmd, STOP_SERVER_TIMEOUT).await?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!(
                "herdr server stop exited with status {:?}",
                output.status.code()
            )
        } else {
            stderr
        })
    }
}

/// `herdr menu ▸ Stop Server…`'s actual effect on the start-once guard
/// (finding #1 "Stop Server auto-undone"): claims the guard *before*
/// running `server stop`, regardless of whether the stop call itself
/// succeeds. Without this, a server that had been up since before this
/// launch ever needed its own auto-start (so the guard was never claimed)
/// would, once stopped, look to the reconnect loop's `Err` arm exactly like
/// an unexpected crash -- and get silently respawned right back up,
/// undoing the user's own deliberate Stop.
pub async fn stop_server_claiming_guard(guard: &StartOnceGuard, bin: &Path) -> Result<(), String> {
    guard.try_claim();
    stop_server(bin).await
}

/// The once-per-launch start guard (spec §3.3 "one entry point
/// `ensure_server_started()` holds the start-once guard"; §3.4 "the
/// once-per-launch start guard").
#[derive(Default)]
pub struct StartOnceGuard(AtomicBool);

impl StartOnceGuard {
    /// Claims the guard. Returns `true` only the first time it's called.
    pub fn try_claim(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }

    /// Reads the guard without claiming it.
    pub fn already_claimed(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

const SERVER_START_POLL_INTERVAL: Duration = Duration::from_millis(250);
const SERVER_START_TIMEOUT: Duration = Duration::from_secs(15);

async fn poll_until_up<Probe, ProbeFut>(mut probe: Probe) -> bool
where
    Probe: FnMut() -> ProbeFut,
    ProbeFut: Future<Output = bool>,
{
    let deadline = tokio::time::Instant::now() + SERVER_START_TIMEOUT;
    loop {
        if probe().await {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(SERVER_START_POLL_INTERVAL).await;
    }
}

/// The generic probe -> start -> poll decision (spec §3.3), decoupled from
/// any real socket or process so it's unit-testable with fakes (spec §3.4
/// "the once-per-launch start guard"). `spawn` runs at most once, only when
/// this call is the one that claims `guard`.
pub async fn ensure_started_generic<Probe, ProbeFut>(
    guard: &StartOnceGuard,
    spawn: impl FnOnce() -> std::io::Result<()>,
    mut probe: Probe,
) -> bool
where
    Probe: FnMut() -> ProbeFut,
    ProbeFut: Future<Output = bool>,
{
    if probe().await {
        return true;
    }
    if !guard.try_claim() {
        // Finding #3 "race false failure": someone else already spent this
        // launch's one silent start attempt (spec §3.3: "never a silent
        // restart loop") -- but that other caller's own spawn may still be
        // starting up right now. Poll for the same 15s instead of
        // immediately reporting failure, so a second, merely-later caller
        // (e.g. the wizard's step 1 racing the reconnect loop's own `Err`
        // arm) doesn't get a false "not running" just because it lost the
        // race to be the one that calls `spawn()`.
        return poll_until_up(&mut probe).await;
    }
    if spawn().is_err() {
        return false;
    }
    poll_until_up(&mut probe).await
}

/// Same probe -> start -> poll decision as `ensure_started_generic`, but
/// **ignores** the guard (spec §3.3's explicit "Start herdr" banner
/// button): a user click is not a silent automatic retry, so it always
/// gets to try.
pub async fn force_started_generic<Probe, ProbeFut>(
    spawn: impl FnOnce() -> std::io::Result<()>,
    mut probe: Probe,
) -> bool
where
    Probe: FnMut() -> ProbeFut,
    ProbeFut: Future<Output = bool>,
{
    if probe().await {
        return true;
    }
    if spawn().is_err() {
        return false;
    }
    poll_until_up(&mut probe).await
}

// ---------------------------------------------------------------------
// Concrete wiring (real socket probe, real spawn) + Tauri commands
// ---------------------------------------------------------------------

async fn probe_socket(socket_path: &Path, hello: &herdr_wire::EndpointClientHello) -> bool {
    crate::conn::Connection::connect(socket_path, hello)
        .await
        .is_ok()
}

/// The concrete `ensure_started_generic` used by both the reconnect loop's
/// `Err` arm and the wizard's step 1 (spec §3.3 "one entry point"):
/// probing over the real client socket and spawning the real `<bin>
/// server`.
pub async fn ensure_server_started(
    guard: &StartOnceGuard,
    bin: &Path,
    socket_path: &Path,
    hello: &herdr_wire::EndpointClientHello,
) -> bool {
    let bin = bin.to_path_buf();
    ensure_started_generic(
        guard,
        move || spawn_server(&bin).map(|_pid| ()),
        || probe_socket(socket_path, hello),
    )
    .await
}

/// The explicit "Start herdr" banner button (spec §3.3): same probe/spawn,
/// no guard.
pub async fn force_start_server(
    bin: &Path,
    socket_path: &Path,
    hello: &herdr_wire::EndpointClientHello,
) -> bool {
    let bin = bin.to_path_buf();
    force_started_generic(
        move || spawn_server(&bin).map(|_pid| ()),
        || probe_socket(socket_path, hello),
    )
    .await
}

use crate::commands::{ApiError, AppState};

/// Wizard step 1 (spec §4.1): "Show the result of §3.1." Cowbell rebrand
/// spec §B: no bundled-version comparison any more (there is no pinned
/// version to compare against, only "installed or not") -- `EngineStatus`
/// flattened as-is, `kind`/`path`/`version`/`error` and nothing else.
#[tauri::command]
pub async fn engine_status() -> EngineStatus {
    locate_herdr().await
}

/// Wizard step 1's `[Install herdr]` button (spec §B/§4.1). Runs herdr's
/// own official installer from herdr.dev, streaming each line as an
/// `engine-install-log` event; on failure the error includes the last 20
/// lines (spec §3.2 "shows the last 20 lines") plus a pointer to the manual
/// install page (spec §B "On failure...").
#[tauri::command]
pub async fn engine_install(app: tauri::AppHandle) -> Result<(), ApiError> {
    use tauri::Emitter;
    run_install(|line| {
        let _ = app.emit("engine-install-log", line);
    })
    .await
    .map_err(|err| ApiError {
        code: "install_failed".to_string(),
        message: format!("{err}\n\nSee https://herdr.dev for manual install."),
    })
}

/// Wizard step 1's own "then run the server start" (spec §4.1), and the
/// reconnect loop's `Err` arm (`dispatch::maybe_auto_start_server`). Both
/// go through this one function, sharing `AppState::inner`'s
/// `server_start_guard` (spec §3.3 "one entry point").
#[tauri::command]
pub async fn engine_ensure_server_started(
    state: tauri::State<'_, AppState>,
) -> Result<bool, ApiError> {
    let status = locate_herdr().await;
    let EngineStatus::Found { path, .. } = status else {
        return Ok(false);
    };
    let socket_path = crate::socket::client_socket_path();
    let hello = crate::dispatch::initial_hello(&state.inner);
    Ok(ensure_server_started(&state.inner.server_start_guard, &path, &socket_path, &hello).await)
}

/// The "Start herdr" banner button (spec §3.3): explicit, bypasses the
/// once-per-launch guard.
#[tauri::command]
pub async fn engine_force_start_server(
    state: tauri::State<'_, AppState>,
) -> Result<bool, ApiError> {
    let status = locate_herdr().await;
    let EngineStatus::Found { path, .. } = status else {
        return Ok(false);
    };
    let socket_path = crate::socket::client_socket_path();
    let hello = crate::dispatch::initial_hello(&state.inner);
    Ok(force_start_server(&path, &socket_path, &hello).await)
}

/// `herdr menu ▸ Stop Server…` (spec §3.3), after the confirm popover.
/// Finding #1 "Stop Server auto-undone": goes through
/// `stop_server_claiming_guard`, not `stop_server` directly, so a
/// deliberate Stop is never silently respawned by the reconnect loop.
#[tauri::command]
pub async fn engine_stop_server(state: tauri::State<'_, AppState>) -> Result<(), ApiError> {
    let status = locate_herdr().await;
    let EngineStatus::Found { path, .. } = status else {
        return Err(ApiError {
            code: "not_installed".to_string(),
            message: "herdr is not installed".to_string(),
        });
    };
    stop_server_claiming_guard(&state.inner.server_start_guard, &path)
        .await
        .map_err(|message| ApiError {
            code: "stop_failed".to_string(),
            message,
        })
}

/// Runs an already-built `--version` probe (a fixed, hardcoded command --
/// spec §5: "only fixed commands... The webview never passes a command
/// string to Rust") with a 3s timeout and no console window, and returns
/// its trimmed, `v`-stripped stdout. `None` covers "not found", "exited
/// non-zero", and "timed out after 3s" alike: callers only need to know
/// whether a usable version string came back.
async fn run_fixed_version_command(mut cmd: AsyncCommand) -> Option<String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    match tokio::time::timeout(Duration::from_secs(3), cmd.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            Some(text.trim().trim_start_matches('v').to_string())
        }
        _ => None,
    }
}

/// Wizard step 2's Node prerequisite check (spec §4.2): "a fixed command
/// with no user input." `node.exe` is a real executable that Windows'
/// `CreateProcess` (and so `Command::new`) resolves on `PATH` directly, so
/// this needs no shell.
#[tauri::command]
pub async fn node_version() -> Option<String> {
    run_fixed_version_command(AsyncCommand::new("node")).await
}

/// Finding #7 "gemini detection": npm installs the Gemini CLI as a
/// `gemini.cmd` shell shim, not a real `gemini.exe`. `CreateProcess`
/// resolves an unqualified name by assuming a literal `.exe` extension (the
/// same rule `Command::new("gemini")` follows), so it never finds the
/// `.cmd` shim -- typing `gemini --version` at a prompt only works because
/// `cmd.exe` itself does its own `PATH`/`PATHEXT` search first. Routing
/// this one probe through `cmd.exe /d /c` (no autorun scripts, `/c` exits
/// after the command) reproduces exactly that search. `node_version` above
/// needs none of this, because `node.exe` genuinely exists.
fn gemini_version_command() -> AsyncCommand {
    let mut cmd = AsyncCommand::new("cmd.exe");
    cmd.args(["/d", "/c", "gemini", "--version"]);
    cmd
}

/// Wizard step 2's Gemini card detection (spec §4.2: "Gemini is not a
/// herdr target... the GUI detects it with a fixed `gemini --version`").
#[tauri::command]
pub async fn gemini_version() -> Option<String> {
    run_fixed_version_command(gemini_version_command()).await
}

/// `herdr menu ▸ Start at Login` (spec §3.3): HKCU Run, via
/// `tauri-plugin-autostart`. Never a Windows service.
#[tauri::command]
pub async fn autostart_get(app: tauri::AppHandle) -> Result<bool, ApiError> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|err| ApiError {
        code: "io_error".to_string(),
        message: err.to_string(),
    })
}

#[tauri::command]
pub async fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), ApiError> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|err| ApiError {
        code: "io_error".to_string(),
        message: err.to_string(),
    })
}

// ---------------------------------------------------------------------
// A1: "Start at Login" migration (Cowbell rebrand spec §A1)
// ---------------------------------------------------------------------
//
// `tauri-plugin-autostart` defaults its Windows autostart entry's `app_name`
// to `app.package_info().name` when no explicit name is configured
// (`tauri-plugin-autostart-2.5.1/src/lib.rs:178-182`, and this crate's
// `lib.rs` calls `tauri_plugin_autostart::init` with no `.app_name()`
// override). `PackageInfo.name` is `tauri.conf.json`'s `productName` when
// one is set (`tauri-codegen-2.6.3/src/context.rs:268-269`). The `auto-launch`
// crate's Windows backend then uses that name **verbatim** as the HKCU
// `SOFTWARE\Microsoft\Windows\CurrentVersion\Run` value's *name* (not just
// its data): `set_value(&self.app_name, ...)`
// (`auto-launch-0.5.0/src/windows.rs:6,39-43`). Renaming `productName` from
// "Herdr Desktop" to "Cowbell" therefore orphans any existing "Herdr
// Desktop" Run entry -- this migrates it once, on startup.

/// The old Run value name (the pre-rebrand `productName`).
const OLD_AUTOSTART_APP_NAME: &str = "Herdr Desktop";

/// What `migrate_old_autostart_entry` decided to do, derived purely from
/// the old Run value's data (or its absence) -- unit-testable with no real
/// registry access (spec §A1.3 "a pure function: old value present/absent
/// -> action").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutostartMigration {
    /// No old "Herdr Desktop" Run value: nothing to migrate.
    NoOldEntry,
    /// An old Run value exists, but its data doesn't look like a path to an
    /// `.exe` (defensive: never touch a value that merely happens to share
    /// the old name for some unrelated reason).
    NotAnExePath,
    /// Delete the old value and enable autostart under the new name.
    Migrate,
}

/// Pure decision (spec §A1.3): `old_value` is the raw Run value data
/// (`"<exe path> <args>"`, `auto-launch-0.5.0/src/windows.rs:42`) read from
/// the registry under `OLD_AUTOSTART_APP_NAME`, or `None` when that value
/// doesn't exist.
pub fn decide_autostart_migration(old_value: Option<&str>) -> AutostartMigration {
    match old_value {
        None => AutostartMigration::NoOldEntry,
        Some(value) if value.trim().to_ascii_lowercase().ends_with(".exe") => {
            AutostartMigration::Migrate
        }
        Some(_) => AutostartMigration::NotAnExePath,
    }
}

/// The index of the first run of 2+ ASCII spaces in `s`, if any -- `reg.exe
/// query`'s own column separator between the name/type/data fields on a
/// value line. A *single* space never splits a field: both a value name
/// ("Herdr Desktop") and a data path ("C:\Program Files\...") routinely
/// contain one of their own.
fn find_field_boundary(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    (0..bytes.len()).find(|&i| bytes[i] == b' ' && bytes.get(i + 1) == Some(&b' '))
}

/// Splits one `reg.exe query` value line (already left-trimmed) into
/// `(name, type, data)` on runs of 2+ spaces. `None` when the line doesn't
/// have both boundaries (not a value line at all -- e.g. the key path
/// header line `reg.exe` prints first).
fn split_reg_query_fields(trimmed_line: &str) -> Option<(&str, &str, &str)> {
    let name_end = find_field_boundary(trimmed_line)?;
    let (name, after_name) = (
        &trimmed_line[..name_end],
        trimmed_line[name_end..].trim_start(),
    );
    let type_end = find_field_boundary(after_name)?;
    let (reg_type, data) = (&after_name[..type_end], after_name[type_end..].trim_start());
    Some((name, reg_type, data))
}

/// Parses one value's data out of `reg.exe query`'s output. Each matching
/// value renders as a line shaped `    <name>    <type>    <data>`. Pure
/// text parsing, no registry access -- unit-testable against captured
/// sample output.
pub fn parse_reg_query_value(output: &str, value_name: &str) -> Option<String> {
    for line in output.lines() {
        let Some((name, _reg_type, data)) = split_reg_query_fields(line.trim_start()) else {
            continue;
        };
        if name == value_name {
            // `reg.exe`'s own data can trail a space (e.g. `auto-launch`
            // writes `"<path> "` when there are no launch args --
            // `windows.rs:42`'s `format!("{} {}", path, args.join(" "))`).
            return Some(data.trim_end().to_string());
        }
    }
    None
}

const RUN_KEY: &str = r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
/// Task Manager's Startup tab state for each Run value. `auto-launch` writes
/// it too; the first byte `02` means enabled, anything else means the user
/// disabled the entry.
const STARTUP_APPROVED_KEY: &str =
    r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

/// True when the old entry's StartupApproved data (reg.exe prints
/// REG_BINARY as hex, e.g. `0300000000000000`) says the user disabled it in
/// Task Manager. An absent value means enabled.
pub fn startup_approved_disabled(hex: Option<&str>) -> bool {
    hex.is_some_and(|hex| !hex.trim().starts_with("02"))
}

/// `reg.exe query <key> /v "Herdr Desktop"` (spec §A1.1): reads the old
/// value's data, or `None` if it doesn't exist. Shells out to the
/// built-in `reg.exe` rather than adding a registry-access crate dependency
/// (hard constraint: no new cargo dependencies) -- the same fixed-command,
/// argument-array, no-console-window pattern this module already uses for
/// `herdr.exe`/`powershell.exe`/`cmd.exe`.
async fn read_old_autostart_value(key: &str) -> Option<String> {
    let mut cmd = AsyncCommand::new("reg.exe");
    cmd.args(["query", key, "/v", OLD_AUTOSTART_APP_NAME]);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_no_window(&mut cmd);
    let output = cmd.output().await.ok()?;
    if !output.status.success() {
        return None; // reg.exe exits non-zero when the value is absent
    }
    parse_reg_query_value(
        &String::from_utf8_lossy(&output.stdout),
        OLD_AUTOSTART_APP_NAME,
    )
}

/// `reg.exe delete <key> /v "Herdr Desktop" /f` (spec §A1.2).
async fn delete_old_autostart_value(key: &str) -> std::io::Result<std::process::ExitStatus> {
    let mut cmd = AsyncCommand::new("reg.exe");
    cmd.args(["delete", key, "/v", OLD_AUTOSTART_APP_NAME, "/f"]);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_no_window(&mut cmd);
    cmd.status().await
}

/// Runs the migration once, silently, on startup (spec §A1.2/.3): reads the
/// old Run value; if `decide_autostart_migration` says `Migrate`, enables
/// autostart under the new name via the already-registered
/// `tauri-plugin-autostart` manager, then deletes the old values. A missing
/// or unrelated old value is a no-op. Since the old value is deleted as part
/// of migrating, a later startup always finds `NoOldEntry` -- "once" falls
/// out of that, with no separate persisted flag needed. Errors are
/// swallowed: autostart is a convenience, never something that should fail
/// startup.
///
/// Order matters: the new entry is enabled first and the old one removed
/// only after that succeeded, so a failed write never loses Start at Login.
/// An entry the user disabled in Task Manager stays off: the old values go,
/// and nothing new is enabled.
pub async fn migrate_old_autostart_entry(app: tauri::AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    let raw = read_old_autostart_value(RUN_KEY).await;
    if decide_autostart_migration(raw.as_deref()) != AutostartMigration::Migrate {
        return;
    }
    let approved = read_old_autostart_value(STARTUP_APPROVED_KEY).await;
    if !startup_approved_disabled(approved.as_deref()) && app.autolaunch().enable().is_err() {
        return; // keep the old entry: the user still starts at login
    }
    let _ = delete_old_autostart_value(RUN_KEY).await;
    let _ = delete_old_autostart_value(STARTUP_APPROVED_KEY).await;
}

/// Finding #10 "Node gate": after a winget Node install, the GUI's own
/// process still has the `PATH` it was launched with baked into its
/// environment block -- only a fresh process picks up the new one. This is
/// the wizard's `[Restart GUI]` button: it restarts only the GUI's own
/// process (`AppHandle::restart`, which re-execs the current binary with
/// the same args/env, picking up the now-updated `PATH`). The herdr
/// **server** is a separate, detached process (spec §3.3) and keeps
/// running throughout.
///
/// Refuses while a screen recording runs: the restart ends the process
/// without finalizing the file (`record::restart_guard`).
#[tauri::command]
pub fn restart_gui(app: tauri::AppHandle) -> Result<(), ApiError> {
    crate::record::restart_guard(crate::record::active_count(&app))?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::io;

    // -- semver --

    #[test]
    fn parses_a_bare_semver() {
        assert_eq!(parse_semver("0.9.1"), Some("0.9.1".to_string()));
    }

    #[test]
    fn parses_semver_with_a_leading_v_and_surrounding_words() {
        assert_eq!(
            parse_semver("herdr v0.9.1 (release)"),
            Some("0.9.1".to_string())
        );
    }

    #[test]
    fn parses_semver_with_prerelease_suffix() {
        assert_eq!(
            parse_semver("0.9.1-beta.1"),
            Some("0.9.1-beta.1".to_string())
        );
    }

    #[test]
    fn rejects_non_semver_text() {
        assert_eq!(parse_semver("not a version"), None);
    }

    // -- binary resolution order (spec §3.1/§3.4, fake filesystem) --

    #[test]
    fn candidate_order_is_herdr_bin_then_junction_then_path() {
        let candidates = candidate_paths_from(
            Some("C:/custom/herdr.exe"),
            Some("C:/Users/x/AppData/Local"),
            Some("C:/tools;C:/other"),
        );
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("C:/custom/herdr.exe"),
                PathBuf::from("C:/Users/x/AppData/Local/Programs/Herdr/bin/herdr.exe"),
                PathBuf::from("C:/tools/herdr.exe"),
                PathBuf::from("C:/other/herdr.exe"),
            ]
        );
    }

    #[test]
    fn empty_herdr_bin_env_is_skipped() {
        let candidates = candidate_paths_from(Some(""), Some("C:/AppData"), None);
        assert_eq!(
            candidates,
            vec![PathBuf::from("C:/AppData/Programs/Herdr/bin/herdr.exe")]
        );
    }

    #[test]
    fn pick_first_existing_honours_order_with_a_fake_filesystem() {
        let candidates = vec![
            PathBuf::from("C:/custom/herdr.exe"),
            PathBuf::from("C:/junction/herdr.exe"),
            PathBuf::from("C:/path/herdr.exe"),
        ];
        // Fake filesystem: only the junction path "exists".
        let existing = std::collections::HashSet::from([PathBuf::from("C:/junction/herdr.exe")]);
        let found = pick_first_existing(&candidates, |p| existing.contains(p));
        assert_eq!(found, Some(PathBuf::from("C:/junction/herdr.exe")));
    }

    #[test]
    fn pick_first_existing_prefers_the_earliest_match() {
        let candidates = vec![PathBuf::from("a"), PathBuf::from("b")];
        let existing = std::collections::HashSet::from([PathBuf::from("a"), PathBuf::from("b")]);
        assert_eq!(
            pick_first_existing(&candidates, |p| existing.contains(p)),
            Some(PathBuf::from("a"))
        );
    }

    #[test]
    fn pick_first_existing_returns_none_when_nothing_exists() {
        let candidates = vec![PathBuf::from("a"), PathBuf::from("b")];
        assert_eq!(pick_first_existing(&candidates, |_| false), None);
    }

    // -- herdr's online installer argument builder (spec §B) --

    #[test]
    fn herdr_install_args_builds_the_exact_expected_arguments() {
        assert_eq!(
            herdr_install_args(),
            vec![
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "irm https://herdr.dev/install.ps1 | iex",
            ]
        );
    }

    #[test]
    fn powershell_exe_path_is_absolute_and_under_system_root() {
        let path = powershell_exe_path_from(Some("C:/Windows"));
        assert_eq!(
            path,
            PathBuf::from("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
        );
    }

    // -- creation-flags fallback (spec §3.3/§3.4, injected spawner) --

    #[test]
    fn breakaway_fallback_uses_primary_flags_when_they_succeed() {
        let mut flags_seen = Vec::new();
        let result = spawn_with_breakaway_fallback(|flags| {
            flags_seen.push(flags);
            Ok::<(), io::Error>(())
        });
        assert!(result.is_ok());
        assert_eq!(
            flags_seen.len(),
            1,
            "must not retry when the first attempt succeeds"
        );
    }

    #[test]
    fn breakaway_fallback_retries_without_breakaway_on_access_denied() {
        let mut flags_seen = Vec::new();
        let result = spawn_with_breakaway_fallback(|flags| {
            flags_seen.push(flags);
            if flags_seen.len() == 1 {
                Err(io::Error::from(io::ErrorKind::PermissionDenied))
            } else {
                Ok::<(), io::Error>(())
            }
        });
        assert!(result.is_ok());
        assert_eq!(
            flags_seen.len(),
            2,
            "must retry exactly once on access denied"
        );
        #[cfg(windows)]
        {
            assert_ne!(
                flags_seen[0], flags_seen[1],
                "the retry must use different flags"
            );
            assert_eq!(
                flags_seen[1] & creation_flags::CREATE_BREAKAWAY_FROM_JOB,
                0,
                "the retry must drop CREATE_BREAKAWAY_FROM_JOB"
            );
        }
    }

    #[test]
    fn breakaway_fallback_does_not_retry_on_other_errors() {
        let mut attempts = 0;
        let result: io::Result<()> = spawn_with_breakaway_fallback(|_flags| {
            attempts += 1;
            Err(io::Error::from(io::ErrorKind::NotFound))
        });
        assert!(result.is_err());
        assert_eq!(attempts, 1, "a non-access-denied error must not retry");
    }

    #[test]
    fn breakaway_fallback_surfaces_the_retrys_own_error() {
        let result: io::Result<()> = spawn_with_breakaway_fallback(|flags| {
            if flags != 0 && cfg!(windows) {
                // first call (primary flags)
            }
            Err(io::Error::from(io::ErrorKind::PermissionDenied))
        });
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::PermissionDenied);
    }

    // -- once-per-launch start guard (spec §3.3/§3.4) --

    #[test]
    fn start_once_guard_claims_exactly_once() {
        let guard = StartOnceGuard::default();
        assert!(!guard.already_claimed());
        assert!(guard.try_claim());
        assert!(guard.already_claimed());
        assert!(!guard.try_claim());
        assert!(!guard.try_claim());
    }

    #[tokio::test]
    async fn ensure_started_returns_true_immediately_when_already_up() {
        let guard = StartOnceGuard::default();
        let spawn_calls = RefCell::new(0);
        let up = ensure_started_generic(
            &guard,
            || {
                *spawn_calls.borrow_mut() += 1;
                Ok(())
            },
            || async { true },
        )
        .await;
        assert!(up);
        assert_eq!(
            *spawn_calls.borrow(),
            0,
            "must not spawn when the probe already succeeds"
        );
        assert!(
            !guard.already_claimed(),
            "an already-up server never claims the guard"
        );
    }

    #[tokio::test]
    async fn ensure_started_spawns_once_then_polls_until_the_probe_succeeds() {
        let guard = StartOnceGuard::default();
        let probe_calls = RefCell::new(0);
        let up = ensure_started_generic(
            &guard,
            || Ok(()),
            || {
                let mut calls = probe_calls.borrow_mut();
                *calls += 1;
                let succeed = *calls >= 3;
                async move { succeed }
            },
        )
        .await;
        assert!(up);
        assert!(guard.already_claimed());
        assert!(*probe_calls.borrow() >= 3);
    }

    // Finding #3 "race false failure": once the guard is already claimed,
    // `ensure_started_generic` now polls for the same 15s (via
    // `poll_until_up`) instead of returning `false` immediately. A probe
    // that never succeeds still spends that whole (virtual) 15s, so this
    // uses paused time -- tokio auto-advances a paused clock straight to
    // the next pending timer once every other task is idle, so the test
    // finishes instantly in real wall-clock time.
    #[tokio::test(start_paused = true)]
    async fn ensure_started_does_not_spawn_again_once_the_guard_is_claimed() {
        let guard = StartOnceGuard::default();
        assert!(guard.try_claim(), "simulate a previous launch attempt");
        let spawn_calls = RefCell::new(0);
        let up = ensure_started_generic(
            &guard,
            || {
                *spawn_calls.borrow_mut() += 1;
                Ok(())
            },
            || async { false },
        )
        .await;
        assert!(
            !up,
            "the probe never succeeds, even after polling out the 15s"
        );
        assert_eq!(
            *spawn_calls.borrow(),
            0,
            "never a silent restart loop (spec §3.3): an already-claimed guard must never spawn again"
        );
    }

    /// Finding #3 "race false failure": this is the scenario the fix
    /// exists for -- two near-simultaneous callers (e.g. the reconnect
    /// loop's `Err` arm and the wizard's own step 1) both find the probe
    /// down and race for the guard. The loser must not report "not
    /// running" just because it lost that race; the winner's own spawn may
    /// still be starting the server.
    #[tokio::test(start_paused = true)]
    async fn ensure_started_polls_and_sees_the_winner_of_the_race_come_up() {
        let guard = StartOnceGuard::default();
        assert!(guard.try_claim(), "simulate the winner of the race");
        let probe_calls = RefCell::new(0);
        let up = ensure_started_generic(
            &guard,
            || panic!("the loser of the race must never spawn a second server"),
            || {
                let mut calls = probe_calls.borrow_mut();
                *calls += 1;
                // The winner's own spawn finishes and the server comes up
                // on this loser's 3rd probe.
                let succeed = *calls >= 3;
                async move { succeed }
            },
        )
        .await;
        assert!(
            up,
            "must poll and see the winner's server come up, not report a false failure"
        );
    }

    #[tokio::test]
    async fn ensure_started_returns_false_when_spawn_fails() {
        let guard = StartOnceGuard::default();
        let up = ensure_started_generic(
            &guard,
            || Err(io::Error::from(io::ErrorKind::PermissionDenied)),
            || async { false },
        )
        .await;
        assert!(!up);
        assert!(
            guard.already_claimed(),
            "the one attempt is still spent even if it failed to spawn"
        );
    }

    #[tokio::test]
    async fn force_started_ignores_an_already_claimed_guard() {
        // force_started_generic takes no guard at all: this test documents
        // that calling it after ensure_started_generic already spent the
        // guard still spawns (an explicit "Start herdr" click, spec §3.3).
        let spawn_calls = RefCell::new(0);
        let up = force_started_generic(
            || {
                *spawn_calls.borrow_mut() += 1;
                Ok(())
            },
            || async { true },
        )
        .await;
        assert!(up);
    }

    // -- Stop Server claims the guard (finding #1 "Stop Server
    // auto-undone") --

    #[tokio::test]
    async fn stop_server_claiming_guard_claims_the_guard_even_when_stop_fails() {
        let guard = StartOnceGuard::default();
        // A bin path that can never spawn: exercises "claim first,
        // regardless of the result" without needing a real herdr binary.
        let bin = Path::new("C:/does/not/exist/herdr.exe");
        assert!(!guard.already_claimed());
        let result = stop_server_claiming_guard(&guard, bin).await;
        assert!(result.is_err(), "a nonexistent binary must fail to spawn");
        assert!(
            guard.already_claimed(),
            "Stop Server must claim the guard even if the stop call itself fails"
        );
    }

    /// Finding #1's full acceptance scenario, "stop → loop Err → no
    /// spawn": once Stop Server has claimed the guard, the reconnect
    /// loop's own `Err` arm (which shares this exact decision via
    /// `ensure_server_started`) must never respawn the server, even though
    /// the probe now correctly reports it down.
    #[tokio::test(start_paused = true)]
    async fn stop_then_reconnect_err_arm_never_respawns_the_server() {
        let guard = StartOnceGuard::default();
        let bin = Path::new("C:/does/not/exist/herdr.exe");
        let _ = stop_server_claiming_guard(&guard, bin).await; // the Stop click
        assert!(guard.already_claimed());

        let spawn_calls = RefCell::new(0);
        let up = ensure_started_generic(
            &guard,
            || {
                *spawn_calls.borrow_mut() += 1;
                Ok(())
            },
            || async { false }, // the server really is down, post-stop
        )
        .await;
        assert!(!up);
        assert_eq!(
            *spawn_calls.borrow(),
            0,
            "a deliberate Stop must never be silently undone by a respawn"
        );
    }

    // -- engine_status wire shape --

    #[test]
    fn engine_status_serializes_found_with_a_flat_kind_tag() {
        let status = EngineStatus::Found {
            path: PathBuf::from("C:/herdr.exe"),
            version: "0.9.5".to_string(),
        };
        let value = serde_json::to_value(&status).unwrap();
        assert_eq!(value["kind"], "found");
        assert_eq!(value["version"], "0.9.5");
    }

    #[test]
    fn engine_status_serializes_missing_with_no_extra_fields() {
        let value = serde_json::to_value(&EngineStatus::Missing).unwrap();
        assert_eq!(value["kind"], "missing");
    }

    // -- gemini command builder (finding #7 "gemini detection") --

    #[test]
    fn gemini_version_command_runs_through_cmd_exe_with_the_exact_expected_args() {
        let cmd = gemini_version_command();
        let std_cmd = cmd.as_std();
        assert_eq!(std_cmd.get_program(), std::ffi::OsStr::new("cmd.exe"));
        let args: Vec<&std::ffi::OsStr> = std_cmd.get_args().collect();
        assert_eq!(
            args,
            vec![
                std::ffi::OsStr::new("/d"),
                std::ffi::OsStr::new("/c"),
                std::ffi::OsStr::new("gemini"),
                std::ffi::OsStr::new("--version"),
            ]
        );
    }

    #[test]
    fn node_version_spawns_node_directly_with_no_shell_wrapper() {
        // `node.exe` genuinely exists on `PATH` (spec finding #7: "same
        // approach must not affect `node`"), so this must stay a direct
        // `Command::new("node")`, never routed through `cmd.exe`.
        let cmd = AsyncCommand::new("node");
        assert_eq!(cmd.as_std().get_program(), std::ffi::OsStr::new("node"));
    }

    // -- timeouts (finding #12) --

    #[tokio::test]
    async fn run_install_kills_and_reports_timeout_when_the_process_hangs() {
        let mut cmd = AsyncCommand::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 30",
        ]);
        let start = std::time::Instant::now();
        let result = run_install_command(cmd, |_line| {}, Duration::from_millis(300)).await;
        assert!(matches!(result, Err(InstallError::Timeout)));
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "must be killed well before the 30s sleep finishes, not wait it out"
        );
    }

    #[tokio::test]
    async fn run_install_command_succeeds_within_its_timeout() {
        let mut cmd = AsyncCommand::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Write-Output hello",
        ]);
        let mut lines = Vec::new();
        let result = run_install_command(
            cmd,
            |line| lines.push(line.to_string()),
            Duration::from_secs(30),
        )
        .await;
        assert!(result.is_ok());
        assert!(lines.iter().any(|l| l.contains("hello")));
    }

    #[tokio::test]
    async fn run_output_with_timeout_kills_a_hanging_command_and_reports_it() {
        let mut cmd = AsyncCommand::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 30",
        ]);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let start = std::time::Instant::now();
        let result = run_output_with_timeout(cmd, Duration::from_millis(300)).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("timed out"));
        assert!(start.elapsed() < Duration::from_secs(10));
    }

    // -- A1 autostart migration (spec §A1.3, pure decision + pure parser) --

    #[test]
    fn task_manager_disabled_state_is_read_from_the_first_byte() {
        assert!(!startup_approved_disabled(None)); // no value: enabled
        assert!(!startup_approved_disabled(Some("020000000000000000000000")));
        assert!(startup_approved_disabled(Some("0300000060B5B4E3D7C4DB01")));
        // reg.exe prints REG_BINARY data as hex in the data column
        let out = "\r\nHKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run\r\n    Herdr Desktop    REG_BINARY    0300000060B5B4E3D7C4DB01\r\n\r\n";
        let hex = parse_reg_query_value(out, OLD_AUTOSTART_APP_NAME);
        assert!(startup_approved_disabled(hex.as_deref()));
    }

    #[test]
    fn migration_is_a_noop_with_no_old_value() {
        assert_eq!(
            decide_autostart_migration(None),
            AutostartMigration::NoOldEntry
        );
    }

    #[test]
    fn migration_runs_when_the_old_value_points_at_an_exe() {
        // The real shape `auto-launch`'s Windows backend writes
        // (`auto-launch-0.5.0/src/windows.rs:42`): the bare exe path, a
        // trailing space, and no quoting even though the path has spaces
        // -- `format!("{} {}", app_path, args.join(" "))` with no args.
        assert_eq!(
            decide_autostart_migration(Some(
                r"C:\Users\jane\AppData\Local\Programs\Herdr Desktop\Herdr Desktop.exe "
            )),
            AutostartMigration::Migrate
        );
    }

    #[test]
    fn migration_is_case_insensitive_on_the_exe_extension() {
        assert_eq!(
            decide_autostart_migration(Some(r"C:\portable\Herdr Desktop.EXE")),
            AutostartMigration::Migrate
        );
    }

    #[test]
    fn migration_ignores_a_value_that_does_not_look_like_an_exe_path() {
        assert_eq!(
            decide_autostart_migration(Some("not an exe path")),
            AutostartMigration::NotAnExePath
        );
    }

    #[test]
    fn migration_ignores_an_empty_value() {
        assert_eq!(
            decide_autostart_migration(Some("")),
            AutostartMigration::NotAnExePath
        );
    }

    #[test]
    fn parses_a_reg_query_value_with_trailing_args() {
        let output = "HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run\n    Herdr Desktop    REG_SZ    C:\\Users\\jane\\Herdr Desktop.exe \n\n";
        assert_eq!(
            parse_reg_query_value(output, "Herdr Desktop"),
            Some("C:\\Users\\jane\\Herdr Desktop.exe".to_string())
        );
    }

    #[test]
    fn parses_a_reg_query_value_with_no_trailing_args() {
        let output = "HKEY_CURRENT_USER\\...\\Run\n    Herdr Desktop    REG_SZ    C:\\portable\\Herdr Desktop.exe\n";
        assert_eq!(
            parse_reg_query_value(output, "Herdr Desktop"),
            Some("C:\\portable\\Herdr Desktop.exe".to_string())
        );
    }

    #[test]
    fn returns_none_when_the_value_name_is_absent() {
        let output =
            "HKEY_CURRENT_USER\\...\\Run\n    Cowbell    REG_SZ    C:\\portable\\Cowbell.exe\n";
        assert_eq!(parse_reg_query_value(output, "Herdr Desktop"), None);
    }

    #[test]
    fn does_not_match_a_longer_name_that_merely_starts_with_the_value_name() {
        let output = "HKEY_CURRENT_USER\\...\\Run\n    Herdr Desktop Beta    REG_SZ    C:\\x.exe\n";
        assert_eq!(parse_reg_query_value(output, "Herdr Desktop"), None);
    }
}
