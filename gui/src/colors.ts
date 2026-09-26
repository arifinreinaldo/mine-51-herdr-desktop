// Maps herdr's packed cell colours to CSS (spec §6 "Terminal canvas"):
// "named -> a 16-colour default palette constant, indexed -> xterm 256
// table, RGB -> direct."
//
// Packing (spec §1 "Colour packing"): `0x00_0000XX` named (0 = Reset),
// `0x01_0000II` indexed, `0x02_RRGGBB` RGB.

export type ColorKind = "named" | "indexed" | "rgb";

/**
 * The 16-colour default palette, indexed 0 = Reset/default, 1..16 matching
 * `wire.rs`'s named-colour packing order (Black, Red, Green, Yellow, Blue,
 * Magenta, Cyan, Gray, DarkGray, LightRed, LightGreen, LightYellow,
 * LightBlue, LightMagenta, LightCyan, White). Real data (not a stub): the
 * exact CSS values are a design/theming choice the implementer can tune,
 * but the table's shape and index order are fixed by the wire format.
 */
export const DEFAULT_PALETTE: readonly string[] = [
  "transparent", // 0: Reset -- caller supplies the actual default fg/bg
  "#000000", // 1: Black
  "#cd0000", // 2: Red
  "#00cd00", // 3: Green
  "#cdcd00", // 4: Yellow
  "#0000ee", // 5: Blue
  "#cd00cd", // 6: Magenta
  "#00cdcd", // 7: Cyan
  "#e5e5e5", // 8: Gray (White in ratatui's naming)
  "#7f7f7f", // 9: DarkGray (BrightBlack)
  "#ff0000", // 10: LightRed
  "#00ff00", // 11: LightGreen
  "#ffff00", // 12: LightYellow
  "#5c5cff", // 13: LightBlue
  "#ff00ff", // 14: LightMagenta
  "#00ffff", // 15: LightCyan
  "#ffffff", // 16: White
];

/** Unpacks a `fg`/`bg` u32 into its wire-encoding kind and payload. */
export function colorKind(_packed: number): ColorKind {
  throw new Error("not implemented: colorKind");
}

/**
 * Maps a packed colour to a CSS colour string, using `palette` for the
 * named case and the xterm 256 table for the indexed case. Stubbed:
 * the mapping (including the xterm 256 table) is left for the implementer.
 */
export function cssColor(_packed: number, _palette: readonly string[]): string {
  throw new Error("not implemented: cssColor");
}
