// Ctrl+click / Ctrl+hover link handling (terminal-parity spec P0 #6
// "Links"): `pane.link.activate {pane_id, viewport_row, col,
// content_revision, offset_from_bottom}` returns `{url?, handled}`; when
// `handled` is false and `url` is http(s), the client opens it
// (`safe_web_url` check, `src/client/shell/actions.rs:685-697`); hover uses
// the same params against `pane.link.resolve`, returning `{regions}` --
// spec fact "Link handling".

import { api, invokeSafe } from "./appApi";

export interface PaneLinkParams {
  pane_id: string;
  viewport_row: number;
  col: number;
  content_revision?: number;
  offset_from_bottom?: number;
}

export interface PaneLinkRegion {
  row: number;
  start_col: number;
  end_col: number;
}

/** Ctrl+click: activates the link (if any) under the click. If the server
 * didn't handle it itself and returned an http(s) URL, opens it via the
 * Rust `open_external_url` command (which re-validates the scheme --
 * `commands.rs`'s `is_safe_web_url`, never trusts this call site alone). */
export async function activateLink(params: PaneLinkParams): Promise<void> {
  const result = await api<{ url?: string; handled?: boolean }>("pane.link.activate", { ...params });
  if (!result || result.handled) return;
  if (result.url) void invokeSafe("open_external_url", { url: result.url });
}

/** Ctrl+hover: resolves the link region(s) at/around the hovered cell, for
 * drawing the underline and switching the cursor to a pointer. */
export async function resolveLinkRegions(params: PaneLinkParams): Promise<PaneLinkRegion[]> {
  const result = await api<{ regions?: PaneLinkRegion[] }>("pane.link.resolve", { ...params });
  return result?.regions ?? [];
}

/** Throttles Ctrl+hover to one `pane.link.resolve` call per `intervalMs`
 * (spec: "throttled to one call per 100ms"). Pure predicate: `true` when a
 * call at `now` is allowed given the last allowed call was at `lastCallAt`
 * (`null` = never called yet). */
export function hoverCallAllowed(lastCallAt: number | null, now: number, intervalMs = 100): boolean {
  return lastCallAt === null || now - lastCallAt >= intervalMs;
}
