// The menu bar's declarative action table (`MenuBarContext`), the
// keyboard-shortcut dispatch table that mirrors it, and the handful of
// chrome actions (F2 rename, the perf HUD toggle) that don't cleanly
// belong to any other extracted module (finding #16 extraction from
// `main.ts`).

import { api, invokeSafe } from "./appApi";
import { herdrMenuDotEl, menuTitleEls, overlayRoot, perfHudEl, tabListEl } from "./appDom";
import {
  activeTabIndex,
  applyCurrentTheme,
  focusedPaneId,
  focusedWorkspaceTabs,
  neighbourWorkspaceId,
} from "./appLookups";
import { applySidebarVisibility } from "./appSidebarResize";
import { appState, persistSettings } from "./appState";
import { focusAgentSequence, openOrRefreshAgentPopover } from "./appStatusBar";
import { sendKeyEvent, sendPaste } from "./appTerminalInput";
import { importThemeFlow, newWorkspaceFlow } from "./appWorkspaceFlows";
import { DEFAULT_FONT_SIZE_PX } from "./render/renderer";
import type { AgentSort } from "./settings";
import { SHORTCUTS, type ShortcutAction } from "./shortcuts";
import { BUILT_IN_THEMES } from "./themes/index";
import { openModal } from "./ui/modal";
import { wireMenuBar, type MenuBarContext } from "./ui/menus";
import { closeActiveOverlay } from "./ui/overlay";
import { openSetupWizard } from "./wizard/wizard";
import { startTabInlineRename, type TabRow } from "./ui/tabs";
import {
  canMoveLeft,
  canMoveRight,
  moveLeftInsertIndex,
  moveRightInsertIndex,
} from "./workspace/tabMove";

// Phase 1.6 §3.3 "herdr menu ▸ Start at Login": cached here (not in
// `appState.settings`) because it's not a GUI setting -- it's read from
// the OS (HKCU Run via `tauri-plugin-autostart`), so it must be re-fetched
// rather than persisted/defaulted like the rest of `menuBarContext`.
let autostartEnabled = false;

/** Fetches the current autostart registration once at startup, so the
 * menu's checkmark reflects reality on the very first open. */
export async function initAutostartState(): Promise<void> {
  autostartEnabled = (await invokeSafe<boolean>("autostart_get")) ?? false;
  menuBarContext.autostartEnabled = autostartEnabled;
}

/** F2 (tab UI focus only) and `Tab ▸ Rename Tab…` both trigger the same
 * inline rename UI double-click uses (spec §4/§6), not a native prompt. */
function renameFocusedTab(): void {
  const tabs = focusedWorkspaceTabs();
  // Finding #11 "F2 renames the tab with UI focus (else active)": F2's own
  // `requiresTabFocus` gate already guarantees `activeElement` is *some*
  // `.tab` by the time this runs; prefer that one over the server's own
  // "active" tab, falling back to it only when nothing more specific has
  // focus (the `Tab ▸ Rename Tab…` menu item's own path, spec §4).
  const focusedTabId = (document.activeElement as HTMLElement | null)?.dataset.tabId;
  const active = tabs.find((t) => t.tab_id === focusedTabId) ?? tabs.find((t) => t.focused);
  if (!active) return;
  const tabEl = tabListEl.querySelector<HTMLElement>(`.tab[data-tab-id="${CSS.escape(active.tab_id)}"]`);
  const labelEl = tabEl?.querySelector<HTMLElement>(".tab-label");
  if (!tabEl || !labelEl) return;
  const row: TabRow = { tab_id: active.tab_id, label: active.label, focused: active.focused, agent_status: active.agent_status };
  startTabInlineRename(labelEl, row, {
    onRenameTab: (id, label) => void api("tab.rename", { tab_id: id, label }),
  });
}

