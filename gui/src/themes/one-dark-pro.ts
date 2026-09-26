// One Dark Pro (spec phase1.5 §2.2). Chrome palette from the mock's
// `THEMES.onedark` table; ANSI 16 from the (Atom) One Dark terminal
// palette that One Dark Pro ships for VS Code's integrated terminal.

import { buildTheme, type CompactPalette } from "./build";
import type { ThemeColors } from "./tokens";

const PALETTE: CompactPalette = {
  bg: "#282c34",
  side: "#21252b",
  border: "#181a1f",
  fg: "#abb2bf",
  desc: "#7f848e",
  accent: "#61afef",
  accentFg: "#21252b",
  sel: "#2c313a",
  hover: "#2c313a",
  menu: "#21252b",
  hoverW: "#21252b",
  orange: "#d19a66",
  ansi: {
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
};

export const ONE_DARK_PRO_COLORS: ThemeColors = buildTheme(PALETTE);
