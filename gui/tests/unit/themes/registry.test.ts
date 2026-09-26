import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES, applyThemeById, findBuiltInTheme, ThemeRegistry } from "../../../src/themes/index";
import { REQUIRED_KEYS, resolveThemeColor } from "../../../src/themes/tokens";
import { DARK_MODERN_COLORS } from "../../../src/themes/dark-modern";

describe("built-in themes", () => {
  it("lists exactly the six built-ins from spec §2.2", () => {
    const ids = BUILT_IN_THEMES.map((t) => t.id).sort();
    expect(ids).toEqual(
      ["catppuccin-mocha", "dark-modern", "dracula", "herdr", "one-dark-pro", "tokyo-night"].sort(),
    );
  });

  it("every built-in theme resolves every required key to a string", () => {
    for (const theme of BUILT_IN_THEMES) {
      for (const key of REQUIRED_KEYS) {
        const value = resolveThemeColor(key, theme.colors, DARK_MODERN_COLORS);
        expect(value, `${theme.id} missing ${key}`).toBeTypeOf("string");
      }
    }
  });

  it("findBuiltInTheme finds by id and returns undefined for an unknown id", () => {
    expect(findBuiltInTheme("dracula")?.label).toBe("Dracula");
    expect(findBuiltInTheme("not-a-theme")).toBeUndefined();
  });
});

describe("ThemeRegistry", () => {
  it("lists built-ins before imported themes", () => {
    const registry = new ThemeRegistry();
    registry.setImported([{ id: "my-import", label: "My Import", kind: "dark", colors: {} }]);
    const list = registry.list();
    expect(list[list.length - 1].id).toBe("my-import");
    expect(list.slice(0, BUILT_IN_THEMES.length).map((t) => t.id)).toEqual(
      BUILT_IN_THEMES.map((t) => t.id),
    );
  });

  it("falls back to Dark Modern for an unknown id", () => {
    const registry = new ThemeRegistry();
    expect(registry.find("does-not-exist").id).toBe("dark-modern");
  });

  it("finds an imported theme by id", () => {
    const registry = new ThemeRegistry();
    registry.setImported([{ id: "my-import", label: "My Import", kind: "light", colors: {} }]);
    expect(registry.find("my-import").label).toBe("My Import");
  });
});

describe("applyThemeById", () => {
  it("applies the resolved theme's colours and returns its definition", () => {
    const registry = new ThemeRegistry();
    const written = new Map<string, string>();
    const sink = { setProperty: (name: string, value: string) => written.set(name, value) };
    const resolved = applyThemeById(registry, "dracula", sink);
    expect(resolved.id).toBe("dracula");
    expect(written.get("--terminal-background")).toBe(resolved.colors["terminal.background"]);
  });
});
