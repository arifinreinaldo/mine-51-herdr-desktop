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

// shortcut: Windows drive paths without spaces, col == string index (ASCII);
// upgrade to quoted/spaced paths when one is missed.
const WIN_PATH = /(?<![A-Za-z0-9])[A-Za-z]:\\[^\s"'<>|*?]+/g;

/** The path in `m`, without trailing punctuation. */
function trimmedPath(m: RegExpMatchArray): { path: string; start: number; end: number } {
  const path = m[0].replace(/[.,;:!)\]}]+$/, "");
  const start = m.index ?? 0;
  return { path, start, end: start + path.length - 1 };
}

/** Finds the `C:\...\file.ext` path under `col` in a row of terminal text. */
export function pathAtColumn(rowText: string, col: number, row = 0): PathMatch | null {
  for (const m of rowText.matchAll(WIN_PATH)) {
    const { path, start, end } = trimmedPath(m);
    if (col >= start && col <= end) return { path, region: { row, start_col: start, end_col: end } };
  }
  return null;
}

/** Most rows one wrapped path may span: a full screen of text must not stitch together. */
export const MAX_WRAP_ROWS = 8;

/** A row wrapped early when it is within this many columns of the pane width.
 * Measured in Claude Code's TUI: it breaks a long path one column short
 * (135 of 136) and indents the next row by 2. */
export const WRAP_SLACK = 2;

/** Whether the text of a row continues on the next row: it reaches the pane edge. */
export function wrapsOntoNextRow(rowText: string, paneWidth: number): boolean {
  return rowText.length >= paneWidth - WRAP_SLACK;
}

export interface WrappedPathMatch {
  path: string;
  /** One region per row the path covers, for the hover underline. */
  regions: PaneLinkRegion[];
}

/** Finds a path that the terminal wrapped over 2+ rows. `rows` are consecutive
 * viewport rows in which every row but the last reaches the pane edge (see
 * `WRAP_SLACK`), so the text continues on the next row. The indent in front of
 * a continuation row is not part of the path. `null` for a one-row path:
 * `pathAtColumn` and the server handle those. */
export function pathAtWrappedRows(rows: { row: number; text: string }[], row: number, col: number): WrappedPathMatch | null {
  const at = rows.findIndex((r) => r.row === row);
  if (at < 0) return null;
  // `starts[k]`: where row k's text lands in `joined`; `skips[k]`: indent columns dropped.
  const starts: number[] = [];
  const skips: number[] = [];
  let joined = "";
  rows.forEach((r, k) => {
    const skip = k === 0 ? 0 : r.text.length - r.text.trimStart().length;
    starts.push(joined.length);
    skips.push(skip);
    joined += r.text.slice(skip);
  });
  if (col < skips[at]) return null;
  const pos = starts[at] + col - skips[at];
  for (const m of joined.matchAll(WIN_PATH)) {
    const { path, start, end } = trimmedPath(m);
    if (pos < start || pos > end) continue;
    const regions: PaneLinkRegion[] = [];
    rows.forEach((r, k) => {
      const from = Math.max(start, starts[k]);
      const to = Math.min(end, starts[k] + r.text.length - skips[k] - 1);
      if (from <= to) regions.push({ row: r.row, start_col: from - starts[k] + skips[k], end_col: to - starts[k] + skips[k] });
    });
    return regions.length > 1 ? { path, regions } : null;
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
    else if (!isStaleError(err)) showErrorNotice(errorMessage(err));
    return [];
  }
}

let hoverUnsupported = false;

/** A moving pane makes the hovered revision stale within one tick; the
 * TUI client stays silent for these too (`actions.rs:709`). */
export function isStaleError(err: unknown): boolean {
  return /^(stale_content|stale_target|endpoint_cancelled)/.test(errorMessage(err));
}

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
