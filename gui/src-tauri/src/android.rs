//! Android mirror and APK install: `scrcpy` for the mirror window, `adb
//! install` for dropped APKs, and a `winget` install of scrcpy when it is
//! missing. scrcpy is not bundled; it runs as its own native window.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command as AsyncCommand;

use crate::commands::ApiError;
use crate::engine::apply_no_window;
use crate::flutter::{
    api_error, default_sdk_dir, is_valid_device_id, resolve_adb, run_capture, tool_file_name,
};

/// scrcpy that dies inside this window (no device, unauthorized) is a
/// failure to report; one still alive after it is the mirror window.
const SCRCPY_EARLY_EXIT: Duration = Duration::from_millis(1500);
const INSTALL_APK_TIMEOUT: Duration = Duration::from_secs(120);
const INSTALL_SCRCPY_TIMEOUT: Duration = Duration::from_secs(300);

fn local_app_data() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

/// The first `PATH` entry, then `extra_dir`, that holds the tool.
fn find_tool(tool: &str, path_var: Option<&OsStr>, extra_dir: Option<PathBuf>) -> Option<PathBuf> {
    let name = tool_file_name(tool);
    let mut dirs: Vec<PathBuf> = path_var
        .map(|p| std::env::split_paths(p).collect())
        .unwrap_or_default();
    dirs.extend(extra_dir);
    dirs.into_iter()
        .map(|d| d.join(&name))
        .find(|p| p.is_file())
}

/// `PATH`, then winget's link folder. A `winget install` of scrcpy adds
/// that folder to the user `PATH`, but this process keeps its old `PATH`.
pub fn resolve_scrcpy(path_var: Option<&OsStr>, local: Option<&Path>) -> Option<PathBuf> {
    let links = local.map(|l| l.join("Microsoft").join("WinGet").join("Links"));
    find_tool("scrcpy", path_var, links)
}

fn resolve_adb_from_env() -> Option<PathBuf> {
    let android_home = std::env::var_os("ANDROID_HOME").map(PathBuf::from);
    let android_sdk_root = std::env::var_os("ANDROID_SDK_ROOT").map(PathBuf::from);
    resolve_adb(
        android_home.as_deref(),
        android_sdk_root.as_deref(),
        std::env::var_os("PATH").as_deref(),
        default_sdk_dir().as_deref(),
    )
}

/// An absolute path to an existing `.apk` file. `adb install` receives it
/// as an argument (no shell), so absolute-only also rules out a leading `-`.
pub fn is_apk_path(path: &Path) -> bool {
    path.is_absolute()
        && path.is_file()
        && path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("apk"))
}

fn check_device_id(id: &str) -> Result<(), ApiError> {
    if is_valid_device_id(id) {
        Ok(())
    } else {
        Err(api_error(
            "bad_device_id",
            format!("Unsafe device id: {id}"),
        ))
    }
}

