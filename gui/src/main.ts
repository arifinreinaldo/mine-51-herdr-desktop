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
  initAutostartState,
  onPasteOverride,
  onShortcut,
  onTerminalKey,
  refreshMenuBarContext,
  wireMenuBarNow,
  wirePerfHudToggle,
} from "./appMenuBar";
import { appState, doneDetector, tabMru } from "./appState";
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
import { decideConnectionBanner, type EngineKind } from "./connectionBanner";
import { openSetupWizard } from "./wizard/wizard";

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

let startHerdrBtnBusy = false;
let bannerRenderGeneration = 0;

interface EngineStatusWireForBanner {
  kind: EngineKind;
}

/** Paints one `BannerDecision` (spec addendum §11.3) into `bannerEl`: the
 * "checking"/"engine missing" states show no button or [Open Setup]; the
 * "server down, engine found" state keeps the existing [Start herdr]
 * (finding #4 "no 'Start herdr' button"). The Start button invokes
 * `engine_force_start_server` (bypasses the once-per-launch auto-start
 * guard, since this is an explicit user click, spec §3.3), is disabled
 * while a click is in flight, and reports its result through the existing
 * transient error-notice mechanism (there is no other notice channel). */
function paintConnectionBanner(decision: ReturnType<typeof decideConnectionBanner>): void {
  bannerEl.innerHTML = "";
  bannerEl.hidden = !decision.visible;
  if (!decision.visible) return;

  const text = document.createElement("span");
  text.className = "connection-banner__text";
  text.textContent = decision.message;
  bannerEl.appendChild(text);

  if (decision.action === "open_setup") {
    const openSetupBtn = document.createElement("button");
    openSetupBtn.className = "btn connection-banner__start-btn";
    openSetupBtn.textContent = "Open Setup";
    openSetupBtn.addEventListener("click", () => openSetupWizard());
    bannerEl.appendChild(openSetupBtn);
    return;
  }

  if (decision.action !== "start_herdr") return;

  const startBtn = document.createElement("button");
  startBtn.className = "btn connection-banner__start-btn";
  startBtn.textContent = "Start herdr";
  startBtn.disabled = startHerdrBtnBusy;
  startBtn.addEventListener("click", () => {
    void (async () => {
      startHerdrBtnBusy = true;
      startBtn.disabled = true;
      startBtn.textContent = "Starting…";
      const started = await invokeSafe<boolean>("engine_force_start_server");
      startHerdrBtnBusy = false;
      showErrorNotice(started ? "herdr server started." : "Could not start the herdr server.");
      startBtn.disabled = false;
      startBtn.textContent = "Start herdr";
    })();
  });
  bannerEl.appendChild(startBtn);
}

/** The disconnected banner (spec addendum §11.3): rebuilt on every
 * `connection-status` event. The engine status needs its own async round
 * trip (`engine_status`), so this paints immediately from the "unknown"
 * state, then repaints once the probe resolves; a generation counter drops
 * a stale resolve from a since-superseded event (e.g. the server
 * reconnected while the probe was still in flight). */
function renderConnectionBanner(status: string, socketPath: string): void {
  const generation = ++bannerRenderGeneration;
  paintConnectionBanner(decideConnectionBanner(status, null, socketPath));
  if (status !== "unavailable" && status !== "disconnected") return;
  void (async () => {
    const engineStatus = await invokeSafe<EngineStatusWireForBanner>("engine_status");
    if (generation !== bannerRenderGeneration) return;
    paintConnectionBanner(decideConnectionBanner(status, engineStatus?.kind ?? "missing", socketPath));
  })();
}

async function wireEvents(): Promise<void> {
  await listen<RawSnapshot>("snapshot", (event) => {
    const previousBootId = appState.snapshot?.boot_id;
    appState.snapshot = event.payload;
    // Keyboard shortcut Alt+`: feed the MRU tracker from every snapshot's
    // focused tab, across all workspaces (not just the current one).
    tabMru.record(appState.snapshot.focused_tab_id);
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
    renderConnectionBanner(appState.lastConnectionStatus, event.payload.socketPath);
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
  // Phase 1.6 spec §6.2 "No painting while minimized": WebView2 reports a
  // minimized window as `document.hidden` (Chromium's own Page Visibility
  // behavior), so this one listener covers both "minimized" and "hidden".
  document.addEventListener("visibilitychange", () => {
    appState.renderer?.setPaused(document.hidden);
  });

  await wireEvents();
  await subscribeSurface();
  void initAutostartState();
  // Phase 1.6 addendum §11 item 2: no first-run auto-open. The Setup wizard
  // opens only from herdr menu ▸ Setup… (`openSetupWizard`).
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
