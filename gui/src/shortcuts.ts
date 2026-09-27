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
  /** Groups the 9 `Alt+1..9` / `Ctrl+Shift+1..9` "focus by index" entries
   * (keyboard shortcuts feature) so the cheat-sheet modal can collapse
   * them into a single row instead of listing all 9 -- routing still
   * matches each one individually by its own `combo`. `undefined` for
   * every other (ungrouped) entry. */
  rangeGroup?: string;
}

function combo(ctrl: boolean, shift: boolean, alt: boolean, code: string): KeyCombo {
  return { ctrl, shift, alt, code };
}

const NAMED_SHORTCUTS: readonly ShortcutAction[] = [
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
  {
    id: "tab.togglePrevious",
    menu: "Tab",
    label: "Toggle Previous Tab",
    display: "Alt+`",
    combo: combo(false, false, true, "Backquote"),
  },
  {
    id: "view.focusSidebar",
    menu: "View",
    label: "Focus Sidebar",
    display: "Ctrl+Shift+E",
    combo: combo(true, true, false, "KeyE"),
  },
  {
    id: "herdr.showShortcuts",
    menu: "herdr",
    label: "Keyboard Shortcuts",
    display: "Ctrl+Shift+/",
    combo: combo(true, true, false, "Slash"),
  },
];

const DIGIT_CODES = [
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
] as const;

/** The cutoff between "focus tab/workspace at this fixed position" (1-8)
 * and "9 always means the last one, whatever its position" -- shared with
 * `workspace/focusByIndex.ts`'s runtime resolution and the tab/sidebar
 * tooltip text, so the three stay in lockstep. */
export const DIRECT_FOCUS_SLOT_COUNT = 8;

/**
 * Builds the 9 `Alt+1..9` (or `Ctrl+Shift+1..9`) "focus by index" entries
 * for `idPrefix` (keyboard shortcuts feature: Alt+1..8 focus tab N, Alt+9
 * focuses the last tab; same shape for Ctrl+Shift+1..9 and workspaces).
 * Each entry matches its own `Digit*` code individually -- `rangeGroup`
 * only affects how the cheat-sheet modal *displays* them, never routing.
 */
function digitRangeShortcuts(
  idPrefix: string,
  menu: MenuName,
  labelPrefix: string,
  modifier: "alt" | "ctrlShift",
): ShortcutAction[] {
  return DIGIT_CODES.map((code, i) => {
    const n = i + 1;
    const isLast = n > DIRECT_FOCUS_SLOT_COUNT;
    return {
      id: `${idPrefix}.${n}`,
      menu,
      label: isLast ? `${labelPrefix} (Last)` : `${labelPrefix} ${n}`,
      display: modifier === "alt" ? `Alt+${n}` : `Ctrl+Shift+${n}`,
      combo: modifier === "alt" ? combo(false, false, true, code) : combo(true, true, false, code),
      rangeGroup: idPrefix,
    };
  });
}

/** The authoritative shortcut table (see the module doc comment above):
 * the named, single-combo entries plus the two 9-wide "focus by index"
 * ranges (Alt+1..9 for tabs, Ctrl+Shift+1..9 for workspaces). */
