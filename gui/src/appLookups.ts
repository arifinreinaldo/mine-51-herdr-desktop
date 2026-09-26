// Pure(ish) lookups derived from `appState` that several orchestration
// modules all need (finding #16 extraction): theme resolution, and the
// small snapshot-field lookups almost every action handler uses.

import { appState } from "./appState";
import type { RawTab } from "./appTypes";
import { DARK_MODERN_COLORS } from "./themes/dark-modern";
import { applyThemeById, type ThemeDefinition } from "./themes/index";
import { ANSI_NAMES, resolveThemeColor, resolveWorkspacePaletteColor, type ThemeColors } from "./themes/tokens";

export function currentThemeDef(): ThemeDefinition {
  return appState.themeRegistry.find(appState.settings.theme);
}

export function rendererThemeFrom(colors: ThemeColors): { ansi: string[]; foreground: string; background: string; cursor: string } {
  const ansi = ANSI_NAMES.map((name) => resolveThemeColor(`terminal.ansi${name}`, colors, DARK_MODERN_COLORS) ?? "#000000");
  return {
    ansi,
    foreground: resolveThemeColor("terminal.foreground", colors, DARK_MODERN_COLORS) ?? "#cccccc",
    background: resolveThemeColor("terminal.background", colors, DARK_MODERN_COLORS) ?? "#1f1f1f",
    cursor: resolveThemeColor("terminalCursor.foreground", colors, DARK_MODERN_COLORS) ?? "#cccccc",
  };
}

export function updateWorkspaceColorTitlebarVar(): void {
  if (!appState.snapshot?.focused_workspace_id) return;
  const index = appState.settings.workspaceColors[appState.snapshot.focused_workspace_id];
  if (index === undefined) return;
  const hex = resolveWorkspacePaletteColor(index, currentThemeDef().colors);
  document.documentElement.style.setProperty("--current-ws-color", hex);
  document.body.classList.add("has-workspace-colors");
}

export function applyCurrentTheme(): void {
  const theme = applyThemeById(appState.themeRegistry, appState.settings.theme, document.documentElement.style);
  appState.renderer?.setTheme(rendererThemeFrom(theme.colors));
  updateWorkspaceColorTitlebarVar();
}

export function focusedWorkspaceTabs(): RawTab[] {
  const snapshot = appState.snapshot;
  if (!snapshot) return [];
  const tabs = snapshot.tabs.filter((t) => t.workspace_id === snapshot.focused_workspace_id);
  const optimisticTabOrder = appState.optimisticTabOrder;
  if (!optimisticTabOrder) return tabs;
  // Finding #11: reorder to the optimistic order, appending any tab that
  // order doesn't mention (e.g. a new one that appeared mid-drag) at the
  // end, in its own snapshot-given order.
  const byId = new Map(tabs.map((t) => [t.tab_id, t]));
  const ordered: RawTab[] = [];
  for (const id of optimisticTabOrder) {
    const t = byId.get(id);
    if (t) {
      ordered.push(t);
      byId.delete(id);
    }
  }
  for (const t of tabs) if (byId.has(t.tab_id)) ordered.push(t);
  return ordered;
}

export function workspaceLabel(workspaceId: string): string {
  return appState.snapshot?.workspaces.find((w) => w.workspace_id === workspaceId)?.label ?? workspaceId;
}

export function tabLabel(tabId: string): string {
  return appState.snapshot?.tabs.find((t) => t.tab_id === tabId)?.label ?? tabId;
}

export function targetPaneId(): string | null {
  return appState.snapshot?.focused_pane_id ?? null;
}

export function neighbourWorkspaceId(direction: 1 | -1): string | undefined {
  const snapshot = appState.snapshot;
  if (!snapshot) return undefined;
  const ids = snapshot.workspaces.map((w) => w.workspace_id);
  const index = ids.indexOf(snapshot.focused_workspace_id ?? "");
  if (index === -1) return undefined;
  return ids[(index + direction + ids.length) % ids.length];
}

export function activeTabIndex(): number {
  const tabs = focusedWorkspaceTabs();
  return tabs.findIndex((t) => t.focused);
}

export function focusedPaneId(): string | undefined {
  return appState.snapshot?.focused_pane_id ?? undefined;
}
