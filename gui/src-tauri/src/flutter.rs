//! Flutter run support (`flutter-run-spec.md` §3, §10): device listing
//! through `adb devices -l` (fast) and `flutter devices --machine` (slow,
//! but it also lists Windows and Chrome), and Flutter project detection.
//!
//! Play does not run `flutter` from Rust: it types `flutter run` into a
//! pane, and the pane's own shell finds it on `PATH`. Only the device
//! listing below spawns `flutter`.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command as AsyncCommand;

use crate::commands::ApiError;
use crate::engine::apply_no_window;

const ADB_TIMEOUT: Duration = Duration::from_secs(10);
const FLUTTER_TIMEOUT: Duration = Duration::from_secs(30);
const PUBSPEC_MAX_BYTES: u64 = 256 * 1024;
const STDERR_MAX_CHARS: usize = 2000;
const SKIPPED_SUBFOLDERS: [&str; 3] = ["build", "node_modules", "ios"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlutterProject {
    pub dir: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidDevice {
    pub id: String,
    pub name: String,
    /// adb's own state word (`device`, `unauthorized`, `offline`, ...). Only
    /// `device` is runnable; the UI explains the rest. Every flutter entry
    /// is `device`.
    pub state: String,
    pub emulator: bool,
}

pub(crate) fn api_error(code: &str, message: impl Into<String>) -> ApiError {
    ApiError {
        code: code.to_string(),
        message: message.into(),
    }
}

/// `^[A-Za-z0-9._:\-]+$`. The id is later typed into a shell, so this is
/// the injection guard; the frontend checks the same set again before it
/// sends the id.
pub fn is_valid_device_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

/// Windows only: `kill_on_drop` kills `flutter.bat`'s `cmd.exe` but not the
/// `dart.exe` grandchild, which keeps flutter's startup lock. `taskkill /T`
/// ends the whole tree; its result is ignored. Elsewhere `kill_on_drop`
/// is enough.
async fn kill_process_tree(pid: Option<u32>) {
    #[cfg(windows)]
    if let Some(pid) = pid {
        let mut kill = AsyncCommand::new("taskkill");
        kill.args(["/T", "/F", "/PID", &pid.to_string()]);
        kill.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        apply_no_window(&mut kill);
        let _ = kill.status().await;
    }
    let _ = pid; // no-op on non-Windows
}

/// Runs `cmd` with no stdin and piped output, under `timeout`. A timeout
/// drops the child, which kills it (`kill_on_drop`). A non-zero exit gives
/// `failed_code` with stderr cut to `STDERR_MAX_CHARS`.
pub(crate) async fn run_capture(
    mut cmd: AsyncCommand,
    timeout: Duration,
    timeout_code: &str,
    failed_code: &str,
) -> Result<String, ApiError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_no_window(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|err| api_error(failed_code, err.to_string()))?;
    let pid = child.id();
    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(result) => result.map_err(|err| api_error(failed_code, err.to_string()))?,
        Err(_) => {
            kill_process_tree(pid).await;
            return Err(api_error(
                timeout_code,
                format!("timed out after {}s", timeout.as_secs()),
            ));
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message: String = stderr.chars().take(STDERR_MAX_CHARS).collect();
        return Err(api_error(failed_code, message));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

// ---------------------------------------------------------------------
// §3.1 adb resolution
// ---------------------------------------------------------------------

pub(crate) fn tool_file_name(tool: &str) -> String {
    if !cfg!(windows) {
        return tool.to_string();
    }
    // `flutter` is a `.bat` on Windows; Rust's `Command::new("flutter")`
    // only appends `.exe`, so the file is looked up by its real name.
    if tool == "flutter" {
        "flutter.bat".to_string()
    } else {
        format!("{tool}.exe")
    }
}

/// The per-OS default SDK folder (`%LOCALAPPDATA%\Android\Sdk`,
/// `~/Library/Android/sdk`, `~/Android/Sdk`), from the process env.
pub(crate) fn default_sdk_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join("Android").join("Sdk"))
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Android")
                .join("sdk")
        })
    } else {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Android").join("Sdk"))
    }
}

