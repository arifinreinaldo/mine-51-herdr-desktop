//! Persisted GUI settings (spec phase1.5 §9.4 "Settings persistence").
//!
//! `%APPDATA%\herdr-gui\settings.json`, resolved with `env::var("APPDATA")`
//! like `lib.rs::log_dir` -- **not** `app_config_dir()`, which gives
//! `dev.cowbell.app` (the Tauri `identifier`, Cowbell rebrand spec §A;
//! this data folder is kept unchanged by that rebrand). Rust commands
//! `settings_get` and `settings_set` do an
//! atomic write (write to a sibling `.tmp` file, then rename over the
//! target, which is atomic on the same filesystem). A corrupt file yields
//! defaults plus a `corrupted: true` flag the frontend turns into a notice.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::commands::{ApiError, AppState};

/// One workspace's persisted 0-9 palette index (spec §6a "Workspace
/// colours"). Kept as `u8` on the wire; the palette itself (10 entries) is
/// theme-overridable TS-side.
pub type WorkspaceColorIndex = u8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_theme")]
    pub theme: String,
    /// GUI-created workspaces only: `{workspace_id -> absolute folder path}`,
    /// used by the New Workspace dedup check (spec §1 "Duplicate folder").
    /// Pruned against the snapshot on the TS side.
    #[serde(default)]
    pub workspace_folders: HashMap<String, String>,
    /// `{workspace_id -> palette index}` (spec §6a), pruned against the
    /// snapshot on the TS side.
    #[serde(default)]
    pub workspace_colors: HashMap<String, WorkspaceColorIndex>,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default = "default_true")]
    pub sidebar_visible: bool,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_agent_sort")]
    pub agent_sort: String,
    #[serde(default = "default_true")]
    pub desktop_notifications: bool,
    /// Phase 1.6 §4: the first-run wizard's trigger. Also set by `herdr
    /// menu ▸ Setup…` re-running it (the wizard just flips this back to
    /// `false` on open and `true` again on its own Done step).
    #[serde(default)]
    pub first_run_complete: bool,
    /// UX pass 1 spec §3 "Pinnable agent list": persists across restarts.
    /// `#[serde(default)]` keeps an older `settings.json` (written before
    /// this field existed) loading fine, defaulting to `false`.
    #[serde(default)]
    pub agent_list_pinned: bool,
    /// Flutter run spec: `{project dir -> device id}`. The id is typed into
    /// a shell on Play, so the frontend re-checks it there.
    #[serde(default)]
    pub flutter_devices: HashMap<String, String>,
    /// `{project dir -> flavor}`, the last pick. Typed into a shell on Play.
    #[serde(default)]
    pub flutter_flavors: HashMap<String, String>,
}

fn default_theme() -> String {
    "dark-modern".to_string()
}
fn default_sidebar_width() -> u32 {
    260
}
fn default_font_size() -> u32 {
    14
}
fn default_agent_sort() -> String {
    "priority".to_string()
}
fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            workspace_folders: HashMap::new(),
            workspace_colors: HashMap::new(),
            sidebar_width: default_sidebar_width(),
            sidebar_visible: true,
            font_size: default_font_size(),
            agent_sort: default_agent_sort(),
            desktop_notifications: true,
            first_run_complete: false,
            agent_list_pinned: false,
            flutter_devices: HashMap::new(),
            flutter_flavors: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SettingsGetResponse {
    pub settings: Settings,
    /// Set when the file existed but failed to parse: the frontend shows a
    /// transient notice ("settings.json was invalid, defaults restored").
    pub corrupted: bool,
}

/// The per-user app data base: `%APPDATA%` on Windows,
/// `~/Library/Application Support` on macOS, `~/.local/share` elsewhere.
pub fn app_data_base() -> PathBuf {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
    });
    #[cfg(not(any(windows, target_os = "macos")))]
    let base =
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"));
    base.unwrap_or_else(std::env::temp_dir)
}

fn settings_dir() -> PathBuf {
    app_data_base().join("herdr-gui")
}

pub fn settings_path() -> PathBuf {
    settings_dir().join("settings.json")
}

/// Loads settings from `path`, matching `settings_get`'s corrupt-file
/// behavior. Split out from the command so it's unit-testable without a
/// `tauri::State`.
pub fn load_settings_from(path: &std::path::Path) -> SettingsGetResponse {
    match std::fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str::<Settings>(&contents) {
            Ok(settings) => SettingsGetResponse {
                settings,
                corrupted: false,
            },
            Err(err) => {
                tracing::warn!("settings.json failed to parse, using defaults: {err}");
                SettingsGetResponse {
                    settings: Settings::default(),
                    corrupted: true,
                }
            }
        },
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => SettingsGetResponse {
            settings: Settings::default(),
            corrupted: false,
        },
        Err(err) => {
            tracing::warn!("settings.json failed to read, using defaults: {err}");
            SettingsGetResponse {
                settings: Settings::default(),
                corrupted: true,
            }
        }
    }
}

