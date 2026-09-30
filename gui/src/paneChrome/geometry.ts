// Pure cell-space maths for the pane chrome overlay (focus ring, dim layer,
// header strip). DOM and IPC glue lives in `paneChrome.ts`.

import type { Grid } from "../grid";
import type { CellRect } from "../mouse/geometry";

export interface LayoutPane {
  pane_id: string;
  rect: CellRect;
  inner_rect: CellRect;
  scrollbar_rect: CellRect | null;
  focused: boolean;
}

/** Fractional cell box. Its edges sit on the centre of the border line that
 * the server draws, so the 2px ring covers that line instead of doubling it. */
export interface CellBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The union of `inner_rect` and `scrollbar_rect`: the pane without borders. */
function contentBox(pane: LayoutPane): CellBox {
  const i = pane.inner_rect;
  const box: CellBox = { left: i.x, top: i.y, right: i.x + i.width, bottom: i.y + i.height };
  const s = pane.scrollbar_rect;
  if (s) {
    box.left = Math.min(box.left, s.x);
    box.top = Math.min(box.top, s.y);
    box.right = Math.max(box.right, s.x + s.width);
    box.bottom = Math.max(box.bottom, s.y + s.height);
  }
  return box;
}

/** True when another pane starts at `edge` on `axis`, overlaps this pane on the
 * other axis, and owns a border cell on that side (`inner_rect` starts after
 * `rect`). That is the `pane_gaps = false` case: the server removes this pane's
 * far border and draws the shared line as the neighbour's near border. */
function neighbourBorderAt(axis: "x" | "y", edge: number, pane: LayoutPane, panes: readonly LayoutPane[]): boolean {
  const other = axis === "x" ? "y" : "x";
  const size = axis === "x" ? "height" : "width";
  return panes.some((p) => {
    if (p === pane || p.pane_id === pane.pane_id) return false;
    if (p.rect[axis] !== edge) return false;
    if (p.inner_rect[axis] <= p.rect[axis]) return false;
    return p.rect[other] < pane.rect[other] + pane.rect[size] && p.rect[other] + p.rect[size] > pane.rect[other];
  });
}

export function ringBox(pane: LayoutPane, panes: readonly LayoutPane[]): CellBox {
  const { rect } = pane;
  const content = contentBox(pane);
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;
  return {
    left: content.left > rect.x ? content.left - 0.5 : rect.x,
    top: content.top > rect.y ? content.top - 0.5 : rect.y,
    right:
      content.right < rectRight
        ? content.right + 0.5
        : neighbourBorderAt("x", rectRight, pane, panes)
          ? rectRight + 0.5
          : rectRight,
    bottom:
      content.bottom < rectBottom
        ? content.bottom + 0.5
        : neighbourBorderAt("y", rectBottom, pane, panes)
          ? rectBottom + 0.5
          : rectBottom,
  };
}

export type HeaderMode = "strip" | "pill" | "none";

/** strip: the pane has a top border row (content.y > rect.y).
 *  pill: no top border row, the pane is focused and its tab is zoomed.
 *  none: otherwise. */
export function headerMode(pane: LayoutPane, tabZoomed: boolean): HeaderMode {
  if (contentBox(pane).top > pane.rect.y) return "strip";
  if (pane.focused && tabZoomed) return "pill";
  return "none";
}

function isBoxDrawing(symbol: string): boolean {
  const cp = symbol.codePointAt(0);
  return cp !== undefined && cp >= 0x2500 && cp <= 0x257f;
}

/** The title the server drew into the pane's top border row, read back from the
 * grid so the DOM label shows the same text. `null` when the pane has no top
 * border or no title. `cells` is the width in cells of the drawn `" label "` run. */
export function borderTitle(grid: Grid, pane: LayoutPane): { text: string; startCol: number; cells: number } | null {
  const { rect } = pane;
  if (contentBox(pane).top <= rect.y) return null;
  if (rect.y >= grid.height) return null;
  const startCol = rect.x + 1;
  const lastCol = Math.min(rect.x + rect.width - 2, grid.width - 1);
  let text = "";
  let cells = 0;
  for (let col = startCol; col <= lastCol; col++) {
    const cell = grid.cells[rect.y * grid.width + col];
    if (!cell) break;
    if (cell.skip) {
      cells++;
      continue;
    }
    if (isBoxDrawing(cell.symbol)) break;
    text += cell.symbol;
    cells++;
  }
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return { text: trimmed, startCol, cells };
}
