//! Native folder picker, called from Rust only (spec phase1.5 §1 "New
//! workspace"). The webview gets no `dialog:*` permission: this command is
//! the only way the frontend ever reaches the dialog plugin for a
//! workspace folder, and it returns a plain path string (or `null`).
//!
//! The VS Code theme file picker used to be a second, separate command
//! here (`pick_theme_file`), returning a path string the webview then
//! passed back into `theme_import::import_vscode_theme(path)`. Finding
//! #13 folds picking and importing into that one command instead, in
//! Rust, so the webview is never handed a path it could substitute for an
//! arbitrary one.

use tauri_plugin_dialog::DialogExt;

use crate::commands::ApiError;

/// `Workspace ▸ New Workspace…` (spec §1): a native folder picker.
/// `blocking_pick_folder` must not run on the main thread; marking this
/// command `async fn` moves its execution off the UI thread onto Tauri's
/// async command runtime, per spec §1's explicit note.
#[tauri::command]
pub async fn pick_workspace_folder(app: tauri::AppHandle) -> Result<Option<String>, ApiError> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|path| path.to_string()))
}
