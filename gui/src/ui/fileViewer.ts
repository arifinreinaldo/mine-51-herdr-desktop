// File viewer (file viewer spec §8): file tabs, numbered read-only lines and a
// breadcrumb over the terminal canvas. DOM only; the reading, the state and the
// hide rules live in `appFiles.ts`. File text and names come from disk and are
// untrusted, so all text uses `textContent`.

import type { SearchResult } from "../files/filesApi";
import { languageFor, tokenizeLine, type Language, type LineState } from "../files/highlight";
import { FONT_STACK } from "../render/renderer";
import { absolutePath, extLabel } from "./fileTree";

/** Rows rendered above and below the viewport. */
const OVERSCAN = 20;
/** Text mode stores the tokenizer state of every CHECKPOINT_LINES-th line, so a jump tokenizes fewer lines than that. */
const CHECKPOINT_LINES = 200;
/** Paged mode fetches aligned pages of PAGE_LINES lines and keeps the MAX_PAGES most recently used pages. */
const PAGE_LINES = 500;
const MAX_PAGES = 8;
/** Edge 155 (the WebView2 engine) clamps an element at 33,554,428 px. A taller file maps its scroll range to its lines in proportion. */
const MAX_SPACER_PX = 16_000_000;
/** The body font is `13px/1.4` (style.css). A row is that height in whole pixels, so the rows do not drift from the spacer. */
const LINE_HEIGHT = 1.4;

/** Paged mode (8 MiB and more): the lines stay on disk. `appFiles.ts` binds these functions to the backend commands. */
export interface PagedFile {
  lineCount: number;
  readLines(start: number, count: number): Promise<string[]>;
  search(query: string): Promise<SearchResult>;
}

export type ViewerContent =
  | { kind: "loading" }
  | { kind: "text"; text: string }
  | { kind: "paged"; file: PagedFile }
  | { kind: "binary" }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export interface TabView {
  /** The line at the viewport top, with its fraction. A refresh that changes the line count keeps this line at the top. */
  topLine: number;
  /** Unset until the first scroll. */
  scrollLeft?: number;
  /** The widest row this tab painted, in px. The scroll width never shrinks under `scrollLeft`. */
  widest?: number;
  currentLine: number | null;
}

/** The lines of the last text or paged render, for find in the file (viewerFind.ts). */
export interface ViewerText {
  /** All lines in text mode; null in paged mode. */
  lines: readonly string[] | null;
  /** The backend search in paged mode; null in text mode. */
  search: ((query: string) => Promise<SearchResult>) | null;
  /** Puts `line` in the middle of the viewport and renders its rows. */
  scrollToLine(line: number): void;
}

let shownText: ViewerText | null = null;
let afterRows: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
// Paged mode: the pages of the last render. A refresh of the same file shows them while it fetches the pages again.
let lastPages: { key: string; pages: Map<number, string[] | null> } | null = null;

export function viewerText(): ViewerText | null {
  return shownText;
}

/** `fn` runs after each change of the rendered rows; null removes it. */
export function onViewerRows(fn: (() => void) | null): void {
  afterRows = fn;
}

export interface TabState {
  tabs: string[];
  active: string | null;
  views: Map<string, TabView>;
}

export interface FileViewerModel {
  /** The absolute workspace root. */
  root: string;
  tabs: readonly string[];
  active: string | null;
  content: ViewerContent;
  /** The view of the active tab. The render's listeners change it in place. */
  view: TabView;
}

export interface FileViewerCallbacks {
  onActivate(rel: string): void;
  onClose(rel: string): void;
}

export function viewOf(s: TabState, rel: string): TabView {
  let view = s.views.get(rel);
  if (!view) {
    view = { topLine: 0, currentLine: null };
    s.views.set(rel, view);
  }
  return view;
}

/** Spec §8.1: a file that is open already only becomes active. */
export function openTab(s: TabState, rel: string): void {
  if (!s.tabs.includes(rel)) s.tabs.push(rel);
  s.active = rel;
}

export function closeTab(s: TabState, rel: string): void {
  const index = s.tabs.indexOf(rel);
  if (index < 0) return;
  s.tabs.splice(index, 1);
  s.views.delete(rel);
  if (s.active === rel) s.active = s.tabs[Math.min(index, s.tabs.length - 1)] ?? null;
}

