//! herdr GUI Tauri backend (spec §4). See each module's doc comment for what
//! is stubbed vs. implemented for real.

pub mod android;
pub mod clipboard;
pub mod commands;
pub mod conn;
pub mod dispatch;
pub mod engine;
pub mod flutter;
pub mod folder_picker;
pub mod memory;
pub mod mirror;
pub mod mirror_tools;
#[cfg(windows)]
pub mod mirror_tools_win32;
pub mod notify;
pub mod record;
#[cfg(windows)]
pub mod record_win32;
pub mod settings;
pub mod socket;
pub mod statusline;
pub mod surface_encode;
pub mod theme_import;
pub mod usage;
pub mod window_chrome;

use std::time::{Duration, Instant};

use commands::AppState;
use tauri::{Emitter, Manager};
use tracing_subscriber::EnvFilter;

/// Initializes logging to `%LOCALAPPDATA%\herdr-gui\logs` (spec §4
/// "Logging"), builds the Tauri app, and runs it.
///
/// `start` is `main.rs`'s `Instant::now()`, captured before anything else.
/// It seeds `AppState`'s `attach_ms` clock and is combined with the
/// frontend's own `report_ready` measurement for the `HERDR_GUI_BENCH=1`
/// startup bench output.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(start: Instant) {
    // `None` (log dir uncreatable) silently disables file logging, matching
    // the prior behavior's own best-effort fallback. Held (as `Some`) until
    // `RunEvent::Exit` below flushes it explicitly -- see that comment
    // (finding #15 "`_log_guard` flushed on exit").
    let log_guard = init_logging();

    let app_state = AppState::new(start);
    let inner = app_state.inner.clone();

    let prevent_default_plugin = build_prevent_default_plugin();

    let app = tauri::Builder::default()
        // Phase 1.6 addendum §11 item 4: registered first, before every
        // other plugin. A second launch focuses/unminimizes the existing
        // window instead of failing to create its own webview
        // (`0x800700AA`, the profile is already in use) and then exits.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(prevent_default_plugin)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(app_state)
        .manage(android::ScreenshotSlot::default())
        .manage(mirror_tools::MirrorToolsState::default())
        .manage(record::RecordingState::default())
        .invoke_handler(tauri::generate_handler![
            commands::send_input,
            commands::resize,
            commands::api,
            commands::report_ready,
            commands::subscribe_surface,
            commands::pane_at,
            commands::pane_mouse_hit,
            commands::pane_layout,
            commands::pane_scroll_info,
            commands::pane_keyboard_info,
            commands::write_clipboard_text,
            commands::clipboard_read_text,
            commands::open_external_url,
            commands::app_version,
            commands::sync_state,
            commands::set_client_focus,
            window_chrome::window_minimize,
            window_chrome::window_toggle_maximize,
            window_chrome::window_close,
            window_chrome::open_settings,
            window_chrome::reconnect,
            settings::settings_get,
            settings::settings_set,
            flutter::flutter_project,
            flutter::android_devices,
            flutter::flutter_devices,
            flutter::flutter_flavors,
            flutter::flutter_run_alive,
            android::android_mirror,
            android::android_install_apk,
            android::install_scrcpy,
            android::android_screenshot,
            android::screenshot_copy,
            android::screenshot_save,
            mirror_tools::mirror_tools_resize,
            record::mirror_record_start,
            record::mirror_record_stop,
            record::reveal_in_folder,
            folder_picker::pick_workspace_folder,
            theme_import::import_vscode_theme,
            theme_import::list_imported_themes,
            notify::notify_agent_done,
            engine::engine_status,
            engine::engine_install,
            engine::engine_ensure_server_started,
            engine::engine_force_start_server,
            engine::engine_stop_server,
            engine::node_version,
            engine::gemini_version,
            engine::autostart_get,
            engine::autostart_set,
            engine::restart_gui,
            statusline::statusline_status,
            statusline::statusline_install,
            statusline::statusline_undo,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(dispatch::run_reconnect_loop(
                app_handle.clone(),
                inner.clone(),
            ));
            tauri::async_runtime::spawn(run_usage_poll_loop(app_handle.clone(), inner.clone()));
            // Cowbell rebrand spec §A1: migrates the pre-rebrand "Herdr
            // Desktop" Start-at-Login entry to the new "Cowbell" name, once,
            // silently. Release builds only: a dev build must never move the
            // user's Start-at-Login entry to `target\debug\herdr-gui.exe`.
            if !tauri::is_dev() {
                tauri::async_runtime::spawn(engine::migrate_old_autostart_entry(app_handle));
            }
            if let Some(window) = app.get_webview_window("main") {
                memory::wire_memory_target(&window);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the herdr GUI");

    // Finding #15: `run()` blocks until the app exits, but Tauri's default
    // window-close path can end the process before a plain top-level local
    // ever gets to run its `Drop` -- `RunEvent::Exit` is guaranteed to fire
    // first, so the flushing appender's guard is dropped explicitly there
    // instead of relying on an implicit end-of-function drop.
    let mut log_guard = Some(log_guard);
    app.run(move |app_handle, event| match event {
        // Closing `main` ends the app. With a mirror tools window open, Tauri
        // would keep the process alive with only that window. scrcpy is
        // detached and keeps running.
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } if label == "main" => record::exit_after_finalize(app_handle),
        // The last window closed (`code: None`) while a recorder runs: hold
        // the exit until the recorders have written their index.
        tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } if record::active_count(app_handle) > 0 => {
            api.prevent_exit();
            record::exit_after_finalize(app_handle);
        }
        tauri::RunEvent::Exit => {
            log_guard.take();
        }
        _ => {}
    });
}

