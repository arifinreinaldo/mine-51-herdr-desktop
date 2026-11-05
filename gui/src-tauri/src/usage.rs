//! Claude plan usage: polls the `mtime` of `~/.claude/herdr-usage.json`
//! every 2s (no watcher dependency) and parses its `rate_limits` shape
//! (spec §1 "Usage data", §4 `usage.rs`).
//!
//! This module never reads `~/.claude/.credentials.json`.
//!
//! The tests in this module encode the expected behavior from spec §5.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct Window {
    /// Clamped to `0.0..=100.0`.
    pub used_pct: f64,
    /// Unix epoch seconds.
    pub resets_at: i64,
}

/// Serializes lowercase (`ok`/`missing`/`invalid`), matching the frontend's
/// `UsageState.status` union (`src/usage.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageStatus {
    Ok,
    /// The file does not exist (yet): no Claude Code session has ever run.
    Missing,
    /// The file exists but is not valid JSON, or does not match the
    /// expected shape.
    Invalid,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct UsageState {
    pub five_hour: Option<Window>,
    pub seven_day: Option<Window>,
    /// Unix epoch seconds.
    pub captured_at: Option<i64>,
    pub status: UsageStatus,
    /// Newest per-session facts (`~/.claude/herdr-usage/*.json`), newest
    /// first. Absent from the payload when empty; old frontends ignore it.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sessions: Vec<SessionUsage>,
}

/// One Claude Code session's facts from the tap's whitelist. Every field is
/// optional: the statusLine payload shape is not guaranteed.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SessionUsage {
    /// File mtime, Unix epoch seconds.
    pub updated_at: i64,
    pub model: Option<String>,
    /// Finite and `>= 0`, else `None`.
    pub cost_usd: Option<f64>,
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    /// Clamped to `0.0..=100.0`.
    pub context_pct: Option<f64>,
}

/// Newest session files read per poll, and the age past which a file is ignored.
const MAX_SESSIONS: usize = 20;
const SESSION_MAX_AGE_SECS: i64 = 24 * 3600;

impl UsageState {
    pub fn missing() -> Self {
        Self {
            five_hour: None,
            seven_day: None,
            captured_at: None,
            status: UsageStatus::Missing,
            sessions: Vec::new(),
        }
    }

    pub fn invalid() -> Self {
        Self {
            five_hour: None,
            seven_day: None,
            captured_at: None,
            status: UsageStatus::Invalid,
            sessions: Vec::new(),
        }
    }
}

/// `~/.claude/herdr-usage.json`. Real (non-stubbed): this is plain path
/// construction, not usage parsing.
pub fn default_usage_path() -> PathBuf {
    home_dir().join(".claude").join("herdr-usage.json")
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

#[derive(serde::Deserialize)]
struct RawWindow {
    used_percentage: f64,
    resets_at: i64,
}

#[derive(serde::Deserialize)]
struct RawRateLimits {
    five_hour: Option<RawWindow>,
    seven_day: Option<RawWindow>,
    // `spend_limit` (if present) is ignored per spec §1: it is not
    // deserialized into any field here.
}

#[derive(serde::Deserialize)]
struct RawUsage {
    captured_at: Option<i64>,
    rate_limits: RawRateLimits,
}

fn clamp_pct(used_pct: f64) -> f64 {
    used_pct.clamp(0.0, 100.0)
}

/// Parses the statusline hook's JSON shape into a `UsageState`. `spend_limit`
/// (if present) is ignored per spec §1. `used_percentage` may be a float or
/// an int and is clamped to `0.0..=100.0`. Any window may be absent.
/// Malformed JSON, or JSON that doesn't match the expected shape, produces
/// `UsageState::invalid()`.
pub fn parse_usage_json(json: &str) -> UsageState {
    let Ok(raw) = serde_json::from_str::<RawUsage>(json) else {
        return UsageState::invalid();
    };
    UsageState {
        five_hour: raw.rate_limits.five_hour.map(|w| Window {
            used_pct: clamp_pct(w.used_percentage),
            resets_at: w.resets_at,
        }),
        seven_day: raw.rate_limits.seven_day.map(|w| Window {
            used_pct: clamp_pct(w.used_percentage),
            resets_at: w.resets_at,
        }),
        captured_at: raw.captured_at,
        status: UsageStatus::Ok,
        sessions: Vec::new(),
    }
}

/// Parses one per-session file. `None` for non-objects, garbage, or a record
/// with no usable field. Bad individual fields become `None`, not an error.
pub fn parse_session_json(json: &str, updated_at: i64) -> Option<SessionUsage> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    let obj = value.as_object()?;
    let model = obj
        .get("model")
        .and_then(|v| v.as_str())
        .map(|m| m.trim().chars().take(60).collect::<String>())
        .filter(|m| !m.is_empty());
    let cost_usd = obj
        .get("cost_usd")
        .and_then(|v| v.as_f64())
        .filter(|c| c.is_finite() && *c >= 0.0);
    let context_pct = obj
        .get("context_pct")
        .and_then(|v| v.as_f64())
        .filter(|p| p.is_finite())
        .map(clamp_pct);
    let lines_added = obj.get("lines_added").and_then(|v| v.as_u64());
    let lines_removed = obj.get("lines_removed").and_then(|v| v.as_u64());
    if model.is_none()
        && cost_usd.is_none()
        && context_pct.is_none()
        && lines_added.is_none()
        && lines_removed.is_none()
    {
        return None;
    }
    Some(SessionUsage {
        updated_at,
        model,
        cost_usd,
        lines_added,
        lines_removed,
        context_pct,
    })
}

