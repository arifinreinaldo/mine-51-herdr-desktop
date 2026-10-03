//! Resolves the herdr client protocol socket path (spec §4 `socket.rs`,
//! §1 "Sockets").
//!
//! Precedence mirrors herdr's own `src/server/socket_paths.rs:23-48`
//! (`client_socket_path` / `client_socket_path_from_overrides`), minus the
//! CLI `--session` flag concept (the GUI has no CLI arg parsing):
//!
//! 1. `HERDR_SOCKET_PATH=<p>` -> `<p stem>-client.sock` in the same directory.
//! 2. Else `HERDR_CLIENT_SOCKET_PATH=<p>` (legacy) -> used literally.
//! 3. Else herdr's own `HERDR_SESSION=<name>` (when set and not `"default"`)
//!    -> `<config_dir>/sessions/<name>/herdr-client.sock`.
//! 4. Else `<config_dir>/herdr-client.sock`.
//!
//! Where `config_dir` is `XDG_CONFIG_HOME/herdr` if set (even on Windows,
//! per `src/config/io.rs:30-35`), else `%APPDATA%\herdr`. The GUI
//! hard-codes the app dir name `"herdr"` (never herdr's debug-build
//! `"herdr-dev"`): live tests always target the installed release herdr,
//! never `cargo run` (spec §1).
//!
//! This module does not invent a new environment variable: it reuses
//! herdr's own `HERDR_SOCKET_PATH`, `HERDR_CLIENT_SOCKET_PATH`, and
//! `HERDR_SESSION`.

use std::path::{Path, PathBuf};

pub const SOCKET_PATH_ENV_VAR: &str = "HERDR_SOCKET_PATH";
pub const CLIENT_SOCKET_PATH_ENV_VAR: &str = "HERDR_CLIENT_SOCKET_PATH";
pub const SESSION_ENV_VAR: &str = "HERDR_SESSION";
const DEFAULT_SESSION_NAME: &str = "default";

/// Resolves the client protocol socket path from the current environment.
pub fn client_socket_path() -> PathBuf {
    client_socket_path_from_env(
        std::env::var(SOCKET_PATH_ENV_VAR).ok().as_deref(),
        std::env::var(CLIENT_SOCKET_PATH_ENV_VAR).ok().as_deref(),
        std::env::var(SESSION_ENV_VAR).ok().as_deref(),
        std::env::var("XDG_CONFIG_HOME").ok().as_deref(),
        config_base().as_deref(),
    )
}

/// herdr's per-user config base when `XDG_CONFIG_HOME` is unset:
/// `%APPDATA%` on Windows, `~/.config` on macOS and Linux (herdr's own
/// `src/config/io.rs`).
pub fn config_base() -> Option<String> {
    #[cfg(windows)]
    {
        std::env::var("APPDATA").ok()
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .ok()
            .map(|home| format!("{home}/.config"))
    }
}

fn client_socket_path_from_env(
    api_socket_override: Option<&str>,
    client_socket_override: Option<&str>,
    session_name: Option<&str>,
    xdg_config_home: Option<&str>,
    appdata: Option<&str>,
) -> PathBuf {
    if let Some(api_socket_override) = api_socket_override {
        return derive_client_socket_from_api_socket(Path::new(api_socket_override));
    }
    if let Some(client_socket_override) = client_socket_override {
        return PathBuf::from(client_socket_override);
    }
    let config_dir = config_dir_from_env(xdg_config_home, appdata);
    match active_session_name(session_name) {
        Some(name) => config_dir
            .join("sessions")
            .join(name)
            .join("herdr-client.sock"),
        None => config_dir.join("herdr-client.sock"),
    }
}

fn active_session_name(session_name: Option<&str>) -> Option<&str> {
    session_name.filter(|name| !name.is_empty() && *name != DEFAULT_SESSION_NAME)
}

fn derive_client_socket_from_api_socket(api_socket_path: &Path) -> PathBuf {
    let stem = api_socket_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("herdr");
    let parent = api_socket_path.parent().unwrap_or_else(|| Path::new(""));
    parent.join(format!("{stem}-client.sock"))
}

fn config_dir_from_env(xdg_config_home: Option<&str>, appdata: Option<&str>) -> PathBuf {
    if let Some(dir) = xdg_config_home {
        return PathBuf::from(dir).join("herdr");
    }
    match appdata {
        Some(dir) => PathBuf::from(dir).join("herdr"),
        None => std::env::temp_dir().join("herdr"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_config_dir_herdr_client_sock() {
        let path =
            client_socket_path_from_env(None, None, None, None, Some("C:/Users/x/AppData/Roaming"));
        assert_eq!(
            path,
            PathBuf::from("C:/Users/x/AppData/Roaming/herdr/herdr-client.sock")
        );
    }

    #[test]
    fn herdr_session_selects_the_named_session_socket() {
        let path = client_socket_path_from_env(
            None,
            None,
            Some("gui-test"),
            None,
            Some("C:/Users/x/AppData/Roaming"),
        );
        assert_eq!(
            path,
            PathBuf::from("C:/Users/x/AppData/Roaming/herdr/sessions/gui-test/herdr-client.sock")
        );
    }

    #[test]
    fn herdr_session_default_is_treated_as_no_session() {
        let path = client_socket_path_from_env(
            None,
            None,
            Some("default"),
            None,
            Some("C:/Users/x/AppData/Roaming"),
        );
        assert_eq!(
            path,
            PathBuf::from("C:/Users/x/AppData/Roaming/herdr/herdr-client.sock")
        );
    }

    #[test]
    fn herdr_socket_path_overrides_and_ignores_session() {
        let path = client_socket_path_from_env(
            Some("C:/tmp/test-herdr.sock"),
            None,
            Some("gui-test"),
            None,
            Some("C:/Users/x/AppData/Roaming"),
        );
        assert_eq!(path, PathBuf::from("C:/tmp/test-herdr-client.sock"));
    }

    #[test]
    fn legacy_client_socket_path_is_used_literally_and_ignores_session() {
        let path = client_socket_path_from_env(
            None,
            Some("C:/tmp/legacy-client.sock"),
            Some("gui-test"),
            None,
            Some("C:/Users/x/AppData/Roaming"),
        );
        assert_eq!(path, PathBuf::from("C:/tmp/legacy-client.sock"));
    }

    #[test]
    fn herdr_socket_path_takes_precedence_over_legacy_client_override() {
        let path = client_socket_path_from_env(
            Some("C:/tmp/test-herdr.sock"),
            Some("C:/tmp/legacy-client.sock"),
            None,
            None,
            Some("C:/Users/x/AppData/Roaming"),
        );
        assert_eq!(path, PathBuf::from("C:/tmp/test-herdr-client.sock"));
    }

    #[test]
    fn xdg_config_home_wins_even_when_appdata_is_set() {
        let path = client_socket_path_from_env(
            None,
            None,
            None,
            Some("C:/custom/xdg"),
            Some("C:/Users/x/AppData/Roaming"),
        );
        assert_eq!(path, PathBuf::from("C:/custom/xdg/herdr/herdr-client.sock"));
    }
}
