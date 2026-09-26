import { describe, expect, it } from "vitest";
import { colorKind, cssColor, DEFAULT_PALETTE } from "../../src/colors";

describe("DEFAULT_PALETTE", () => {
  it("has 17 entries: index 0 for Reset plus the 16 named colours", () => {
    expect(DEFAULT_PALETTE).toHaveLength(17);
  });
});

describe("colorKind", () => {
  it("recognizes named colours (0x00_0000XX, including Reset = 0)", () => {
    expect(colorKind(0x00_00_00_00)).toBe("named");
    expect(colorKind(0x00_00_00_02)).toBe("named"); // Red
  });

  it("recognizes indexed colours (0x01_0000II)", () => {
    expect(colorKind(0x01_00_00_dc)).toBe("indexed"); // Indexed(220)
  });

  it("recognizes RGB colours (0x02_RRGGBB)", () => {
    expect(colorKind(0x02_ff_80_00)).toBe("rgb");
  });
});

describe("cssColor", () => {
  it("maps a named colour through the palette", () => {
    // Red = named index 2 (wire.rs:1526).
    expect(cssColor(0x00_00_00_02, DEFAULT_PALETTE)).toBe(DEFAULT_PALETTE[2]);
  });

  it("maps Reset (0) through the palette's index 0", () => {
    expect(cssColor(0x00_00_00_00, DEFAULT_PALETTE)).toBe(DEFAULT_PALETTE[0]);
  });

  it("maps RGB directly, ignoring the palette", () => {
    expect(cssColor(0x02_ff_80_00, DEFAULT_PALETTE)).toBe("rgb(255, 128, 0)");
  });

  it("maps an indexed colour through the xterm 256 table (spot check: index 9 = bright red)", () => {
    // The xterm 256 table is a distinct, larger table from herdr's own
    // 16-colour named palette (spec §6): index 9 is the standard
    // "bright red" in every common xterm 256-colour reference chart.
    expect(cssColor(0x01_00_00_09, DEFAULT_PALETTE)).toBe("#ff0000");
  });
});
