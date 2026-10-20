// File viewer (file viewer spec §8): file tabs, numbered read-only lines and a
// breadcrumb over the terminal canvas. DOM only; the reading, the state and the
// hide rules live in `appFiles.ts`. File text and names come from disk and are
// untrusted, so all text uses `textContent`.

import { languageFor, tokenizeLine, type LineState } from "../files/highlight";
import { FONT_STACK } from "../render/renderer";
import { absolutePath, extLabel } from "./fileTree";

export const MAX_VIEWER_LINES = 5000;

export type ViewerContent =
  | { kind: "loading" }
  | { kind: "text"; text: string }
  | { kind: "binary" }
  | { kind: "tooLarge"; size: number }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export interface TabView {
  scrollTop: number;
  currentLine: number | null;
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
    view = { scrollTop: 0, currentLine: null };
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

function renderTabs(model: FileViewerModel, callbacks: FileViewerCallbacks): HTMLElement {
  const row = el("div", "fv-tabs");
  const nameCount = new Map<string, number>();
  for (const rel of model.tabs) nameCount.set(fileName(rel), (nameCount.get(fileName(rel)) ?? 0) + 1);
  for (const rel of model.tabs) {
    const name = fileName(rel);
    const tab = el("div", rel === model.active ? "fv-tab is-active" : "fv-tab");
    tab.title = absolutePath(model.root, rel);
    tab.dataset.rel = rel;
    const ext = extLabel(name);
    tab.appendChild(ext === "" ? el("i", "codicon codicon-file") : el("span", "fv-tab__ext", ext));
    tab.appendChild(el("span", "fv-tab__name", name));
    if ((nameCount.get(name) ?? 0) > 1) {
      const dir = parentName(rel);
      if (dir !== "") tab.appendChild(el("span", "fv-tab__dir", dir));
    }
    const close = el("span", "fv-tab__close codicon codicon-close"); // a span, not a button: focus stays on #file-viewer
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
  return row;
}

function renderLines(body: HTMLElement, text: string, name: string, view: TabView): void {
  const all = text.split(/\r\n|\n|\r/);
  if (all.length > 1 && all[all.length - 1] === "") all.pop();
  const count = all.length;
  const lines = el("div", "fv-lines");
  lines.style.setProperty("--fv-gutter", `${String(count).length + 1}ch`);
  const lang = languageFor(name);
  let state: LineState = null;
  const shown = Math.min(count, MAX_VIEWER_LINES);
  for (let i = 0; i < shown; i++) {
    const row = el("div", i === view.currentLine ? "fv-line is-current" : "fv-line");
    row.dataset.line = String(i);
    row.appendChild(el("span", "fv-line__no", String(i + 1)));
    const textEl = el("span", "fv-line__text");
    const result = tokenizeLine(all[i], lang, state);
    state = result.state;
    for (const token of result.tokens) {
      if (token.kind === "plain") textEl.appendChild(document.createTextNode(token.text));
      else textEl.appendChild(el("span", `tok-${token.kind}`, token.text));
    }
    row.appendChild(textEl);
    lines.appendChild(row);
  }
  lines.addEventListener("click", (event) => {
    const line = (event.target as Element | null)?.closest<HTMLElement>(".fv-line");
    if (!line) return;
    lines.querySelector(".fv-line.is-current")?.classList.remove("is-current");
    line.classList.add("is-current");
    view.currentLine = Number(line.dataset.line);
  });
  body.appendChild(lines);
  body.addEventListener("scroll", () => {
    view.scrollTop = body.scrollTop;
  });
  if (count > MAX_VIEWER_LINES) {
    body.appendChild(el("div", "fv-notice", `Showing the first 5,000 of ${count.toLocaleString("en-US")} lines`));
  }
}

export function renderFileViewer(
  rootEl: HTMLElement,
  model: FileViewerModel,
  fontSizePx: number,
  callbacks: FileViewerCallbacks,
): void {
  rootEl.textContent = "";
  const { content, view, active } = model;
  const rootName = model.root.split(/[/\\]/).filter(Boolean).pop() ?? model.root;

  rootEl.appendChild(renderTabs(model, callbacks));

  const body = el("div", "fv-body");
  body.style.fontFamily = FONT_STACK;
  body.style.fontSize = `${fontSizePx}px`;
  switch (content.kind) {
    case "loading":
      body.appendChild(el("div", "fv-notice", "Loading…"));
      break;
    case "binary":
      body.appendChild(el("div", "fv-notice", "Binary file, not shown"));
      break;
    case "tooLarge":
      body.appendChild(
        el("div", "fv-notice", `File too large to show (${(content.size / 1048576).toFixed(1)} MB, limit 2 MB)`),
      );
      break;
    case "missing":
      body.appendChild(el("div", "fv-notice", "File not found. It was moved or deleted."));
      break;
    case "error":
      body.appendChild(el("div", "fv-notice", content.message));
      break;
    case "text":
      renderLines(body, content.text, active === null ? "" : fileName(active), view);
      break;
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

  // Last: the breadcrumb changes the body height (edge case 31).
  if (content.kind === "text") body.scrollTop = view.scrollTop;
}
