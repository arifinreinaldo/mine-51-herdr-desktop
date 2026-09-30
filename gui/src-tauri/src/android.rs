//! Android mirror and APK install: `scrcpy` for the mirror window, `adb
//! install` for dropped APKs, and a `winget` install of scrcpy when it is
//! missing. scrcpy is not bundled; it runs as its own native window. Also
//! the screenshot capture (`adb exec-out screencap`) with copy and save.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::process::Command as AsyncCommand;

use crate::commands::ApiError;
use crate::engine::apply_no_window;
use crate::flutter::{
    api_error, default_sdk_dir, is_valid_device_id, resolve_adb, run_capture, tool_file_name,
};
use crate::mirror_tools;

/// scrcpy that dies inside this window (no device, unauthorized) is a
/// failure to report; one still alive after it is the mirror window.
const SCRCPY_EARLY_EXIT: Duration = Duration::from_millis(1500);
const INSTALL_APK_TIMEOUT: Duration = Duration::from_secs(120);
const INSTALL_SCRCPY_TIMEOUT: Duration = Duration::from_secs(300);
const SCREENSHOT_TIMEOUT: Duration = Duration::from_secs(15);
const SCREENSHOT_MAX_BYTES: usize = 32 * 1024 * 1024;
const STDERR_MAX_CHARS: usize = 2000;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

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

/// Spawns scrcpy and waits out the early-exit window. `Ok(None)`: scrcpy
/// exited cleanly inside it (the user closed it at once).
async fn start_scrcpy(device_id: &str) -> Result<Option<tokio::process::Child>, ApiError> {
    check_device_id(device_id)?;
    let scrcpy = resolve_scrcpy(
        std::env::var_os("PATH").as_deref(),
        local_app_data().as_deref(),
    )
    .ok_or_else(|| api_error("scrcpy_not_found", "scrcpy was not found"))?;
    let mut cmd = AsyncCommand::new(&scrcpy);
    cmd.args(["-s", device_id]);
    // The mirror tools window finds the scrcpy window by this title.
    cmd.args([
        "--window-title",
        &mirror_tools::scrcpy_window_title(device_id),
    ]);
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
        Err(_) => Ok(Some(child)),
        Ok(Ok(status)) if status.success() => Ok(None),
        Ok(Ok(status)) => Err(api_error(
            "scrcpy_failed",
            format!("scrcpy exited ({status}). Unlock the phone and allow USB debugging"),
        )),
        Ok(Err(err)) => Err(api_error("scrcpy_failed", err.to_string())),
    }
}

/// Starts `scrcpy -s <id>` and returns while its window stays open. The
/// mirror tools window (`mirror_tools::run`) then follows that window.
#[tauri::command]
pub async fn android_mirror(
    app: tauri::AppHandle,
    device_id: String,
    device_name: Option<String>,
) -> Result<(), ApiError> {
    if let Some(child) = start_scrcpy(&device_id).await? {
        let name =
            mirror_tools::sanitize_device_name(device_name.as_deref().unwrap_or(""), &device_id);
        tauri::async_runtime::spawn(mirror_tools::run(app, child, device_id, name));
    }
    Ok(())
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

// ---------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------

/// The latest screenshot PNG. Rust holds it so the frontend never sends the
/// bytes back through IPC.
// ponytail: one slot, cleared on next capture
///
/// Each capture takes a ticket when it starts. A slow capture that finishes
/// after a newer one must not overwrite it, or Copy and Save would use an
/// older image than the one on screen.
#[derive(Default)]
pub struct ScreenshotSlot(std::sync::Mutex<Option<(u64, Vec<u8>)>>);

static NEXT_TICKET: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Stores `png` unless a newer capture (higher ticket) is already there.
fn store_if_newer(slot: &ScreenshotSlot, ticket: u64, png: Vec<u8>) {
    let mut guard = slot.0.lock().unwrap_or_else(|e| e.into_inner());
    if guard.as_ref().is_none_or(|(held, _)| ticket > *held) {
        *guard = Some((ticket, png));
    }
}

/// Bytes from the first PNG signature onward, or `None`. `screencap` on a
/// phone with several displays prints a text warning to stdout before the
/// PNG, so a check at byte 0 is not enough.
pub fn strip_to_png(data: &[u8]) -> Option<&[u8]> {
    data.windows(PNG_SIGNATURE.len())
        .position(|w| w == PNG_SIGNATURE)
        .map(|i| &data[i..])
}

/// A safe file name: only `[A-Za-z0-9._-]`, ending in `.png` (any case).
/// Anything else gives `screenshot.png`.
pub fn sanitize_file_name(name: &str) -> String {
    let ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && name.len() > ".png".len()
        && name[name.len() - 4..].eq_ignore_ascii_case(".png");
    if ok {
        name.to_string()
    } else {
        "screenshot.png".to_string()
    }
}

/// Decodes a PNG to `(width, height, RGBA8 bytes)`.
pub fn decode_png_rgba(data: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = png::Decoder::new(data);
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(info.buffer_size());
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        _ => return Err("unsupported PNG colour type".to_string()),
    };
    Ok((info.width, info.height, rgba))
}

