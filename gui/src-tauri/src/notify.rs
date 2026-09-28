//! Agent-done desktop notification (spec phase1.5 §7 "Done notification").
//!
//! In-app highlighting (opening the agent popover, the highlight card, the
//! auto-hide timer) is TS-side (`src/notifications/doneDetector.ts`). This
//! module is only the **window-unfocused** path: `window.request_user_
//! attention`, and -- when the setting is on -- a rate-limited desktop
//! toast. The rate limiter is pure and Rust-tested per spec §13.

use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::commands::{ApiError, AppState};

pub const TOAST_WINDOW: Duration = Duration::from_secs(5);
const TOAST_TITLE_MAX_CHARS: usize = 64;
const TOAST_BODY_MAX_CHARS: usize = 200;

/// One toast per `window` (spec: "one toast per 5s"); transitions that
/// arrive while a window is already open are coalesced into the next
/// allowed toast's "and N more" (finding-free, but exactly the spec's
/// wording).
pub struct ToastRateLimiter {
    window: Duration,
    last_fired: Option<Instant>,
    coalesced: u32,
}

impl ToastRateLimiter {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            last_fired: None,
            coalesced: 0,
        }
    }

    /// Records one agent-done transition at `now`. Returns `Some(extra)`
    /// (the number of transitions coalesced into this toast, 0 the first
    /// time or after a quiet period) when a toast should actually be shown,
    /// or `None` when this transition falls inside the current window and
    /// is coalesced into whichever toast fires next.
    pub fn on_event(&mut self, now: Instant) -> Option<u32> {
        let should_fire = match self.last_fired {
            None => true,
            Some(last) => now.saturating_duration_since(last) >= self.window,
        };
        if should_fire {
            let extra = self.coalesced;
            self.coalesced = 0;
            self.last_fired = Some(now);
            Some(extra)
        } else {
            self.coalesced += 1;
            None
        }
    }
}

impl Default for ToastRateLimiter {
    fn default() -> Self {
        Self::new(TOAST_WINDOW)
    }
}

/// Strips ASCII/Unicode control characters and truncates to at most
/// `max_chars` **characters** (not bytes), per spec: "Truncate the toast
/// title and body to 64 and 200 characters and strip control characters."
pub fn sanitize_toast_text(input: &str, max_chars: usize) -> String {
    input
        .chars()
        .filter(|c| !c.is_control())
        .take(max_chars)
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentDoneParams {
    pub workspace: String,
    pub tab: String,
    pub agent: String,
    pub title: String,
}

/// Called when the window is not focused and an agent just transitioned to
/// Done (spec §7 "Window unfocused"): flashes the taskbar unconditionally,
/// and -- only when `desktopNotifications` is on -- shows a rate-limited
/// toast. Clicking the toast just focuses the app (OS/webview behavior);
/// the in-app highlight card is what the frontend already shows once
/// focused.
#[tauri::command]
pub async fn notify_agent_done(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    workspace: String,
    tab: String,
    agent: String,
    title: String,
) -> Result<(), ApiError> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }

    let desktop_notifications_enabled =
        crate::settings::load_settings_from(&crate::settings::settings_path())
            .settings
            .desktop_notifications;
    if !desktop_notifications_enabled {
        return Ok(());
    }

    let extra = {
        let mut limiter = state
            .inner
            .toast_limiter
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        limiter.on_event(Instant::now())
    };
    let Some(extra) = extra else {
        return Ok(());
    };

    let toast_title = sanitize_toast_text(
        &format!("\u{2713} {workspace} \u{b7} {tab}"),
        TOAST_TITLE_MAX_CHARS,
    );
    let mut body = format!("{agent} finished \u{2014} {title}");
    if extra > 0 {
        body.push_str(&format!(" (and {extra} more)"));
    }
    let toast_body = sanitize_toast_text(&body, TOAST_BODY_MAX_CHARS);

    if let Err(err) = app
        .notification()
        .builder()
        .title(toast_title)
        .body(toast_body)
        .show()
    {
        tracing::warn!("failed to show agent-done toast: {err}");
    }
    Ok(())
}

