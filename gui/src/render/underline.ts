// Herdr's underline-style nibble (terminal-parity spec P1 #15 "Rendering"):
// bits 12-15 of the modifier word carry the SGR 4:<n> underline style,
// independent of whether the underline bit (bit3) itself is set. Mirrors
// `src/protocol/wire.rs:1582-1605` (the shift/mask) and
// `render_ansi.rs:439-445` (the value -> style mapping, including its
// `_ => "4"` single-underline fallback for any unrecognized nibble).

export const UNDERLINE_STYLE_SHIFT = 12;
export const UNDERLINE_STYLE_MASK = 0xf000;

export type UnderlineStyle = "single" | "double" | "curly" | "dotted" | "dashed";

export function underlineStyleFromModifier(modifier: number): UnderlineStyle {
  const nibble = (modifier & UNDERLINE_STYLE_MASK) >> UNDERLINE_STYLE_SHIFT;
  switch (nibble) {
    case 2:
      return "double";
    case 3:
      return "curly";
    case 4:
      return "dotted";
    case 5:
      return "dashed";
    default:
      return "single";
  }
}
