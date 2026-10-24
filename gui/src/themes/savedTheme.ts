// The saved theme for a secondary window (mirror tools, SQLite inspector).
// Those pages do not load `appState`, so they read the setting from Rust.

import { invoke } from "@tauri-apps/api/core";
import { ThemeRegistry, applyThemeById, importedThemeId } from "./index";

/** Applies the saved theme once, at startup. A later change in the main window reaches the page when it opens again. */
export async function applySavedTheme(): Promise<void> {
  const registry = new ThemeRegistry();
  let themeId = "dark-modern";
  try {
    const { settings } = await invoke<{ settings: { theme: string } }>("settings_get");
    themeId = settings.theme;
    const imported = await invoke<{ slug: string; name: string; type: string; colors: Record<string, string> }[]>(
      "list_imported_themes",
    );
    registry.setImported(
      imported.map((t) => ({
        id: importedThemeId(t.slug),
        label: t.name,
        kind: t.type as "light" | "dark" | "hc",
        colors: t.colors,
      })),
    );
  } catch {
    themeId = "dark-modern";
  }
  applyThemeById(registry, themeId, document.documentElement.style);
}
