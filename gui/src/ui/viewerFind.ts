// Find in the file viewer (Ctrl+F): a bar at the viewer's top-right, Enter/Shift+Enter for next/previous, Esc to
// close. The viewer renders only the rows near the viewport, so the search runs over the file, not over the DOM:
// over the lines in memory (text mode), or through the backend `fs_search` after a pause in typing (paged mode).
// The CSS Custom Highlight API marks the matches of the rendered rows, again after each row change.

import type { SearchResult } from "../files/filesApi";
import { onViewerRows, viewerText, type ViewerText } from "./fileViewer";

export interface LineMatch {
  line: number;
  start: number;
  end: number;
}

/** Case-insensitive, non-overlapping matches of `query` in each line, in reading order. */
export function findMatches(lines: readonly string[], query: string): LineMatch[] {
  if (query === "") return [];
  const needle = query.toLowerCase();
  const out: LineMatch[] = [];
  lines.forEach((text, line) => {
    const hay = text.toLowerCase();
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
      out.push({ line, start: at, end: at + needle.length });
    }
  });
  return out;
}

/** The next index after `current`, wrapping; -1 when there are no matches. */
export function stepIndex(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}

const ALL = "fv-find";
const CURRENT = "fv-find-current";
/** Paged mode: the pause after the last key before the backend search starts. */
const SEARCH_DELAY_MS = 250;

let barEl: HTMLDivElement | null = null;
let inputEl: HTMLInputElement | null = null;
let countEl: HTMLSpanElement | null = null;
let matches: LineMatch[] = [];
let truncated = false; // paged mode: the backend stopped at its match limit
let index = -1;
let searched: ViewerText | null = null; // the render that `matches` belong to
let searchSeq = 0; // drops a backend answer to an older query
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let pending = false; // paged mode: a backend search is due or runs; the bar shows "Searching…"
let failure: string | null = null; // paged mode: the error of the last backend search
let running: ((query: string) => Promise<SearchResult>) | null = null; // the backend of a search that has not answered

// The DOM lib for ES2020 types HighlightRegistry without its Map methods.
interface Registry {
  set(name: string, highlight: Highlight): unknown;
  delete(name: string): boolean;
}

/** WebView2 and Safari 17.2+ have it; jsdom does not, so the bar still counts without marks there. */
function highlights(): Registry | null {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"
    ? (CSS.highlights as unknown as Registry)
    : null;
}

/** A DOM range over `[start, end)` of a line element's text, across its token spans. */
function rangeIn(lineEl: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && start < offset + length) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && end <= offset + length) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset += length;
  }
  return null;
}

function showCount(): void {
  if (!countEl) return;
  const counted = `${matches.length === 0 ? 0 : index + 1}/${matches.length}${truncated ? "+" : ""}`;
  countEl.textContent = pending ? "Searching…" : (failure ?? (inputEl?.value ? counted : ""));
}

/** Marks the matches of the rendered rows. The viewer calls it after each row change (`onViewerRows`). */
function mark(): void {
  const text = viewerText();
  if (text !== searched) {
    // A new render (a refresh). Text mode searches the new lines and keeps the place, without a scroll. Paged mode
    // keeps its matches: a backend search on each refresh of a growing log would not end before the next refresh.
    searched = text;
    if (text?.lines) {
      matches = findMatches(text.lines, inputEl?.value ?? "");
      index = matches.length === 0 ? -1 : Math.min(Math.max(index, 0), matches.length - 1);
      showCount();
    }
  }
  const registry = highlights();
  if (!registry) return;
  const rows = Array.from(barEl?.parentElement?.querySelectorAll<HTMLElement>(".fv-line") ?? []);
  // The rows are consecutive lines, and the matches are in line order: find the first match of the first row.
  const first = rows.length > 0 ? Number(rows[0].dataset.line) : 0;
  let k = 0;
  let hi = matches.length;
  while (k < hi) {
    const mid = (k + hi) >> 1;
    if (matches[mid].line < first) k = mid + 1;
    else hi = mid;
  }
  const all: Range[] = [];
  let current: Range | null = null;
  for (const row of rows) {
    const line = Number(row.dataset.line);
    const textEl = row.querySelector(".fv-line__text");
    for (; k < matches.length && matches[k].line === line; k++) {
      const range = textEl && rangeIn(textEl, matches[k].start, matches[k].end);
      if (!range) continue;
      all.push(range);
      if (k === index) current = range;
    }
  }
  registry.set(ALL, new Highlight(...all));
  if (current) registry.set(CURRENT, new Highlight(current));
  else registry.delete(CURRENT);
}

