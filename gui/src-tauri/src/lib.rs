//! herdr GUI Tauri backend (spec §4). See each module's doc comment for what
//! is stubbed vs. implemented for real.

pub mod commands;
pub mod conn;
pub mod dispatch;
pub mod mirror;
pub mod socket;
pub mod surface_encode;
pub mod usage;

use std::time::{Duration, Instant};

use commands::AppState;
use tauri::Emitter;

/// Initializes logging to `%LOCALAPPDATA%\herdr-gui\logs` (spec §4
/// "Logging"), builds the Tauri app, and runs it.
///
/// `start` is `main.rs`'s `Instant::now()`, captured before anything else.
/// It seeds `AppState`'s `attach_ms` clock and is combined with the
/// frontend's own `report_ready` measurement for the `HERDR_GUI_BENCH=1`
/// startup bench output.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(start: Instant) {
    init_logging();

    let app_state = AppState::new(start);
    let inner = app_state.inner.clone();

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::send_input,
            commands::resize,
            commands::api,
            commands::report_ready,
            commands::subscribe_surface,
            commands::pane_at,
            commands::sync_state,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(dispatch::run_reconnect_loop(
                app_handle.clone(),
                inner.clone(),
            ));
            tauri::async_runtime::spawn(run_usage_poll_loop(app_handle, inner.clone()));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the herdr GUI");
}

/// Polls `~/.claude/herdr-usage.json`'s `mtime` every 2s (spec §4
/// `usage.rs`: "no watcher dependency") and emits a `usage` event to the
/// frontend whenever the parsed state changes. Also caches the latest
/// state on `inner` so `commands::sync_state` (spec §4 v3) can re-emit it
/// to a frontend that registered its `listen` call after this last fired
/// (finding #1).
async fn run_usage_poll_loop(app: tauri::AppHandle, inner: std::sync::Arc<commands::Inner>) {
    let path = usage::default_usage_path();
    let mut last_mtime = None;
    let mut last_state: Option<usage::UsageState> = None;
    loop {
        let mtime = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        if mtime != last_mtime {
            last_mtime = mtime;
            let state = usage::read_usage_file(&path);
            if last_state.as_ref() != Some(&state) {
                inner.record_usage(state.clone());
                let _ = app.emit("usage", &state);
                last_state = Some(state);
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn init_logging() {
    let log_dir = log_dir();
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let log_path = log_dir.join("herdr-gui.log");
    let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    else {
        return;
    };
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_writer(std::sync::Mutex::new(file))
        .try_init();
}

/// `%LOCALAPPDATA%\herdr-gui\logs` (spec §4 "Logging").
fn log_dir() -> std::path::PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("herdr-gui").join("logs")
}
