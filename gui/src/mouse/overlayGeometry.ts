// Shared CSS-pixel origin/cell-size maths for every row-rect overlay drawn
// over `#terminal-wrap` (the mouse-selection highlight, the Ctrl+hover link
// underline, the find-bar match highlight, and copy mode's selection/
// cursor) -- extracted so it has exactly one implementation instead of one
// per overlay (`appTerminalMouse.ts`, `ui/findBar.ts`, `copyMode.ts`). DOM
// glue, like `render/renderer.ts`; not unit-tested for the same reason
// (no canvas/layout in the test environment).

import { canvas, terminalWrapEl } from "../appDom";
import type { CellRect } from "./geometry";
import type { TerminalRenderer } from "../render/renderer";

export interface OverlayOrigin {
  originLeft: number;
  originTop: number;
  cellWidthCss: number;
  cellHeightCss: number;
}

/** `innerRect`'s origin in CSS px relative to `#terminal-wrap`, plus one
 * cell's CSS size -- everything `SelectionOverlay.render()` needs besides
 * the row rects themselves. */
export function paneOverlayOrigin(innerRect: CellRect, renderer: TerminalRenderer): OverlayOrigin {
  const dpr = window.devicePixelRatio || 1;
  const { width: cellWidthPx, height: cellHeightPx } = renderer.getCellSizeDevicePx();
  const cellWidthCss = cellWidthPx / dpr;
  const cellHeightCss = cellHeightPx / dpr;
  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = terminalWrapEl.getBoundingClientRect();
  return {
    originLeft: canvasRect.left - wrapRect.left + innerRect.x * cellWidthCss,
    originTop: canvasRect.top - wrapRect.top + innerRect.y * cellHeightCss,
    cellWidthCss,
    cellHeightCss,
  };
}
