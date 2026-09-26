//! herdr GUI Tauri backend (spec §4). See each module's doc comment for what
//! is stubbed vs. implemented for real.

pub mod commands;
pub mod conn;
pub mod mirror;
pub mod socket;
pub mod surface_encode;
pub mod usage;

use std::time::Instant;

use commands::AppState;

/// Initializes logging to `%LOCALAPPDATA%\herdr-gui\logs` (spec §4
/// "Logging"), builds the Tauri app, and runs it.
///
/// `start` is `main.rs`'s `Instant::now()`, captured before anything else.
/// The implementer wires it to the `HERDR_GUI_BENCH=1` startup bench output
/// and to `conn.rs`'s reconnect-loop startup; neither is started here yet.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(start: Instant) {
    let _ = start;
    init_logging();

    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::send_input,
            commands::resize,
            commands::api,
            commands::report_ready,
            commands::subscribe_surface,
        ])
        // TODO(implementer): spawn conn::Connection::connect's reconnect
        // loop here (e.g. via `tauri::async_runtime::spawn` in `.setup()`),
        // wired to AppState and to `commands::subscribe_surface`'s channel.
        .run(tauri::generate_context!())
        .expect("error while running the herdr GUI");
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