export const menuBarContext: MenuBarContext = {
  overlayRoot,
  onNewWorkspace: () => void newWorkspaceFlow(),
  onNextWorkspace: () => {
    const id = neighbourWorkspaceId(1);
    if (id) void api("workspace.focus", { workspace_id: id });
  },
  onPreviousWorkspace: () => {
    const id = neighbourWorkspaceId(-1);
    if (id) void api("workspace.focus", { workspace_id: id });
  },
  onNewTab: () => void api("tab.create", { workspace_id: appState.snapshot?.focused_workspace_id ?? undefined, focus: true }),
  onCloseTab: () => {
    if (appState.snapshot?.focused_tab_id) void api("tab.close", { tab_id: appState.snapshot.focused_tab_id });
  },
  onRenameActiveTab: renameFocusedTab,
  onNextTab: () => {
    const tabs = focusedWorkspaceTabs();
    const index = activeTabIndex();
    const next = tabs[(index + 1 + tabs.length) % tabs.length];
    if (next) void api("tab.focus", { tab_id: next.tab_id });
  },
  onPreviousTab: () => {
    const tabs = focusedWorkspaceTabs();
    const index = activeTabIndex();
    const next = tabs[(index - 1 + tabs.length) % tabs.length];
    if (next) void api("tab.focus", { tab_id: next.tab_id });
  },
  onMoveTabLeft: () => {
    const index = activeTabIndex();
    const active = focusedWorkspaceTabs()[index];
    if (active && canMoveLeft(index)) void api("tab.move", { tab_id: active.tab_id, insert_index: moveLeftInsertIndex(index) });
  },
  onMoveTabRight: () => {
    const tabs = focusedWorkspaceTabs();
    const index = activeTabIndex();
    const active = tabs[index];
    if (active && canMoveRight(index, tabs.length)) void api("tab.move", { tab_id: active.tab_id, insert_index: moveRightInsertIndex(index) });
  },
  onSplitRight: () => {
    const paneId = focusedPaneId();
    if (paneId) void api("pane.split", { direction: "right", target_pane_id: paneId, focus: true });
  },
  onSplitDown: () => {
    const paneId = focusedPaneId();
    if (paneId) void api("pane.split", { direction: "down", target_pane_id: paneId, focus: true });
  },
  onClosePane: () => {
    const paneId = focusedPaneId();
    if (paneId) void api("pane.close", { pane_id: paneId });
  },
  onToggleZoom: () => {
    const paneId = focusedPaneId();
    if (paneId) void api("pane.zoom", { pane_id: paneId });
  },
  onJumpToNextNeedingAttention: () => {
    const order = appState.snapshot?.agent_order ?? [];
    const agents = appState.snapshot?.agents ?? [];
    const byPane = new Map(agents.map((a) => [a.pane_id, a]));
    const target =
      order.map((id) => byPane.get(id)).find((a) => a?.agent_status === "blocked") ??
      order.map((id) => byPane.get(id)).find((a) => a?.agent_status === "done");
    if (target) void focusAgentSequence(target);
  },
  onToggleAgentList: () => {
    // Finding #11: `agentPopoverCloser` is now reliably reset by the
    // popover's own `onClose` (fired for every close path, not just a row
    // click), so this check always reflects reality -- Ctrl+Shift+A can
    // no longer get stuck thinking it's still open after it already closed
    // some other way.
    if (appState.agentPopoverCloser) {
      closeActiveOverlay();
    } else {
      openOrRefreshAgentPopover(false);
    }
  },
  agentSort: appState.settings.agentSort,
  // Finding #15 "menu check marks update immediately on selection": each
  // setter below also updates `menuBarContext` itself, not just
  // `settings` -- the menu rebuilds fresh from `menuBarContext` every time
  // it opens, and otherwise this field stayed stale until the *next*
  // unrelated snapshot event happened to call `refreshMenuBarContext()`.
  onSetAgentSort: (mode: AgentSort) => {
    appState.settings.agentSort = mode;
    menuBarContext.agentSort = mode;
    persistSettings();
  },
  sidebarVisible: appState.settings.sidebarVisible,
  onToggleSidebar: () => {
    appState.settings.sidebarVisible = !appState.settings.sidebarVisible;
    menuBarContext.sidebarVisible = appState.settings.sidebarVisible;
    applySidebarVisibility();
    persistSettings();
  },
  themes: BUILT_IN_THEMES,
  currentThemeId: appState.settings.theme,
  onSelectTheme: (id: string) => {
    appState.settings.theme = id;
    menuBarContext.currentThemeId = id;
    applyCurrentTheme();
    persistSettings();
  },
  onImportTheme: () => void importThemeFlow(),
  onZoomIn: () => {
    appState.renderer?.setFontSize(appState.renderer.getFontSizePx() + 1);
    appState.settings.fontSize = appState.renderer?.getFontSizePx() ?? appState.settings.fontSize;
    persistSettings();
  },
  onZoomOut: () => {
    appState.renderer?.setFontSize(appState.renderer.getFontSizePx() - 1);
    appState.settings.fontSize = appState.renderer?.getFontSizePx() ?? appState.settings.fontSize;
    persistSettings();
  },
  onZoomReset: () => {
    appState.renderer?.setFontSize(DEFAULT_FONT_SIZE_PX);
    appState.settings.fontSize = DEFAULT_FONT_SIZE_PX;
    persistSettings();
  },
  desktopNotifications: appState.settings.desktopNotifications,
  onToggleDesktopNotifications: () => {
    appState.settings.desktopNotifications = !appState.settings.desktopNotifications;
    menuBarContext.desktopNotifications = appState.settings.desktopNotifications;
    persistSettings();
  },
  onOpenSettings: () => void invokeSafe("open_settings"),
  onSetupWizard: () => openSetupWizard(),
  onStopServer: () => {
    const agentCount = appState.snapshot?.agents.length ?? 0;
    const dispose = openModal("Stop herdr server?", (body) => {
      const p = document.createElement("p");
      p.textContent =
        agentCount > 0
          ? `${agentCount} agent(s) running will stop.`
          : "No agents are currently running.";
      body.appendChild(p);
      const actions = document.createElement("div");
      actions.className = "confirm-popover__actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "btn";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => dispose());
      const confirmBtn = document.createElement("button");
      confirmBtn.className = "btn btn--danger";
      confirmBtn.textContent = "Stop Server";
      confirmBtn.addEventListener("click", () => {
        dispose();
        void invokeSafe("engine_stop_server");
      });
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      body.appendChild(actions);
    });
  },
  autostartEnabled,
  onToggleAutostart: () => {
    autostartEnabled = !autostartEnabled;
    menuBarContext.autostartEnabled = autostartEnabled;
    void invokeSafe("autostart_set", { enabled: autostartEnabled });
  },
  onOpenKeyboardShortcuts: () => {
    openModal("Keyboard Shortcuts", (body) => {
      for (const action of SHORTCUTS) {
        const row = document.createElement("div");
        row.className = "modal-shortcut-row";
        row.append(action.label);
        const key = document.createElement("span");
        key.className = "key";
        key.textContent = action.display;
        row.appendChild(key);
        body.appendChild(row);
      }
    });
  },
  onReloadConfig: () => void api("server.reload_config"),
  updateAvailable: false,
  latestReleaseNotesAvailable: false,
  releaseNotesPresent: false,
  onOpenWhatsNewOrUpdateReady: () => {
    openModal(appState.snapshot?.update_available ? "Update Ready" : "What's New", (body) => {
      const text = document.createElement("p");
      text.textContent = appState.snapshot?.release_notes?.body ?? "";
      body.appendChild(text);
      if (appState.snapshot?.update_available && appState.snapshot.update_install_command) {
        const btn = document.createElement("button");
        btn.className = "btn modal-copy-btn";
        btn.textContent = "Copy update command";
        btn.addEventListener("click", () => void navigator.clipboard.writeText(appState.snapshot!.update_install_command));
        body.appendChild(btn);
      }
    });
  },
  onDetach: () => void invokeSafe("window_close"),
  onReconnect: () => void invokeSafe("reconnect"),
  onAbout: () => {
    openModal("About herdr GUI", (body) => {
      const p = document.createElement("p");
      p.textContent = "herdr GUI — Phase 1.5";
      body.appendChild(p);
      // Finding #14 "About shows the server version": plumbed through the
      // `connection-status` event's `serverVersion` (from the welcome
      // handshake), cached module-side so it survives a re-render.
      const serverVersionEl = document.createElement("p");
      serverVersionEl.textContent = appState.serverVersion
        ? `Server version: ${appState.serverVersion}`
        : "Server version: unknown (not connected)";
      body.appendChild(serverVersionEl);
      const attribution = document.createElement("p");
      attribution.textContent = "Codicons © Microsoft, CC-BY-4.0";
      body.appendChild(attribution);
    });
  },
};

