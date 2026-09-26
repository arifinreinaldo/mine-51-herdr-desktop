// Theme registry: built-in themes (spec phase1.5 §2.2) + imported ones
// (§2.3), and the "apply a theme by id" entry point the picker (§2.4) and
// startup sequence (§9.4) both call.

import { CATPPUCCIN_MOCHA_COLORS } from "./catppuccin-mocha";
import { DARK_MODERN_COLORS } from "./dark-modern";
import { DRACULA_COLORS } from "./dracula";
import { HERDR_COLORS } from "./herdr";
import { ONE_DARK_PRO_COLORS } from "./one-dark-pro";
import type { StyleSink, ThemeDefinition } from "./tokens";
import { applyTheme } from "./tokens";
import { TOKYO_NIGHT_COLORS } from "./tokyo-night";

export const DEFAULT_THEME_ID = "dark-modern";

/** Finding #12: every imported theme's id is prefixed so it can never
 * collide with a built-in id and the picker can group them predictably
 * ("shows imported after built-ins", spec §2.4 -- already true of
 * `ThemeRegistry.list()`'s ordering below, and this prefix is the other
 * half of that same requirement). */
export const IMPORTED_THEME_ID_PREFIX = "import:";

export function importedThemeId(slug: string): string {
  return `${IMPORTED_THEME_ID_PREFIX}${slug}`;
}

export const BUILT_IN_THEMES: readonly ThemeDefinition[] = [
  { id: "dark-modern", label: "Dark Modern", kind: "dark", colors: DARK_MODERN_COLORS },
  { id: "herdr", label: "herdr", kind: "dark", colors: HERDR_COLORS },
  { id: "catppuccin-mocha", label: "Catppuccin Mocha", kind: "dark", colors: CATPPUCCIN_MOCHA_COLORS },
  { id: "tokyo-night", label: "Tokyo Night", kind: "dark", colors: TOKYO_NIGHT_COLORS },
  { id: "one-dark-pro", label: "One Dark Pro", kind: "dark", colors: ONE_DARK_PRO_COLORS },
  { id: "dracula", label: "Dracula", kind: "dark", colors: DRACULA_COLORS },
];

export function findBuiltInTheme(id: string): ThemeDefinition | undefined {
  return BUILT_IN_THEMES.find((theme) => theme.id === id);
}

/**
 * Built-ins + imported themes fetched from the backend (spec §2.4: "lists
 * the built-in themes, then the imported ones, with a check mark on the
 * current one"). IO (calling `list_imported_themes`) is the caller's job;
 * this class is a pure, synchronous, testable container.
 */
export class ThemeRegistry {
  private imported: ThemeDefinition[] = [];

  setImported(themes: readonly ThemeDefinition[]): void {
    this.imported = [...themes];
  }

  list(): readonly ThemeDefinition[] {
    return [...BUILT_IN_THEMES, ...this.imported];
  }

  /** Falls back to Dark Modern when `id` names neither a built-in nor an
   * imported theme (e.g. a persisted choice whose import was later deleted
   * from `%APPDATA%\herdr-gui\themes`). */
  find(id: string): ThemeDefinition {
    return this.list().find((theme) => theme.id === id) ?? BUILT_IN_THEMES[0];
  }
}

/** Resolves `id` in `registry` and applies it to `sink` (normally
 * `document.documentElement.style`), returning the resolved definition so
 * the caller can update the "current theme" check mark and persist the
 * choice. */
export function applyThemeById(registry: ThemeRegistry, id: string, sink: StyleSink): ThemeDefinition {
  const theme = registry.find(id);
  applyTheme(theme.colors, DARK_MODERN_COLORS, sink);
  return theme;
}

export type { ThemeColors, ThemeDefinition, ThemeKind } from "./tokens";
