// Positions the hidden `#keyboard-capture` textarea at the terminal
// cursor's cell (terminal-parity spec P1 #16 "IME"), so the OS IME
// candidate window appears next to the cursor instead of the window's
// top-left corner (where the textarea otherwise permanently sits,
// `style.css`'s `top: 0; left: 0`). `grid.cursor.x`/`y` are already
// surface-absolute cell coordinates -- the same ones `render/renderer.ts`'s
// `paintCursor` draws at directly -- so this mirrors that positioning, not
// a pane-relative one.

import { keyboardCapture } from "./appDom";
import { appState } from "./appState";
import { paneOverlayOrigin } from "./mouse/overlayGeometry";

export function positionKeyboardCaptureAtCursor(): void {
  const renderer = appState.renderer;
  const cursor = appState.grid.cursor;
  if (!renderer || !cursor) return;
  const origin = paneOverlayOrigin({ x: 0, y: 0, width: 0, height: 0 }, renderer);
  keyboardCapture.style.left = `${origin.originLeft + cursor.x * origin.cellWidthCss}px`;
  keyboardCapture.style.top = `${origin.originTop + cursor.y * origin.cellHeightCss}px`;
}