export function refreshMenuBarContext(): void {
  menuBarContext.agentSort = appState.settings.agentSort;
  menuBarContext.sidebarVisible = appState.settings.sidebarVisible;
  menuBarContext.currentThemeId = appState.settings.theme;
  menuBarContext.themes = appState.themeRegistry.list();
  menuBarContext.desktopNotifications = appState.settings.desktopNotifications;
  menuBarContext.autostartEnabled = autostartEnabled;
  menuBarContext.updateAvailable = Boolean(appState.snapshot?.update_available);
  menuBarContext.latestReleaseNotesAvailable = Boolean(appState.snapshot?.latest_release_notes_available);
  menuBarContext.releaseNotesPresent = Boolean(appState.snapshot?.release_notes);
  herdrMenuDotEl.hidden = !(menuBarContext.updateAvailable || Boolean(appState.snapshot?.integration_updates_available));
}

const SHORTCUT_HANDLERS: Readonly<Record<string, () => void>> = {
  "workspace.new": () => menuBarContext.onNewWorkspace(),
  "workspace.next": () => menuBarContext.onNextWorkspace(),
  "workspace.previous": () => menuBarContext.onPreviousWorkspace(),
  "tab.new": () => menuBarContext.onNewTab(),
  "tab.close": () => menuBarContext.onCloseTab(),
  "tab.rename": renameFocusedTab,
  "tab.next": () => menuBarContext.onNextTab(),
  "tab.previous": () => menuBarContext.onPreviousTab(),
  "tab.moveLeft": () => menuBarContext.onMoveTabLeft(),
  "tab.moveRight": () => menuBarContext.onMoveTabRight(),
  "pane.splitRight": () => menuBarContext.onSplitRight(),
  "pane.splitDown": () => menuBarContext.onSplitDown(),
  "pane.close": () => menuBarContext.onClosePane(),
  "pane.toggleZoom": () => menuBarContext.onToggleZoom(),
  "agents.jumpToNextNeedingAttention": () => menuBarContext.onJumpToNextNeedingAttention(),
  "agents.showList": () => menuBarContext.onToggleAgentList(),
  "view.toggleSidebar": () => menuBarContext.onToggleSidebar(),
  "view.zoomIn": () => menuBarContext.onZoomIn(),
  "view.zoomOut": () => menuBarContext.onZoomOut(),
  "view.zoomReset": () => menuBarContext.onZoomReset(),
  "herdr.settings": () => menuBarContext.onOpenSettings(),
};

