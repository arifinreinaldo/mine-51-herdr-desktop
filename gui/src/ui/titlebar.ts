// Custom title bar window controls (spec phase1.5 §3 "Window"): "Window
// controls are 46x30 px. They call Rust commands (`window_minimize`,
// `window_toggle_maximize`, `window_close`), not `core:window` JS
// permissions."

import { invoke } from "@tauri-apps/api/core";

export function wireTitlebarControls(
  minimizeBtn: HTMLElement,
  maximizeBtn: HTMLElement,
  closeBtn: HTMLElement,
): void {
  minimizeBtn.addEventListener("click", () => {
    void invoke("window_minimize");
  });
  maximizeBtn.addEventListener("click", () => {
    void invoke("window_toggle_maximize");
  });
  closeBtn.addEventListener("click", () => {
    void invoke("window_close");
  });
}

/** `<title> — <workspace>` centre text (e.g. "camera — flutter_rad_pvmi"),
 * from the focused tab/workspace labels. "Cowbell" only when both are empty. */
export function formatTitlebarCenter(tabLabel: string | null, workspaceLabel: string | null): string {
  const parts = [tabLabel, workspaceLabel].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" — ") : "Cowbell";
}
