// The menu bar (spec phase1.5 §4 "Menus and shortcuts"): "Menus open on
// click. Once one menu is open, hovering the next menu title switches to
// it. Menus close with Esc or an outside click." Item data mirrors the §4
// table exactly; shortcut hints come from `shortcuts.ts` (single source of
// truth for both the menu labels and the key-capture layer).

import { keyboardCaptureReturnTarget } from "../keyboard/focusCapture";
import { SHORTCUTS } from "../shortcuts";
import type { ThemeDefinition } from "../themes/index";
import { closeActiveOverlay, isOverlayOpen } from "./overlay";
import { openMenu, type MenuItemSpec } from "./menu";

function shortcutDisplay(id: string): string | undefined {
  return SHORTCUTS.find((s) => s.id === id)?.display;
}

export interface AgentSortState {
  mode: "priority" | "server_order";
}

export interface MenuBarContext {
  overlayRoot: HTMLElement;

  onNewWorkspace(): void;
  onNextWorkspace(): void;
  onPreviousWorkspace(): void;

  onNewTab(): void;
  onCloseTab(): void;
  onRenameActiveTab(): void;
  onNextTab(): void;
  onPreviousTab(): void;
  onMoveTabLeft(): void;
  onMoveTabRight(): void;

  onSplitRight(): void;
  onSplitDown(): void;
  onClosePane(): void;
  onToggleZoom(): void;

  onJumpToNextNeedingAttention(): void;
  onToggleAgentList(): void;
  agentSort: "priority" | "server_order";
  onSetAgentSort(mode: "priority" | "server_order"): void;