export function onShortcut(action: ShortcutAction): void {
  SHORTCUT_HANDLERS[action.id]?.();
}

function keyCodeToWire(code: { kind: string; value?: unknown }): unknown {
  if (code.kind === "Char" || code.kind === "F") {
    return { [code.kind]: code.value };
  }
  return code.kind;
}

export function onTerminalKey(mapped: { code: { kind: string; value?: unknown }; modifiers: number }): void {
  sendKeyEvent({ code: keyCodeToWire(mapped.code), modifiers: mapped.modifiers });
}

export function onPasteOverride(): void {
  void navigator.clipboard.readText().then(sendPaste);
}

/** Ctrl+Shift+Alt+P (spec §8a.4 "Perf HUD"): outside the §1 allowed
 * shortcut classes (a discrepancy between §1's exhaustive list and §8a.4
 * introducing a new Ctrl+Shift+Alt+* combo), handled as its own listener
 * rather than added to `shortcuts.ts`'s claimed table. */
export function wirePerfHudToggle(): void {
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.ctrlKey && event.shiftKey && event.altKey && event.code === "KeyP") {
        event.preventDefault();
        // Finding #14 "Ctrl+Shift+Alt+P must not also reach the
        // terminal": this listener is registered before
        // `installKeyboardRouting`'s, so both run on the same keydown
        // (also on `document`, capture phase) unless this one stops it --
        // `preventDefault()` alone only suppresses the browser's own
        // default action, not the other listener's own forward-to-
        // terminal logic.
        event.stopImmediatePropagation();
        const visible = !(appState.renderer?.isPerfHudVisible() ?? false);
        appState.renderer?.setPerfHudVisible(visible);
        perfHudEl.hidden = !visible;
      }
    },
    true,
  );
}

export function wireMenuBarNow(): void {
  wireMenuBar(menuTitleEls, menuBarContext);
}
