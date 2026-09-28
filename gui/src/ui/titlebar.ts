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

/** `<title> — <workspace> — Cowbell` style centre text (mock: "camera —
 * flutter_rad_pvmi — Cowbell"), from the focused tab/workspace labels. */
export function formatTitlebarCenter(tabLabel: string | null, workspaceLabel: string | null): string {
  const parts = [tabLabel, workspaceLabel, "Cowbell"].filter((p): p is string => Boolean(p));
  return parts.join(" — ");
}
