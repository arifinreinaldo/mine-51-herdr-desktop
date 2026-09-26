//! Claude plan usage: polls the `mtime` of `~/.claude/herdr-usage.json`
//! every 2s (no watcher dependency) and parses its `rate_limits` shape
//! (spec §1 "Usage data", §4 `usage.rs`).
//!
//! This module never reads `~/.claude/.credentials.json`.
//!
//! `parse_usage_json`/`read_usage_file` are stubbed with `todo!()`: usage
//! parsing is application logic, not scaffolding, and is left for the
//! implementer. `default_usage_path` is plain, deterministic path
//! construction (like `socket::client_socket_path`) and is implemented for
//! real. The tests in this module encode the expected behavior from spec §5
//! and are expected to fail (red) until the parser lands.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Window {
    /// Clamped to `0.0..=100.0`.
    pub used_pct: f64,
    /// Unix epoch seconds.
    pub resets_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageStatus {
    Ok,
    /// The file does not exist (yet): no Claude Code session has ever run.
    Missing,
    /// The file exists but is not valid JSON, or does not match the
    /// expected shape.
    Invalid,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UsageState {
    pub five_hour: Option<Window>,
    pub seven_day: Option<Window>,
    /// Unix epoch seconds.
    pub captured_at: Option<i64>,
    pub status: UsageStatus,
}

impl UsageState {
    pub fn missing() -> Self {
        Self {
            five_hour: None,
            seven_day: None,
            captured_at: None,
            status: UsageStatus::Missing,
        }
    }

    pub fn invalid() -> Self {
        Self {
            five_hour: None,
            seven_day: None,
            captured_at: None,
            status: UsageStatus::Invalid,
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

/// Parses the statusline hook's JSON shape into a `UsageState`. `spend_limit`
/// (if present) is ignored per spec §1. `used_percentage` may be a float or
/// an int and is clamped to `0.0..=100.0`. Any window may be absent.
/// Malformed JSON, or JSON that doesn't match the expected shape, produces
/// `UsageState::invalid()`.
pub fn parse_usage_json(json: &str) -> UsageState {
    let _ = json;
    todo!("parse_usage_json: parse rate_limits.{{five_hour,seven_day}}.{{used_percentage,resets_at}}, clamp used_percentage to 0..=100, ignore spend_limit, Invalid on malformed/mismatched JSON")
}

/// Reads and parses `path`. A missing file yields `UsageState::missing()`
/// (not `Invalid` -- absence is expected before the first Claude Code
/// session runs).
pub fn read_usage_file(path: &Path) -> UsageState {
    let _ = path;
    todo!("read_usage_file: std::fs::read_to_string, Missing on NotFound, else parse_usage_json")
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
}
