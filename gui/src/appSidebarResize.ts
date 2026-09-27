// Sidebar sash drag-resize and Ctrl+Shift+B visibility toggle support
// (finding #16 extraction from `main.ts`).

import { mainEl, sidebarFooterEl, sidebarNewWorkspaceBtn, sidebarResizeHandleEl } from "./appDom";
import { requireConnected } from "./appConnectionGuard";
import { appState, persistSettings } from "./appState";
import { newWorkspaceFlow } from "./appWorkspaceFlows";

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 400;

export function applySidebarWidth(width: number): void {
  appState.sidebarWidth = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
  document.documentElement.style.setProperty("--sidebar-width", `${appState.sidebarWidth}px`);
}

export function applySidebarVisibility(): void {
  mainEl.classList.toggle("sidebar-hidden", !appState.settings.sidebarVisible);
}

export function wireSidebarResize(): void {
  let dragging = false;
  sidebarResizeHandleEl.addEventListener("pointerdown", (event) => {
    dragging = true;
    sidebarResizeHandleEl.classList.add("is-active");
    sidebarResizeHandleEl.setPointerCapture(event.pointerId);
  });
  sidebarResizeHandleEl.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    applySidebarWidth(event.clientX);
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    sidebarResizeHandleEl.classList.remove("is-active");
    appState.settings.sidebarWidth = appState.sidebarWidth;
    persistSettings();
  };
  sidebarResizeHandleEl.addEventListener("pointerup", stop);
  sidebarResizeHandleEl.addEventListener("pointercancel", stop);
}

export function wireNewWorkspaceControls(): void {
  // MINOR guard (finding #6): "New Workspace" starts with a
  // `pick_workspace_folder`/`workspace.create` round trip -- must not fire
  // while herdr is not connected, same as every other sidebar/tab-strip
  // click (spec §4 "not interactive ... A click shows the notice").
  sidebarNewWorkspaceBtn.addEventListener("click", () => {
    if (!requireConnected()) return;
    void newWorkspaceFlow();
  });
  sidebarFooterEl.addEventListener("click", () => {
    if (!requireConnected()) return;
    void newWorkspaceFlow();
  });
  sidebarFooterEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (!requireConnected()) return;
    void newWorkspaceFlow();
  });
}
