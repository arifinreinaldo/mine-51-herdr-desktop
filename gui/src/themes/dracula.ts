// Dracula (spec phase1.5 §2.2). Chrome palette from the mock's
// `THEMES.dracula` table; ANSI 16 from Dracula's published terminal palette
// (draculatheme.com/contribute).

import { buildTheme, type CompactPalette } from "./build";
import type { ThemeColors } from "./tokens";

const PALETTE: CompactPalette = {
  bg: "#282a36",
  side: "#21222c",
  border: "#191a21",
  fg: "#f8f8f2",
  desc: "#6272a4",
  accent: "#bd93f9",
  accentFg: "#282a36",
  sel: "#44475a",
  hover: "#343746",
  menu: "#21222c",
  hoverW: "#21222c",
  orange: "#ffb86c",
  ansi: {
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
};

export const DRACULA_COLORS: ThemeColors = buildTheme(PALETTE);
