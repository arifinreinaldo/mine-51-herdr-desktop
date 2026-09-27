//! WebView2 memory-usage target (Phase 1.6 spec §6.1): dropped to `LOW`
//! while the window is minimized, back to `NORMAL` on restore. Windows
//! only; a no-op everywhere else.
//!
//! There is no dedicated `WindowEvent::Minimized` (Tauri's `WindowEvent`
//! enum has none): minimizing fires `Resized`, so that's where
//! `is_minimized()` is checked, matching Tauri's own documented pattern
//! for detecting it.

#[cfg(windows)]
pub fn wire_memory_target(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;

    let window_for_events = window.clone();
    window.on_window_event(move |event| {
        let tauri::WindowEvent::Resized(_) = event else {
            return;
        };
        let minimized = window_for_events.is_minimized().unwrap_or(false);
        let level = if minimized {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        let result = window_for_events.with_webview(move |webview| {
            let set: windows::core::Result<()> = (|| {
                let controller = webview.controller();
                // SAFETY: `controller` is a live COM pointer owned by the
                // webview for as long as the window exists; both calls are
                // plain out-parameter COM invocations with no aliasing.
                let core = unsafe { controller.CoreWebView2()? };
                let core19 = core.cast::<ICoreWebView2_19>()?;
                unsafe { core19.SetMemoryUsageTargetLevel(level) }
            })();
            if let Err(err) = set {
                tracing::warn!("SetMemoryUsageTargetLevel failed: {err}");
            }
        });
        if let Err(err) = result {
            tracing::warn!("with_webview failed while setting the memory target: {err}");
        }
    });
}

#[cfg(not(windows))]
pub fn wire_memory_target(_window: &tauri::WebviewWindow) {}
