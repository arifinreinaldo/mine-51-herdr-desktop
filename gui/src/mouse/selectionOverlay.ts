// Renders the host-side text selection highlight as absolutely-positioned
// `<div>`s over `#terminal-wrap`, not inside the canvas's own paint
// pipeline (`render/renderer.ts`): the canvas repaints only on a new
// surface frame or an explicit `markDirty`, and a selection drag must
// redraw every pointermove without waiting on either. A thin CSS overlay is
// additive and independent of the renderer's atlas/dirty-row machinery, at
// the cost of not being pixel-composited with cell backgrounds the way
// herdr's TUI renders its selection (an accepted simplification for Phase
// 1 -- see this feature's scope notes).
//
// DOM glue only; the actual row/column geometry it draws comes from
// `mouse/geometry.ts`'s `selectionRowRects` (unit-tested there, same split
// as `render/renderer.ts` vs. `render/metrics.ts`).

import type { SelectionRowRect } from "./geometry";

export class SelectionOverlay {
  private readonly rows: HTMLDivElement[] = [];

  constructor(private readonly container: HTMLElement) {}

  /** `originLeftCss`/`originTopCss`: the pane's inner_rect origin in CSS
   * px, relative to `container` (typically `canvasRect - containerRect`
   * plus `innerRect.x/y * cellSizeCss`). `cellWidthCss`/`cellHeightCss`:
   * one cell's CSS size (device px / dpr). */
  render(
    rects: readonly SelectionRowRect[],
    originLeftCss: number,
    originTopCss: number,
    cellWidthCss: number,
    cellHeightCss: number,
  ): void {
    while (this.rows.length < rects.length) {
      const div = document.createElement("div");
      div.className = "terminal-selection-row";
      this.container.appendChild(div);
      this.rows.push(div);
    }
    while (this.rows.length > rects.length) {
      this.rows.pop()?.remove();
    }
    rects.forEach((rect, index) => {
      const el = this.rows[index];
      el.style.left = `${originLeftCss + rect.startCol * cellWidthCss}px`;
      el.style.top = `${originTopCss + rect.row * cellHeightCss}px`;
      el.style.width = `${(rect.endCol - rect.startCol) * cellWidthCss}px`;
      el.style.height = `${cellHeightCss}px`;
    });
  }

  clear(): void {
    for (const row of this.rows.splice(0)) row.remove();
  }
}