export const SHORTCUTS: readonly ShortcutAction[] = [
  ...NAMED_SHORTCUTS,
  ...digitRangeShortcuts("tab.focusByIndex", "Tab", "Focus Tab", "alt"),
  ...digitRangeShortcuts("workspace.focusByIndex", "Workspace", "Focus Workspace", "ctrlShift"),
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
/** The keyboard shortcuts feature's two new alt-only classes: `Alt+1..9`
 * (tab/workspace "focus by index") and `Alt+\`` (toggle previous tab).
 * `Ctrl+Shift+1..9`, `Ctrl+Shift+E`, and `Ctrl+Shift+/` need no addition
 * here -- they already fall under the pre-existing `Ctrl+Shift+*` class
 * below. */
const ALLOWED_ALT_ONLY_CODES = new Set<string>([...DIGIT_CODES, "Backquote"]);

/** Spec §1's allowed shortcut classes, as a pure predicate -- used by the
 * self-check test so a future entry can't silently widen what the GUI
 * claims from the terminal. */
export function isAllowedShortcutClass(action: ShortcutAction): boolean {
  const { ctrl, shift, alt, code } = action.combo;
  if (ctrl && shift && !alt) return true; // Ctrl+Shift+* (incl. Ctrl+Shift+Tab, +1..9, +E, +/)
  if (alt && shift && !ctrl) return true; // Alt+Shift+*
  if (ctrl && !shift && !alt && ALLOWED_CTRL_ONLY_CODES.has(code)) return true; // Ctrl+Tab/=/-/0/,
  if (alt && !shift && !ctrl && ALLOWED_ALT_ONLY_CODES.has(code)) return true; // Alt+1..9, Alt+`
  if (!ctrl && !shift && !alt && code === "F2" && action.requiresTabFocus) return true; // F2, tab focus only
  return false;
}

export function isPlainCtrlLetter(combo: KeyCombo): boolean {
  return combo.ctrl && !combo.shift && !combo.alt && LETTER_CODE.test(combo.code);
}

// --------------------------------------------------------------------------
// Keyboard Shortcuts cheat-sheet modal data (Ctrl+Shift+/): a pure view over
// `SHORTCUTS`, kept here so the modal has exactly one source of truth. A
// `rangeGroup`'s 9 entries collapse into a single row (spec: "the Alt+N /
// Ctrl+Shift+N ranges shown as one row each").
// --------------------------------------------------------------------------

export interface CheatSheetEntry {
  id: string;
  menu: MenuName;
  label: string;
  display: string;
  /** Lowercased `label + display`, precomputed for `filterCheatSheetEntries`. */
  searchText: string;
}

/** Friendlier group labels for the two ranges than any single member's own
 * `label` (e.g. "Focus Tab 1" for the first of the nine). */
const RANGE_GROUP_LABELS: Readonly<Record<string, string>> = {
  "tab.focusByIndex": "Focus Tab by Number (9 = last)",
  "workspace.focusByIndex": "Focus Workspace by Number (9 = last)",
};

function toEntry(id: string, menu: MenuName, label: string, display: string): CheatSheetEntry {
  return { id, menu, label, display, searchText: `${label} ${display}`.toLowerCase() };
}

/** One entry per `SHORTCUTS` action, except every `rangeGroup`'s 9 members
 * collapse into the single entry a caller would expect to search/see. */
export function cheatSheetEntries(shortcuts: readonly ShortcutAction[] = SHORTCUTS): CheatSheetEntry[] {
  const entries: CheatSheetEntry[] = [];
  const seenGroups = new Set<string>();
  for (const action of shortcuts) {
    if (!action.rangeGroup) {
      entries.push(toEntry(action.id, action.menu, action.label, action.display));
      continue;
    }
    if (seenGroups.has(action.rangeGroup)) continue;
    seenGroups.add(action.rangeGroup);
    const members = shortcuts.filter((a) => a.rangeGroup === action.rangeGroup);
    const first = members[0];
    const last = members[members.length - 1];
    const label = RANGE_GROUP_LABELS[action.rangeGroup] ?? action.label;
    entries.push(toEntry(action.rangeGroup, action.menu, label, `${first.display} … ${last.display}`));
  }
  return entries;
}

/** Case-insensitive substring match against each entry's label or display
 * text (spec: "searchable: filter by label or key text"). Empty/blank
 * `query` returns every entry, unfiltered. */
export function filterCheatSheetEntries(
  entries: readonly CheatSheetEntry[],
  query: string,
): CheatSheetEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => e.searchText.includes(q));
}

/** Fixed menu order for the cheat sheet (spec: "grouped by menu (Workspace,
 * Tab, Pane, Agents, View, herdr)"); a menu with no matching entries (Help,
 * or any menu filtered down to nothing) is left out rather than shown
 * empty. */
const CHEAT_SHEET_MENU_ORDER: readonly MenuName[] = [
  "Workspace",
  "Tab",
  "Pane",
  "Agents",
  "View",
  "herdr",
  "Help",
];

export function groupCheatSheetEntriesByMenu(
  entries: readonly CheatSheetEntry[],
): Array<[MenuName, CheatSheetEntry[]]> {
  const byMenu = new Map<MenuName, CheatSheetEntry[]>();
  for (const entry of entries) {
    const list = byMenu.get(entry.menu);
    if (list) list.push(entry);
    else byMenu.set(entry.menu, [entry]);
  }
  return CHEAT_SHEET_MENU_ORDER.filter((menu) => byMenu.has(menu)).map((menu) => [menu, byMenu.get(menu)!]);
}
