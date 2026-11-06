//! Claude plan usage: polls the `mtime` of `~/.claude/herdr-usage.json`
//! every 2s (no watcher dependency) and parses its `rate_limits` shape
//! (spec §1 "Usage data", §4 `usage.rs`).
//!
//! This module never reads `~/.claude/.credentials.json`.
//!
//! The tests in this module encode the expected behavior from spec §5.

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// A session file older than this (by file mtime) is ignored but kept.
const SESSION_STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);
/// A session file older than this (by file mtime) is deleted.
const SESSION_PRUNE_AFTER: Duration = Duration::from_secs(7 * 24 * 60 * 60);

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

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct SessionModel {
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct SessionContext {
    /// Clamped to `0.0..=100.0`.
    pub used_pct: Option<f64>,
    pub size: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct SessionCost {
    pub usd: Option<f64>,
    pub duration_ms: Option<i64>,
    pub api_duration_ms: Option<i64>,
    pub lines_added: Option<i64>,
    pub lines_removed: Option<i64>,
}

/// One Claude Code session, read from `~/.claude/herdr-usage/<session_id>.json`.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct SessionUsage {
    /// The file stem.
    pub session_id: String,
    pub pane_id: Option<String>,
    /// Unix epoch seconds.
    pub captured_at: Option<i64>,
    pub cwd: Option<String>,
    pub model: SessionModel,
    pub effort_level: Option<String>,
    pub fast_mode: Option<bool>,
    pub context: SessionContext,
    pub cost: SessionCost,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct UsageState {
    pub five_hour: Option<Window>,
    pub seven_day: Option<Window>,
    /// Unix epoch seconds.
    pub captured_at: Option<i64>,
    pub status: UsageStatus,
    /// Sorted by `session_id`. Filled by `read_sessions`, not by the legacy file.
    pub sessions: Vec<SessionUsage>,
}

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

/// `~/.claude/herdr-usage/`: one file per Claude Code session.
pub fn default_sessions_dir() -> PathBuf {
    home_dir().join(".claude").join("herdr-usage")
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

/// The session id rule the taps use for file names: `^[A-Za-z0-9_-]{1,128}$`.
pub fn is_valid_session_id(id: &str) -> bool {
    (1..=128).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn f64_at(v: &Value, ptr: &str) -> Option<f64> {
    v.pointer(ptr).and_then(Value::as_f64)
}

fn i64_at(v: &Value, ptr: &str) -> Option<i64> {
    v.pointer(ptr).and_then(Value::as_i64)
}

fn str_at(v: &Value, ptr: &str) -> Option<String> {
    v.pointer(ptr).and_then(Value::as_str).map(str::to_owned)
}

/// Parses one session file: `{"captured_at":N,"pane_id":"..."|null,"session":{raw}}`.
/// Uses pointer lookups, so a retyped or missing field becomes `None` and never
/// rejects the file. Malformed JSON or a non-object root gives `None`.
pub fn parse_session_json(session_id: &str, json: &str) -> Option<SessionUsage> {
    let root: Value = serde_json::from_str(json).ok()?;
    if !root.is_object() {
        return None;
    }
    Some(SessionUsage {
        session_id: session_id.to_owned(),
        pane_id: str_at(&root, "/pane_id"),
        captured_at: i64_at(&root, "/captured_at"),
        cwd: str_at(&root, "/session/cwd")
            .or_else(|| str_at(&root, "/session/workspace/current_dir")),
        model: SessionModel {
            display_name: str_at(&root, "/session/model/display_name"),
        },
        effort_level: str_at(&root, "/session/effort/level"),
        fast_mode: root.pointer("/session/fast_mode").and_then(Value::as_bool),
        context: SessionContext {
            used_pct: f64_at(&root, "/session/context_window/used_percentage").map(clamp_pct),
            size: i64_at(&root, "/session/context_window/context_window_size"),
        },
        cost: SessionCost {
            usd: f64_at(&root, "/session/cost/total_cost_usd"),
            duration_ms: i64_at(&root, "/session/cost/total_duration_ms"),
            api_duration_ms: i64_at(&root, "/session/cost/total_api_duration_ms"),
            lines_added: i64_at(&root, "/session/cost/total_lines_added"),
            lines_removed: i64_at(&root, "/session/cost/total_lines_removed"),
        },
    })
}

/// Reads every fresh session file in `dir`, sorted by `session_id`. Age is the
/// file mtime relative to `now`: older than 7 d deletes the file, older than
/// 24 h skips it. Only `<valid id>.json` and `<valid id>.json.tmp-*` are
/// touched; tmp files are never parsed. A missing dir gives an empty vec.
pub fn read_sessions(dir: &Path, now: SystemTime) -> Vec<SessionUsage> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut sessions = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some((id, rest)) = name.split_once('.') else {
            continue;
        };
        let is_tmp = rest.starts_with("json.tmp-");
        if !is_valid_session_id(id) || (rest != "json" && !is_tmp) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        // A future mtime (clock skew) counts as age zero.
        let age = meta
            .modified()
            .ok()
            .and_then(|m| now.duration_since(m).ok())
            .unwrap_or(Duration::ZERO);
        if age > SESSION_PRUNE_AFTER {
            let _ = std::fs::remove_file(entry.path());
            continue;
        }
        if is_tmp || age > SESSION_STALE_AFTER {
            continue;
        }
        let Ok(contents) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if let Some(session) = parse_session_json(id, &contents) {
            sessions.push(session);
        }
    }
    sessions.sort_by(|a, b| a.session_id.cmp(&b.session_id));
    sessions
}

/// Reads and parses `path`. A missing file yields `UsageState::missing()`
/// (not `Invalid` -- absence is expected before the first Claude Code
/// session runs).
pub fn read_usage_file(path: &Path) -> UsageState {
    match std::fs::read_to_string(path) {
        Ok(contents) => parse_usage_json(&contents),
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
    fn past_resets_at_still_parses_and_is_preserved() {
        let json = r#"{"captured_at": 1, "rate_limits": {"five_hour": {"used_percentage": 5, "resets_at": 1}}}"#;
        let state = parse_usage_json(json);
        // resets_at (1) is far in the past relative to any real captured_at;
        // the parser must not reject or reinterpret it -- formatting
        // "5h -- (reset)" is the TS side's job (spec §6).
        assert_eq!(state.five_hour.unwrap().resets_at, 1);
    }

    const FULL_SESSION: &str = r#"{"captured_at": 1790388472, "pane_id": "w18:p1B",
        "session": {"session_id": "s-1", "cwd": "C:\\repo",
            "model": {"display_name": "Opus"}, "effort": {"level": "high"}, "fast_mode": false,
            "context_window": {"used_percentage": 42.5, "context_window_size": 200000},
            "cost": {"total_cost_usd": 1.23, "total_duration_ms": 2820000,
                     "total_api_duration_ms": 1080000,
                     "total_lines_added": 312, "total_lines_removed": 88}}}"#;

    /// Unique empty dir per test; the caller removes it.
    fn temp_sessions_dir(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "herdr-gui-test-sessions-{}-{test}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_a_full_session_file() {
        let s = parse_session_json("s-1", FULL_SESSION).unwrap();
        assert_eq!(s.session_id, "s-1");
        assert_eq!(s.pane_id.as_deref(), Some("w18:p1B"));
        assert_eq!(s.captured_at, Some(1790388472));
        assert_eq!(s.cwd.as_deref(), Some("C:\\repo"));
        assert_eq!(s.model.display_name.as_deref(), Some("Opus"));
        assert_eq!(s.effort_level.as_deref(), Some("high"));
        assert_eq!(s.fast_mode, Some(false));
        assert_eq!(s.context.used_pct, Some(42.5));
        assert_eq!(s.context.size, Some(200000));
        assert_eq!(s.cost.usd, Some(1.23));
        assert_eq!(s.cost.duration_ms, Some(2820000));
        assert_eq!(s.cost.api_duration_ms, Some(1080000));
        assert_eq!(s.cost.lines_added, Some(312));
        assert_eq!(s.cost.lines_removed, Some(88));
    }

    #[test]
    fn cwd_falls_back_to_workspace_current_dir_and_pct_is_clamped() {
        let json = r#"{"session": {"workspace": {"current_dir": "/w"},
            "context_window": {"used_percentage": 250}}}"#;
        let s = parse_session_json("a", json).unwrap();
        assert_eq!(s.cwd.as_deref(), Some("/w"));
        assert_eq!(s.context.used_pct, Some(100.0));
    }

    #[test]
    fn a_session_with_every_field_missing_parses_to_nones() {
        for json in ["{}", r#"{"session":{}}"#, r#"{"session":null}"#] {
            let s = parse_session_json("x", json).unwrap();
            assert_eq!(
                s,
                SessionUsage {
                    session_id: "x".to_owned(),
                    ..SessionUsage::default()
                },
                "{json}"
            );
        }
    }

    #[test]
    fn unknown_fields_and_retyped_fields_are_ignored() {
        let json = r#"{"captured_at": "soon", "pane_id": 7, "future": [1],
            "session": {"cwd": 5, "model": "Opus", "fast_mode": "yes",
                "context_window": {"used_percentage": "42", "context_window_size": 1.5},
                "cost": {"total_cost_usd": "1", "total_lines_added": null}, "extra": {}}}"#;
        let s = parse_session_json("x", json).unwrap();
        assert_eq!(
            s,
            SessionUsage {
                session_id: "x".to_owned(),
                ..SessionUsage::default()
            }
        );
    }

    #[test]
    fn a_malformed_session_file_is_skipped() {
        assert_eq!(parse_session_json("x", "not json {{{"), None);
        assert_eq!(parse_session_json("x", ""), None);
        assert_eq!(parse_session_json("x", "[1,2]"), None);
        assert_eq!(parse_session_json("x", "\"s\""), None);
    }

    #[test]
    fn session_ids_follow_the_file_name_rule() {
        for ok in ["s-1", "A_b-9", "x", &"a".repeat(128)] {
            assert!(is_valid_session_id(ok), "{ok}");
        }
        for bad in [
            "",
            "..\\evil",
            "../evil",
            "served:1",
            "a.b",
            "a b",
            &"a".repeat(129),
        ] {
            assert!(!is_valid_session_id(bad), "{bad}");
        }
    }

    #[test]
    fn read_sessions_keeps_fresh_files_and_skips_bad_names() {
        let dir = temp_sessions_dir("fresh");
        std::fs::write(dir.join("b.json"), r#"{"session":{"cwd":"b"}}"#).unwrap();
        std::fs::write(dir.join("a.json"), r#"{"session":{"cwd":"a"}}"#).unwrap();
        std::fs::write(dir.join("a.json.tmp-1"), r#"{"session":{"cwd":"tmp"}}"#).unwrap();
        std::fs::write(dir.join("bad id.json"), "{}").unwrap();
        std::fs::write(dir.join("c.txt"), "{}").unwrap();
        std::fs::write(dir.join("broken.json"), "not json").unwrap();
        std::fs::create_dir(dir.join("d.json")).unwrap();
        let sessions = read_sessions(&dir, SystemTime::now());
        let ids: Vec<_> = sessions.iter().map(|s| s.session_id.as_str()).collect();
        assert_eq!(ids, ["a", "b"]);
        assert_eq!(sessions[0].cwd.as_deref(), Some("a"));
        // Skipped files are left alone.
        assert!(dir.join("a.json.tmp-1").exists());
        assert!(dir.join("bad id.json").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_session_older_than_24h_is_ignored_but_kept() {
        let dir = temp_sessions_dir("stale");
        std::fs::write(dir.join("s.json"), "{}").unwrap();
        let now = SystemTime::now() + Duration::from_secs(25 * 60 * 60);
        assert!(read_sessions(&dir, now).is_empty());
        assert!(dir.join("s.json").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_session_older_than_7d_is_pruned() {
        let dir = temp_sessions_dir("prune");
        std::fs::write(dir.join("s.json"), "{}").unwrap();
        std::fs::write(dir.join("s.json.tmp-1"), "{}").unwrap();
        std::fs::write(dir.join("other.txt"), "{}").unwrap();
        let now = SystemTime::now() + Duration::from_secs(8 * 24 * 60 * 60);
        assert!(read_sessions(&dir, now).is_empty());
        assert!(!dir.join("s.json").exists());
        assert!(!dir.join("s.json.tmp-1").exists());
        assert!(dir.join("other.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_sessions_dir_is_empty() {
        let dir = std::env::temp_dir().join("herdr-gui-test-sessions-does-not-exist");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(read_sessions(&dir, SystemTime::now()).is_empty());
    }

    #[test]
    fn default_sessions_dir_is_under_dot_claude() {
        let dir = default_sessions_dir();
        assert_eq!(dir.file_name().unwrap(), "herdr-usage");
        assert_eq!(dir.parent().unwrap().file_name().unwrap(), ".claude");
    }
}
