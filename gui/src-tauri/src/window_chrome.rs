//! Custom title bar window controls, `Settings…`, and `Reconnect`
//! (spec phase1.5 §3 "Window", §4 "Menus and shortcuts").
//!
//! The window controls are plain Rust commands, **not** `core:window` JS
//! permissions (spec §3): "They call Rust commands (`window_minimize`,
//! `window_toggle_maximize`, `window_close`), not `core:window` JS
//! permissions."

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::commands::{ApiError, AppState};

fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, ApiError> {
    app.get_webview_window("main").ok_or_else(|| ApiError {
        code: "no_window".to_string(),
        message: "main window not found".to_string(),
    })
}

#[tauri::command]
pub async fn window_minimize(app: AppHandle) -> Result<(), ApiError> {
    main_window(&app)?.minimize().map_err(|err| ApiError {
        code: "window_error".to_string(),
        message: err.to_string(),
    })
}

#[tauri::command]
pub async fn window_toggle_maximize(app: AppHandle) -> Result<(), ApiError> {
    let window = main_window(&app)?;
    let is_maximized = window.is_maximized().map_err(|err| ApiError {
        code: "window_error".to_string(),
        message: err.to_string(),
    })?;
    let result = if is_maximized {
        window.unmaximize()
    } else {
        window.maximize()
    };
    result.map_err(|err| ApiError {
        code: "window_error".to_string(),
        message: err.to_string(),
    })
}

#[tauri::command]
pub async fn window_close(app: AppHandle) -> Result<(), ApiError> {
    main_window(&app)?.close().map_err(|err| ApiError {
        code: "window_error".to_string(),
        message: err.to_string(),
    })
}

/// `herdr's own config_dir()` (spec: "reuse socket.rs config_dir"):
/// `XDG_CONFIG_HOME/herdr` if set, else `%APPDATA%\herdr`, matching
/// `socket.rs::config_dir_from_env` and herdr's own `src/config/io.rs`.
fn herdr_config_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("XDG_CONFIG_HOME") {
        return std::path::PathBuf::from(dir).join("herdr");
    }
    match std::env::var("APPDATA") {
        Ok(dir) => std::path::PathBuf::from(dir).join("herdr"),
        Err(_) => std::env::temp_dir().join("herdr"),
    }
}

/// The herdr `config.toml` path: `HERDR_CONFIG_PATH` if set, else
/// `config_dir()/config.toml` (spec §4 "Settings…", `src/config/io.rs:195-200`).
fn herdr_config_path() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("HERDR_CONFIG_PATH") {
        return std::path::PathBuf::from(path);
    }
    herdr_config_dir().join("config.toml")
}

/// `herdr● Settings…` (spec §4): opens `config.toml` in the OS's default
/// editor for `.toml`, never creating it. If it does not exist yet, reveals
/// its containing directory instead so the user can create it themselves.
#[tauri::command]
pub async fn open_settings(app: AppHandle) -> Result<(), ApiError> {
    let path = herdr_config_path();
    let to_io_error = |err: tauri_plugin_opener::Error| ApiError {
        code: "io_error".to_string(),
        message: err.to_string(),
    };
    if path.is_file() {
        app.opener()
            .open_path(path.to_string_lossy(), None::<&str>)
            .map_err(to_io_error)
    } else {
        let dir = path.parent().unwrap_or(&path);
        app.opener().reveal_item_in_dir(dir).map_err(to_io_error)
    }
}

/// `Help ▸ Reconnect` (spec §4): forces the live connection closed so the
/// background reconnect loop (`dispatch::run_reconnect_loop`) immediately
/// re-attaches, instead of waiting for the server to actually drop the pipe.
#[tauri::command]
pub async fn reconnect(state: tauri::State<'_, AppState>) -> Result<(), ApiError> {
    let existing = state.inner.connection.write().await.take();
    if let Some(conn) = existing {
        conn.close();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_path_honours_override() {
        // SAFETY: single-threaded test, restored immediately after.
        unsafe {
            std::env::set_var("HERDR_CONFIG_PATH", "C:/tmp/custom-config.toml");
        }
        let path = herdr_config_path();
        unsafe {
            std::env::remove_var("HERDR_CONFIG_PATH");
        }
        assert_eq!(path, std::path::PathBuf::from("C:/tmp/custom-config.toml"));
    }
}
