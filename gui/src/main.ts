// Frontend bootstrap (spec phase1.5). Wires the theme system, layout
// shell (title bar/menus/sidebar/tab strip/status bar/popovers), the
// terminal renderer, and settings/notifications -- each a separate module
// (spec: "main.ts must not grow into a god file"; finding #16 moved the
// orchestration those modules perform out of here, leaving this file the
// startup sequence and the event listeners that fan out to them).

import "./style.css";
import { listen } from "@tauri-apps/api/event";

import { invokeSafe, showErrorNotice } from "./appApi";
import { renderConnectionBanner } from "./appConnectionBanner";
import {
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
import { appState, doneDetector, statusAge, tabMru } from "./appState";
import { renderSidebarNow } from "./appSidebarPanel";
import { applySidebarVisibility, applySidebarWidth, wireNewWorkspaceControls, wireSidebarResize } from "./appSidebarResize";
import {
  openOrRefreshAgentPopover,
  refreshAgentPopoverIfOpen,
  renderStatusBarNow,
  renderUsageBarNow,
  wireUsageRefresh,
} from "./appStatusBar";
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

// UX pass 1 spec §2 refresh (finding #2): ages ("12m", "3h", ...) go stale
// between snapshots -- a workspace or agent that's been blocked for an
// hour with no new snapshot would otherwise still read "blocked 1m" from
// whenever that snapshot happened to arrive. Every 30s, re-render the
// sidebar/tab strip (both recompute ages fresh off the wall clock) and
// refresh the open agent popover in place (never disposes/reopens it, so
// it never steals focus -- see `refreshAgentPopoverIfOpen`).
const AGE_REFRESH_INTERVAL_MS = 30_000;
function wireAgeRefresh(): void {
  window.setInterval(() => {
    renderSidebarNow();
    renderTabsNow();
    refreshAgentPopoverIfOpen();
  }, AGE_REFRESH_INTERVAL_MS);
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
    const isFirstSnapshot = appState.snapshot === null;
    appState.snapshot = event.payload;
    appState.lastSnapshotAt = Date.now();
    // Keyboard shortcut Alt+`: feed the MRU tracker from every snapshot's
    // focused tab, across all workspaces (not just the current one).
    tabMru.record(appState.snapshot.focused_tab_id);
    // Finding #11: "the next snapshot is authoritative" -- any new
    // snapshot, whether or not it is the one confirming a pending
    // `tab.move`, ends the optimistic reorder window.
    appState.optimisticTabOrder = null;
    if (previousBootId !== undefined && previousBootId !== appState.snapshot.boot_id) {
      doneDetector.resetBaseline();
      statusAge.reset();
    } else {
      handleDoneTransitions(doneDetector.diff(toDetectionAgents()));
    }
    statusAge.update(toDetectionAgents(), appState.lastSnapshotAt);
    renderSidebarNow();
    renderTabsNow();
    renderStatusBarNow();
    // UX pass 1 spec §2 refresh (finding #2): keep the open agent
    // popover's rows/ages in sync with each snapshot too, not just the
    // 30s tick below -- without this, a pinned list could show a status
    // that changed several snapshots ago.
    refreshAgentPopoverIfOpen();
    refreshMenuBarContext();
    titlebarCenterEl.textContent = formatTitlebarCenter(
      appState.snapshot.tabs.find((t) => t.focused)?.label ?? null,
      appState.snapshot.workspaces.find((w) => w.focused)?.label ?? null,
    );
    // UX pass 1 spec §3 "the list reopens pinned at startup": deferred to
    // the first real snapshot (rather than true `main()` start) so it has
    // actual agent rows to show, not an empty popover.
    if (isFirstSnapshot && appState.settings.agentListPinned) openOrRefreshAgentPopover(false);
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
      statusAge.reset();
    }
    // Spec §4: the terminal canvas dims alongside the status-bar counts
    // (handled by `renderStatusBarNow` below) while not connected.
    canvas.classList.toggle("is-disconnected", appState.lastConnectionStatus !== "connected");
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
  wireAgeRefresh();
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
  statusAge.reset();
  await invokeSafe("sync_state");
  reportReadyAfterTwoFrames(startedAt);
}

void main();

// Re-exported for tests that want to assert routing without a full DOM
// bootstrap (kept minimal; most logic already lives in tested modules).
export { hasTabUiFocus };