/// Clones the slot's bytes out of the lock. Empty gives `no_screenshot`.
fn take_slot(slot: &ScreenshotSlot) -> Result<Vec<u8>, ApiError> {
    slot.0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|(_, png)| png.clone())
        .ok_or_else(|| api_error("no_screenshot", "No screenshot to use"))
}

/// Like `flutter::run_capture`, but stdout stays raw bytes: a lossy UTF-8
/// conversion would destroy a PNG.
async fn run_capture_bytes(mut cmd: AsyncCommand, timeout: Duration) -> Result<Vec<u8>, ApiError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_no_window(&mut cmd);
    let child = cmd
        .spawn()
        .map_err(|err| api_error("screenshot_failed", err.to_string()))?;
    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(result) => result.map_err(|err| api_error("screenshot_failed", err.to_string()))?,
        Err(_) => {
            return Err(api_error(
                "screenshot_timeout",
                format!("timed out after {}s", timeout.as_secs()),
            ))
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message: String = stderr.chars().take(STDERR_MAX_CHARS).collect();
        let message = if message.trim().is_empty() {
            format!("adb exited with {}", output.status)
        } else {
            message
        };
        return Err(api_error("screenshot_failed", message));
    }
    if output.stdout.len() > SCREENSHOT_MAX_BYTES {
        return Err(api_error("screenshot_failed", "screenshot too large"));
    }
    Ok(output.stdout)
}

/// `adb -s <id> exec-out screencap -p`. `exec-out`, not `shell`: `shell`
/// can turn `\n` into `\r\n` and corrupt the PNG. Returns the raw PNG bytes.
#[tauri::command]
pub async fn android_screenshot(
    device_id: String,
    slot: State<'_, ScreenshotSlot>,
) -> Result<tauri::ipc::Response, ApiError> {
    check_device_id(&device_id)?;
    let ticket = NEXT_TICKET.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let adb = resolve_adb_from_env().ok_or_else(|| {
        api_error(
            "adb_not_found",
            "adb was not found; install Android SDK platform-tools",
        )
    })?;
    let mut cmd = AsyncCommand::new(&adb);
    cmd.args(["-s", &device_id, "exec-out", "screencap", "-p"]);
    let stdout = run_capture_bytes(cmd, SCREENSHOT_TIMEOUT).await?;
    let png = strip_to_png(&stdout)
        .ok_or_else(|| api_error("not_a_png", "The device returned no image"))?
        .to_vec();
    store_if_newer(&slot, ticket, png.clone());
    Ok(tauri::ipc::Response::new(png))
}

/// Puts the latest screenshot on the OS clipboard, full resolution.
#[tauri::command]
pub async fn screenshot_copy(slot: State<'_, ScreenshotSlot>) -> Result<(), ApiError> {
    let png = take_slot(&slot)?;
    tokio::task::spawn_blocking(move || {
        let (width, height, rgba) = decode_png_rgba(&png)?;
        crate::clipboard::write_clipboard_image_rgba(width, height, rgba)
    })
    .await
    .map_err(|err| api_error("copy_failed", err.to_string()))?
    .map_err(|err| api_error("copy_failed", err))
}

