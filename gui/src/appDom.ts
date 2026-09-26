// Every chrome DOM element `main.ts` and its orchestration modules touch,
// looked up once. Extracted (finding #16, "move orchestration out of
// main.ts into modules") purely so every other module can share these
// references instead of each re-querying `document.getElementById`.

export const overlayRoot = document.getElementById("overlay-root") as HTMLDivElement;
export const bannerEl = document.getElementById("banner") as HTMLDivElement;
export const mainEl = document.getElementById("main") as HTMLDivElement;
export const sidebarEl = document.getElementById("sidebar-list") as HTMLDivElement;
export const sidebarNewWorkspaceBtn = document.getElementById("sidebar-new-workspace-btn") as HTMLButtonElement;
export const sidebarFooterEl = document.getElementById("sidebar-footer") as HTMLDivElement;
export const sidebarResizeHandleEl = document.getElementById("sidebar-resize-handle") as HTMLDivElement;
export const tabListEl = document.getElementById("tab-list") as HTMLDivElement;
export const tabPlusEl = document.getElementById("tab-plus") as HTMLDivElement;
export const tabOverflowEl = document.getElementById("tab-overflow") as HTMLDivElement;
export const canvas = document.getElementById("terminal") as HTMLCanvasElement;
export const terminalWrapEl = document.getElementById("terminal-wrap") as HTMLDivElement;
export const keyboardCapture = document.getElementById("keyboard-capture") as HTMLTextAreaElement;
export const perfHudEl = document.getElementById("perf-hud") as HTMLDivElement;
export const errorNoticesEl = document.getElementById("error-notices") as HTMLDivElement;
export const statusAgentCountsEl = document.getElementById("status-agent-counts") as HTMLDivElement;
export const statusConnectionEl = document.getElementById("status-connection") as HTMLDivElement;
export const statusUsageEl = document.getElementById("status-usage") as HTMLDivElement;
export const titlebarCenterEl = document.getElementById("titlebar-center") as HTMLDivElement;
export const herdrMenuDotEl = document.getElementById("herdr-menu-dot") as HTMLElement;
export const winMinimizeEl = document.getElementById("win-minimize") as HTMLButtonElement;
export const winMaximizeEl = document.getElementById("win-maximize") as HTMLButtonElement;
export const winCloseEl = document.getElementById("win-close") as HTMLButtonElement;
export const menuTitleEls = Array.from(document.querySelectorAll<HTMLElement>(".menu-title"));