/// Stops WebView2 from swallowing F5/F3/Ctrl+F/Ctrl+P/Ctrl+R/Ctrl+Shift+I so
/// they reach the terminal instead of reloading/printing/finding/opening
/// devtools (spec phase1.5 §1 "WebView2 browser keys are disabled"). The
/// `platform-windows` feature's `PlatformOptions` only takes effect on
/// Windows; elsewhere the plugin is registered with no platform options
/// (the JS-injection `Flags` path is not needed here since the GUI wants
/// these keys to *reach* JS, just not trigger WebView2's own handling).
fn build_prevent_default_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    // Finding #15: `Builder::new()`'s default flag set is `Flags::all()`,
    // which includes `FOCUS_MOVE` -- the plugin's own JS injection then
    // calls `preventDefault()` on every `Shift+Tab`, silently breaking
    // backward focus navigation through the chrome (sidebar rows, tabs,
    // menu items, status bar items). `FOCUS_MOVE` guards a browser-only
    // affordance (moving focus into the URL bar) this app has no use for
    // anyway, so it is dropped from the claimed flag set everywhere, not
    // just on Windows.
    let flags = tauri_plugin_prevent_default::Flags::all()
        .difference(tauri_plugin_prevent_default::Flags::FOCUS_MOVE);
    #[cfg(target_os = "windows")]
    {
        tauri_plugin_prevent_default::Builder::new()
            .with_flags(flags)
            .platform(
                tauri_plugin_prevent_default::PlatformOptions::new()
                    .browser_accelerator_keys(false),
            )
            .build()
    }
    #[cfg(not(target_os = "windows"))]
    {
        tauri_plugin_prevent_default::Builder::new()
            .with_flags(flags)
            .build()
    }
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

/// Initializes `tracing` with a **flushing** non-blocking file writer (spec
/// phase1.5 §9.1 "Empty log file"): the prior synchronous writer left the
/// log empty in practice because `EnvFilter::from_default_env()` with no
/// `RUST_LOG` set filters out everything below `ERROR`, so the app's
/// `warn!`/`debug!` calls (connect, disconnect, handshake result, resyncs,
/// decode skips) never reached it. This defaults to `info` and honors
/// `HERDR_GUI_LOG` to override, and returns the `WorkerGuard` that must be
/// held for the process lifetime to flush buffered lines on exit.
fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let log_dir = log_dir();
    if std::fs::create_dir_all(&log_dir).is_err() {
        return None;
    }
    let file_appender = tracing_appender::rolling::never(&log_dir, "herdr-gui.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let filter = std::env::var("HERDR_GUI_LOG")
        .ok()
        .and_then(|directive| EnvFilter::try_new(directive).ok())
        .unwrap_or_else(|| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(non_blocking)
        .with_ansi(false)
        .try_init();
    Some(guard)
}

/// `%LOCALAPPDATA%\herdr-gui\logs` (spec §4 "Logging").
fn log_dir() -> std::path::PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("herdr-gui").join("logs")
}
