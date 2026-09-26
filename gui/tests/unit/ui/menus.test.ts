// @vitest-environment jsdom
//
// Finding #11 "Menu hover-switch works repeatedly (menus.ts:270-285
// onClose clobbers openMenuName)": switching menus by hovering a
// different title opens the new one (setting `openMenuName` to it)
// *before* `openMenu`'s own `openOverlay` synchronously closes the
// previous one, which fires that previous menu's stale `onClose` --
// clobbering `openMenuName` back to `null` right after it was set. The
// bug only shows up on the *second* hover-switch (the first works by
// coincidence), so this test switches through three menus.

import { beforeEach, describe, expect, it } from "vitest";
import { wireMenuBar, type MenuBarContext } from "../../../src/ui/menus";
import { DARK_MODERN_COLORS } from "../../../src/themes/dark-modern";

function fakeContext(): MenuBarContext {
  const overlayRoot = document.createElement("div");
  document.body.appendChild(overlayRoot);
  const noop = () => {};
  return {
    overlayRoot,
    onNewWorkspace: noop,
    onNextWorkspace: noop,
    onPreviousWorkspace: noop,
    onNewTab: noop,
    onCloseTab: noop,
    onRenameActiveTab: noop,
    onNextTab: noop,
    onPreviousTab: noop,
    onMoveTabLeft: noop,
    onMoveTabRight: noop,
    onSplitRight: noop,
    onSplitDown: noop,
    onClosePane: noop,
    onToggleZoom: noop,
    onJumpToNextNeedingAttention: noop,
    onToggleAgentList: noop,
    agentSort: "priority",
    onSetAgentSort: noop,
    sidebarVisible: true,
    onToggleSidebar: noop,
    themes: [{ id: "dark-modern", label: "Dark Modern", kind: "dark", colors: DARK_MODERN_COLORS }],
    currentThemeId: "dark-modern",
    onSelectTheme: noop,
    onImportTheme: noop,
    onZoomIn: noop,
    onZoomOut: noop,
    onZoomReset: noop,
    desktopNotifications: true,
    onToggleDesktopNotifications: noop,
    onOpenSettings: noop,
    onOpenKeyboardShortcuts: noop,
    onReloadConfig: noop,
    updateAvailable: false,
    latestReleaseNotesAvailable: false,
    releaseNotesPresent: false,
    onOpenWhatsNewOrUpdateReady: noop,
    onDetach: noop,
    onReconnect: noop,
    onAbout: noop,
  };
}

function makeTitleEls(names: string[]): HTMLElement[] {
  return names.map((name) => {
    const el = document.createElement("span");
    el.dataset.menu = name;
    document.body.appendChild(el);
    return el;
  });
}

describe("wireMenuBar: hover-switch (finding #11)", () => {
  let ctx: MenuBarContext;
  let titleEls: HTMLElement[];

  beforeEach(() => {
    ctx = fakeContext();
    titleEls = makeTitleEls(["workspace", "tab", "pane"]);
    wireMenuBar(titleEls, ctx);
  });

  it("hovering a second, then a third, menu title switches each time (not just the first)", () => {
    const [workspaceTitle, tabTitle, paneTitle] = titleEls;

    workspaceTitle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(workspaceTitle.classList.contains("is-open")).toBe(true);

    // First hover-switch: workspace -> tab.
    tabTitle.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(tabTitle.classList.contains("is-open")).toBe(true);
    expect(workspaceTitle.classList.contains("is-open")).toBe(false);

    // Second hover-switch: tab -> pane. This is the one the pre-fix bug
    // broke (tab's stale `onClose`, fired by opening pane's menu, clobbered
    // `openMenuName` back to null right after it was set to "pane").
    paneTitle.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(paneTitle.classList.contains("is-open")).toBe(true);
    expect(tabTitle.classList.contains("is-open")).toBe(false);

    // Prove `openMenuName` really tracks "pane" now (not stuck null): a
    // *third* switch must still work.
    workspaceTitle.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(workspaceTitle.classList.contains("is-open")).toBe(true);
    expect(paneTitle.classList.contains("is-open")).toBe(false);
  });

  it("clicking the already-open menu's own title closes it (openMenuName was not clobbered to some other value)", () => {
    const [workspaceTitle, tabTitle] = titleEls;
    workspaceTitle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    tabTitle.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(tabTitle.classList.contains("is-open")).toBe(true);

    tabTitle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(tabTitle.classList.contains("is-open")).toBe(false);
    expect(document.querySelector(".menu")).toBeNull();
  });
});
