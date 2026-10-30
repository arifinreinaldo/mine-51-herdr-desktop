// File viewer spec §7.2: the Find File dialog. An input, a status line and a ranked list.

import { errorMessage } from "../appApi";
import { fsGrep, fsListFiles, type GrepHit } from "../files/filesApi";
import { rankPaths } from "../files/fuzzy";
import { openModal } from "./modal";

export interface QuickOpenOptions {
  root: string;
  openTabs: readonly string[];
  onOpen(rel: string): void;
  /** A content hit; `line` is 1-based. */
  onOpenAt(rel: string, line: number): void;
}

const GREP_MIN_CHARS = 3;
const GREP_DEBOUNCE_MS = 200;
const GREP_MAX_HITS = 50;

interface Row {
  rel: string;
  positions: readonly number[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function nameWithHits(name: string, positions: readonly number[]): HTMLElement {
  const span = el("span", "qo-name");
  const hits = new Set(positions);
  let i = 0;
  while (i < name.length) {
    const hit = hits.has(i);
    let j = i;
    while (j < name.length && hits.has(j) === hit) j++;
    if (hit) span.appendChild(el("span", "qo-hit", name.slice(i, j)));
    else span.append(name.slice(i, j));
    i = j;
  }
  return span;
}

export function openQuickOpen(options: QuickOpenOptions): () => void {
  let closed = false;
  let files: string[] | null = null;
  let selected = 0;
  let error: string | null = null;
  let rows: Row[] = [];
  let hits: GrepHit[] = [];
  let grepSeq = 0; // drops stale grep responses
  let grepTimer: number | undefined;
  let nodes: HTMLElement[] = [];

  const input = el("input", "shortcuts-modal-search");
  const status = el("div", "qo-status");
  const list = el("div", "qo-list");
  const footer = el("div", "qo-footer", "Showing first 50,000 files");

  function render(): void {
    const query = input.value;
    if (query.trim() === "") rows = options.openTabs.map((rel) => ({ rel, positions: [] }));
    else if (files === null) rows = [];
    else rows = rankPaths(query, files).map((r) => ({ rel: r.path, positions: r.positions }));
    const total = rows.length + hits.length;
    if (selected >= total) selected = Math.max(0, total - 1);

    status.textContent =
      error ?? (files === null ? "Indexing…" : query.trim() !== "" && total === 0 ? "No matching files" : "");
    list.textContent = "";
    nodes = [];
    const addRow = (index: number, title: string, onClick: () => void, ...parts: HTMLElement[]): void => {
      const node = el("div", index === selected ? "qo-row is-selected" : "qo-row");
      node.title = title;
      node.append(...parts);
      // Keep focus in the input.
      node.addEventListener("mousedown", (event) => event.preventDefault());
      node.addEventListener("click", onClick);
      list.appendChild(node);
      nodes.push(node);
    };
    rows.forEach((row, index) => {
      const slash = row.rel.lastIndexOf("/");
      addRow(
        index,
        row.rel,
        () => choose(index),
        nameWithHits(row.rel.slice(slash + 1), row.positions),
        el("span", "qo-dir", slash >= 0 ? row.rel.slice(0, slash) : ""),
      );
    });
    if (hits.length > 0) list.appendChild(el("div", "qo-group", "In files"));
    hits.forEach((hit, i) => {
      const index = rows.length + i;
      addRow(
        index,
        `${hit.rel}:${hit.line}`,
        () => choose(index),
        el("span", "qo-name", `${hit.rel.slice(hit.rel.lastIndexOf("/") + 1)}:${hit.line}`),
        el("span", "qo-dir", hit.text),
      );
    });
  }

  /** `index` runs over the file rows, then the content rows. */
  function choose(index: number): void {
    dispose(); // first: the modal gives the terminal focus on close (edge case 18)
    if (index < rows.length) options.onOpen(rows[index].rel);
    else options.onOpenAt(hits[index - rows.length].rel, hits[index - rows.length].line);
  }

  function scheduleGrep(): void {
    window.clearTimeout(grepTimer);
    const seq = ++grepSeq;
    hits = [];
    const query = input.value.trim();
    if (query.length < GREP_MIN_CHARS) return;
    grepTimer = window.setTimeout(() => {
      fsGrep(options.root, query, GREP_MAX_HITS)
        .then((result) => {
          if (closed || seq !== grepSeq) return;
          hits = result.hits;
          render();
        })
        .catch(() => {}); // silent: the file results still work
    }, GREP_DEBOUNCE_MS);
  }

  const dispose = openModal(
    "Find File",
    (body) => {
      input.type = "text";
      input.placeholder = "Type a file name";
      input.setAttribute("aria-label", "Find file");
      input.spellcheck = false;
      list.setAttribute("role", "listbox");
      footer.hidden = true;
      body.append(input, status, list, footer);

      input.addEventListener("input", () => {
        selected = 0;
        scheduleGrep();
        render();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          selected = Math.max(0, Math.min(rows.length + hits.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1)));
          render();
          nodes[selected]?.scrollIntoView?.({ block: "nearest" });
        } else if (event.key === "Enter" && selected < rows.length + hits.length) {
          event.preventDefault();
          choose(selected);
        }
      });
      render();
    },
    {
      className: "quick-open",
      onClose: () => {
        closed = true;
        window.clearTimeout(grepTimer);
      },
    },
  );

  // Not cached: each open reads the index again (spec §7.2).
  fsListFiles(options.root)
    .then((listing) => {
      if (closed) return;
      files = listing.files;
      footer.hidden = !listing.truncated;
      render();
    })
    .catch((err) => {
      if (closed) return;
      files = [];
      error = errorMessage(err);
      render();
    });

  window.setTimeout(() => input.focus(), 0);
  return dispose;
}
