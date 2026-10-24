//! macOS-only shell integration: the Dock badge and bounce for agents that
//! need attention, and the native menu bar. Every command exists on all
//! platforms so the invoke handler stays one list, but does nothing off
//! macOS; the frontend only calls them when it runs in a Mac webview.

use serde::Deserialize;

/// One menu item sent by the frontend (`gui/src/nativeMenu.ts`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeItem {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub accelerator: Option<String>,
    #[serde(default)]
    pub checked: Option<bool>,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    #[serde(default)]
    pub separator_before: bool,
    #[serde(default)]
    pub submenu: Vec<NativeItem>,
}

fn enabled_by_default() -> bool {
    true
}

/// A top-level menu: the first one is the app menu ("Cowbell"), the last is
/// Help; Edit and Window are added around them in `build_menu`.
#[derive(Debug, Deserialize)]
pub struct NativeMenu {
    pub title: String,
    pub items: Vec<NativeItem>,
}

/// Badge on the Dock icon: the number of agents blocked or done. 0 clears it.
#[tauri::command]
pub fn dock_badge(app: tauri::AppHandle, count: u32) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let badge = (count > 0).then_some(i64::from(count));
            if let Err(err) = window.set_badge_count(badge) {
                tracing::warn!("set_badge_count failed: {err}");
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, count);
}

/// Bounces the Dock icon once. macOS ignores this while the app is active.
#[tauri::command]
pub fn dock_bounce(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            if let Err(err) =
                window.request_user_attention(Some(tauri::UserAttentionType::Informational))
            {
                tracing::warn!("request_user_attention failed: {err}");
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Replaces the menu bar. Item clicks come back as a `native-menu` event
/// carrying the item id (`on_menu_event` in `lib.rs`).
#[tauri::command]
pub fn set_native_menu(app: tauri::AppHandle, menus: Vec<NativeMenu>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let menu = build_menu(&app, &menus).map_err(|err| err.to_string())?;
        app.set_menu(menu).map_err(|err| err.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, menus);
    Ok(())
}

#[cfg(target_os = "macos")]
fn fill_submenu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    submenu: &tauri::menu::Submenu<R>,
    items: &[NativeItem],
) -> tauri::Result<()> {
    use tauri::menu::{CheckMenuItem, MenuItem, PredefinedMenuItem, Submenu};
    for item in items {
        if item.separator_before {
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        let accelerator = item.accelerator.as_deref();
        if !item.submenu.is_empty() {
            let child = Submenu::with_id(app, &item.id, &item.label, item.enabled)?;
            fill_submenu(app, &child, &item.submenu)?;
            submenu.append(&child)?;
        } else if let Some(checked) = item.checked {
            submenu.append(&CheckMenuItem::with_id(
                app,
                &item.id,
                &item.label,
                item.enabled,
                checked,
                accelerator,
            )?)?;
        } else {
            // An accelerator muda cannot parse must not drop the whole menu.
            let built = MenuItem::with_id(app, &item.id, &item.label, item.enabled, accelerator)
                .or_else(|err| {
                    tracing::warn!("menu accelerator {accelerator:?} rejected: {err}");
                    MenuItem::with_id(app, &item.id, &item.label, item.enabled, None::<&str>)
                })?;
            submenu.append(&built)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn build_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    menus: &[NativeMenu],
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

    let menu = Menu::new(app)?;
    let last = menus.len().saturating_sub(1);
    for (index, spec) in menus.iter().enumerate() {
        let submenu = Submenu::new(app, &spec.title, true)?;
        fill_submenu(app, &submenu, &spec.items)?;
        if index == 0 {
            // The app menu ends with the system items every Mac app has.
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
            submenu.append(&PredefinedMenuItem::services(app, None)?)?;
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
            submenu.append(&PredefinedMenuItem::hide(app, None)?)?;
            submenu.append(&PredefinedMenuItem::hide_others(app, None)?)?;
            submenu.append(&PredefinedMenuItem::show_all(app, None)?)?;
            submenu.append(&PredefinedMenuItem::separator(app)?)?;
            submenu.append(&PredefinedMenuItem::quit(app, None)?)?;
            menu.append(&submenu)?;
            menu.append(&edit_menu(app)?)?;
            continue;
        }
        if index == last {
            menu.append(&window_menu(app)?)?;
        }
        menu.append(&submenu)?;
    }
    Ok(menu)
}

#[cfg(target_os = "macos")]
fn edit_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Submenu<R>> {
    use tauri::menu::{PredefinedMenuItem, Submenu};
    let edit = Submenu::new(app, "Edit", true)?;
    edit.append(&PredefinedMenuItem::undo(app, None)?)?;
    edit.append(&PredefinedMenuItem::redo(app, None)?)?;
    edit.append(&PredefinedMenuItem::separator(app)?)?;
    edit.append(&PredefinedMenuItem::cut(app, None)?)?;
    edit.append(&PredefinedMenuItem::copy(app, None)?)?;
    edit.append(&PredefinedMenuItem::paste(app, None)?)?;
    edit.append(&PredefinedMenuItem::select_all(app, None)?)?;
    Ok(edit)
}

#[cfg(target_os = "macos")]
fn window_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Submenu<R>> {
    use tauri::menu::{PredefinedMenuItem, Submenu};
    let window = Submenu::new(app, "Window", true)?;
    window.append(&PredefinedMenuItem::minimize(app, None)?)?;
    window.append(&PredefinedMenuItem::maximize(app, None)?)?;
    window.append(&PredefinedMenuItem::fullscreen(app, None)?)?;
    Ok(window)
}