fn is_safe_session_stem(stem: &str) -> bool {
    !stem.is_empty()
        && stem.len() <= 128
        && stem
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Reads up to `MAX_SESSIONS` `<safe id>.json` files in `dir` (newest by
/// mtime, none older than 24h before `now`), newest first. A missing dir or
/// unreadable file yields fewer sessions, never an error.
pub fn read_sessions(dir: &Path, now: i64) -> Vec<SessionUsage> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<(i64, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let stem = path.file_stem()?.to_str()?;
            if path.extension()? != "json" || !is_safe_session_stem(stem) {
                return None;
            }
            let meta = entry.metadata().ok().filter(|m| m.is_file())?;
            let mtime = meta
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs() as i64;
            (now - mtime <= SESSION_MAX_AGE_SECS).then_some((mtime, path))
        })
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.0));
    files.truncate(MAX_SESSIONS);
    files
        .into_iter()
        .filter_map(|(mtime, path)| parse_session_json(&std::fs::read_to_string(path).ok()?, mtime))
        .collect()
}

/// Reads and parses `path`. A missing file yields `UsageState::missing()`
/// (not `Invalid` -- absence is expected before the first Claude Code
/// session runs).
pub fn read_usage_file(path: &Path) -> UsageState {
    match std::fs::read_to_string(path) {
        Ok(contents) => {
            let mut state = parse_usage_json(&contents);
            if state.status == UsageStatus::Ok {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |d| d.as_secs() as i64);
                state.sessions = read_sessions(&path.with_file_name("herdr-usage"), now);
            }
            state
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => UsageState::missing(),
        Err(_) => UsageState::invalid(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL_SAMPLE: &str = r#"{"captured_at": 1790388472,
        "rate_limits": {"five_hour": {"used_percentage": 14, "resets_at": 1790395200},
                        "seven_day": {"used_percentage": 1, "resets_at": 1790985600}}}"#;

    #[test]
    fn default_usage_path_is_under_dot_claude() {
        let path = default_usage_path();
        assert_eq!(path.file_name().unwrap(), "herdr-usage.json");
        assert_eq!(path.parent().unwrap().file_name().unwrap(), ".claude");
    }

    #[test]
    fn parses_the_full_sample() {
        let state = parse_usage_json(FULL_SAMPLE);
        assert_eq!(state.status, UsageStatus::Ok);
        assert_eq!(state.captured_at, Some(1790388472));
        assert_eq!(
            state.five_hour,
            Some(Window {
                used_pct: 14.0,
                resets_at: 1790395200
            })
        );
        assert_eq!(
            state.seven_day,
            Some(Window {
                used_pct: 1.0,
                resets_at: 1790985600
            })
        );
    }

    #[test]
    fn tolerates_a_missing_window() {
        let json = r#"{"captured_at": 1, "rate_limits": {"five_hour": {"used_percentage": 5, "resets_at": 2}}}"#;
        let state = parse_usage_json(json);
        assert_eq!(state.status, UsageStatus::Ok);
        assert!(state.five_hour.is_some());
        assert!(state.seven_day.is_none());
    }

    #[test]
    fn ignores_spend_limit() {
        let json = r#"{"captured_at": 1, "rate_limits": {
            "five_hour": {"used_percentage": 5, "resets_at": 2},
            "spend_limit": {"used_percentage": 99, "resets_at": 3}
        }}"#;
        let state = parse_usage_json(json);
        assert_eq!(state.status, UsageStatus::Ok);
        assert_eq!(state.five_hour.unwrap().used_pct, 5.0);
    }

    #[test]
    fn accepts_float_percentages() {
        let json = r#"{"captured_at": 1, "rate_limits": {"five_hour": {"used_percentage": 14.5, "resets_at": 2}}}"#;
        let state = parse_usage_json(json);
        assert_eq!(state.five_hour.unwrap().used_pct, 14.5);
    }

    #[test]
    fn accepts_int_percentages() {
        let json = r#"{"captured_at": 1, "rate_limits": {"five_hour": {"used_percentage": 14, "resets_at": 2}}}"#;
        let state = parse_usage_json(json);
        assert_eq!(state.five_hour.unwrap().used_pct, 14.0);
    }

    #[test]
    fn clamps_percentages_over_100() {
        let json = r#"{"captured_at": 1, "rate_limits": {"five_hour": {"used_percentage": 150, "resets_at": 2}}}"#;
        let state = parse_usage_json(json);
        assert_eq!(state.five_hour.unwrap().used_pct, 100.0);
    }

    #[test]
    fn clamps_negative_percentages_to_zero() {
        let json = r#"{"captured_at": 1, "rate_limits": {"five_hour": {"used_percentage": -5, "resets_at": 2}}}"#;
        let state = parse_usage_json(json);
        assert_eq!(state.five_hour.unwrap().used_pct, 0.0);
    }

    #[test]
    fn garbage_json_is_invalid() {
        let state = parse_usage_json("not json at all {{{");
        assert_eq!(state.status, UsageStatus::Invalid);
        assert!(state.five_hour.is_none());
        assert!(state.seven_day.is_none());
    }

    #[test]
    fn missing_file_is_missing_not_invalid() {
        let path = std::env::temp_dir().join("herdr-gui-test-usage-does-not-exist.json");
        let _ = std::fs::remove_file(&path);
        let state = read_usage_file(&path);
        assert_eq!(state.status, UsageStatus::Missing);
    }

    #[test]
    fn parses_a_full_session_record() {
        let json = r#"{"captured_at":1,"model":"Opus 4.7","cost_usd":1.25,"lines_added":10,"lines_removed":2,"context_pct":42.5}"#;
        let s = parse_session_json(json, 99).unwrap();
        assert_eq!(s.updated_at, 99);
        assert_eq!(s.model.as_deref(), Some("Opus 4.7"));
        assert_eq!(s.cost_usd, Some(1.25));
        assert_eq!(s.lines_added, Some(10));
        assert_eq!(s.lines_removed, Some(2));
        assert_eq!(s.context_pct, Some(42.5));
    }

    #[test]
    fn a_partial_session_record_keeps_the_present_fields() {
        let s = parse_session_json(r#"{"model":null,"cost_usd":0.5}"#, 1).unwrap();
        assert_eq!(s.cost_usd, Some(0.5));
        assert!(s.model.is_none() && s.lines_added.is_none() && s.context_pct.is_none());
    }

    #[test]
    fn session_garbage_and_empty_records_are_none() {
        assert!(parse_session_json("not json {{{", 1).is_none());
        assert!(parse_session_json("[1,2]", 1).is_none());
        assert!(parse_session_json("{}", 1).is_none());
        assert!(parse_session_json(r#"{"model":null,"cost_usd":null}"#, 1).is_none());
    }

    #[test]
    fn session_cost_rejects_negative_and_wrong_types_and_context_clamps() {
        let s =
            parse_session_json(r#"{"cost_usd":-1,"context_pct":250,"lines_added":-3}"#, 1).unwrap();
        assert!(s.cost_usd.is_none());
        assert!(s.lines_added.is_none());
        assert_eq!(s.context_pct, Some(100.0));
        // serde_json rejects a bare NaN token, so the whole record is garbage.
        assert!(parse_session_json(r#"{"cost_usd":NaN}"#, 1).is_none());
        let s = parse_session_json(r#"{"cost_usd":"5","context_pct":-4}"#, 1).unwrap();
        assert!(s.cost_usd.is_none());
        assert_eq!(s.context_pct, Some(0.0));
    }

    #[test]
    fn old_shape_file_without_a_sessions_dir_has_no_sessions() {
        let dir =
            std::env::temp_dir().join(format!("herdr-gui-test-usage-old-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("herdr-usage.json");
        std::fs::write(&path, FULL_SAMPLE).unwrap();
        let state = read_usage_file(&path);
        assert_eq!(state.status, UsageStatus::Ok);
        assert!(state.sessions.is_empty());
        let json = serde_json::to_string(&state).unwrap();
        assert!(!json.contains("sessions"), "{json}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_sessions_skips_unsafe_names_and_old_files_and_caps_at_20() {
        let dir = std::env::temp_dir().join(format!(
            "herdr-gui-test-usage-sessions-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let rec = r#"{"cost_usd":1.0}"#;
        for i in 0..25 {
            std::fs::write(dir.join(format!("s{i}.json")), rec).unwrap();
        }
        std::fs::write(dir.join("bad name.json"), rec).unwrap();
        std::fs::write(dir.join("ok.json.tmp-1"), rec).unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert_eq!(read_sessions(&dir, now).len(), 20);
        // 25h later every file is older than 24h.
        assert!(read_sessions(&dir, now + 25 * 3600).is_empty());
        assert!(read_sessions(&dir.join("absent"), now).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn past_resets_at_still_parses_and_is_preserved() {
        let json = r#"{"captured_at": 1, "rate_limits": {"five_hour": {"used_percentage": 5, "resets_at": 1}}}"#;
        let state = parse_usage_json(json);
        // resets_at (1) is far in the past relative to any real captured_at;
        // the parser must not reject or reinterpret it -- formatting
        // "5h -- (reset)" is the TS side's job (spec §6).
        assert_eq!(state.five_hour.unwrap().resets_at, 1);
    }
}
