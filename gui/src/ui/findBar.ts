// Find in scrollback (terminal-parity spec P1 #7), Ctrl+Shift+F: a small
// bar docked at the pane's top-right with a query box, Enter/Shift+Enter
// for next/previous, a "3/17" count, and Esc to close. Calls
// `pane.copy_search {pane_id, query, direction, cursor, content_revision,
// previous?}`, scrolls to the current match with `pane.scroll`, and
// highlights it on the client.

import { api, invokeSafe } from "../appApi";
import { terminalWrapEl } from "../appDom";
import { focusedPaneId } from "../appLookups";
import { appState } from "../appState";
import { paneOverlayOrigin } from "../mouse/overlayGeometry";
import { SelectionOverlay } from "../mouse/selectionOverlay";
import { notifyOverlayClosed, openOverlay } from "./overlay";

interface PaneKeyboardInfoLike {
  content_revision: number;
  inner_rect: { x: number; y: number; width: number; height: number };
  scroll: { offset_from_bottom: number; max_offset_from_bottom: number; viewport_rows: number } | null;
}

interface TextPoint {
  row: number;
  col: number;
}

interface TextRange {
  start: TextPoint;
  end: TextPoint;
}

interface CopySearchResult {
  content_revision: number;
  matches: TextRange[];
  total: number;
  current?: number;
}

interface FindSession {
  paneId: string;
  width: number;
  contentRevision: number;
  maxOffsetFromBottom: number;
  cursor: TextPoint;
  previous: TextRange | null;
}

let session: FindSession | null = null;
let barEl: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let countEl: HTMLSpanElement | null = null;
let matchOverlay: SelectionOverlay | null = null;
let closeDispose: (() => void) | null = null;

function matchOverlayFor(): SelectionOverlay {
  if (!matchOverlay) matchOverlay = new SelectionOverlay(terminalWrapEl, "terminal-find-match-row");
  return matchOverlay;
}

function buildBar(): HTMLDivElement {
  const bar = document.createElement("div");
  bar.className = "find-bar";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "find-bar__input";
  input.placeholder = "Find";
  const count = document.createElement("span");
  count.className = "find-bar__count";
  bar.appendChild(input);
  bar.appendChild(count);
  input.addEventListener("keydown", onInputKeydown);
  terminalWrapEl.appendChild(bar);
  inputEl = input;
  countEl = count;
  return bar;
}

function onInputKeydown(event: KeyboardEvent): void {
  event.stopPropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    closeFindBar();
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    void runSearch(event.shiftKey ? "backward" : "forward");
  }
}

/** Ctrl+Shift+F: opens (or refocuses) the find bar for the focused pane. */
export function openFindBar(): void {
  const paneId = focusedPaneId();
  if (!paneId) return;
  if (!barEl) barEl = buildBar();
  session = { paneId, width: 0, contentRevision: 0, maxOffsetFromBottom: 0, cursor: { row: 0, col: 0 }, previous: null };
  if (countEl) countEl.textContent = "";
  closeDispose = () => closeFindBar();
  openOverlay(closeDispose);
  inputEl?.focus();
  inputEl?.select();
}

export function closeFindBar(): void {
  session = null;
  barEl?.remove();
  barEl = null;
  inputEl = null;
  countEl = null;
  matchOverlay?.clear();
  if (closeDispose) {
    const dispose = closeDispose;
    closeDispose = null;
    notifyOverlayClosed(dispose);
  }
}

async function runSearch(direction: "forward" | "backward"): Promise<void> {
  if (!session || !inputEl) return;
  const query = inputEl.value;
  if (!query) return;

  // Refresh geometry/content_revision on every new query (the session may
  // be long-lived across several searches while the pane keeps producing
  // output).
  const info = await invokeSafe<PaneKeyboardInfoLike | null>("pane_keyboard_info", { paneId: session.paneId });
  if (!session || !info) return;
  session.width = info.inner_rect.width;
  session.contentRevision = info.content_revision;
  session.maxOffsetFromBottom = info.scroll?.max_offset_from_bottom ?? 0;

  const params: Record<string, unknown> = {
    pane_id: session.paneId,
    query,
    direction,
    cursor: session.cursor,
    content_revision: session.contentRevision,
  };
  if (session.previous) params.previous = session.previous;

  const result = await api<CopySearchResult>("pane.copy_search", params);
  if (!session || !result) return;
  if (result.matches.length === 0 || result.total === 0) {
    if (countEl) countEl.textContent = "0/0";
    matchOverlay?.clear();
    return;
  }
  const match = result.matches[0];
  session.previous = match;
  session.cursor = direction === "forward" ? match.end : match.start;
  if (countEl) countEl.textContent = `${(result.current ?? 0) + 1}/${result.total}`;
  await scrollToMatch(match);
  highlightMatch(match);
}

/** Scrolls the match's row into view as the viewport's top row, clamped to
 * `[0, max_offset_from_bottom]`. A simplification of "centered" scroll-into-
 * view: simple, correct at the edges, and good enough for a find bar. */
async function scrollToMatch(match: TextRange): Promise<void> {
  if (!session) return;
  const offset = Math.min(session.maxOffsetFromBottom, Math.max(0, session.maxOffsetFromBottom - match.start.row));
  await api("pane.scroll", { pane_id: session.paneId, offset_from_bottom: offset });
}

function highlightMatch(match: TextRange): void {
  const renderer = appState.renderer;
  if (!renderer || !session) return;
  const origin = paneOverlayOrigin({ x: 0, y: 0, width: session.width, height: 1 }, renderer);
  // The row was just scrolled to the viewport's top (`scrollToMatch`), so
  // the match's row is row 0 of the viewport.
  const rowInView = 0;
  const startCol = match.start.row === match.end.row ? match.start.col : 0;
  const endCol = match.start.row === match.end.row ? match.end.col + 1 : session.width;
  matchOverlayFor().render(
    [{ row: rowInView, startCol, endCol }],
    origin.originLeft,
    origin.originTop,
    origin.cellWidthCss,
    origin.cellHeightCss,
  );
}

export function isFindBarOpen(): boolean {
  return session !== null;
}
