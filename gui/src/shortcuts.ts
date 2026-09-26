// The authoritative shortcut table (spec phase1.5 §4): "Both the menus and
// the key-capture layer read it." Matches symbol keys by `event.code`
// (`Equal`, `Minus`, `Digit0`), "because Shift and Alt change `event.key`."
//
// Spec §1 "Keys the GUI claims": "Only the shortcuts listed in §4 are
// claimed, and they are all `Ctrl+Shift+*`, `Alt+Shift+*`, `Ctrl+Tab`/
// `Ctrl+Shift+Tab`, `Ctrl+=`/`-`/`0`, `F2` (only when a tab has UI focus,
// never when the terminal has focus), or `Ctrl+,`. **Every other key goes
// to the terminal.** Plain `Ctrl+T` in particular belongs to Claude Code
// ("toggle task checklist"), bash, and PSReadLine. `Ctrl+Shift+C`/
// `Ctrl+Shift+V` stay reserved for a future copy and paste" -- deliberately
// absent from this table.

export type MenuName = "Workspace" | "Tab" | "Pane" | "Agents" | "View" | "herdr" | "Help";

export interface KeyCombo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** `KeyboardEvent.code`, e.g. `"KeyN"`, `"Equal"`, `"ArrowDown"`, `"F2"`. */
  code: string;
}

export interface ShortcutAction {
  id: string;
  menu: MenuName;
  label: string;
  /** The right-aligned hint text shown in the menu, e.g. `"Ctrl+Shift+N"`. */
  display: string;
  combo: KeyCombo;
  /** F2 only (spec §1/§4): claimed only when `activeElement` is a `.tab`
   * (reached via Tab key or right-click), never when the terminal has
   * keyboard focus. */
  requiresTabFocus?: boolean;
}

function combo(ctrl: boolean, shift: boolean, alt: boolean, code: string): KeyCombo {
  return { ctrl, shift, alt, code };
}

export const SHORTCUTS: readonly ShortcutAction[] = [
  {
    id: "workspace.new",
    menu: "Workspace",
    label: "New Workspace…",
    display: "Ctrl+Shift+N",
    combo: combo(true, true, false, "KeyN"),
  },
  {
    id: "workspace.next",
    menu: "Workspace",
    label: "Next Workspace",
    display: "Ctrl+Shift+↓",
    combo: combo(true, true, false, "ArrowDown"),
  },
  {
    id: "workspace.previous",
    menu: "Workspace",
    label: "Previous Workspace",
    display: "Ctrl+Shift+↑",
    combo: combo(true, true, false, "ArrowUp"),
  },
  {
    id: "tab.new",
    menu: "Tab",
    label: "New Tab",
    display: "Ctrl+Shift+T",
    combo: combo(true, true, false, "KeyT"),
  },
  {
    id: "tab.close",
    menu: "Tab",
    label: "Close Tab",
    display: "Ctrl+Shift+W",
    combo: combo(true, true, false, "KeyW"),
  },
  {
    id: "tab.rename",
    menu: "Tab",
    label: "Rename Tab…",
    display: "F2",
    combo: combo(false, false, false, "F2"),
    requiresTabFocus: true,
  },
  {
    id: "tab.next",
    menu: "Tab",
    label: "Next Tab",
    display: "Ctrl+Tab",
    combo: combo(true, false, false, "Tab"),
  },
  {
    id: "tab.previous",
    menu: "Tab",
    label: "Previous Tab",
    display: "Ctrl+Shift+Tab",
    combo: combo(true, true, false, "Tab"),
  },
  {
    id: "tab.moveLeft",
    menu: "Tab",
    label: "Move Tab Left",
    display: "Ctrl+Shift+PgUp",
    combo: combo(true, true, false, "PageUp"),
  },
  {
    id: "tab.moveRight",
    menu: "Tab",
    label: "Move Tab Right",
    display: "Ctrl+Shift+PgDn",
    combo: combo(true, true, false, "PageDown"),
  },
  {
    id: "pane.splitRight",
    menu: "Pane",
    label: "Split Right",
    display: "Alt+Shift+=",
    combo: combo(false, true, true, "Equal"),
  },
  {
    id: "pane.splitDown",
    menu: "Pane",
    label: "Split Down",
    display: "Alt+Shift+-",
    combo: combo(false, true, true, "Minus"),
  },
  {
    id: "pane.close",
    menu: "Pane",
    label: "Close Pane",
    display: "Alt+Shift+W",
    combo: combo(false, true, true, "KeyW"),
  },
  {
    id: "pane.toggleZoom",
    menu: "Pane",
    label: "Toggle Zoom",
    display: "Alt+Shift+Z",
    combo: combo(false, true, true, "KeyZ"),
  },
  {
    id: "agents.jumpToNextNeedingAttention",
    menu: "Agents",
    label: "Jump to Next Needing Attention",
    display: "Ctrl+Shift+J",
    combo: combo(true, true, false, "KeyJ"),
  },
  {
    id: "agents.showList",
    menu: "Agents",
    label: "Show Agent List",
    display: "Ctrl+Shift+A",
    combo: combo(true, true, false, "KeyA"),
  },
  {
    id: "view.toggleSidebar",
    menu: "View",
    label: "Toggle Sidebar",
    display: "Ctrl+Shift+B",
    combo: combo(true, true, false, "KeyB"),
  },
  {
    id: "view.zoomIn",
    menu: "View",
    label: "Zoom In",
    display: "Ctrl+=",
    combo: combo(true, false, false, "Equal"),
  },
  {
    id: "view.zoomOut",
    menu: "View",
    label: "Zoom Out",
    display: "Ctrl+-",
    combo: combo(true, false, false, "Minus"),
  },
  {
    id: "view.zoomReset",
    menu: "View",
    label: "Reset Zoom",
    display: "Ctrl+0",
    combo: combo(true, false, false, "Digit0"),
  },
  {
    id: "herdr.settings",
    menu: "herdr",
    label: "Settings…",
    display: "Ctrl+,",
    combo: combo(true, false, false, "Comma"),
  },
];

