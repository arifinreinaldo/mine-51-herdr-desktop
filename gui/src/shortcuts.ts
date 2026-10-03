// The authoritative shortcut table (spec phase1.5 §4): "Both the menus and
// the key-capture layer read it." Matches symbol keys by `event.code`
// (`Equal`, `Minus`, `Digit0`), "because Shift and Alt change `event.key`."
//
// Spec §1 "Keys the GUI claims": "Only the shortcuts listed in §4 are
// claimed, and they are all `Ctrl+Shift+*`, `Alt+Shift+*`, `Ctrl+Tab`/
// `Ctrl+Shift+Tab`, `Ctrl+=`/`-`/`0`, `F2` (only when a tab has UI focus,
// never when the terminal has focus), or `Ctrl+,`. **Every other key goes
// to the terminal.** Plain `Ctrl+T` in particular belongs to Claude Code
// ("toggle task checklist"), bash, and PSReadLine." `Ctrl+Shift+V` stays
// reserved (`keyboard/routing.ts`'s own paste-override path handles it while
// the terminal has focus, spec §1) -- deliberately absent from this table.
//
// The terminal-parity spec (P0 #1/#4, P1 #7/#8/#10/#12) claims six more
// combos, none previously claimed: `Ctrl+Shift+C` (Copy), `Ctrl+Shift+F`
// (Find), `Ctrl+Shift+K` (Clear), `Ctrl+Shift+Space` (Copy Mode) -- all
// `Ctrl+Shift+*`, so no widening of `isAllowedShortcutClass` was needed --
// and `Shift+Insert` (Paste) and `Shift+PgUp`/`PgDn`/`Home`/`End`
// (scrollback), a brand-new bare-`Shift+<key>` class that *did* need one.

export type MenuName = "Workspace" | "Tab" | "Pane" | "Agents" | "View" | "herdr" | "Help";

