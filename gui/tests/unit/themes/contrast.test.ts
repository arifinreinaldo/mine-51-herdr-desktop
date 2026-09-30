import { describe, expect, it } from "vitest";
import { BUILT_IN_THEMES } from "../../../src/themes/index";
import { DARK_MODERN_COLORS } from "../../../src/themes/dark-modern";
import { resolveThemeColor } from "../../../src/themes/tokens";

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const n = parseInt(h.slice(0, 6), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2.x contrast ratio between two opaque `#rrggbb` colours. */
function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrastRatio helper", () => {
  it("is 21 for black on white and 1 for identical colours", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});

describe("secondary text contrast (S7)", () => {
  const backgrounds = ["sideBar.background", "menu.background", "list.hoverBackground", "terminal.background"];
  for (const theme of BUILT_IN_THEMES) {
    for (const bgKey of backgrounds) {
      it(`${theme.label}: descriptionForeground on ${bgKey} is at least 4.5:1`, () => {
        const fg = resolveThemeColor("descriptionForeground", theme.colors, DARK_MODERN_COLORS)!;
        const bg = resolveThemeColor(bgKey, theme.colors, DARK_MODERN_COLORS)!;
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
