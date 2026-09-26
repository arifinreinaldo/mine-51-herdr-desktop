// Catppuccin Mocha (spec phase1.5 §2.2). Chrome palette from the mock's
// `THEMES.catppuccin` table; ANSI 16 from Catppuccin's published terminal
// palette (github.com/catppuccin/catppuccin).

import { buildTheme, type CompactPalette } from "./build";
import type { ThemeColors } from "./tokens";

const PALETTE: CompactPalette = {
  bg: "#1e1e2e",
  side: "#181825",
  border: "#11111b",
  fg: "#cdd6f4",
  desc: "#a6adc8",
  accent: "#cba6f7",
  accentFg: "#1e1e2e",
  sel: "#313244",
  hover: "#262637",
  menu: "#181825",
  hoverW: "#181825",
  orange: "#fab387",
  ansi: {
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8",
  },
};

export const CATPPUCCIN_MOCHA_COLORS: ThemeColors = buildTheme(PALETTE);
