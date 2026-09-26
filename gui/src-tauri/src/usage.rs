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
    }
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
}
