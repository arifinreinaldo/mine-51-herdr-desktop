// Tokyo Night (spec phase1.5 §2.2). Chrome palette from the mock's
// `THEMES.tokyonight` table; ANSI 16 from Tokyo Night's published terminal
// palette (github.com/enkia/tokyo-night-vscode-theme).

import { buildTheme, type CompactPalette } from "./build";
import type { ThemeColors } from "./tokens";

const PALETTE: CompactPalette = {
  bg: "#1a1b26",
  side: "#16161e",
  border: "#101014",
  fg: "#a9b1d6",
  desc: "#565f89",
  accent: "#7aa2f7",
  accentFg: "#16161e",
  sel: "#283457",
  hover: "#1f2030",
  menu: "#16161e",
  hoverW: "#16161e",
  orange: "#ff9e64",
  ansi: {
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#f7768e",
    brightGreen: "#9ece6a",
    brightYellow: "#e0af68",
    brightBlue: "#7aa2f7",
    brightMagenta: "#bb9af7",
    brightCyan: "#7dcfff",
    brightWhite: "#c0caf5",
  },
};

export const TOKYO_NIGHT_COLORS: ThemeColors = buildTheme(PALETTE);