/** Updates the count. With `scroll`, puts the line of the current match in the middle of the viewport. */
function show(scroll: boolean): void {
  showCount();
  if (scroll && index >= 0) viewerText()?.scrollToLine(matches[index].line);
  mark();
}

function setMatches(next: LineMatch[], cut: boolean): void {
  matches = next;
  truncated = cut;
  index = next.length > 0 ? 0 : -1;
  show(true);
}

/** Stops a backend search that runs: an empty query bumps the search generation in Rust (files.rs `fs_search`). */
function cancelBackend(): void {
  if (running) void running("").catch(() => {});
  running = null;
}

function search(): void {
  const text = viewerText();
  const query = inputEl?.value ?? "";
  const backend = text?.search;
  searched = text;
  clearTimeout(searchTimer);
  const seq = ++searchSeq;
  pending = false;
  failure = null;
  if (!backend || query === "") {
    cancelBackend();
    setMatches(findMatches(text?.lines ?? [], query), false);
    return;
  }
  // Paged mode: no stale count and no Enter on old matches while the backend searches.
  pending = true;
  setMatches([], false);
  searchTimer = setTimeout(() => {
    running = backend;
    backend(query).then(
      (result) => {
        if (seq !== searchSeq) return;
        running = null;
        pending = false;
        setMatches(result.matches.map((m) => ({ line: m.line, start: m.col, end: m.col + query.length })), result.truncated);
      },
      (err: { code?: string; message?: string } | undefined) => {
        if (seq !== searchSeq || err?.code === "cancelled") return; // a newer search replaced this one
        running = null;
        pending = false;
        failure = err?.message ?? String(err);
        showCount();
      },
    );
  }, SEARCH_DELAY_MS);
}

export function isViewerFindOpen(): boolean {
  return barEl !== null;
}

/** Opens (or refocuses) the bar in `viewer`; with text selected in the viewer, searches for it. */
export function openViewerFind(viewer: HTMLElement): void {
  const selected = window.getSelection()?.toString() ?? "";
  if (!barEl || !viewer.contains(barEl)) {
    closeViewerFind();
    const bar = document.createElement("div");
    bar.className = "find-bar fv-find-bar";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "find-bar__input";
    input.placeholder = "Find in file";
    input.setAttribute("aria-label", "Find in file");
    const count = document.createElement("span");
    count.className = "find-bar__count";
    bar.append(input, count);
    input.addEventListener("input", search);
    input.addEventListener("keydown", (event) => {
      event.stopPropagation(); // Esc must not also hide the viewer; keys must not reach the terminal
      if (event.key === "Escape") {
        event.preventDefault();
        closeViewerFind();
        viewer.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (pending) return; // the matches of the last query are gone
        index = stepIndex(index, matches.length, event.shiftKey ? -1 : 1);
        show(true);
      }
    });
    viewer.appendChild(bar);
    barEl = bar;
    inputEl = input;
    countEl = count;
    onViewerRows(mark);
  }
  if (selected && !selected.includes("\n") && inputEl) {
    inputEl.value = selected;
    search();
  }
  inputEl?.focus();
  inputEl?.select();
}

/** Closes the bar, clears the marks and stops a backend search; called on Esc, on a full render and when the viewer hides. */
export function closeViewerFind(): void {
  barEl?.remove();
  barEl = null;
  inputEl = null;
  countEl = null;
  matches = [];
  truncated = false;
  index = -1;
  searched = null;
  pending = false;
  failure = null;
  clearTimeout(searchTimer);
  ++searchSeq;
  cancelBackend();
  onViewerRows(null);
  highlights()?.delete(ALL);
  highlights()?.delete(CURRENT);
}
