import { describe, expect, it } from "vitest";
import {
  applyTheme,
  cssVarName,
  DEFAULT_WORKSPACE_PALETTE,
  REQUIRED_KEYS,
  resolveThemeColor,
  resolveWorkspacePaletteColor,
  type ThemeColors,
} from "../../../src/themes/tokens";
import { DARK_MODERN_COLORS } from "../../../src/themes/dark-modern";

describe("cssVarName", () => {
  it("replaces every dot with a dash", () => {
    expect(cssVarName("sideBar.background")).toBe("--sideBar-background");
    expect(cssVarName("herdr.status.working")).toBe("--herdr-status-working");
    expect(cssVarName("foreground")).toBe("--foreground");
  });
});

describe("resolveThemeColor", () => {
  const darkModern: ThemeColors = DARK_MODERN_COLORS;

  it("returns the theme's own value when present", () => {
    const theme: ThemeColors = { foreground: "#abcabc" };
    expect(resolveThemeColor("foreground", theme, darkModern)).toBe("#abcabc");
  });

  it("falls back to the theme's own explicit-fallback key (terminal.background -> editor.background)", () => {
    const theme: ThemeColors = { "editor.background": "#111111" };
    expect(resolveThemeColor("terminal.background", theme, darkModern)).toBe("#111111");
  });

  it("falls back to Dark Modern's explicit-fallback key when the theme has neither", () => {
    const theme: ThemeColors = {};
    expect(resolveThemeColor("terminal.background", theme, darkModern)).toBe(
      darkModern["editor.background"],
    );
  });

  it("herdr.status.* falls back through charts.* (spec §2.1 herdr keys)", () => {
    const theme: ThemeColors = { "charts.blue": "#4488ff" };
    expect(resolveThemeColor("herdr.status.working", theme, darkModern)).toBe("#4488ff");
  });

  it("herdr.status.idle falls back through descriptionForeground", () => {
    const theme: ThemeColors = { descriptionForeground: "#999999" };
    expect(resolveThemeColor("herdr.status.idle", theme, darkModern)).toBe("#999999");
  });

  it("falls all the way back to Dark Modern's own value for a key with no fallback and no theme override", () => {
    const theme: ThemeColors = {};
    expect(resolveThemeColor("herdr.danger", theme, darkModern)).toBe(darkModern["herdr.danger"]);
  });

  it("a sparse imported theme resolves every required key without throwing", () => {
    const sparse: ThemeColors = { foreground: "#ffffff" };
    for (const key of REQUIRED_KEYS) {
      expect(resolveThemeColor(key, sparse, darkModern)).toBeTypeOf("string");
    }
  });
});

describe("applyTheme", () => {
  it("writes every required key as a CSS custom property", () => {
    const written = new Map<string, string>();
    const sink = { setProperty: (name: string, value: string) => written.set(name, value) };
    applyTheme(DARK_MODERN_COLORS, DARK_MODERN_COLORS, sink);
    expect(written.size).toBe(REQUIRED_KEYS.length);
    expect(written.get("--terminal-background")).toBe(DARK_MODERN_COLORS["terminal.background"]);
    expect(written.get("--herdr-status-working")).toBe(DARK_MODERN_COLORS["herdr.status.working"]);
  });
});

describe("resolveWorkspacePaletteColor", () => {
  it("falls back to the default palette when the theme doesn't override it", () => {
    expect(resolveWorkspacePaletteColor(0, {})).toBe(DEFAULT_WORKSPACE_PALETTE[0]);
  });

  it("uses the theme's override when present", () => {
    const theme: ThemeColors = { "herdr.workspace.1": "#123456" };
    expect(resolveWorkspacePaletteColor(0, theme)).toBe("#123456");
  });
});
