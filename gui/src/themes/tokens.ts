// Theme token system (spec phase1.5 §2.1 "Tokens").
//
// "The theme is a flat map of VS Code colour keys to CSS colours. The
// loader writes each key to :root as a CSS custom property with every `.`
// replaced by `-`. For example, `sideBar.background` becomes
// `--sideBar-background`. CSS reads only these variables. No hard-coded
// colours in CSS or TS, apart from the built-in theme tables."
//
// "A missing key falls back first along the chain above, then to Dark
// Modern." -- the explicit fallbacks named in §2.1 (`terminal.background` ->
// `editor.background`, and each `herdr.*` status colour -> its `charts.*`
// counterpart) live in `EXPLICIT_FALLBACKS` below.

/** A theme's colours: VS Code colour key -> CSS colour string. Sparse for
 * imported themes (only the keys the `.json`/`.vsix` actually set); the
 * five built-in themes other than Dark Modern are sparse too, relying on
 * Dark Modern as the fallback for anything they don't override. */
export type ThemeColors = Readonly<Record<string, string>>;

export type ThemeKind = "light" | "dark" | "hc";

export interface ThemeDefinition {
  id: string;
  label: string;
  kind: ThemeKind;
  colors: ThemeColors;
}

/** The 16 ANSI colour name suffixes, in `terminal.ansi<Name>` order (spec
 * §2.1: "the 16 `terminal.ansi*` keys (`ansiBlack` … `ansiBrightWhite`)"). */
export const ANSI_NAMES: readonly string[] = [
  "Black",
  "Red",
  "Green",
  "Yellow",
  "Blue",
  "Magenta",
  "Cyan",
  "White",
  "BrightBlack",
  "BrightRed",
  "BrightGreen",
  "BrightYellow",
  "BrightBlue",
  "BrightMagenta",
  "BrightCyan",
  "BrightWhite",
] as const;

export const ANSI_KEYS: readonly string[] = ANSI_NAMES.map((name) => `terminal.ansi${name}`);

/** Spec §2.1: "A missing key falls back first along the chain above" --
 * `terminal.background` -> `editor.background`; each `herdr.status.*` ->
 * its `charts.*`/`descriptionForeground` counterpart. `herdr.danger` and
 * the `herdr.workspace.*` palette (spec §6a) have no natural theme-key
 * fallback: they resolve straight to Dark Modern's literal defaults. */
export const EXPLICIT_FALLBACKS: Readonly<Record<string, string>> = {
  "terminal.background": "editor.background",
  "herdr.status.working": "charts.blue",
  "herdr.status.blocked": "charts.orange",
  "herdr.status.done": "charts.green",
  "herdr.status.idle": "descriptionForeground",
};

/** Every key a theme is required (by fallback, not necessarily directly) to
 * resolve, per spec §2.1's bullet list, plus `editor.background` (the
 * fallback target for `terminal.background`, not itself called out as a
 * top-level bullet but required for that fallback to have somewhere to
 * land) and the 16 ansi keys. */
