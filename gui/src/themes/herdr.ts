// "herdr" built-in theme (spec phase1.5 §2.2): "near-black with a peach
// active tab". Palette lifted from the mock's `THEMES.herdr` table.

import { buildTheme, type CompactPalette } from "./build";
import type { ThemeColors } from "./tokens";

const PALETTE: CompactPalette = {
  bg: "#0c0c0c",
  side: "#121212",
  border: "#262626",
  fg: "#d4d4d4",
  desc: "#8a8a8a",
  accent: "#f4b183",
  accentFg: "#1a1a1a",
  sel: "#2a2320",
  hover: "#1c1c1c",
  menu: "#161616",
  tabActiveBg: "#f4b183",
  tabActiveFg: "#1a1a1a",
  hoverW: "#161616",
  orange: "#f4b183",
  ansi: {
    black: "#0c0c0c",
    red: "#e06c75",
    green: "#9ccc65",
    yellow: "#e6c07b",
    blue: "#6cb6ff",
    magenta: "#c792ea",
    cyan: "#7fdbca",
    white: "#d4d4d4",
    brightBlack: "#5a5a5a",
    brightRed: "#f28b82",
    brightGreen: "#9ccc65",
    brightYellow: "#f4b183",
    brightBlue: "#7fb4ff",
    brightMagenta: "#d7aefb",
    brightCyan: "#9be8d8",
    brightWhite: "#ffffff",
  },
};

export const HERDR_COLORS: ThemeColors = buildTheme(PALETTE);
