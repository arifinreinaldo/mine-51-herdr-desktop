//! The Claude Code statusLine tap install/undo flow (Phase 1.6 spec §4.3).
//!
//! **This is the only code allowed to write `~/.claude/settings.json` or
//! `~/.claude/statusline/`, and only after an explicit click** (spec §4.3
//! "Exception to Phase 1 §8"). It never reads `~/.claude/.credentials.json`.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::commands::ApiError;

/// The tap script, embedded at compile time from the same file the NSIS
/// bundle also ships under `resources/statusline/*` (spec §2.1) -- so
/// installing the tap needs no `AppHandle`/resource-path resolution at
/// runtime, only the bytes that are already part of this binary.
const TAP_SCRIPT: &[u8] = include_bytes!("../resources/statusline/herdr-usage.ps1");

const TRUNCATE_LEN: usize = 120;
const TAP_COMMAND_MARKER: &str = "herdr-usage";

#[derive(Debug, Clone, PartialEq)]
pub enum StatuslineClass {
    None,
    /// Already herdr's own tap (`statusLine.command` contains
    /// `herdr-usage`).
    Herdr,
    /// Some other tool's statusLine command, truncated to 120 characters
    /// for display (spec §4.3).
    Other {
        display_command: String,
    },
}

/// Classifies `statusLine.command` (spec §4.3).
pub fn classify_command(command: Option<&str>) -> StatuslineClass {
    match command {
        None => StatuslineClass::None,
        Some(cmd) if cmd.contains(TAP_COMMAND_MARKER) => StatuslineClass::Herdr,
        Some(cmd) => StatuslineClass::Other {
            display_command: truncate_chars(cmd, TRUNCATE_LEN),
        },
    }
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect()
    }
}

fn home_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("USERPROFILE") {
        return PathBuf::from(dir);
    }
    if let Ok(dir) = std::env::var("HOME") {
        return PathBuf::from(dir);
    }
    std::env::temp_dir()
}

pub fn claude_dir() -> PathBuf {
    home_dir().join(".claude")
}

pub fn settings_json_path() -> PathBuf {
    claude_dir().join("settings.json")
}

pub fn statusline_dir() -> PathBuf {
    claude_dir().join("statusline")
}

pub fn tap_script_path() -> PathBuf {
    statusline_dir().join("herdr-usage.ps1")
}

pub fn chain_sidecar_path() -> PathBuf {
    statusline_dir().join("herdr-usage.chain.txt")
}

/// Reads and parses `path` (spec §4.3: "Parse it with `serde_json`. If
/// parsing fails, abort this step with a message and never write.").
/// `Ok(None)` means the file does not exist yet -- not an error, just
/// nothing to classify or back up.
pub fn read_settings_value(path: &Path) -> Result<Option<Value>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str::<Value>(&text)
            .map(Some)
            .map_err(|err| format!("settings.json failed to parse: {err}")),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("settings.json failed to read: {err}")),
    }
}

pub fn extract_statusline_command(value: &Value) -> Option<&str> {
    value.get("statusLine")?.get("command")?.as_str()
}

/// The `statusLine` value to write (spec §4.3 step 4, overridden by
/// finding #8): no `-Chain` argument, and the tap script's absolute path
/// with forward slashes -- Claude Code runs statusLine commands through
/// Git Bash when it's installed, and that eats backslashes. The path is
/// wrapped in double quotes (finding #8 "quote the script path", which
/// overrides the original spec's "no nested quotes"): an unquoted path
/// containing a space (e.g. `C:/Users/First Last/...`) would otherwise
/// split into multiple arguments.
pub fn statusline_command_value(tap_script_path: &Path) -> Value {
    let forward_slash_path = tap_script_path.to_string_lossy().replace('\\', "/");
    serde_json::json!({
        "type": "command",
        "command": format!(
            "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{forward_slash_path}\""
        ),
    })
}

