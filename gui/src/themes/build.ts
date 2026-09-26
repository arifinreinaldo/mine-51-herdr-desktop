// Shared builder for the five non-default built-in themes (spec phase1.5
// §2.2): each is authored as a small "compact palette" (mirroring
// `gui/docs/mock/index.html`'s own `THEMES` table shape) and expanded into
// the full `ThemeColors` map the rest of the app reads. Dark Modern itself
// is hand-authored in full (`dark-modern.ts`), since it is both the visual
// reference and the fallback target for every other theme.

import type { ThemeColors } from "./tokens";
import { ANSI_NAMES } from "./tokens";

export interface Ansi16 {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface CompactPalette {
  /** Editor/terminal background. */
  bg: string;
  /** Sidebar/title-bar/tab-strip/status-bar chrome background. */
  side: string;
  /** The one chrome border colour. */
  border: string;
  fg: string;
  desc: string;
  /** Accent: menu selection, focus border, active tab top border, sash hover. */
  accent: string;
  /** Text colour on top of `accent` (menu selection, buttons). Defaults to white. */
  accentFg?: string;
  /** Sidebar row / list active-selection background. */
  sel: string;
  /** List/tab hover background. */
  hover: string;
  /** Menu background, if distinct from `side`. */
  menu?: string;
  /** Active tab background, if distinct from `bg`. */
  tabActiveBg?: string;
  tabActiveFg?: string;
  /** Hover widget (usage/agent popover) background, if distinct from `menu`. */
  hoverW?: string;
  /** The "blocked"/orange accent (`charts.orange`, `herdr.status.blocked`'s
   * fallback target), matching the mock `THEMES` table's `block` field. */
  orange: string;
  ansi: Ansi16;
}

function ansiEntries(ansi: Ansi16): Record<string, string> {
  const out: Record<string, string> = {};
  const values = [
    ansi.black,
    ansi.red,
    ansi.green,
    ansi.yellow,
    ansi.blue,
    ansi.magenta,
    ansi.cyan,
    ansi.white,
    ansi.brightBlack,
    ansi.brightRed,
    ansi.brightGreen,
    ansi.brightYellow,
    ansi.brightBlue,
    ansi.brightMagenta,
    ansi.brightCyan,
    ansi.brightWhite,
  ];
  ANSI_NAMES.forEach((name, i) => {
    out[`terminal.ansi${name}`] = values[i];
  });
  return out;
}

/** Expands a `CompactPalette` into a full `ThemeColors` map, mirroring the
 * mapping the mockup's own inline `THEMES` switcher used (spec §2.2: "The
 * approximate token values are in the `THEMES` table in the mockup
 * script"), extended to the rest of §2.1's required keys. */
export function buildTheme(p: CompactPalette): ThemeColors {
  const accentFg = p.accentFg ?? "#ffffff";
  const menu = p.menu ?? p.side;
  const hoverW = p.hoverW ?? menu;
  return {
    "titleBar.activeBackground": p.side,
    "titleBar.activeForeground": p.fg,
    "titleBar.inactiveBackground": p.side,
    "menu.background": menu,
    "menu.foreground": p.fg,
    "menu.selectionBackground": p.accent,
    "menu.selectionForeground": accentFg,
    "menu.separatorBackground": p.border,
    "menu.border": p.border,

    "sideBar.background": p.side,
    "sideBar.border": p.border,
    "sideBarSectionHeader.foreground": p.fg,
    "list.hoverBackground": p.hover,
    "list.activeSelectionBackground": p.sel,
    "list.activeSelectionForeground": p.fg,
    "list.inactiveSelectionBackground": p.hover,
    "list.focusOutline": p.accent,

    foreground: p.fg,
    descriptionForeground: p.desc,
    "icon.foreground": p.fg,
    focusBorder: p.accent,
    errorForeground: p.ansi.brightRed,

    "editorGroupHeader.tabsBackground": p.side,
    "tab.activeBackground": p.tabActiveBg ?? p.bg,
    "tab.activeForeground": p.tabActiveFg ?? p.fg,
    "tab.inactiveBackground": p.side,
    "tab.inactiveForeground": p.desc,
    "tab.hoverBackground": p.bg,
    "tab.activeBorderTop": p.accent,
    "tab.border": p.border,
    "tab.dragAndDropBorder": p.accent,

    "terminal.background": p.bg,
    "editor.background": p.bg,
    "terminal.foreground": p.fg,
    "terminalCursor.foreground": p.fg,
    "terminal.selectionBackground": p.sel,
    ...ansiEntries(p.ansi),

    "statusBar.background": p.side,
    "statusBar.foreground": p.fg,
    "statusBar.border": p.border,
    "statusBarItem.hoverBackground": p.hover,
    "statusBarItem.warningBackground": "#7a5c00",
    "statusBarItem.errorBackground": "#5a1d1d",
    "editorHoverWidget.background": hoverW,
    "editorHoverWidget.border": p.border,

    "sash.hoverBorder": p.accent,
    "progressBar.background": p.accent,
    "button.background": p.accent,
    "button.foreground": accentFg,
    "charts.blue": p.ansi.blue,
    "charts.orange": p.orange,
    "charts.green": p.ansi.green,
  };
}