export interface KeyCombo {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Cmd (macOS only); absent means "must not be held". */
  meta?: boolean;
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
  // Terminal-parity spec P0 #1: keeps the last mouse selection highlighted
  // (`appTerminalMouse.ts`) and copies it via `pane.selection.read`; a no-op
  // with no selection. Was sent to the terminal as Ctrl+Shift+'c' before
  // this (`input/keymap.ts`'s Ctrl+Alt/Ctrl `Char` branch).
  {
    id: "pane.copy",
    menu: "Pane",
    label: "Copy",
    display: "Ctrl+Shift+C",
    combo: combo(true, true, false, "KeyC"),
  },
  // P1 #7: opens the find-in-scrollback bar docked at the pane's top-right.
  {
    id: "pane.find",
    menu: "Pane",
    label: "Find…",
    display: "Ctrl+Shift+F",
    combo: combo(true, true, false, "KeyF"),
  },
  // P1 #12: `pane.clear`, also reachable from the pane context menu.
  {
    id: "pane.clear",
    menu: "Pane",
    label: "Clear",
    display: "Ctrl+Shift+K",
    combo: combo(true, true, false, "KeyK"),
  },
  // P1 #8: enters/exits vim-like copy mode (`copy_mode.rs` parity).
  {
    id: "pane.copyMode",
    menu: "Pane",
    label: "Copy Mode",
    display: "Ctrl+Shift+Space",
    combo: combo(true, true, false, "Space"),
  },
  // P0 #4 "Paste": claimed in the capture layer, same reserved-combo
  // treatment as Ctrl+Shift+V -- it never reaches `mapKeyboardEvent`'s own
  // named-key table (`Insert`), which would otherwise send a plain
  // Shift+Insert key press instead of pasting.
  {
    id: "pane.paste",
    menu: "Pane",
    label: "Paste",
    display: "Shift+Insert",
    combo: combo(false, true, false, "Insert"),
  },
  // P1 #10 "Scrollback keys": one page via `pane.scroll`, using
  // `PaneSurfacePane.scroll`/`viewport_rows` -- distinct from plain
  // PgUp/PgDn, which the server itself scrolls at a shell prompt
  // (`src/server/pane_input.rs:293-309`).
  {
    id: "pane.scrollPageUp",
    menu: "Pane",
    label: "Scroll Page Up",
    display: "Shift+PgUp",
    combo: combo(false, true, false, "PageUp"),
  },
  {
    id: "pane.scrollPageDown",
    menu: "Pane",
    label: "Scroll Page Down",
    display: "Shift+PgDn",
    combo: combo(false, true, false, "PageDown"),
  },
  {
    id: "pane.scrollToTop",
    menu: "Pane",
    label: "Scroll to Top",
    display: "Shift+Home",
    combo: combo(false, true, false, "Home"),
  },
  {
    id: "pane.scrollToBottom",
    menu: "Pane",
    label: "Scroll to Bottom",
    display: "Shift+End",
    combo: combo(false, true, false, "End"),
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
const WINDOWS_SHORTCUTS: readonly ShortcutAction[] = [
  ...NAMED_SHORTCUTS,
  ...digitRangeShortcuts("tab.focusByIndex", "Tab", "Focus Tab", "alt"),
  ...digitRangeShortcuts("workspace.focusByIndex", "Workspace", "Focus Workspace", "ctrlShift"),
];

/** On a Mac, Option+key types a character, so every Alt combo becomes the
 * same combo on Cmd (a terminal never sees Cmd). Ctrl+Shift+* is unchanged. */
export function toMacShortcut(action: ShortcutAction): ShortcutAction {
  if (!action.combo.alt) return action;
  return {
    ...action,
    display: action.display.replace("Alt+", "Cmd+"),
    combo: { ...action.combo, alt: false, meta: true },
  };
}

// The webview user agent says "Macintosh"; Node's says "Node.js", so unit tests
// always exercise the Windows table.
export const IS_MAC = typeof navigator !== "undefined" && /Macintosh/.test(navigator.userAgent);

export const SHORTCUTS: readonly ShortcutAction[] = IS_MAC
  ? WINDOWS_SHORTCUTS.map(toMacShortcut)
  : WINDOWS_SHORTCUTS;

/** The display string of a shortcut (for menu hints and tooltips), by id. */
export function shortcutDisplay(id: string): string | undefined {
  return SHORTCUTS.find((s) => s.id === id)?.display;
}

export interface KeyboardEventLike {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
  code: string;
}

export function matchesCombo(target: KeyCombo, event: KeyboardEventLike): boolean {
  return (
    target.ctrl === event.ctrlKey &&
    target.shift === event.shiftKey &&
    target.alt === event.altKey &&
    (target.meta ?? false) === (event.metaKey ?? false) &&
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
/** The terminal-parity spec's one new bare-`Shift+<key>` class: Paste
 * (`Shift+Insert`) and the four scrollback keys (`Shift+PgUp`/`PgDn`/
 * `Home`/`End`). `Ctrl+Shift+C`/`F`/`K`/`Space` need no addition here --
 * they already fall under the pre-existing `Ctrl+Shift+*` class below. */
const ALLOWED_SHIFT_ONLY_CODES = new Set(["Insert", "PageUp", "PageDown", "Home", "End"]);

/** Spec §1's allowed shortcut classes, as a pure predicate -- used by the
 * self-check test so a future entry can't silently widen what the GUI
 * claims from the terminal. */
export function isAllowedShortcutClass(action: ShortcutAction): boolean {
  const { ctrl, shift, alt, code } = action.combo;
  if (action.combo.meta && !ctrl && !alt) return true; // Cmd+* (macOS; a terminal never sees Cmd)
  if (ctrl && shift && !alt) return true; // Ctrl+Shift+* (incl. Ctrl+Shift+Tab, +1..9, +E, +/)
  if (alt && shift && !ctrl) return true; // Alt+Shift+*
  if (ctrl && !shift && !alt && ALLOWED_CTRL_ONLY_CODES.has(code)) return true; // Ctrl+Tab/=/-/0/,
  if (alt && !shift && !ctrl && ALLOWED_ALT_ONLY_CODES.has(code)) return true; // Alt+1..9, Alt+`
  if (shift && !ctrl && !alt && ALLOWED_SHIFT_ONLY_CODES.has(code)) return true; // Shift+Insert/PgUp/PgDn/Home/End
  if (!ctrl && !shift && !alt && code === "F2" && action.requiresTabFocus) return true; // F2, tab focus only
  return false;
}

export function isPlainCtrlLetter(combo: KeyCombo): boolean {
  return combo.ctrl && !combo.shift && !combo.alt && !combo.meta && LETTER_CODE.test(combo.code);
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
