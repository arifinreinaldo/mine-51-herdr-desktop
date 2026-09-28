import { describe, expect, it } from "vitest";
import { UNDERLINE_STYLE_SHIFT, underlineStyleFromModifier } from "../../../src/render/underline";

function withUnderlineStyle(nibble: number): number {
  return (nibble & 0x0f) << UNDERLINE_STYLE_SHIFT;
}

describe("underlineStyleFromModifier", () => {
  it("maps every nibble value per src/protocol/render_ansi.rs:439-445", () => {
    expect(underlineStyleFromModifier(withUnderlineStyle(0))).toBe("single");
    expect(underlineStyleFromModifier(withUnderlineStyle(1))).toBe("single");
    expect(underlineStyleFromModifier(withUnderlineStyle(2))).toBe("double");
    expect(underlineStyleFromModifier(withUnderlineStyle(3))).toBe("curly");
    expect(underlineStyleFromModifier(withUnderlineStyle(4))).toBe("dotted");
    expect(underlineStyleFromModifier(withUnderlineStyle(5))).toBe("dashed");
  });

  it("falls back to single for an unrecognized nibble, matching render_ansi.rs's own default", () => {
    expect(underlineStyleFromModifier(withUnderlineStyle(9))).toBe("single");
  });

  it("ignores the low 12 bits (the ordinary modifier flags)", () => {
    const boldUnderlinedCurly = 0x0009 | withUnderlineStyle(3);
    expect(underlineStyleFromModifier(boldUnderlinedCurly)).toBe("curly");
  });
});