/// Picks the first existing adb, in spec order: `ANDROID_HOME`,
/// `ANDROID_SDK_ROOT`, `PATH`, then the default SDK folder. The env values
/// are parameters so tests never change the process env.
pub fn resolve_adb(
    android_home: Option<&Path>,
    android_sdk_root: Option<&Path>,
    path_var: Option<&std::ffi::OsStr>,
    default_sdk: Option<&Path>,
) -> Option<PathBuf> {
    let name = tool_file_name("adb");
    let mut candidates: Vec<PathBuf> = Vec::new();
    for sdk in [android_home, android_sdk_root].into_iter().flatten() {
        candidates.push(sdk.join("platform-tools").join(&name));
    }
    if let Some(path_var) = path_var {
        for dir in std::env::split_paths(path_var) {
            candidates.push(dir.join(&name));
        }
    }
    if let Some(sdk) = default_sdk {
        candidates.push(sdk.join("platform-tools").join(&name));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// The first `PATH` entry that holds `flutter.bat` (`flutter` elsewhere).
pub fn resolve_flutter(path_var: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let name = tool_file_name("flutter");
    std::env::split_paths(path_var?)
        .map(|dir| dir.join(&name))
        .find(|p| p.is_file())
}

// ---------------------------------------------------------------------
// §3.2 android_devices
// ---------------------------------------------------------------------

/// Parses `adb devices -l` output. Keeps every state.
pub fn parse_adb_devices(stdout: &str) -> Vec<AndroidDevice> {
    let mut devices = Vec::new();
    let mut in_list = false;
    for line in stdout.lines() {
        let line = line.trim();
        if !in_list {
            in_list = line.starts_with("List of devices attached");
            continue;
        }
        if line.is_empty() || line.starts_with('*') {
            continue;
        }
        let mut fields = line.split_whitespace();
        let (Some(id), Some(state)) = (fields.next(), fields.next()) else {
            continue;
        };
        if !is_valid_device_id(id) {
            tracing::warn!(id, "dropping adb device with an unsafe id");
            continue;
        }
        let name = fields
            .find_map(|f| f.strip_prefix("model:"))
            .filter(|m| !m.is_empty())
            .map(|m| m.replace('_', " "))
            .unwrap_or_else(|| id.to_string());
        devices.push(AndroidDevice {
            id: id.to_string(),
            name,
            state: state.to_string(),
            emulator: id.starts_with("emulator-"),
        });
    }
    devices
}

#[tauri::command]
pub async fn android_devices() -> Result<Vec<AndroidDevice>, ApiError> {
    let android_home = std::env::var_os("ANDROID_HOME").map(PathBuf::from);
    let android_sdk_root = std::env::var_os("ANDROID_SDK_ROOT").map(PathBuf::from);
    let path_var = std::env::var_os("PATH");
    let adb = resolve_adb(
        android_home.as_deref(),
        android_sdk_root.as_deref(),
        path_var.as_deref(),
        default_sdk_dir().as_deref(),
    )
    .ok_or_else(|| {
        api_error(
            "adb_not_found",
            "adb was not found; install Android SDK platform-tools",
        )
    })?;
    let mut cmd = AsyncCommand::new(&adb);
    cmd.args(["devices", "-l"]);
    let stdout = run_capture(cmd, ADB_TIMEOUT, "adb_timeout", "adb_failed").await?;
    Ok(parse_adb_devices(&stdout))
}

// ---------------------------------------------------------------------
// §10.1 flutter_devices
// ---------------------------------------------------------------------

/// Parses `flutter devices --machine` output: the JSON array from the
/// first `[` to the last `]`, because flutter can print a banner or a
/// "Waiting for another flutter command..." line first. Keeps only
/// `isSupported == true` entries with a safe id.
pub fn parse_flutter_devices(stdout: &str) -> Result<Vec<AndroidDevice>, ApiError> {
    let (Some(start), Some(end)) = (stdout.find('['), stdout.rfind(']')) else {
        return Err(api_error(
            "flutter_failed",
            "flutter devices printed no JSON array",
        ));
    };
    if end < start {
        return Err(api_error(
            "flutter_failed",
            "flutter devices printed no JSON array",
        ));
    }
    let entries: Vec<serde_json::Value> = serde_json::from_str(&stdout[start..=end])
        .map_err(|err| api_error("flutter_failed", err.to_string()))?;
    let mut devices = Vec::new();
    for entry in entries {
        if entry.get("isSupported").and_then(|v| v.as_bool()) != Some(true) {
            continue;
        }
        let Some(id) = entry.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        if !is_valid_device_id(id) {
            tracing::warn!(id, "dropping flutter device with an unsafe id");
            continue;
        }
        let name = entry
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|n| !n.is_empty())
            .unwrap_or(id);
        devices.push(AndroidDevice {
            id: id.to_string(),
            name: name.to_string(),
            state: "device".to_string(),
            emulator: entry
                .get("emulator")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        });
    }
    Ok(devices)
}

#[tauri::command]
pub async fn flutter_devices() -> Result<Vec<AndroidDevice>, ApiError> {
    let flutter = resolve_flutter(std::env::var_os("PATH").as_deref())
        .ok_or_else(|| api_error("flutter_not_found", "flutter was not found on PATH"))?;
    let mut cmd = AsyncCommand::new(&flutter);
    cmd.args(["devices", "--machine"]);
    let stdout = run_capture(cmd, FLUTTER_TIMEOUT, "flutter_timeout", "flutter_failed").await?;
    parse_flutter_devices(&stdout)
}

// ---------------------------------------------------------------------
// §3.3 flutter_project
// ---------------------------------------------------------------------

/// Reads at most `PUBSPEC_MAX_BYTES` of `dir/pubspec.yaml`; `None` on a
/// missing file or an I/O error.
fn read_pubspec(dir: &Path) -> Option<String> {
    let file = std::fs::File::open(dir.join("pubspec.yaml")).ok()?;
    let mut bytes = Vec::new();
    file.take(PUBSPEC_MAX_BYTES).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// A folder matches when its `pubspec.yaml` has a line that, trimmed,
/// equals `sdk: flutter`; a pure Dart package must not match.
fn match_flutter_dir(dir: &Path) -> Option<FlutterProject> {
    let pubspec = read_pubspec(dir)?;
    if !pubspec.lines().any(|l| l.trim() == "sdk: flutter") {
        return None;
    }
    let name = pubspec
        .lines()
        .find_map(|l| l.strip_prefix("name:"))
        .map(|v| v.trim().trim_matches(['"', '\'']).to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| {
            dir.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
    Some(FlutterProject {
        dir: dir.to_string_lossy().into_owned(),
        name,
    })
}

/// `cwd` and each ancestor first, then each immediate subfolder of `cwd`
/// sorted by name.
pub fn find_flutter_project(cwd: &Path) -> Option<FlutterProject> {
    if let Some(found) = cwd.ancestors().find_map(match_flutter_dir) {
        return Some(found);
    }
    let mut subfolders: Vec<PathBuf> = std::fs::read_dir(cwd)
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            !name.starts_with('.') && !SKIPPED_SUBFOLDERS.contains(&name.as_str())
        })
        .map(|entry| entry.path())
        .collect();
    subfolders.sort();
    subfolders.iter().find_map(|dir| match_flutter_dir(dir))
}

#[tauri::command]
pub async fn flutter_project(cwd: String) -> Result<Option<FlutterProject>, ApiError> {
    tokio::task::spawn_blocking(move || find_flutter_project(Path::new(&cwd)))
        .await
        .map_err(|err| api_error("flutter_project_failed", err.to_string()))
}

// ---------------------------------------------------------------------
// Flavors and run liveness
// ---------------------------------------------------------------------

const GRADLE_MAX_BYTES: u64 = 1024 * 1024;
const MAX_FLAVORS: usize = 500;

fn quoted_strings(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut quote: Option<char> = None;
    let mut current = String::new();
    for c in text.chars() {
        match quote {
            Some(q) if c == q => {
                out.push(std::mem::take(&mut current));
                quote = None;
            }
            Some(_) => current.push(c),
            None if c == '"' || c == '\'' => quote = Some(c),
            None => {}
        }
    }
    out
}

fn strip_line_comments(text: &str) -> String {
    text.lines()
        .map(|l| l.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_safe_flavor(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && name.chars().all(|c| c.is_ascii_alphanumeric())
}

/// The flavor names `flutter run --flavor` accepts, from the text of an app
/// `build.gradle(.kts)`: every combination of the flavor dimensions, in
/// `flavorDimensions` order, joined camelCase (`dev` + `sales` = `devSales`).
/// Groovy and Kotlin DSL both work; a project with no flavors gives none.
pub fn parse_flavors(gradle: &str) -> Vec<String> {
    let text = strip_line_comments(gradle);
    let mut dimensions: Vec<String> = text
        .lines()
        .find(|l| l.contains("flavorDimensions"))
        .map(quoted_strings)
        .unwrap_or_default();
    let Some(start) = text.find("productFlavors") else {
        return Vec::new();
    };
    let Some(open) = text[start..].find('{') else {
        return Vec::new();
    };
    let mut depth = 0usize;
    let mut header = String::new();
    let mut body = String::new();
    let mut flavors: Vec<(String, Option<String>)> = Vec::new();
    for c in text[start + open + 1..].chars() {
        match c {
            '{' => {
                depth += 1;
                if depth > 1 {
                    body.push(c);
                }
            }
            '}' if depth == 0 => break,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    let line = header
                        .lines()
                        .rev()
                        .find(|l| !l.trim().is_empty())
                        .unwrap_or("");
                    let name = quoted_strings(line).into_iter().next().or_else(|| {
                        line.split(|c: char| !c.is_ascii_alphanumeric())
                            .filter(|w| !w.is_empty())
                            .last()
                            .map(str::to_string)
                    });
                    let dimension = body.find("dimension").and_then(|i| {
                        let rest = body[i..].lines().next().unwrap_or("");
                        quoted_strings(rest).into_iter().next()
                    });
                    if let Some(name) = name {
                        flavors.push((name, dimension));
                    }
                    header.clear();
                    body.clear();
                } else {
                    body.push(c);
                }
            }
            _ if depth == 0 => header.push(c),
            _ => body.push(c),
        }
    }
    if dimensions.is_empty() {
        for dim in flavors.iter().filter_map(|(_, d)| d.as_ref()) {
            if !dimensions.contains(dim) {
                dimensions.push(dim.clone());
            }
        }
    }
    let mut combos: Vec<String> = Vec::new();
    if dimensions.is_empty() {
        combos = flavors.iter().map(|(n, _)| n.clone()).collect();
    } else {
        for dim in &dimensions {
            let names: Vec<&String> = flavors
                .iter()
                .filter(|(_, d)| d.as_deref() == Some(dim.as_str()))
                .map(|(n, _)| n)
                .collect();
            if names.is_empty() {
                continue;
            }
            if combos.is_empty() {
                combos = names.iter().map(|n| (*n).clone()).collect();
                continue;
            }
            let mut next = Vec::new();
            'outer: for prefix in &combos {
                for name in &names {
                    if next.len() >= MAX_FLAVORS {
                        break 'outer;
                    }
                    let mut chars = name.chars();
                    let cap: String = chars
                        .next()
                        .map(|f| f.to_ascii_uppercase().to_string() + chars.as_str())
                        .unwrap_or_default();
                    next.push(format!("{prefix}{cap}"));
                }
            }
            combos = next;
        }
    }
    combos.retain(|n| is_safe_flavor(n));
    combos
}

/// `android/app/build.gradle`, else `build.gradle.kts`, under `dir`.
pub fn read_flavors(dir: &Path) -> Vec<String> {
    for file in ["build.gradle", "build.gradle.kts"] {
        let path = dir.join("android").join("app").join(file);
        let Ok(handle) = std::fs::File::open(path) else {
            continue;
        };
        let mut bytes = Vec::new();
        if handle.take(GRADLE_MAX_BYTES).read_to_end(&mut bytes).is_ok() {
            return parse_flavors(&String::from_utf8_lossy(&bytes));
        }
    }
    Vec::new()
}

#[tauri::command]
pub async fn flutter_flavors(dir: String) -> Result<Vec<String>, ApiError> {
    tokio::task::spawn_blocking(move || read_flavors(Path::new(&dir)))
        .await
        .map_err(|err| api_error("flutter_flavors_failed", err.to_string()))
}

/// Whether a `flutter run -d <device_id>` process is alive. The GUI cannot
/// read the pane, so this is how it learns that a run ended on its own (a
/// failed build). Any failure to look answers `true`: the run state stays
/// as it was rather than flipping to stopped on a guess.
#[tauri::command]
pub async fn flutter_run_alive(device_id: String) -> Result<bool, ApiError> {
    if !is_valid_device_id(&device_id) {
        return Err(api_error("invalid_device_id", "unsafe device id"));
    }
    #[cfg(windows)]
    {
        let script = format!(
            "@(Get-CimInstance Win32_Process | Where-Object {{ $_.Name -like 'dart*' -and $_.CommandLine -like '*flutter_tools*' -and $_.CommandLine -like '* run *' -and $_.CommandLine -like '*-d {device_id}*' }}).Count"
        );
        let mut cmd = AsyncCommand::new("powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        let out = run_capture(cmd, ADB_TIMEOUT, "flutter_alive_timeout", "flutter_alive_failed").await;
        Ok(out
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .map_or(true, |n| n > 0))
    }
    #[cfg(not(windows))]
    {
        let mut cmd = AsyncCommand::new("pgrep");
        cmd.args(["-f", &format!("flutter_tools.*run.*-d {device_id}")]);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        Ok(cmd.status().await.map_or(true, |s| s.success()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "List of devices attached\nRF8W3085JEW            device product:a14nsxx model:SM_A145F device:a14 transport_id:30\n\n";

    #[test]
    fn parses_the_sample_device() {
        let devices = parse_adb_devices(SAMPLE);
        assert_eq!(
            devices,
            vec![AndroidDevice {
                id: "RF8W3085JEW".into(),
                name: "SM A145F".into(),
                state: "device".into(),
                emulator: false,
            }]
        );
    }

    #[test]
    fn flags_an_emulator() {
        let out = "List of devices attached\nemulator-5554 device product:sdk_gphone64 model:sdk_gphone64_x86_64\n";
        let devices = parse_adb_devices(out);
        assert_eq!(devices.len(), 1);
        assert!(devices[0].emulator);
        assert_eq!(devices[0].name, "sdk gphone64 x86 64");
    }

    #[test]
    fn unauthorized_without_model_uses_the_id_as_name() {
        let out = "List of devices attached\nABC123\tunauthorized transport_id:2\n";
        let devices = parse_adb_devices(out);
        assert_eq!(devices[0].name, "ABC123");
        assert_eq!(devices[0].state, "unauthorized");
    }

    #[test]
    fn ignores_daemon_lines_before_the_header() {
        let out = format!(
            "* daemon not running; starting now at tcp:5037\n* daemon started successfully\n{SAMPLE}"
        );
        assert_eq!(parse_adb_devices(&out).len(), 1);
    }

    #[test]
    fn header_only_gives_no_devices() {
        assert!(parse_adb_devices("List of devices attached\n\n").is_empty());
    }

    #[test]
    fn keeps_a_wireless_id() {
        let out = "List of devices attached\nadb-R58N._adb-tls-connect._tcp device model:Pixel_7\n";
        let devices = parse_adb_devices(out);
        assert_eq!(devices[0].id, "adb-R58N._adb-tls-connect._tcp");
    }

    #[test]
    fn drops_an_id_with_a_semicolon() {
        let out = "List of devices attached\nabc;rm device model:X\nGOOD device model:Y\n";
        let devices = parse_adb_devices(out);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "GOOD");
    }

    #[test]
    fn device_id_filter() {
        assert!(is_valid_device_id("192.168.1.5:5555"));
        assert!(!is_valid_device_id(""));
        assert!(!is_valid_device_id("a b"));
        assert!(!is_valid_device_id("$(x)"));
        assert!(!is_valid_device_id("--release"));
    }

    const FLUTTER_SAMPLE: &str = r#"[{"name":"SM A145F","id":"RF8W3085JEW","isSupported":true,"targetPlatform":"android-arm64","emulator":false},{"name":"Windows","id":"windows","isSupported":true,"targetPlatform":"windows-x64","emulator":false},{"name":"Chrome","id":"chrome","isSupported":true,"targetPlatform":"web-javascript","emulator":false}]"#;

    #[test]
    fn parses_the_flutter_sample() {
        let devices = parse_flutter_devices(FLUTTER_SAMPLE).unwrap();
        let ids: Vec<&str> = devices.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, ["RF8W3085JEW", "windows", "chrome"]);
        assert_eq!(devices[1].name, "Windows");
        assert!(devices.iter().all(|d| d.state == "device" && !d.emulator));
    }

    #[test]
    fn flutter_output_may_have_a_text_prefix() {
        let out = format!("Waiting for another flutter command to release the startup lock...\n{FLUTTER_SAMPLE}\n");
        assert_eq!(parse_flutter_devices(&out).unwrap().len(), 3);
    }

    #[test]
    fn flutter_drops_unsupported_devices() {
        let out = r#"[{"name":"Old","id":"old","isSupported":false},{"name":"New","id":"new","isSupported":true}]"#;
        let devices = parse_flutter_devices(out).unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "new");
    }

    #[test]
    fn flutter_drops_an_id_with_a_semicolon() {
        let out = r#"[{"name":"Bad","id":"a;b","isSupported":true},{"name":"Ok","id":"ok","isSupported":true}]"#;
        let devices = parse_flutter_devices(out).unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].id, "ok");
    }

    #[test]
    fn flutter_empty_stdout_is_flutter_failed() {
        let err = parse_flutter_devices("").unwrap_err();
        assert_eq!(err.code, "flutter_failed");
        let err = parse_flutter_devices("no json here").unwrap_err();
        assert_eq!(err.code, "flutter_failed");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("cowbell-flutter-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_pubspec(dir: &Path, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("pubspec.yaml"), body).unwrap();
    }

    const FLUTTER_PUBSPEC: &str = "name: my_app\ndependencies:\n  flutter:\n    sdk: flutter\n";

    #[test]
    fn detects_a_project_in_cwd() {
        let root = scratch("cwd");
        write_pubspec(&root, FLUTTER_PUBSPEC);
        let found = find_flutter_project(&root).unwrap();
        assert_eq!(found.name, "my_app");
        assert_eq!(found.dir, root.to_string_lossy());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn detects_a_project_two_ancestors_up() {
        let root = scratch("ancestor");
        write_pubspec(&root, FLUTTER_PUBSPEC);
        let deep = root.join("lib").join("src");
        std::fs::create_dir_all(&deep).unwrap();
        let found = find_flutter_project(&deep).unwrap();
        assert_eq!(found.dir, root.to_string_lossy());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn detects_a_project_in_a_subfolder() {
        let root = scratch("sub");
        write_pubspec(&root.join("app"), FLUTTER_PUBSPEC);
        let found = find_flutter_project(&root).unwrap();
        assert_eq!(found.dir, root.join("app").to_string_lossy());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_dart_only_package_does_not_match() {
        let root = scratch("dart");
        write_pubspec(&root, "name: just_dart\nenvironment:\n  sdk: ^3.0.0\n");
        assert!(find_flutter_project(&root).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn skips_dot_and_build_subfolders() {
        let root = scratch("skipped");
        write_pubspec(&root.join(".dart_tool"), FLUTTER_PUBSPEC);
        write_pubspec(&root.join("build"), FLUTTER_PUBSPEC);
        assert!(find_flutter_project(&root).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn strips_quotes_from_the_name() {
        let root = scratch("quotes");
        write_pubspec(&root, "name: \"my_app\"\nflutter:\n  sdk: flutter\n");
        assert_eq!(find_flutter_project(&root).unwrap().name, "my_app");
        let _ = std::fs::remove_dir_all(&root);
    }

    fn fake_adb(sdk: &Path) {
        let dir = sdk.join("platform-tools");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(tool_file_name("adb")), b"").unwrap();
    }

    #[test]
    fn android_home_wins_over_path() {
        let home = scratch("adb-home");
        let on_path = scratch("adb-path");
        fake_adb(&home);
        std::fs::write(on_path.join(tool_file_name("adb")), b"").unwrap();
        let path_var = std::env::join_paths([&on_path]).unwrap();
        let found = resolve_adb(Some(&home), None, Some(&path_var), None).unwrap();
        assert_eq!(
            found,
            home.join("platform-tools").join(tool_file_name("adb"))
        );
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&on_path);
    }

    #[test]
    fn falls_back_to_the_default_sdk_folder() {
        let empty = scratch("adb-empty");
        let sdk = scratch("adb-default");
        fake_adb(&sdk);
        let path_var = std::env::join_paths([&empty]).unwrap();
        let found = resolve_adb(Some(&empty), None, Some(&path_var), Some(&sdk)).unwrap();
        assert_eq!(
            found,
            sdk.join("platform-tools").join(tool_file_name("adb"))
        );
        assert!(resolve_adb(Some(&empty), None, Some(&path_var), None).is_none());
        let _ = std::fs::remove_dir_all(&empty);
        let _ = std::fs::remove_dir_all(&sdk);
    }

    #[test]
    fn resolves_flutter_from_the_path_parameter() {
        let empty = scratch("flutter-empty");
        let bin = scratch("flutter-bin");
        std::fs::write(bin.join(tool_file_name("flutter")), b"").unwrap();
        let path_var = std::env::join_paths([&empty, &bin]).unwrap();
        let found = resolve_flutter(Some(&path_var)).unwrap();
        assert_eq!(found, bin.join(tool_file_name("flutter")));
        let only_empty = std::env::join_paths([&empty]).unwrap();
        assert!(resolve_flutter(Some(&only_empty)).is_none());
        assert!(resolve_flutter(None).is_none());
        let _ = std::fs::remove_dir_all(&empty);
        let _ = std::fs::remove_dir_all(&bin);
    }
}

#[cfg(test)]
mod flavor_tests {
    use super::*;

    const GROOVY: &str = r#"
android {
    flavorDimensions "deployment", "solution"
    productFlavors {
        dev {
            dimension "deployment"
            applicationIdSuffix ".dev"
        }
        play {
            dimension "deployment"
        }
        sales {
            dimension "solution"
            manifestPlaceholders.applicationLabel = "Simplr Sales"
        }
        wms { // comment
            dimension "solution"
        }
    }
    defaultConfig { }
}
"#;

    #[test]
    fn groovy_two_dimensions_give_camel_case_combinations() {
        assert_eq!(
            parse_flavors(GROOVY),
            ["devSales", "devWms", "playSales", "playWms"]
        );
    }

    #[test]
    fn kotlin_dsl_works() {
        let kts = r#"
flavorDimensions += listOf("env", "app")
productFlavors {
    create("dev") { dimension = "env" }
    register("prod") { dimension = "env" }
    create("main") { dimension = "app" }
}
"#;
        assert_eq!(parse_flavors(kts), ["devMain", "prodMain"]);
    }

    #[test]
    fn one_dimension_gives_plain_names() {
        let g = "flavorDimensions \"env\"\nproductFlavors {\n dev { dimension \"env\" }\n prod { dimension \"env\" }\n}";
        assert_eq!(parse_flavors(g), ["dev", "prod"]);
    }

    #[test]
    fn no_flavors_gives_none() {
        assert!(parse_flavors("android { defaultConfig { } }").is_empty());
    }

    #[test]
    fn unsafe_names_are_dropped() {
        let g = "flavorDimensions \"e\"\nproductFlavors {\n create(\"a b;c\") { dimension \"e\" }\n ok { dimension \"e\" }\n}";
        assert_eq!(parse_flavors(g), ["ok"]);
    }
}
