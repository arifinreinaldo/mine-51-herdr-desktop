// Frontend bootstrap (spec phase1.5). Wires the theme system, layout
// shell (title bar/menus/sidebar/tab strip/status bar/popovers), the
// terminal renderer, and settings/notifications -- each a separate module
// (spec: "main.ts must not grow into a god file"; finding #16 moved the
// orchestration those modules perform out of here, leaving this file the
// startup sequence and the event listeners that fan out to them).

import "./style.css";
import { listen } from "@tauri-apps/api/event";

import { invokeSafe, showErrorNotice } from "./appApi";
import {
  bannerEl,
  canvas,
  keyboardCapture,
  perfHudEl,
  sidebarEl,
  statusUsageEl,
  terminalWrapEl,
  titlebarCenterEl,
  winCloseEl,
  winMaximizeEl,
  winMinimizeEl,
} from "./appDom";
import { applyCurrentTheme, currentThemeDef, rendererThemeFrom } from "./appLookups";
import {
  onPasteOverride,
  onShortcut,
  onTerminalKey,
  refreshMenuBarContext,
  wireMenuBarNow,
  wirePerfHudToggle,
} from "./appMenuBar";
import { appState, doneDetector } from "./appState";
import { renderSidebarNow } from "./appSidebarPanel";
import { applySidebarVisibility, applySidebarWidth, wireNewWorkspaceControls, wireSidebarResize } from "./appSidebarResize";
import { renderStatusBarNow, renderUsageBarNow, wireUsageRefresh } from "./appStatusBar";
import { renderTabsNow, wireTabStripControls } from "./appTabStrip";
import { subscribeSurface, wireInputHandlers, wireResizeObserver } from "./appTerminalInput";
import type { RawSnapshot, UsageEventPayload } from "./appTypes";
import { handleDoneTransitions, toDetectionAgents } from "./appDoneNotifications";
import { refreshImportedThemes } from "./appWorkspaceFlows";
import { hasTabUiFocus, installKeyboardRouting } from "./keyboard/routing";
import type { Settings } from "./settings";
import { TAB_RENDER_GUARD_REGION } from "./ui/tabs";
import { onRenderGuardReleased } from "./ui/renderGuard";
import { SIDEBAR_RENDER_GUARD_REGION } from "./ui/sidebar";
import { TerminalRenderer } from "./render/renderer";
import { formatTitlebarCenter, wireTitlebarControls } from "./ui/titlebar";

function paintChromeSkeleton(): void {
  sidebarEl.textContent = "";
  statusUsageEl.textContent = "Claude usage: waiting for a Claude Code session";
}

function reportReadyAfterTwoFrames(startedAt: number): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ms = performance.now() - startedAt;
      void invokeSafe("report_ready", { ms });
    });
  });
}

async function wireEvents(): Promise<void> {
  await listen<RawSnapshot>("snapshot", (event) => {
    const previousBootId = appState.snapshot?.boot_id;
    appState.snapshot = event.payload;
    // Finding #11: "the next snapshot is authoritative" -- any new
    // snapshot, whether or not it is the one confirming a pending
    // `tab.move`, ends the optimistic reorder window.
    appState.optimisticTabOrder = null;
    if (previousBootId !== undefined && previousBootId !== appState.snapshot.boot_id) {
      doneDetector.resetBaseline();
    } else {
      handleDoneTransitions(doneDetector.diff(toDetectionAgents()));
    }
    renderSidebarNow();
    renderTabsNow();
    renderStatusBarNow();
    refreshMenuBarContext();
    titlebarCenterEl.textContent = formatTitlebarCenter(
      appState.snapshot.tabs.find((t) => t.focused)?.label ?? null,
      appState.snapshot.workspaces.find((w) => w.focused)?.label ?? null,
    );
  });
  await listen<UsageEventPayload>("usage", (event) => {
    appState.usagePayload = event.payload;
    renderUsageBarNow();
  });
  await listen<{ status: string; socketPath: string; serverVersion: string | null }>("connection-status", (event) => {
    appState.lastConnectionStatus = event.payload.status;
    if (event.payload.serverVersion) appState.serverVersion = event.payload.serverVersion;
    if (appState.lastConnectionStatus !== "connected") {
      doneDetector.resetBaseline();
    }
    if (appState.lastConnectionStatus === "unavailable" || appState.lastConnectionStatus === "disconnected") {
      bannerEl.hidden = false;
      bannerEl.textContent = `herdr server not reachable at ${event.payload.socketPath} — retrying`;
    } else {
      bannerEl.hidden = true;
      bannerEl.textContent = "";
    }
    renderStatusBarNow();
  });
}

async function main(): Promise<void> {
  const startedAt = performance.now();
  paintChromeSkeleton();

  // Startup order (spec §9.4): settings_get -> apply the theme -> sync_state
  // -> report_ready. The window stays `visible: false` until report_ready.
  const settingsResponse = await invokeSafe<{ settings: Settings; corrupted: boolean }>("settings_get");
  if (settingsResponse) {
    appState.settings = settingsResponse.settings;
    if (settingsResponse.corrupted) showErrorNotice("settings.json was invalid; defaults restored");
  }
  await refreshImportedThemes();
  applySidebarWidth(appState.settings.sidebarWidth);
  applySidebarVisibility();

  appState.renderer = new TerminalRenderer(
    canvas,
    terminalWrapEl,
    rendererThemeFrom(currentThemeDef().colors),
    (cols, rows, cellW, cellH) => {
      void invokeSafe("resize", { cols, rows, cellW, cellH });
    },
    undefined,
    (stats) => {
      perfHudEl.textContent =
        `decode ${stats.decodeMs.toFixed(2)}ms · paint ${stats.paintMs.toFixed(2)}ms · ` +
        `rust ${stats.rustUs.toFixed(0)}us · ${stats.fps} fps · ${stats.dirtyRows} dirty rows`;
    },
  );
  appState.renderer.setFontSize(appState.settings.fontSize);
  applyCurrentTheme();

  onRenderGuardReleased(TAB_RENDER_GUARD_REGION, () => renderTabsNow());
  onRenderGuardReleased(SIDEBAR_RENDER_GUARD_REGION, () => renderSidebarNow());
  wireInputHandlers();
  wireResizeObserver();
  wireSidebarResize();
  wireNewWorkspaceControls();
  wireTabStripControls();
  wireUsageRefresh();
  wireTitlebarControls(winMinimizeEl, winMaximizeEl, winCloseEl);
  wireMenuBarNow();
  wirePerfHudToggle();
  installKeyboardRouting(keyboardCapture, { onShortcut, onTerminalKey, onPasteOverride });
  window.addEventListener("focus", () => {
    appState.windowFocused = true;
  });
  window.addEventListener("blur", () => {
    appState.windowFocused = false;
  });

  await wireEvents();
  await subscribeSurface();
  // Finding #8: reset right before the `sync_state` replay too, not just
  // on a boot_id change or a disconnect -- a no-op today (the detector's
  // baseline already starts `null`), but it is the third of the spec's
  // three reset points and must stay correct if `sync_state` is ever
  // called again later (e.g. from a future reconnect path).
  doneDetector.resetBaseline();
  await invokeSafe("sync_state");
  reportReadyAfterTwoFrames(startedAt);
}

void main();

// Re-exported for tests that want to assert routing without a full DOM
// bootstrap (kept minimal; most logic already lives in tested modules).
export { hasTabUiFocus };