export interface KeyboardEventLike {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  code: string;
}

export function matchesCombo(target: KeyCombo, event: KeyboardEventLike): boolean {
  return (
    target.ctrl === event.ctrlKey &&
    target.shift === event.shiftKey &&
    target.alt === event.altKey &&
    target.code === event.code
  );
}

/**
 * Finds the claimed shortcut for `event`, or `undefined` if none matches
 * (spec §1 step 2 of keyboard routing: "Check the `shortcuts.ts` table").
 * `hasTabFocus` gates `requiresTabFocus` entries (F2).
 */
export function findShortcut(
  event: KeyboardEventLike,
  hasTabFocus: boolean,
): ShortcutAction | undefined {
  return SHORTCUTS.find(
    (action) =>
      matchesCombo(action.combo, event) && (!action.requiresTabFocus || hasTabFocus),
  );
}

const LETTER_CODE = /^Key[A-Z]$/;
const ALLOWED_CTRL_ONLY_CODES = new Set(["Tab", "Equal", "Minus", "Digit0", "Comma"]);

/** Spec §1's allowed shortcut classes, as a pure predicate -- used by the
 * self-check test so a future entry can't silently widen what the GUI
 * claims from the terminal. */
export function isAllowedShortcutClass(action: ShortcutAction): boolean {
  const { ctrl, shift, alt, code } = action.combo;
  if (ctrl && shift && !alt) return true; // Ctrl+Shift+* (incl. Ctrl+Shift+Tab)
  if (alt && shift && !ctrl) return true; // Alt+Shift+*
  if (ctrl && !shift && !alt && ALLOWED_CTRL_ONLY_CODES.has(code)) return true; // Ctrl+Tab/=/-/0/,
  if (!ctrl && !shift && !alt && code === "F2" && action.requiresTabFocus) return true; // F2, tab focus only
  return false;
}

export function isPlainCtrlLetter(combo: KeyCombo): boolean {
  return combo.ctrl && !combo.shift && !combo.alt && LETTER_CODE.test(combo.code);
}
