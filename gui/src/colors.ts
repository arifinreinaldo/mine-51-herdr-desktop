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
export function colorKind(packed: number): ColorKind {
  const tag = (packed >>> 24) & 0xff;
  if (tag === 0x02) return "rgb";
  if (tag === 0x01) return "indexed";
  return "named";
}

/**
 * The xterm 256-colour table, indices 0-255. 0-15 mirror the standard
 * 16-colour palette (kept distinct from `DEFAULT_PALETTE`, which is
 * herdr's own named-colour packing order); 16-231 are the 6x6x6 colour
 * cube; 232-255 are the grayscale ramp.
 */
function buildXterm256Table(): string[] {
  const table: string[] = [
    "#000000",
    "#800000",
    "#008000",
    "#808000",
    "#000080",
    "#800080",
    "#008080",
    "#c0c0c0",
    "#808080",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#0000ff",
    "#ff00ff",
    "#00ffff",
    "#ffffff",
  ];
  const ramp = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        const hex = (n: number) => n.toString(16).padStart(2, "0");
        table.push(`#${hex(ramp[r])}${hex(ramp[g])}${hex(ramp[b])}`);
      }
    }
  }
  for (let i = 0; i < 24; i++) {
    const level = 8 + i * 10;
    const hex = level.toString(16).padStart(2, "0");
    table.push(`#${hex}${hex}${hex}`);
  }
  return table;
}

const XTERM_256_TABLE: readonly string[] = buildXterm256Table();

/**
 * Maps a packed colour to a CSS colour string, using `palette` for the
 * named case and the xterm 256 table for the indexed case.
 */
export function cssColor(packed: number, palette: readonly string[]): string {
  const kind = colorKind(packed);
  const payload = packed & 0x00ffffff;
  if (kind === "rgb") {
    const r = (payload >>> 16) & 0xff;
    const g = (payload >>> 8) & 0xff;
    const b = payload & 0xff;
    return `rgb(${r}, ${g}, ${b})`;
  }
  if (kind === "indexed") {
    const index = payload & 0xff;
    return XTERM_256_TABLE[index] ?? palette[0];
  }
  // Named: index 0 is Reset, 1-16 are the 16 named colours.
  const index = payload & 0xff;
  return palette[index] ?? palette[0];
}