export const REQUIRED_KEYS: readonly string[] = [
  // Title bar and menus
  "titleBar.activeBackground",
  "titleBar.activeForeground",
  "titleBar.inactiveBackground",
  "menu.background",
  "menu.foreground",
  "menu.selectionBackground",
  "menu.selectionForeground",
  "menu.separatorBackground",
  "menu.border",
  // Sidebar and lists
  "sideBar.background",
  "sideBar.border",
  "sideBarSectionHeader.foreground",
  "list.hoverBackground",
  "list.activeSelectionBackground",
  "list.activeSelectionForeground",
  "list.inactiveSelectionBackground",
  "list.focusOutline",
  // Text and focus
  "foreground",
  "descriptionForeground",
  "icon.foreground",
  "focusBorder",
  "errorForeground",
  // Tabs
  "editorGroupHeader.tabsBackground",
  "tab.activeBackground",
  "tab.activeForeground",
  "tab.inactiveBackground",
  "tab.inactiveForeground",
  "tab.hoverBackground",
  "tab.activeBorderTop",
  "tab.border",
  "tab.dragAndDropBorder",
  // Terminal
  "terminal.background",
  "editor.background",
  "terminal.foreground",
  "terminalCursor.foreground",
  "terminal.selectionBackground",
  ...ANSI_KEYS,
  // Status bar and hover widgets
  "statusBar.background",
  "statusBar.foreground",
  "statusBar.border",
  "statusBarItem.hoverBackground",
  "statusBarItem.warningBackground",
  "statusBarItem.errorBackground",
  "editorHoverWidget.background",
  "editorHoverWidget.border",
  // Sashes, progress, buttons, and charts
  "sash.hoverBorder",
  "progressBar.background",
  "button.background",
  "button.foreground",
  "charts.blue",
  "charts.orange",
  "charts.green",
  // herdr keys
  "herdr.status.working",
  "herdr.status.blocked",
  "herdr.status.done",
  "herdr.status.idle",
  "herdr.danger",
];

/** Spec §6a: 10 theme-overridable workspace colour keys, defaulting to this
 * palette (in order). Not part of `REQUIRED_KEYS`'s CSS-variable sweep --
 * consumed directly by `src/workspaceColors.ts` -- but they follow the same
 * "theme key with a literal Dark Modern default" shape. */
export const WORKSPACE_PALETTE_KEYS: readonly string[] = Array.from(
  { length: 10 },
  (_, i) => `herdr.workspace.${i + 1}`,
);

export const DEFAULT_WORKSPACE_PALETTE: readonly string[] = [
  "#60a5fa",
  "#a78bfa",
  "#2dd4bf",
  "#f472b6",
  "#facc15",
  "#22d3ee",
  "#fb7185",
  "#a3e635",
  "#818cf8",
  "#e879f9",
];

/** `sideBar.background` -> `--sideBar-background` (spec §2.1). */
export function cssVarName(key: string): string {
  return `--${key.replace(/\./g, "-")}`;
}

/**
 * Resolves `key` against `theme`, falling back (in order) to: the theme's
 * own value at `EXPLICIT_FALLBACKS[key]`, then Dark Modern's value at that
 * same fallback key, then Dark Modern's own value at `key`. Returns
 * `undefined` only if Dark Modern itself doesn't define `key` (which
 * should not happen for any `REQUIRED_KEYS` entry).
 */
export function resolveThemeColor(
  key: string,
  theme: ThemeColors,
  darkModern: ThemeColors,
): string | undefined {
  if (theme[key] !== undefined) return theme[key];
  const fallbackKey = EXPLICIT_FALLBACKS[key];
  if (fallbackKey !== undefined) {
    if (theme[fallbackKey] !== undefined) return theme[fallbackKey];
    if (darkModern[fallbackKey] !== undefined) return darkModern[fallbackKey];
  }
  return darkModern[key];
}

/** A minimal sink so this is testable without a DOM (spec: applied via
 * `style.setProperty`, "never a `<style>` string"). The call site passes
 * `document.documentElement.style`. */
export interface StyleSink {
  setProperty(name: string, value: string): void;
}

/** Writes every `REQUIRED_KEYS` entry (resolved through the fallback chain)
 * as a CSS custom property on `sink`. */
export function applyTheme(theme: ThemeColors, darkModern: ThemeColors, sink: StyleSink): void {
  for (const key of REQUIRED_KEYS) {
    const value = resolveThemeColor(key, theme, darkModern);
    if (value !== undefined) sink.setProperty(cssVarName(key), value);
  }
}

/** Resolves one workspace-palette slot (spec §6a), falling back to
 * `DEFAULT_WORKSPACE_PALETTE` when the theme doesn't override it. */
export function resolveWorkspacePaletteColor(index: number, theme: ThemeColors): string {
  const key = WORKSPACE_PALETTE_KEYS[index];
  return theme[key] ?? DEFAULT_WORKSPACE_PALETTE[index];
}