/// A `.tmp` sibling name unique to this process *and* this call (finding
/// #7): a fixed name (the prior `path.with_extension("json.tmp")`) let two
/// near-simultaneous saves -- from this process or, in principle, another
/// instance -- clobber each other's in-flight tmp file before either
/// `rename` ran. The nanosecond component makes same-process collisions
/// effectively impossible even without the caller-side lock below; the
/// process id covers a second instance racing this one.
fn unique_tmp_path(path: &Path) -> PathBuf {
    // macOS's clock has ~1µs resolution, so two threads can read the same
    // `nanos`; the counter keeps same-process names distinct.
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let base_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("settings.json");
    path.with_file_name(format!(
        "{base_name}.tmp.{}.{nanos}.{seq}",
        std::process::id()
    ))
}

/// Atomically writes `settings` to `path`: a sibling tmp file with a unique
/// name (finding #7), then a same-filesystem rename over the target.
pub fn save_settings_to(path: &Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|err| std::io::Error::other(err.to_string()))?;
    let tmp_path = unique_tmp_path(path);
    std::fs::write(&tmp_path, json)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}

#[tauri::command]
pub async fn settings_get() -> Result<SettingsGetResponse, ApiError> {
    Ok(load_settings_from(&settings_path()))
}

/// Finding #7: several near-simultaneous `settings_set` calls (a
/// sidebar-resize drag-end racing a theme change, say) must never interleave
/// their write-tmp-then-rename steps -- `settings_save_lock` serializes
/// every save through this command, one at a time.
#[tauri::command]
pub async fn settings_set(
    state: tauri::State<'_, AppState>,
    settings: Settings,
) -> Result<(), ApiError> {
    let _guard = state.inner.settings_save_lock.lock().await;
    save_settings_to(&settings_path(), &settings).map_err(|err| ApiError {
        code: "io_error".to_string(),
        message: err.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("herdr-gui-test-settings-{name}.json"))
    }

    #[test]
    fn missing_file_yields_defaults_uncorrupted() {
        let path = temp_path("missing");
        let _ = std::fs::remove_file(&path);
        let response = load_settings_from(&path);
        assert!(!response.corrupted);
        assert_eq!(response.settings, Settings::default());
    }

    #[test]
    fn corrupt_file_yields_defaults_and_corrupted_flag() {
        let path = temp_path("corrupt");
        std::fs::write(&path, "not json at all {{{").unwrap();
        let response = load_settings_from(&path);
        assert!(response.corrupted);
        assert_eq!(response.settings, Settings::default());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_then_load_round_trips() {
        let path = temp_path("roundtrip");
        let mut settings = Settings::default();
        settings.theme = "herdr".to_string();
        settings.sidebar_width = 300;
        settings.workspace_colors.insert("ws-1".to_string(), 3);
        save_settings_to(&path, &settings).unwrap();
        let response = load_settings_from(&path);
        assert!(!response.corrupted);
        assert_eq!(response.settings, settings);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn save_is_atomic_and_leaves_no_tmp_file_behind() {
        let path = temp_path("atomic");
        save_settings_to(&path, &Settings::default()).unwrap();
        assert!(path.exists());
        assert!(!path.with_extension("json.tmp").exists());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn unique_tmp_path_differs_across_calls_and_from_the_target() {
        // Finding #7: a fixed tmp name let two near-simultaneous saves
        // clobber each other's in-flight file before either `rename` ran.
        let path = temp_path("unique-tmp");
        let a = unique_tmp_path(&path);
        let b = unique_tmp_path(&path);
        assert_ne!(a, b);
        assert_ne!(a, path);
        assert_eq!(a.parent(), path.parent());
    }

    #[test]
    fn concurrent_saves_never_corrupt_the_file_or_leave_stray_tmp_files() {
        // Finding #7: several threads saving to the same path at once, each
        // through the unique-tmp-name write-then-rename primitive, must
        // still leave a fully valid settings.json with nothing stray behind
        // -- the scenario a fixed tmp name could corrupt.
        let path = temp_path("concurrent");
        let _ = std::fs::remove_file(&path);
        let handles: Vec<_> = (0..8u32)
            .map(|i| {
                let path = path.clone();
                std::thread::spawn(move || {
                    let mut settings = Settings::default();
                    settings.sidebar_width = 200 + i;
                    save_settings_to(&path, &settings).unwrap();
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let response = load_settings_from(&path);
        assert!(
            !response.corrupted,
            "the final file must still be valid JSON"
        );
        // `temp_dir()` is the shared OS temp directory, so the stray-file
        // check must be scoped to *this test's own* tmp-name prefix rather
        // than any ".tmp." substring -- other processes leave plenty of
        // unrelated `*.tmp.*` files lying around in there too.
        let dir = path.parent().unwrap();
        let own_prefix = format!("{}.tmp.", path.file_name().unwrap().to_string_lossy());
        let stray: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(&own_prefix))
            .collect();
        assert!(stray.is_empty(), "stray tmp files left behind: {stray:?}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn partial_json_fills_in_defaults() {
        let path = temp_path("partial");
        std::fs::write(&path, r#"{"theme":"dracula"}"#).unwrap();
        let response = load_settings_from(&path);
        assert!(!response.corrupted);
        assert_eq!(response.settings.theme, "dracula");
        assert_eq!(response.settings.sidebar_width, default_sidebar_width());
        assert!(response.settings.desktop_notifications);
        // UX pass 1 spec §3: an older settings.json written before this
        // field existed must still load fine, defaulting to unpinned.
        assert!(!response.settings.agent_list_pinned);
        let _ = std::fs::remove_file(&path);
    }
}