/// `ServerMessage::TerminalBell{count}` (terminal-parity spec P1 #13 "Bell
/// and notifications"): flashes the focused tab (emitted to the frontend
/// unconditionally, so it flashes even while the window is focused), and --
/// only while the window is unfocused -- also flashes the taskbar, same call
/// as `notify_agent_done` above (`window.request_user_attention`). There is
/// no sound (spec: "the bell never becomes annoying").
pub async fn handle_terminal_bell(app: &AppHandle, count: u16) {
    if let Some(window) = app.get_webview_window("main") {
        if !window.is_focused().unwrap_or(true) {
            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
    }
    let _ = app.emit("terminal-bell", count);
}

/// `ServerMessage::SemanticNotification` (terminal-parity spec P1 #13):
/// forwarded to the frontend as-is. The done-toast dedup against the
/// snapshot-driven `DoneTransitionDetector` (by pane id and
/// `state_change_seq`) needs the current snapshot baseline, which only the
/// TS side holds (`src/notifications/doneDetector.ts`), so this is a plain
/// forward, not a decision point -- Rust's only other notification job
/// (the desktop toast + taskbar flash) stays exactly as `notify_agent_done`
/// already does it, called from TS once it decides a transition is new.
pub fn handle_semantic_notification(
    app: &AppHandle,
    notification: herdr_wire::SemanticNotification,
) {
    let _ = app.emit("semantic-notification", notification);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_event_always_fires_with_no_extras() {
        let mut limiter = ToastRateLimiter::new(Duration::from_secs(5));
        assert_eq!(limiter.on_event(Instant::now()), Some(0));
    }

    #[test]
    fn events_within_the_window_are_coalesced() {
        let mut limiter = ToastRateLimiter::new(Duration::from_secs(5));
        let t0 = Instant::now();
        assert_eq!(limiter.on_event(t0), Some(0));
        assert_eq!(limiter.on_event(t0 + Duration::from_secs(1)), None);
        assert_eq!(limiter.on_event(t0 + Duration::from_secs(2)), None);
        // The next toast that actually fires reports the 2 coalesced ones.
        assert_eq!(limiter.on_event(t0 + Duration::from_secs(6)), Some(2));
    }

    #[test]
    fn events_spaced_past_the_window_each_fire_with_no_extras() {
        let mut limiter = ToastRateLimiter::new(Duration::from_secs(5));
        let t0 = Instant::now();
        assert_eq!(limiter.on_event(t0), Some(0));
        assert_eq!(limiter.on_event(t0 + Duration::from_secs(5)), Some(0));
        assert_eq!(limiter.on_event(t0 + Duration::from_secs(10)), Some(0));
    }

    #[test]
    fn a_long_coalescing_burst_reports_the_full_count_once_the_window_reopens() {
        let mut limiter = ToastRateLimiter::new(Duration::from_secs(5));
        let t0 = Instant::now();
        assert_eq!(limiter.on_event(t0), Some(0));
        for i in 1..=4u64 {
            assert_eq!(limiter.on_event(t0 + Duration::from_millis(i * 100)), None);
        }
        assert_eq!(limiter.on_event(t0 + Duration::from_secs(5)), Some(4));
        // The counter resets after being reported.
        assert_eq!(
            limiter.on_event(t0 + Duration::from_secs(5) + Duration::from_millis(1)),
            None
        );
        assert_eq!(limiter.on_event(t0 + Duration::from_secs(10)), Some(1));
    }

    #[test]
    fn sanitize_strips_control_characters() {
        let out = sanitize_toast_text("hello\u{0007}\nworld", 100);
        assert_eq!(out, "helloworld");
    }

    #[test]
    fn sanitize_truncates_to_char_count_not_bytes() {
        // Each "é" is 2 bytes in UTF-8; truncation must count characters.
        let input = "é".repeat(10);
        let out = sanitize_toast_text(&input, 5);
        assert_eq!(out.chars().count(), 5);
    }

    #[test]
    fn title_and_body_limits_match_spec() {
        let long_title = "x".repeat(1000);
        assert_eq!(
            sanitize_toast_text(&long_title, TOAST_TITLE_MAX_CHARS)
                .chars()
                .count(),
            TOAST_TITLE_MAX_CHARS
        );
        let long_body = "y".repeat(1000);
        assert_eq!(
            sanitize_toast_text(&long_body, TOAST_BODY_MAX_CHARS)
                .chars()
                .count(),
            TOAST_BODY_MAX_CHARS
        );
    }
}