  sidebarVisible: boolean;
  onToggleSidebar(): void;
  themes: readonly ThemeDefinition[];
  currentThemeId: string;
  onSelectTheme(id: string): void;
  onImportTheme(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomReset(): void;
  desktopNotifications: boolean;
  onToggleDesktopNotifications(): void;

  onOpenSettings(): void;
  onOpenKeyboardShortcuts(): void;
  onReloadConfig(): void;
  updateAvailable: boolean;
  latestReleaseNotesAvailable: boolean;
  /** Finding #15 "'What's New' inert/hidden when release_notes is None":
   * `latestReleaseNotesAvailable` can be true while the notes payload
   * itself hasn't arrived yet (or isn't present for some other reason) --
   * distinct from `updateAvailable`, whose own modal is still useful (the
   * install-command copy button) even with no notes text. */
  releaseNotesPresent: boolean;
  onOpenWhatsNewOrUpdateReady(): void;
  onDetach(): void;

  onReconnect(): void;
  onAbout(): void;
}

function workspaceMenuItems(ctx: MenuBarContext): MenuItemSpec[] {
  return [
    {
      id: "workspace.new",
      label: "New Workspace…",
      icon: "folder-opened",
      shortcut: shortcutDisplay("workspace.new"),
      onSelect: ctx.onNewWorkspace,
    },
    {
      id: "workspace.next",
      label: "Next Workspace",
      shortcut: shortcutDisplay("workspace.next"),
      separatorBefore: true,
      onSelect: ctx.onNextWorkspace,
    },
    {
      id: "workspace.previous",
      label: "Previous Workspace",
      shortcut: shortcutDisplay("workspace.previous"),
      onSelect: ctx.onPreviousWorkspace,
    },
  ];
}

function tabMenuItems(ctx: MenuBarContext): MenuItemSpec[] {
  return [
    { id: "tab.new", label: "New Tab", shortcut: shortcutDisplay("tab.new"), onSelect: ctx.onNewTab },
    { id: "tab.close", label: "Close Tab", shortcut: shortcutDisplay("tab.close"), onSelect: ctx.onCloseTab },
    {
      id: "tab.rename",
      label: "Rename Tab…",
      shortcut: "F2",
      onSelect: ctx.onRenameActiveTab,
    },
    {
      id: "tab.next",
      label: "Next Tab",
      shortcut: shortcutDisplay("tab.next"),
      separatorBefore: true,
      onSelect: ctx.onNextTab,
    },
    { id: "tab.previous", label: "Previous Tab", shortcut: shortcutDisplay("tab.previous"), onSelect: ctx.onPreviousTab },
    {
      id: "tab.moveLeft",
      label: "Move Tab Left",
      shortcut: shortcutDisplay("tab.moveLeft"),
      separatorBefore: true,
      onSelect: ctx.onMoveTabLeft,
    },
    { id: "tab.moveRight", label: "Move Tab Right", shortcut: shortcutDisplay("tab.moveRight"), onSelect: ctx.onMoveTabRight },
  ];
}

function paneMenuItems(ctx: MenuBarContext): MenuItemSpec[] {
  return [
    {
      id: "pane.splitRight",
      label: "Split Right",
      icon: "split-horizontal",
      shortcut: shortcutDisplay("pane.splitRight"),
      onSelect: ctx.onSplitRight,
    },
    {
      id: "pane.splitDown",
      label: "Split Down",
      icon: "split-vertical",
      shortcut: shortcutDisplay("pane.splitDown"),
      onSelect: ctx.onSplitDown,
    },
    {
      id: "pane.close",
      label: "Close Pane",
      shortcut: shortcutDisplay("pane.close"),
      separatorBefore: true,
      onSelect: ctx.onClosePane,
    },
    { id: "pane.toggleZoom", label: "Toggle Zoom", shortcut: shortcutDisplay("pane.toggleZoom"), onSelect: ctx.onToggleZoom },
  ];
}

function agentsMenuItems(ctx: MenuBarContext): MenuItemSpec[] {
  return [
    {
      id: "agents.jump",
      label: "Jump to Next Needing Attention",
      shortcut: shortcutDisplay("agents.jumpToNextNeedingAttention"),
      onSelect: ctx.onJumpToNextNeedingAttention,
    },
    {
      id: "agents.showList",
      label: "Show Agent List",
      shortcut: shortcutDisplay("agents.showList"),
      onSelect: ctx.onToggleAgentList,
    },
    {
      id: "agents.sortPriority",
      label: "Sort: Priority",
      checked: ctx.agentSort === "priority",
      separatorBefore: true,
      onSelect: () => ctx.onSetAgentSort("priority"),
    },
    {
      id: "agents.sortServer",
      label: "Sort: Server order",
      checked: ctx.agentSort === "server_order",
      onSelect: () => ctx.onSetAgentSort("server_order"),
    },
  ];
}

function viewMenuItems(ctx: MenuBarContext): MenuItemSpec[] {
  return [
    {
      id: "view.toggleSidebar",
      label: "Toggle Sidebar",
      shortcut: shortcutDisplay("view.toggleSidebar"),
      checked: ctx.sidebarVisible,
      onSelect: ctx.onToggleSidebar,
    },
    {
      id: "view.colorTheme",
      label: "Color Theme",
      separatorBefore: true,
      submenu: ctx.themes.map((theme) => ({
        id: `theme.${theme.id}`,
        label: theme.label,
        checked: theme.id === ctx.currentThemeId,
        onSelect: () => ctx.onSelectTheme(theme.id),
      })),
    },
    {
      id: "view.importTheme",
      label: "Import VS Code Theme…",
      onSelect: ctx.onImportTheme,
    },
    {
      id: "view.zoomIn",
      label: "Zoom In",
      shortcut: shortcutDisplay("view.zoomIn"),
      separatorBefore: true,
      onSelect: ctx.onZoomIn,
    },
    { id: "view.zoomOut", label: "Zoom Out", shortcut: shortcutDisplay("view.zoomOut"), onSelect: ctx.onZoomOut },
    {
      id: "view.zoomReset",
      label: "Reset Zoom",
      shortcut: shortcutDisplay("view.zoomReset"),
      onSelect: ctx.onZoomReset,
    },
    {
      id: "view.desktopNotifications",
      label: "Desktop Notifications",
      checked: ctx.desktopNotifications,
      separatorBefore: true,
      onSelect: ctx.onToggleDesktopNotifications,
    },
  ];
}

function herdrMenuItems(ctx: MenuBarContext): MenuItemSpec[] {
  const items: MenuItemSpec[] = [
    { id: "herdr.settings", label: "Settings…", shortcut: shortcutDisplay("herdr.settings"), onSelect: ctx.onOpenSettings },
    { id: "herdr.shortcuts", label: "Keyboard Shortcuts", onSelect: ctx.onOpenKeyboardShortcuts },
    { id: "herdr.reload", label: "Reload Config", onSelect: ctx.onReloadConfig },
  ];
  if (ctx.updateAvailable || ctx.latestReleaseNotesAvailable) {
    items.push({
      id: "herdr.whatsnew",
      label: ctx.updateAvailable ? "Update Ready — Restart Server…" : "What's New",
      dot: ctx.updateAvailable,
      separatorBefore: true,
      // Finding #15: "What's New" (not the update-ready case, whose modal
      // is still useful with no notes text) is inert with nothing to show.
      disabled: !ctx.updateAvailable && !ctx.releaseNotesPresent,
      onSelect: ctx.onOpenWhatsNewOrUpdateReady,
    });
  }
  items.push({
    id: "herdr.detach",
    label: "Detach (keep agents running)",
    separatorBefore: true,
    onSelect: ctx.onDetach,
  });
  return items;
}

function helpMenuItems(ctx: MenuBarContext): MenuItemSpec[] {
  return [
    { id: "help.reconnect", label: "Reconnect", onSelect: ctx.onReconnect },
    { id: "help.about", label: "About herdr GUI", onSelect: ctx.onAbout },
  ];
}

const MENU_BUILDERS: Readonly<Record<string, (ctx: MenuBarContext) => MenuItemSpec[]>> = {
  workspace: workspaceMenuItems,
  tab: tabMenuItems,
  pane: paneMenuItems,
  agents: agentsMenuItems,
  view: viewMenuItems,
  herdr: herdrMenuItems,
  help: helpMenuItems,
};

export function wireMenuBar(menuTitleEls: readonly HTMLElement[], ctx: MenuBarContext): void {
  let openMenuName: string | null = null;

  const openFor = (name: string, titleEl: HTMLElement) => {
    const builder = MENU_BUILDERS[name];
    if (!builder) return;
    for (const el of menuTitleEls) el.classList.remove("is-open");
    titleEl.classList.add("is-open");
    openMenuName = name;
    const rect = titleEl.getBoundingClientRect();
    const rootRect = ctx.overlayRoot.getBoundingClientRect();
    openMenu(
      ctx.overlayRoot,
      { left: rect.left - rootRect.left, top: rect.bottom - rootRect.top },
      builder(ctx),
      {
        // Finding #3: return focus to the terminal capture after any menu
        // closes, not just after an item is selected.
        returnFocusTo: keyboardCaptureReturnTarget(),
        onClose: () => {
          titleEl.classList.remove("is-open");
          // Finding #11 "menu hover-switch works repeatedly": switching
          // menus on hover opens the new one (setting `openMenuName` to
          // it) *before* `openMenu`'s own `openOverlay` synchronously
          // closes the previous one, which fires *this* stale closure --
          // for the menu that just lost focus, not the new one. Without
          // this guard, that stale `onClose` clobbers `openMenuName` back
          // to `null` right after it was set to the new menu's name,
          // breaking every hover-switch after the first.
          if (openMenuName === name) openMenuName = null;
        },
        // Spec §4: with a top-level menu open, Left/Right move to the
        // previous/next top-level menu and open it, wrapping. `openFor`'s
        // own `openOverlay` (inside `openMenu`) closes this instance
        // synchronously when the neighbour opens, the same mechanism the
        // hover-switch above already relies on.
        onSwitchTopLevel: (direction) => {
          const currentIndex = menuTitleEls.indexOf(titleEl);
          if (currentIndex < 0) return;
          const nextIndex = (currentIndex + direction + menuTitleEls.length) % menuTitleEls.length;
          const nextTitleEl = menuTitleEls[nextIndex];
          openFor(nextTitleEl.dataset.menu ?? "", nextTitleEl);
        },
      },
    );
  };

  for (const titleEl of menuTitleEls) {
    const name = titleEl.dataset.menu ?? "";
    titleEl.addEventListener("click", () => {
      if (openMenuName === name) {
        closeActiveOverlay();
      } else {
        openFor(name, titleEl);
      }
    });
    titleEl.addEventListener("mouseenter", () => {
      // Spec §4: "Once one menu is open, hovering the next menu title
      // switches to it."
      if (isOverlayOpen() && openMenuName !== null && openMenuName !== name) {
        openFor(name, titleEl);
      }
    });
    titleEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        openFor(name, titleEl);
      }
    });
  }
}