/// Starts `scrcpy -s <id>` and returns while its window stays open.
#[tauri::command]
pub async fn android_mirror(device_id: String) -> Result<(), ApiError> {
    check_device_id(&device_id)?;
    let scrcpy = resolve_scrcpy(
        std::env::var_os("PATH").as_deref(),
        local_app_data().as_deref(),
    )
    .ok_or_else(|| api_error("scrcpy_not_found", "scrcpy was not found"))?;
    let mut cmd = AsyncCommand::new(&scrcpy);
    cmd.args(["-s", &device_id]);
    // One adb for Cowbell, flutter and scrcpy: two adb versions restart
    // each other's server and drop the device.
    if let Some(adb) = resolve_adb_from_env() {
        cmd.env("ADB", adb);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    apply_no_window(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|err| api_error("scrcpy_failed", err.to_string()))?;
    match tokio::time::timeout(SCRCPY_EARLY_EXIT, child.wait()).await {
        Err(_) => Ok(()),
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(Ok(status)) => Err(api_error(
            "scrcpy_failed",
            format!("scrcpy exited ({status}). Unlock the phone and allow USB debugging"),
        )),
        Ok(Err(err)) => Err(api_error("scrcpy_failed", err.to_string())),
    }
}

/// `adb -s <id> install -r <apk>`. Returns adb's output.
#[tauri::command]
pub async fn android_install_apk(device_id: String, path: String) -> Result<String, ApiError> {
    check_device_id(&device_id)?;
    if !is_apk_path(Path::new(&path)) {
        return Err(api_error("not_an_apk", format!("Not an .apk file: {path}")));
    }
    let adb = resolve_adb_from_env().ok_or_else(|| {
        api_error(
            "adb_not_found",
            "adb was not found; install Android SDK platform-tools",
        )
    })?;
    let mut cmd = AsyncCommand::new(&adb);
    cmd.args(["-s", &device_id, "install", "-r", &path]);
    let stdout = run_capture(
        cmd,
        INSTALL_APK_TIMEOUT,
        "install_timeout",
        "install_failed",
    )
    .await?;
    Ok(stdout.trim().to_string())
}

/// Installs scrcpy with winget. Windows only; elsewhere the message names
/// the package managers.
#[tauri::command]
pub async fn install_scrcpy() -> Result<(), ApiError> {
    if !cfg!(windows) {
        return Err(api_error(
            "install_unsupported",
            "Install scrcpy with your package manager (brew install scrcpy, apt install scrcpy)",
        ));
    }
    let local = local_app_data();
    // The winget alias lives in `WindowsApps`, which a GUI process may not
    // have on its `PATH`. A missing alias fails at spawn with a clear error.
    let winget = find_tool("winget", std::env::var_os("PATH").as_deref(), None)
        .or_else(|| {
            local
                .as_ref()
                .map(|l| l.join("Microsoft").join("WindowsApps").join("winget.exe"))
        })
        .unwrap_or_else(|| PathBuf::from("winget"));
    let mut cmd = AsyncCommand::new(winget);
    cmd.args([
        "install",
        "--id",
        "Genymobile.scrcpy",
        "-e",
        "--silent",
        "--disable-interactivity",
        "--accept-package-agreements",
        "--accept-source-agreements",
    ]);
    // winget writes its errors to stdout, which `run_capture` drops.
    run_capture(
        cmd,
        INSTALL_SCRCPY_TIMEOUT,
        "install_timeout",
        "install_failed",
    )
    .await
    .map_err(|err| {
        if err.message.is_empty() {
            api_error(
                "install_failed",
                "winget failed. Run `winget install Genymobile.scrcpy` in a terminal",
            )
        } else {
            err
        }
    })?;
    if resolve_scrcpy(std::env::var_os("PATH").as_deref(), local.as_deref()).is_none() {
        return Err(api_error(
            "scrcpy_not_found",
            "scrcpy was installed but not found; restart Cowbell",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("cowbell-android-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scrcpy_is_found_on_path() {
        let dir = scratch("path");
        std::fs::write(dir.join(tool_file_name("scrcpy")), b"").unwrap();
        let path_var = std::env::join_paths([&dir]).unwrap();
        assert_eq!(
            resolve_scrcpy(Some(&path_var), None),
            Some(dir.join(tool_file_name("scrcpy")))
        );
    }

    #[test]
    fn scrcpy_is_found_in_the_winget_links_folder() {
        let local = scratch("links");
        let links = local.join("Microsoft").join("WinGet").join("Links");
        std::fs::create_dir_all(&links).unwrap();
        std::fs::write(links.join(tool_file_name("scrcpy")), b"").unwrap();
        assert_eq!(
            resolve_scrcpy(None, Some(&local)),
            Some(links.join(tool_file_name("scrcpy")))
        );
    }

    #[test]
    fn scrcpy_missing_gives_none() {
        let empty = scratch("empty");
        let path_var = std::env::join_paths([&empty]).unwrap();
        assert_eq!(resolve_scrcpy(Some(&path_var), Some(&empty)), None);
    }

    #[test]
    fn apk_path_needs_an_existing_absolute_apk_file() {
        let dir = scratch("apk");
        let apk = dir.join("App.APK");
        std::fs::write(&apk, b"").unwrap();
        let txt = dir.join("notes.txt");
        std::fs::write(&txt, b"").unwrap();
        assert!(is_apk_path(&apk));
        assert!(!is_apk_path(&txt));
        assert!(!is_apk_path(&dir.join("missing.apk")));
        assert!(!is_apk_path(Path::new("relative.apk")));
    }

    #[tokio::test]
    async fn mirror_rejects_an_unsafe_device_id() {
        let err = android_mirror("x; rm -rf".into()).await.unwrap_err();
        assert_eq!(err.code, "bad_device_id");
    }

    #[tokio::test]
    async fn install_rejects_a_non_apk_path() {
        let err = android_install_apk("RF8W3085JEW".into(), "C:\\nope.txt".into())
            .await
            .unwrap_err();
        assert_eq!(err.code, "not_an_apk");
    }
}