/// Sets `statusLine` on `settings`, preserving every other key and the key
/// order (spec §4.3 step 5, `serde_json`'s `preserve_order` feature, spec
/// §7).
pub fn apply_statusline(settings: &mut Value, tap_script_path: &Path) -> Result<(), String> {
    let object = settings
        .as_object_mut()
        .ok_or_else(|| "settings.json root is not an object".to_string())?;
    object.insert(
        "statusLine".to_string(),
        statusline_command_value(tap_script_path),
    );
    Ok(())
}

/// Days-since-epoch civil calendar conversion (Howard Hinnant's
/// `civil_from_days`, public domain), used only to format the backup
/// filename's `yyyyMMddHHmmss` timestamp (UTC) -- this crate has no
/// calendar/time dependency (spec §7 lists none).
fn civil_from_unix_utc(epoch_secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = epoch_secs.div_euclid(86400);
    let secs_of_day = epoch_secs.rem_euclid(86400);
    let hour = (secs_of_day / 3600) as u32;
    let minute = ((secs_of_day % 3600) / 60) as u32;
    let second = (secs_of_day % 60) as u32;

    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if m <= 2 { y + 1 } else { y };
    (year, m, d, hour, minute, second)
}

fn backup_timestamp(epoch_secs: i64) -> String {
    let (year, month, day, hour, minute, second) = civil_from_unix_utc(epoch_secs);
    format!("{year:04}{month:02}{day:02}{hour:02}{minute:02}{second:02}")
}