export function cycleTab(s: TabState, step: 1 | -1): void {
  if (s.active === null) return;
  const index = s.tabs.indexOf(s.active);
  if (index < 0) return;
  s.active = s.tabs[(index + step + s.tabs.length) % s.tabs.length];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fileName(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

function parentName(rel: string): string {
  const parts = rel.split("/");
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

/**
 * The open-file tabs, rendered into `row` (the page's bottom strip, `#file-tabs`). It lives outside the
 * viewer so the tabs stay visible while a terminal tab is shown. `active` is null while the viewer is hidden.
 */
export function renderFileTabs(
  row: HTMLElement,
  model: Pick<FileViewerModel, "root" | "tabs" | "active">,
  callbacks: FileViewerCallbacks,
): void {
  row.textContent = "";
  const nameCount = new Map<string, number>();
  for (const rel of model.tabs) nameCount.set(fileName(rel), (nameCount.get(fileName(rel)) ?? 0) + 1);
  for (const rel of model.tabs) {
    const name = fileName(rel);
    const tab = el("div", rel === model.active ? "fv-tab is-active" : "fv-tab");
    tab.title = absolutePath(model.root, rel);
    tab.dataset.rel = rel;
    const ext = extLabel(name);
    const badge = ext === "" ? el("i", "codicon codicon-file") : el("span", "fv-tab__ext", ext);
    if (ext !== "") badge.dataset.ext = ext; // CSS colours the badge by file type
    tab.appendChild(badge);
    tab.appendChild(el("span", "fv-tab__name", name));
    if ((nameCount.get(name) ?? 0) > 1) {
      const dir = parentName(rel);
      if (dir !== "") tab.appendChild(el("span", "fv-tab__dir", dir));
    }
    const close = el("span", "fv-tab__close codicon codicon-close"); // a span, not a button: not a tab stop
    close.title = "Close";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      callbacks.onClose(rel);
    });
    tab.appendChild(close);
    tab.addEventListener("click", () => callbacks.onActivate(rel));
    tab.addEventListener("auxclick", (event) => {
      if (event.button === 1) callbacks.onClose(rel);
    });
    tab.addEventListener("mousedown", (event) => {
      if (event.button === 1) event.preventDefault(); // stops autoscroll
    });
    row.appendChild(tab);
  }
}

/** The lines of one render. The viewport reads only this interface, in text mode and in paged mode. */
interface LineSource {
  readonly count: number;
  /** Line `i`, or null while its page loads. */
  line(i: number): string | null;
  /** The tokenizer state at the start of line `i`. */
  stateAt(i: number): LineState;
  /** The viewport sets it; a paged source calls it when a page arrives. */
  onLoad?: () => void;
}

function textSource(text: string, lang: Language | null): LineSource & { lines: string[] } {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const checkpoints: LineState[] = [null]; // checkpoints[k]: the state at the start of line k * CHECKPOINT_LINES
  return {
    lines,
    count: lines.length,
    line: (i) => lines[i],
    stateAt: (i) => {
      const k = Math.min(Math.floor(i / CHECKPOINT_LINES), checkpoints.length - 1);
      let state = checkpoints[k];
      for (let j = k * CHECKPOINT_LINES; j < i; j++) {
        state = tokenizeLine(lines[j], lang, state).state;
        if ((j + 1) % CHECKPOINT_LINES === 0) checkpoints.push(state);
      }
      return state;
    },
  };
}

// shortcut: each page tokenizes from a null state, so a block comment that opens above a page colours it wrong; carry the state across pages if users report it.
function pagedSource(
  file: PagedFile,
  lang: Language | null,
  pages: Map<number, string[] | null>, // null while the page loads; Map order: least recently used first
  stale: Map<number, string[] | null> | undefined,
): LineSource {
  const page = (p: number): string[] | null => {
    const lines = pages.get(p);
    pages.delete(p);
    pages.set(p, lines ?? null);
    if (lines !== undefined) return lines;
    for (const old of pages.keys()) if (pages.size > MAX_PAGES) pages.delete(old);
    file.readLines(p * PAGE_LINES, PAGE_LINES).then(
      (got) => {
        if (pages.get(p) !== null) return; // dropped from the cache while it loaded
        pages.set(p, got);
        source.onLoad?.();
      },
      () => pages.delete(p), // the next paint asks again
    );
    return null;
  };
  const source: LineSource = {
    count: file.lineCount,
    line: (i) => {
      const p = Math.floor(i / PAGE_LINES);
      const lines = page(p) ?? stale?.get(p) ?? null;
      return lines === null ? null : (lines[i % PAGE_LINES] ?? "");
    },
    stateAt: (i) => {
      const p = Math.floor(i / PAGE_LINES);
      const lines = page(p) ?? stale?.get(p) ?? null;
      let state: LineState = null;
      if (lines !== null) for (let j = 0; j < i % PAGE_LINES; j++) state = tokenizeLine(lines[j] ?? "", lang, state).state;
      return state;
    },
  };
  return source;
}

interface Rows {
  /** Sets scrollTop from `view.topLine` and renders the rows. */
  place(): void;
  scrollToLine(line: number): void;
}

/**
 * Virtual rows: a spacer with the height of all lines, and a window that holds only the rows near the viewport.
 * All rows have one height and do not wrap. Above MAX_SPACER_PX, the scroll range maps to the lines in proportion.
 * `view.topLine` (the line at the viewport top) is the truth for the position; scrollTop follows it, so a refresh
 * that changes the line count keeps the same line at the top.
 */
function renderRows(body: HTMLElement, source: LineSource, lang: Language | null, view: TabView, rowPx: number): Rows {
  const count = source.count;
  if (view.currentLine !== null && view.currentLine >= count) view.currentLine = count - 1; // a refresh made the file shorter
  const spacerPx = Math.min(count * rowPx, MAX_SPACER_PX);
  const lines = el("div", "fv-lines");
  lines.style.setProperty("--fv-gutter", `${String(count).length + 1}ch`);
  lines.style.setProperty("--fv-row", `${rowPx}px`);
  lines.style.height = `${spacerPx}px`;
  if (view.widest) lines.style.width = `${view.widest}px`;
  const win = el("div", "fv-window");
  lines.appendChild(win);
  let shownFirst = 0;
  let shownLast = -1; // nothing rendered yet
  let placedTop = -1; // the scrollTop that place() set: its scroll event must not move the anchor
  /** The top line at the end of the scroll range. */
  const lastTop = (): number => Math.max(0, count - body.clientHeight / rowPx);
  const maxScroll = (): number => Math.max(1, spacerPx - body.clientHeight);
  const paint = (force = false): void => {
    const topExact = Math.min(view.topLine, lastTop());
    const scroll = Math.min(body.scrollTop, maxScroll());
    const top = Math.min(count - 1, Math.floor(topExact));
    const bottom = Math.min(count, Math.ceil(topExact + body.clientHeight / rowPx));
    const rebuild = force || top < shownFirst || bottom > shownLast;
    if (rebuild) {
      shownFirst = Math.max(0, top - OVERSCAN);
      shownLast = Math.min(count, bottom + OVERSCAN);
      win.textContent = "";
      const texts: HTMLElement[] = [];
      let state = source.stateAt(shownFirst);
      for (let i = shownFirst; i < shownLast; i++) {
        const row = el("div", i === view.currentLine ? "fv-line is-current" : "fv-line");
        row.dataset.line = String(i);
        row.appendChild(el("span", "fv-line__no", String(i + 1)));
        const textEl = el("span", "fv-line__text");
        const text = source.line(i);
        if (text !== null) {
          // null: a placeholder row while its page loads
          const result = tokenizeLine(text, lang, state);
          state = result.state;
          for (const token of result.tokens) {
            if (token.kind === "plain") textEl.appendChild(document.createTextNode(token.text));
            else textEl.appendChild(el("span", `tok-${token.kind}`, token.text));
          }
        }
        row.appendChild(textEl);
        win.appendChild(row);
        texts.push(textEl);
      }
      // The scroll width only grows: short rows near the viewport must not clamp scrollLeft. One layout, after the build.
      const natural = Math.max(0, ...texts.map((t) => t.offsetLeft + t.offsetWidth));
      if (natural > (view.widest ?? 0)) {
        view.widest = natural;
        lines.style.width = `${natural}px`;
      }
    }
    win.style.top = `${scroll - (topExact - shownFirst) * rowPx}px`;
    if (rebuild) afterRows?.();
  };
  const place = (): void => {
    view.topLine = Math.min(view.topLine, lastTop()); // the file got shorter, or the viewport taller
    const span = lastTop();
    body.scrollTop = span > 0 ? (view.topLine / span) * maxScroll() : 0;
    placedTop = body.scrollTop;
    paint();
  };
  source.onLoad = () => paint(true);
  body.addEventListener("scroll", () => {
    if (body.scrollTop !== placedTop) {
      // A user scroll: the anchor follows the scroll position. Without scaling, this is scrollTop / rowPx.
      view.topLine = (Math.min(body.scrollTop, maxScroll()) / maxScroll()) * lastTop();
      placedTop = -1;
    }
    view.scrollLeft = body.scrollLeft;
    paint();
  });
  lines.addEventListener("click", (event) => {
    const line = (event.target as Element | null)?.closest<HTMLElement>(".fv-line");
    if (!line) return;
    lines.querySelector(".fv-line.is-current")?.classList.remove("is-current");
    line.classList.add("is-current");
    view.currentLine = Number(line.dataset.line);
  });
  body.appendChild(lines);
  resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
  resizeObserver?.observe(body);
  return {
    place,
    scrollToLine: (line) => {
      view.topLine = Math.max(0, line - (body.clientHeight / rowPx - 1) / 2);
      place();
    },
  };
}

export function renderFileViewer(
  rootEl: HTMLElement,
  model: FileViewerModel,
  fontSizePx: number,
): void {
  // A refresh keeps the find bar (viewerFind.ts) in place, so its input keeps focus. All else is built again.
  for (const child of Array.from(rootEl.children)) if (!child.classList.contains("fv-find-bar")) child.remove();
  shownText = null;
  resizeObserver?.disconnect();
  const previous = lastPages;
  lastPages = null;
  const { content, view, active } = model;
  const rootName = model.root.split(/[/\\]/).filter(Boolean).pop() ?? model.root;
  const lang = languageFor(active === null ? "" : fileName(active));
  const rowPx = Math.round(fontSizePx * LINE_HEIGHT);

  const body = el("div", "fv-body");
  body.style.fontFamily = FONT_STACK;
  body.style.fontSize = `${fontSizePx}px`;
  let rows: Rows | null = null;
  switch (content.kind) {
    case "loading":
      body.appendChild(el("div", "fv-notice", "Loading…"));
      break;
    case "binary":
      body.appendChild(el("div", "fv-notice", "Binary file, not shown"));
      break;
    case "missing":
      body.appendChild(el("div", "fv-notice", "File not found. It was moved or deleted."));
      break;
    case "error":
      body.appendChild(el("div", "fv-notice", content.message));
      break;
    case "text": {
      const source = textSource(content.text, lang);
      rows = renderRows(body, source, lang, view, rowPx);
      shownText = { lines: source.lines, search: null, scrollToLine: rows.scrollToLine };
      break;
    }
    case "paged": {
      const key = `${model.root}\n${active}`;
      lastPages = { key, pages: new Map() };
      const stale = previous?.key === key ? previous.pages : undefined; // no blank rows while a refresh fetches the pages again
      rows = renderRows(body, pagedSource(content.file, lang, lastPages.pages, stale), lang, view, rowPx);
      shownText = { lines: null, search: content.file.search, scrollToLine: rows.scrollToLine };
      break;
    }
  }
  rootEl.appendChild(body);

  const crumb = el("div", "fv-breadcrumb");
  const segments = [rootName, ...(active === null ? [] : active.split("/"))];
  segments.forEach((segment, i) => {
    if (i > 0) crumb.appendChild(el("span", "fv-breadcrumb__sep", " › "));
    crumb.appendChild(el("span", "fv-breadcrumb__seg", segment));
  });
  crumb.appendChild(el("span", "fv-readonly", "Read-only"));
  rootEl.appendChild(crumb);

  // Last: the breadcrumb changes the body height (edge case 31), and the first paint needs the final height.
  // scrollLeft comes after the paint: the painted rows give the scroll width.
  if (rows) {
    rows.place();
    body.scrollLeft = view.scrollLeft ?? 0;
  }
}
