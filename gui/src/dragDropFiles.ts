// Drag and drop files onto the terminal (terminal-parity spec P1 #14):
// Tauri's `onDragDropEvent` over the terminal pastes the dropped paths into
// the pane under the pointer, each quoted for PowerShell (`'…'`, with inner
// `'` doubled) and separated by spaces. Uses `Paste`, not typed keys, so the
// server adds bracketed paste like every other paste path.

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, invokeSafe } from "./appApi";
import { canvas } from "./appDom";
import { appState } from "./appState";
import { pixelToCell } from "./mouse/geometry";

interface PaneMouseHitLike {
  pane_id: string;
}

/** PowerShell single-quoting: wrap in `'...'`, doubling any embedded `'`
 * (PowerShell's own escape for a single quote inside a single-quoted
 * string) -- safe for paths containing spaces, `$`, backticks, etc., none
 * of which are special inside a single-quoted PowerShell string. */
export function quotePathForPowerShell(path: string): string {
  return `'${path.replace(/'/g, "''")}'`;
}

export function pathsToPasteText(paths: readonly string[]): string {
  return paths.map(quotePathForPowerShell).join(" ");
}

async function onDrop(paths: string[], position: { x: number; y: number }): Promise<void> {
  const renderer = appState.renderer;
  if (!renderer || paths.length === 0) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const { width: cellWidthPx, height: cellHeightPx } = renderer.getCellSizeDevicePx();
  // `position` is in physical px (device px), same convention `pixelToCell`
  // already expects after its own `* dpr` -- so the client-px input it
  // wants here is `position / dpr`.
  const cell = pixelToCell(position.x / dpr, position.y / dpr, rect.left, rect.top, dpr, cellWidthPx, cellHeightPx);
  const hit = await invokeSafe<PaneMouseHitLike | null>("pane_mouse_hit", { col: cell.col, row: cell.row });
  if (!hit) return;
  void api("pane.focus", { pane_id: hit.pane_id });
  void invokeSafe("send_input", { paneId: hit.pane_id, events: [{ Paste: pathsToPasteText(paths) }] });
}

export function wireDragDropFiles(): void {
  void getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "drop") void onDrop(event.payload.paths, event.payload.position);
  });
}