fn now_epoch_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A unique backup path (spec §4.3 "unique name"): `base_name` unmodified
/// if free, else `base_name-1`, `base_name-2`, ... (only matters if two
/// installs land in the same UTC second).
fn unique_backup_path(dir: &Path, base_name: &str) -> PathBuf {
    let candidate = dir.join(base_name);
    if !candidate.exists() {
        return candidate;
    }
    for n in 1u32.. {
        let candidate = dir.join(format!("{base_name}-{n}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("u32 exhausted")
}

/// Same collision-avoidance as `unique_backup_path`, but for an absence
/// marker (finding #9d): the `-N` collision suffix goes *before* `.absent`
/// (`...-1.absent`, not `...absent-1`), so `parse_backup_name`'s "strip
/// `.absent`, then parse the timestamp/suffix" order still works on a
/// collision.
fn unique_backup_marker_path(dir: &Path, prefix: &str, timestamp: &str) -> PathBuf {
    let base = format!("{prefix}{timestamp}");
    let candidate = dir.join(format!("{base}.absent"));
    if !candidate.exists() {
        return candidate;
    }
    for n in 1u32.. {
        let candidate = dir.join(format!("{base}-{n}.absent"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("u32 exhausted")
}

fn write_json_atomically(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    }
    let json = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("settings.json");
    let tmp = path.with_file_name(format!("{file_name}.tmp.{}.{nanos}", std::process::id()));
    std::fs::write(&tmp, json).map_err(|err| err.to_string())?;
    std::fs::rename(&tmp, path).map_err(|err| err.to_string())?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
pub struct InstallReport {
    /// `None` when there was no pre-existing `settings.json` to back up, or
    /// when this install found the tap already herdr's own (finding #9b:
    /// no new backup then -- the pre-herdr backup stays the undo target).
    pub backup_path: Option<PathBuf>,
    /// Whether a previous "other" statusLine command was chained.
    pub chained: bool,
}

/// Installs the tap (spec §4.3 steps 1-5), given the running settings.json
/// path and the tap script's bytes (split out as a parameter so tests
/// don't depend on the real embedded script). Never writes anything --
/// not even the tap script itself -- if the existing `settings.json` fails
/// to parse, or parses to something other than a JSON object (finding
/// #9a: validated *before* any write, not just at `apply_statusline`'s own
/// check at the very end).
pub fn install_tap(settings_path: &Path, tap_script_bytes: &[u8]) -> Result<InstallReport, String> {
    let existing = read_settings_value(settings_path)?;
    if let Some(value) = &existing {
        if !value.is_object() {
            return Err("settings.json root is not an object".to_string());
        }
    }
    let mut settings_value = existing
        .clone()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    let previous_command = existing
        .as_ref()
        .and_then(extract_statusline_command)
        .map(str::to_string);
    let class = classify_command(previous_command.as_deref());

    let tap_dir = statusline_dir();
    std::fs::create_dir_all(&tap_dir).map_err(|err| err.to_string())?;

    // 1. Copy the script.
    let tap_path = tap_script_path();
    std::fs::write(&tap_path, tap_script_bytes).map_err(|err| err.to_string())?;

    // 2. Back up settings.json, or record that none existed yet (finding
    // #9d) -- but never a *new* backup when the tap is already herdr's own
    // (finding #9b): the pre-herdr backup stays the correct undo target.
    let (backup_dir, backup_prefix) = backup_dir_and_prefix(settings_path);
    let backup_path = if matches!(class, StatuslineClass::Herdr) {
        None
    } else if existing.is_some() {
        let backup = unique_backup_path(
            &backup_dir,
            &format!("{backup_prefix}{}", backup_timestamp(now_epoch_secs())),
        );
        std::fs::copy(settings_path, &backup).map_err(|err| err.to_string())?;
        Some(backup)
    } else {
        // Finding #9d: no settings.json existed before this install --
        // record an absence marker so `undo_tap` knows to delete the file
        // it created, not "restore" a backup that never existed.
        let marker = unique_backup_marker_path(
            &backup_dir,
            &backup_prefix,
            &backup_timestamp(now_epoch_secs()),
        );
        std::fs::write(&marker, b"").map_err(|err| err.to_string())?;
        None
    };

    // 3. Chain sidecar, only when the previous command was some other tool's
    // (the full untruncated command, never the classifier's display copy).
    let chained = if matches!(class, StatuslineClass::Other { .. }) {
        if let Some(cmd) = &previous_command {
            std::fs::write(chain_sidecar_path(), cmd.as_bytes()).map_err(|err| err.to_string())?;
        }
        true
    } else {
        false
    };

    // 4/5. Set statusLine and write atomically, 2-space indent, every
    // other key and key order unchanged.
    apply_statusline(&mut settings_value, &tap_path)?;
    write_json_atomically(settings_path, &settings_value)?;

    Ok(InstallReport {
        backup_path,
        chained,
    })
}

fn backup_dir_and_prefix(settings_path: &Path) -> (PathBuf, String) {
    let dir = settings_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    let file_name = settings_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("settings.json");
    (dir, format!("{file_name}.herdr-backup-"))
}

struct BackupEntry {
    path: PathBuf,
    /// Parsed `yyyyMMddHHmmss` timestamp and same-second collision suffix
    /// (finding #9c "pick the newest backup by parsed timestamp, not
    /// string sort"): a lexicographic sort of the raw file names gets the
    /// collision suffix wrong past single digits (`...-10` sorts *before*
    /// `...-9`, even though it was created after it).
    timestamp: u64,
    suffix: u32,
    /// Finding #9d: this entry is an absence marker, not a real backup --
    /// `undo_tap` deletes the settings file instead of restoring one.
    is_absent: bool,
}

/// Parses `{prefix}{rest}` (finding #9c): `rest` is either a bare
/// `yyyyMMddHHmmss` timestamp, one with a `-N` collision suffix, or either
/// of those followed by `.absent` (finding #9d). Returns `None` for
/// anything that doesn't match that shape (defensive: an unrelated file
/// that happens to share the prefix must never crash `undo_tap`).
fn parse_backup_name(rest: &str) -> Option<(u64, u32, bool)> {
    let (is_absent, core) = match rest.strip_suffix(".absent") {
        Some(core) => (true, core),
        None => (false, rest),
    };
    let (ts_part, suffix_part) = match core.split_once('-') {
        Some((ts, suffix)) => (ts, suffix),
        None => (core, ""),
    };
    if ts_part.len() != 14 || !ts_part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let timestamp: u64 = ts_part.parse().ok()?;
    let suffix: u32 = if suffix_part.is_empty() {
        0
    } else {
        suffix_part.parse().ok()?
    };
    Some((timestamp, suffix, is_absent))
}

fn list_backups(settings_path: &Path) -> Vec<BackupEntry> {
    let (dir, prefix) = backup_dir_and_prefix(settings_path);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter_map(|path| {
            let name = path.file_name()?.to_str()?;
            let rest = name.strip_prefix(&prefix)?;
            let (timestamp, suffix, is_absent) = parse_backup_name(rest)?;
            Some(BackupEntry {
                path,
                timestamp,
                suffix,
                is_absent,
            })
        })
        .collect()
}

/// Restores the newest `herdr-backup` file (by parsed timestamp, finding
/// #9c) and deletes the chain sidecar (spec §4.3 "[Undo]"). When the
/// newest entry is an absence marker (finding #9d: no `settings.json`
/// existed before install), deletes the file herdr created instead of
/// "restoring" a backup that never existed.
pub fn undo_tap(settings_path: &Path) -> Result<(), String> {
    let backups = list_backups(settings_path);
    let newest = backups
        .into_iter()
        .max_by_key(|b| (b.timestamp, b.suffix))
        .ok_or_else(|| "no herdr-backup file found to restore".to_string())?;
    if newest.is_absent {
        match std::fs::remove_file(settings_path) {
            Ok(()) | Err(_) => {} // already gone is fine too
        }
        let _ = std::fs::remove_file(&newest.path);
    } else {
        std::fs::copy(&newest.path, settings_path).map_err(|err| err.to_string())?;
    }
    let _ = std::fs::remove_file(chain_sidecar_path());
    Ok(())
}

// ---------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatuslineStatusWire {
    /// `"none"` | `"herdr"` | `"other"`.
    pub class: String,
    /// Present (and truncated to 120 chars) only when `class == "other"`.
    pub other_command: Option<String>,
    /// Set when `settings.json` exists but failed to parse (spec §4.3:
    /// "abort this step with a message").
    pub error: Option<String>,
}

fn status_wire_from(class: StatuslineClass, error: Option<String>) -> StatuslineStatusWire {
    match class {
        StatuslineClass::None => StatuslineStatusWire {
            class: "none".to_string(),
            other_command: None,
            error,
        },
        StatuslineClass::Herdr => StatuslineStatusWire {
            class: "herdr".to_string(),
            other_command: None,
            error,
        },
        StatuslineClass::Other { display_command } => StatuslineStatusWire {
            class: "other".to_string(),
            other_command: Some(display_command),
            error,
        },
    }
}

/// Wizard step 3 (spec §4.3): reads and classifies `~/.claude/settings.json`
/// without writing anything.
#[tauri::command]
pub async fn statusline_status() -> StatuslineStatusWire {
    match read_settings_value(&settings_json_path()) {
        Ok(value) => {
            let command = value.as_ref().and_then(extract_statusline_command);
            status_wire_from(classify_command(command), None)
        }
        Err(err) => status_wire_from(StatuslineClass::None, Some(err)),
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatuslineInstallWire {
    pub backup_path: Option<String>,
    pub chained: bool,
}

/// Wizard step 3's `[Install]` (spec §4.3), after explicit consent.
#[tauri::command]
pub async fn statusline_install() -> Result<StatuslineInstallWire, ApiError> {
    install_tap(&settings_json_path(), TAP_SCRIPT)
        .map(|report| StatuslineInstallWire {
            backup_path: report.backup_path.map(|p| p.to_string_lossy().into_owned()),
            chained: report.chained,
        })
        .map_err(|message| ApiError {
            code: "statusline_install_failed".to_string(),
            message,
        })
}

/// Wizard step 3's `[Undo]` (spec §4.3).
#[tauri::command]
pub async fn statusline_undo() -> Result<(), ApiError> {
    undo_tap(&settings_json_path()).map_err(|message| ApiError {
        code: "statusline_undo_failed".to_string(),
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_settings_path(name: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "herdr-gui-test-statusline-{name}-{n}-settings.json"
        ))
    }

    fn cleanup(path: &Path) {
        let _ = std::fs::remove_file(path);
        let dir = path.parent().unwrap();
        let file_name = path.file_name().unwrap().to_string_lossy();
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(file_name.as_ref()) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }

    // -- classification --

    #[test]
    fn classifies_none_when_absent() {
        assert_eq!(classify_command(None), StatuslineClass::None);
    }

    #[test]
    fn classifies_herdr_when_command_contains_the_marker() {
        let class = classify_command(Some("powershell -File C:/x/herdr-usage.ps1"));
        assert_eq!(class, StatuslineClass::Herdr);
    }

    #[test]
    fn classifies_other_and_truncates_to_120_chars() {
        let long_command = "x".repeat(200);
        let class = classify_command(Some(&long_command));
        match class {
            StatuslineClass::Other { display_command } => {
                assert_eq!(display_command.chars().count(), 120)
            }
            other => panic!("expected Other, got {other:?}"),
        }
    }

    #[test]
    fn other_short_command_is_not_truncated() {
        let class = classify_command(Some("ccusage"));
        assert_eq!(
            class,
            StatuslineClass::Other {
                display_command: "ccusage".to_string()
            }
        );
    }

    // -- civil calendar (backup timestamp) --

    #[test]
    fn civil_from_unix_matches_known_epoch_anchors() {
        assert_eq!(civil_from_unix_utc(0), (1970, 1, 1, 0, 0, 0));
        assert_eq!(civil_from_unix_utc(946_684_800), (2000, 1, 1, 0, 0, 0));
        assert_eq!(civil_from_unix_utc(1_609_459_200), (2021, 1, 1, 0, 0, 0));
    }

    #[test]
    fn backup_timestamp_formats_as_yyyymmddhhmmss() {
        assert_eq!(backup_timestamp(946_684_800), "20000101000000");
    }

    // -- statusLine value / preserve-order edit --

    #[test]
    fn statusline_command_uses_forward_slashes_double_quotes_and_no_chain_arg() {
        // Finding #8 (overrides spec §4.3's "no nested quotes"): the path
        // is wrapped in double quotes, so a space in it (e.g. a "First
        // Last" Windows profile folder) can't split into multiple
        // arguments.
        let value =
            statusline_command_value(Path::new(r"C:\Users\x\.claude\statusline\herdr-usage.ps1"));
        let command = value["command"].as_str().unwrap();
        assert!(!command.contains('\\'));
        assert!(!command.contains("-Chain"));
        assert_eq!(value["type"], "command");
        assert_eq!(
            command,
            "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"C:/Users/x/.claude/statusline/herdr-usage.ps1\""
        );
    }

    #[test]
    fn statusline_command_quotes_a_path_containing_a_space() {
        let value = statusline_command_value(Path::new(
            r"C:\Users\First Last\.claude\statusline\herdr-usage.ps1",
        ));
        let command = value["command"].as_str().unwrap();
        assert_eq!(
            command,
            "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"C:/Users/First Last/.claude/statusline/herdr-usage.ps1\""
        );
        // The classifier must still recognize it as herdr's own tap with
        // the path quoted.
        assert_eq!(classify_command(Some(command)), StatuslineClass::Herdr);
    }

    #[test]
    fn apply_statusline_preserves_other_keys_and_their_order() {
        let mut settings: Value = serde_json::from_str(r#"{"a":1,"model":"opus","b":2}"#).unwrap();
        apply_statusline(&mut settings, Path::new("C:/x/herdr-usage.ps1")).unwrap();
        let keys: Vec<&String> = settings.as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["a", "model", "b", "statusLine"]);
        assert_eq!(settings["a"], 1);
        assert_eq!(settings["model"], "opus");
        assert_eq!(settings["b"], 2);
    }

    #[test]
    fn apply_statusline_replaces_in_place_when_the_key_already_existed() {
        let mut settings: Value = serde_json::from_str(
            r#"{"a":1,"statusLine":{"type":"command","command":"old"},"b":2}"#,
        )
        .unwrap();
        apply_statusline(&mut settings, Path::new("C:/x/herdr-usage.ps1")).unwrap();
        let keys: Vec<&String> = settings.as_object().unwrap().keys().collect();
        assert_eq!(
            keys,
            vec!["a", "statusLine", "b"],
            "must stay at its original position"
        );
    }

    // -- read_settings_value --

    #[test]
    fn read_settings_value_missing_file_is_ok_none() {
        let path = temp_settings_path("missing");
        cleanup(&path);
        assert_eq!(read_settings_value(&path), Ok(None));
    }

    #[test]
    fn read_settings_value_parse_failure_is_an_error() {
        let path = temp_settings_path("badjson");
        std::fs::write(&path, "not json {{{").unwrap();
        assert!(read_settings_value(&path).is_err());
        cleanup(&path);
    }

    // -- install_tap --

    #[test]
    fn install_on_missing_settings_creates_one_with_no_backup() {
        let path = temp_settings_path("install-missing");
        cleanup(&path);
        // Redirect the tap dir/script under a scoped fake HOME so the test
        // never touches the real `~/.claude`.
        let scoped = scoped_home();
        let report = install_tap(&path, b"# fake script").unwrap();
        assert!(report.backup_path.is_none());
        assert!(!report.chained);
        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert!(value["statusLine"]["command"]
            .as_str()
            .unwrap()
            .contains("herdr-usage.ps1"));
        cleanup(&path);
        drop(scoped);
    }

    #[test]
    fn install_backs_up_and_preserves_other_keys() {
        let path = temp_settings_path("install-existing");
        std::fs::write(
            &path,
            r#"{"model":"opus","statusLine":{"type":"command","command":"ccusage"}}"#,
        )
        .unwrap();
        let scoped = scoped_home();
        let report = install_tap(&path, b"# fake script").unwrap();
        let backup = report.backup_path.expect("must back up an existing file");
        assert!(backup.exists());
        let backup_contents = std::fs::read_to_string(&backup).unwrap();
        assert!(backup_contents.contains("ccusage"));
        assert!(report.chained, "an 'other' command must be chained");
        let chain = std::fs::read_to_string(chain_sidecar_path()).unwrap();
        assert_eq!(chain, "ccusage");
        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["model"], "opus");
        let keys: Vec<&String> = value.as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["model", "statusLine"]);
        cleanup(&path);
        let _ = std::fs::remove_file(backup);
        drop(scoped);
    }

    #[test]
    fn install_never_writes_on_parse_failure() {
        let path = temp_settings_path("install-badjson");
        std::fs::write(&path, "not json {{{").unwrap();
        let before = std::fs::read_to_string(&path).unwrap();
        let scoped = scoped_home();
        let result = install_tap(&path, b"# fake script");
        assert!(result.is_err());
        let after = std::fs::read_to_string(&path).unwrap();
        assert_eq!(before, after, "a parse failure must never write");
        cleanup(&path);
        drop(scoped);
    }

    #[test]
    fn install_never_writes_anything_when_the_root_is_not_an_object() {
        // Finding #9a: validated *before* any write, not just at
        // `apply_statusline`'s own check at the very end -- so a
        // non-object root must never leave the tap script, a backup, or
        // the chain sidecar behind either.
        let path = temp_settings_path("install-non-object-root");
        std::fs::write(&path, "[1,2,3]").unwrap();
        let before = std::fs::read_to_string(&path).unwrap();
        let scoped = scoped_home();
        let result = install_tap(&path, b"# fake script");
        assert!(result.is_err());
        let after = std::fs::read_to_string(&path).unwrap();
        assert_eq!(before, after, "a non-object root must never be written");
        assert!(
            !tap_script_path().exists(),
            "must not write the tap script before validating the root shape"
        );
        assert!(
            list_backups(&path).is_empty(),
            "must not create a backup either"
        );
        cleanup(&path);
        drop(scoped);
    }

    #[test]
    fn install_does_not_chain_when_already_herdrs_own_tap() {
        let path = temp_settings_path("install-already-herdr");
        std::fs::write(
            &path,
            r#"{"statusLine":{"type":"command","command":"powershell -File C:/x/herdr-usage.ps1"}}"#,
        )
        .unwrap();
        let scoped = scoped_home();
        let report = install_tap(&path, b"# fake script").unwrap();
        assert!(!report.chained);
        assert!(!chain_sidecar_path().exists());
        cleanup(&path);
        drop(scoped);
    }

    #[test]
    fn reinstalling_over_an_existing_herdr_tap_keeps_the_original_backup() {
        // Finding #9b: a re-install while the tap is already herdr's own
        // must not create a *new* backup -- the pre-herdr backup stays the
        // correct undo target.
        let path = temp_settings_path("reinstall-herdr");
        std::fs::write(
            &path,
            r#"{"model":"opus","statusLine":{"type":"command","command":"ccusage"}}"#,
        )
        .unwrap();
        let scoped = scoped_home();
        let first = install_tap(&path, b"# fake script").unwrap();
        let backup = first
            .backup_path
            .expect("first install must back up the pre-existing file");
        let backup_contents_before = std::fs::read_to_string(&backup).unwrap();
        assert!(backup_contents_before.contains("ccusage"));

        let second = install_tap(&path, b"# fake script v2").unwrap();
        assert!(
            second.backup_path.is_none(),
            "a re-install over herdr's own tap must not create a new backup"
        );
        assert!(
            backup.exists(),
            "the original pre-herdr backup must remain the undo target"
        );
        let backup_contents_after = std::fs::read_to_string(&backup).unwrap();
        assert_eq!(backup_contents_before, backup_contents_after);

        undo_tap(&path).unwrap();
        let restored: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            restored["statusLine"]["command"], "ccusage",
            "undo after a re-install must still restore the pre-herdr command"
        );

        cleanup(&path);
        let _ = std::fs::remove_file(&backup);
        drop(scoped);
    }

    // -- undo --

    #[test]
    fn undo_restores_the_newest_backup_and_removes_the_chain_sidecar() {
        let path = temp_settings_path("undo");
        std::fs::write(
            &path,
            r#"{"model":"opus","statusLine":{"type":"command","command":"ccusage"}}"#,
        )
        .unwrap();
        let scoped = scoped_home();
        install_tap(&path, b"# fake script").unwrap();
        assert!(chain_sidecar_path().exists());

        undo_tap(&path).unwrap();
        let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            value["statusLine"]["command"], "ccusage",
            "must restore the pre-install content"
        );
        assert!(
            !chain_sidecar_path().exists(),
            "the chain sidecar must be deleted"
        );
        cleanup(&path);
        drop(scoped);
    }

    #[test]
    fn undo_with_no_backup_is_an_error() {
        let path = temp_settings_path("undo-no-backup");
        cleanup(&path);
        let scoped = scoped_home();
        assert!(undo_tap(&path).is_err());
        drop(scoped);
    }

    #[test]
    fn undo_picks_the_highest_collision_suffix_not_the_lexicographic_max() {
        // Finding #9c "pick the newest backup by parsed timestamp, not
        // string sort": "...-10" is numerically newer than "...-9" (it was
        // allocated after it, on a 10th same-second collision), but sorts
        // *before* it lexicographically ('1' < '9'). A plain `.sort()` +
        // `.last()` over the raw names would restore "-9" here; the fix
        // must restore "-10".
        let path = temp_settings_path("undo-collision");
        std::fs::write(
            &path,
            r#"{"statusLine":{"type":"command","command":"herdr-usage current"}}"#,
        )
        .unwrap();
        let scoped = scoped_home();
        let (dir, prefix) = backup_dir_and_prefix(&path);
        let ts = "20260101000000";
        let backup9 = dir.join(format!("{prefix}{ts}-9"));
        let backup10 = dir.join(format!("{prefix}{ts}-10"));
        std::fs::write(&backup9, r#"{"statusLine":{"command":"old-9"}}"#).unwrap();
        std::fs::write(&backup10, r#"{"statusLine":{"command":"new-10"}}"#).unwrap();

        undo_tap(&path).unwrap();
        let restored: Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            restored["statusLine"]["command"], "new-10",
            "must restore the -10 backup (numerically newest), not -9 (the lexicographically \"largest\" string)"
        );

        cleanup(&path);
        let _ = std::fs::remove_file(&backup9);
        let _ = std::fs::remove_file(&backup10);
        drop(scoped);
    }

    #[test]
    fn undo_deletes_the_file_when_herdr_created_it_from_nothing() {
        // Finding #9d: when no settings.json existed before install, undo
        // must delete the file herdr created, not error out with "no
        // backup found" and leave it behind forever.
        let path = temp_settings_path("undo-absent");
        cleanup(&path);
        let scoped = scoped_home();
        let report = install_tap(&path, b"# fake script").unwrap();
        assert!(report.backup_path.is_none());
        assert!(path.exists(), "install must create settings.json");

        undo_tap(&path).unwrap();
        assert!(
            !path.exists(),
            "undo must delete the file herdr created from nothing"
        );

        cleanup(&path);
        drop(scoped);
    }

    #[test]
    fn parse_backup_name_reads_timestamp_suffix_and_absence_marker() {
        assert_eq!(
            parse_backup_name("20260101000000"),
            Some((20260101000000, 0, false))
        );
        assert_eq!(
            parse_backup_name("20260101000000-3"),
            Some((20260101000000, 3, false))
        );
        assert_eq!(
            parse_backup_name("20260101000000.absent"),
            Some((20260101000000, 0, true))
        );
        assert_eq!(
            parse_backup_name("20260101000000-1.absent"),
            Some((20260101000000, 1, true))
        );
        assert_eq!(parse_backup_name("not-a-timestamp"), None);
        assert_eq!(parse_backup_name(""), None);
    }

    #[test]
    fn unique_backup_path_avoids_a_same_second_collision() {
        let dir = std::env::temp_dir();
        let base = format!(
            "herdr-gui-test-collision-{}",
            COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        let first = unique_backup_path(&dir, &base);
        std::fs::write(&first, "x").unwrap();
        let second = unique_backup_path(&dir, &base);
        assert_ne!(first, second);
        let _ = std::fs::remove_file(&first);
        let _ = std::fs::remove_file(&second);
    }

    /// Points `statusline_dir()`'s inputs (`USERPROFILE`/`HOME`) at a fresh
    /// temp directory for the duration of the test, so `install_tap`'s own
    /// `~/.claude/statusline/...` writes never touch the real HOME (Phase
    /// 1.6 hard constraint: "tests use a temp HOME; never read
    /// `.credentials.json`"). Single-threaded env mutation: `cargo test`
    /// runs each test in its own thread but `std::env::set_var` is
    /// process-wide, so these tests must not run truly concurrently with
    /// each other -- `#[test]` fns in this module all serialize through
    /// this guard's own lock to make that safe.
    static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn scoped_home() -> ScopedHome {
        // Held for the whole `ScopedHome`'s lifetime (a struct field, not
        // leaked): `std::env::set_var` is process-wide, so tests in this
        // module that touch `USERPROFILE` must not overlap. The custom
        // `Drop` body below runs before this field's own (automatic) drop
        // releases the lock, so cleanup always finishes first.
        let guard = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!(
            "herdr-gui-test-statusline-home-{}",
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let previous = std::env::var("USERPROFILE").ok();
        // SAFETY: serialized by `HOME_LOCK` above.
        unsafe {
            std::env::set_var("USERPROFILE", &dir);
        }
        ScopedHome {
            _guard: guard,
            dir,
            previous,
        }
    }

    struct ScopedHome {
        _guard: std::sync::MutexGuard<'static, ()>,
        dir: PathBuf,
        previous: Option<String>,
    }

    impl Drop for ScopedHome {
        fn drop(&mut self) {
            // SAFETY: see `scoped_home`.
            unsafe {
                match &self.previous {
                    Some(value) => std::env::set_var("USERPROFILE", value),
                    None => std::env::remove_var("USERPROFILE"),
                }
            }
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}