/// Save dialog for the latest screenshot. `Ok(None)` when the user cancels.
#[tauri::command]
pub async fn screenshot_save(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    slot: State<'_, ScreenshotSlot>,
    suggested_name: String,
) -> Result<Option<String>, ApiError> {
    let png = take_slot(&slot)?;
    let name = sanitize_file_name(&suggested_name);
    let start_dir = app
        .path()
        .picture_dir()
        .ok()
        .map(|p| p.join("Cowbell"))
        .filter(|p| std::fs::create_dir_all(p).is_ok());
    let mut dialog = app
        .dialog()
        .file()
        // Owned by the calling window: the mirror tools window stays visible
        // behind its own Save dialog (`Foreground::ToolsOwned`).
        .set_parent(&window)
        .set_file_name(name)
        .add_filter("PNG image", &["png"]);
    if let Some(dir) = start_dir {
        dialog = dialog.set_directory(dir);
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let mut path = chosen
        .into_path()
        .map_err(|err| api_error("save_failed", err.to_string()))?;
    if !path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("png"))
    {
        let mut os = path.into_os_string();
        os.push(".png");
        path = PathBuf::from(os);
    }
    std::fs::write(&path, png).map_err(|err| api_error("save_failed", err.to_string()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
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
        let err = start_scrcpy("x; rm -rf").await.unwrap_err();
        assert_eq!(err.code, "bad_device_id");
    }

    #[tokio::test]
    async fn install_rejects_a_non_apk_path() {
        let err = android_install_apk("RF8W3085JEW".into(), "C:\\nope.txt".into())
            .await
            .unwrap_err();
        assert_eq!(err.code, "not_an_apk");
    }

    #[test]
    fn strip_to_png_keeps_a_png_at_offset_zero() {
        let mut data = PNG_SIGNATURE.to_vec();
        data.extend_from_slice(b"rest");
        assert_eq!(strip_to_png(&data), Some(&data[..]));
    }

    #[test]
    fn strip_to_png_skips_a_text_prefix() {
        let mut data = b"[Warning] Multiple displays were found\n".to_vec();
        let start = data.len();
        data.extend_from_slice(&PNG_SIGNATURE);
        data.extend_from_slice(b"rest");
        assert_eq!(strip_to_png(&data), Some(&data[start..]));
    }

    #[test]
    fn strip_to_png_without_a_signature_is_none() {
        assert_eq!(strip_to_png(b"error: device offline"), None);
        assert_eq!(strip_to_png(&PNG_SIGNATURE[..5]), None);
        assert_eq!(strip_to_png(b""), None);
    }

    #[test]
    fn sanitize_file_name_accepts_the_default_name() {
        assert_eq!(
            sanitize_file_name("screenshot-20260930-143207.png"),
            "screenshot-20260930-143207.png"
        );
        assert_eq!(sanitize_file_name("Shot.PNG"), "Shot.PNG");
    }

    #[test]
    fn sanitize_file_name_rejects_paths_and_other_extensions() {
        for bad in ["..\\evil.png", "a/b.png", "x.txt", "", ".png", "a b.png"] {
            assert_eq!(sanitize_file_name(bad), "screenshot.png", "{bad:?}");
        }
    }

    fn encode_png(color: png::ColorType, data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, 2, 2);
        encoder.set_color(color);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(data).unwrap();
        writer.finish().unwrap();
        out
    }

    #[test]
    fn decode_png_rgba_copies_an_rgba_image() {
        let pixels: Vec<u8> = (0..16).collect();
        let png = encode_png(png::ColorType::Rgba, &pixels);
        assert_eq!(decode_png_rgba(&png), Ok((2, 2, pixels)));
    }

    #[test]
    fn decode_png_rgba_adds_alpha_to_an_rgb_image() {
        let png = encode_png(
            png::ColorType::Rgb,
            &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        );
        let (w, h, rgba) = decode_png_rgba(&png).unwrap();
        assert_eq!((w, h), (2, 2));
        assert_eq!(
            rgba,
            [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]
        );
    }

    #[test]
    fn decode_png_rgba_rejects_garbage() {
        assert!(decode_png_rgba(b"not a png at all").is_err());
    }

    #[test]
    fn take_slot_on_an_empty_slot_is_no_screenshot() {
        let err = take_slot(&ScreenshotSlot::default()).unwrap_err();
        assert_eq!(err.code, "no_screenshot");
    }

    #[test]
    fn take_slot_returns_a_copy_and_keeps_the_slot() {
        let slot = ScreenshotSlot(std::sync::Mutex::new(Some((1, vec![1, 2, 3]))));
        assert_eq!(take_slot(&slot).unwrap(), vec![1, 2, 3]);
        assert_eq!(take_slot(&slot).unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn a_slow_older_capture_does_not_overwrite_a_newer_one() {
        let slot = ScreenshotSlot::default();
        store_if_newer(&slot, 2, vec![2]);
        store_if_newer(&slot, 1, vec![1]);
        assert_eq!(take_slot(&slot).unwrap(), vec![2]);
        store_if_newer(&slot, 3, vec![3]);
        assert_eq!(take_slot(&slot).unwrap(), vec![3]);
    }
}
