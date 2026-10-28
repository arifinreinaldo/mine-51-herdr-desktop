// Ctrl+click / Ctrl+hover link handling (terminal-parity spec P0 #6
// "Links"): `pane.link.activate {pane_id, viewport_row, col,
// content_revision, offset_from_bottom}` returns `{url?, handled}`; when
// `handled` is false and `url` is http(s), the client opens it
// (`safe_web_url` check, `src/client/shell/actions.rs:685-697`); hover uses
// the same params against `pane.link.resolve`, returning `{regions}` --
// spec fact "Link handling".

import { invoke } from "@tauri-apps/api/core";
import { api, errorMessage, invokeSafe, showErrorNotice } from "./appApi";

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
export async function activateLink(params: PaneLinkParams): Promise<boolean> {
  const result = await api<{ url?: string; handled?: boolean }>("pane.link.activate", { ...params });
  if (!result) return false;
  if (result.handled) return true;
  if (result.url) {
    void invokeSafe("open_external_url", { url: result.url });
    return true;
  }
  return false;
}

export interface PathMatch {
  path: string;
  region: PaneLinkRegion;
}

// shortcut: Windows drive paths without spaces, one row only, col == string
// index (ASCII); upgrade to quoted/spaced/wrapped paths when one is missed.
const WIN_PATH = /[A-Za-z]:\\[^\s"'<>|*?]+/g;

/** Finds the `C:\...\file.ext` path under `col` in a row of terminal text. */
export function pathAtColumn(rowText: string, col: number, row = 0): PathMatch | null {
  for (const m of rowText.matchAll(WIN_PATH)) {
    const path = m[0].replace(/[.,;:!)\]}]+$/, "");
    const start = m.index ?? 0;
    const end = start + path.length - 1;
    if (col >= start && col <= end) return { path, region: { row, start_col: start, end_col: end } };
  }
  return null;
}

/** Ctrl+click fallback: opens the file path under the click, if any. */
export function openLocalPath(path: string): void {
  void invokeSafe("open_local_path", { path });
}

/** Ctrl+hover: resolves the link region(s) at/around the hovered cell, for
 * drawing the underline and switching the cursor to a pointer. */
export async function resolveLinkRegions(params: PaneLinkParams): Promise<PaneLinkRegion[]> {
  if (hoverUnsupported) return [];
  try {
    const result = await invoke<{ regions?: PaneLinkRegion[] }>("api", {
      method: "pane.link.resolve",
      params: { ...params },
    });
    return result?.regions ?? [];
  } catch (err: unknown) {
    // An older herdr server has no `pane.link.resolve`. Hover fires on every
    // Ctrl+mouse move, so a notice per call floods the screen: stop asking
    // for this session and stay silent. Any other error still shows.
    if (isUnsupportedMethod(err)) hoverUnsupported = true;
    else showErrorNotice(errorMessage(err));
    return [];
  }
}

let hoverUnsupported = false;

export function isUnsupportedMethod(err: unknown): boolean {
  return errorMessage(err).startsWith("unsupported_method");
}

/** Throttles Ctrl+hover to one `pane.link.resolve` call per `intervalMs`
 * (spec: "throttled to one call per 100ms"). Pure predicate: `true` when a
 * call at `now` is allowed given the last allowed call was at `lastCallAt`
 * (`null` = never called yet). */
export function hoverCallAllowed(lastCallAt: number | null, now: number, intervalMs = 100): boolean {
  return lastCallAt === null || now - lastCallAt >= intervalMs;
}
