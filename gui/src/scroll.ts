// Keyboard scrollback (terminal-parity spec P1 #10 "Scrollback keys"):
// Shift+PgUp/PgDn scroll by one page, Shift+Home/End jump to the top/
// bottom, all through `pane.scroll {pane_id, offset_from_bottom}` --
// `PaneSurfacePane.scroll`/`viewport_rows` (spec fact "it routes the wheel
// to scrollback... and plain PgUp/PgDn at a shell prompt scroll the
// scrollback", `src/server/pane_input.rs:128-185,293-309` -- Shift+PgUp/PgDn
// are a GUI-only addition on top of that, distinct from the plain,
// server-side PgUp/PgDn behavior).

import { api, invokeSafe } from "./appApi";
import { focusedPaneId } from "./appLookups";

export interface ScrollMetricsLike {
  offset_from_bottom: number;
  max_offset_from_bottom: number;
  viewport_rows: number;
}

/** One page = `viewport_rows` (at least 1, so a 0-row pane never divides by
 * zero / never-scrolls), clamped to `[0, max_offset_from_bottom]`. */
export function pageScrollOffset(
  metrics: ScrollMetricsLike,
  direction: "up" | "down",
): number {
  const page = Math.max(1, metrics.viewport_rows);
  if (direction === "up") {
    return Math.min(metrics.max_offset_from_bottom, metrics.offset_from_bottom + page);
  }
  return Math.max(0, metrics.offset_from_bottom - page);
}

async function focusedPaneScrollMetrics(): Promise<{ paneId: string; scroll: ScrollMetricsLike } | null> {
  const paneId = focusedPaneId();
  if (!paneId) return null;
  const scroll = await invokeSafe<ScrollMetricsLike | null>("pane_scroll_info", { paneId });
  if (!scroll) return null;
  return { paneId, scroll };
}

/** Shift+PgUp/PgDn: scrolls the focused pane by one page. A no-op with no
 * focused pane or no scroll metrics (e.g. an alternate-screen app). */
export async function scrollFocusedPaneByPage(direction: "up" | "down"): Promise<void> {
  const found = await focusedPaneScrollMetrics();
  if (!found) return;
  const offset = pageScrollOffset(found.scroll, direction);
  void api("pane.scroll", { pane_id: found.paneId, offset_from_bottom: offset });
}

/** Shift+Home/End: jumps the focused pane to the top or bottom of
 * scrollback. `"bottom"` never needs the pane's scroll metrics (`0` is
 * always the live bottom), so it skips the round trip `"top"` needs. */
export async function scrollFocusedPaneToEdge(edge: "top" | "bottom"): Promise<void> {
  const paneId = focusedPaneId();
  if (!paneId) return;
  if (edge === "bottom") {
    void api("pane.scroll", { pane_id: paneId, offset_from_bottom: 0 });
    return;
  }
  const scroll = await invokeSafe<ScrollMetricsLike | null>("pane_scroll_info", { paneId });
  if (!scroll) return;
  void api("pane.scroll", { pane_id: paneId, offset_from_bottom: scroll.max_offset_from_bottom });
}
