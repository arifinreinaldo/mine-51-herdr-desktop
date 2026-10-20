// File viewer spec §7.2: the Find File dialog. An input, a status line and a ranked list.

import { errorMessage } from "../appApi";
import { fsListFiles } from "../files/filesApi";
import { rankPaths } from "../files/fuzzy";
import { openModal } from "./modal";

export interface QuickOpenOptions {
  root: string;
  openTabs: readonly string[];
  onOpen(rel: string): void;
}

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

  const input = el("input", "shortcuts-modal-search");
  const status = el("div", "qo-status");
  const list = el("div", "qo-list");
  const footer = el("div", "qo-footer", "Showing first 50,000 files");

  function render(): void {
    const query = input.value;
    if (query.trim() === "") rows = options.openTabs.map((rel) => ({ rel, positions: [] }));
    else if (files === null) rows = [];
    else rows = rankPaths(query, files).map((r) => ({ rel: r.path, positions: r.positions }));
    if (selected >= rows.length) selected = Math.max(0, rows.length - 1);

    status.textContent =
      error ?? (files === null ? "Indexing…" : query.trim() !== "" && rows.length === 0 ? "No matching files" : "");
    list.textContent = "";
    rows.forEach((row, index) => {
      const node = el("div", index === selected ? "qo-row is-selected" : "qo-row");
      node.title = row.rel;
      const slash = row.rel.lastIndexOf("/");
      node.appendChild(nameWithHits(row.rel.slice(slash + 1), row.positions));
      node.appendChild(el("span", "qo-dir", slash >= 0 ? row.rel.slice(0, slash) : ""));
      // Keep focus in the input.
      node.addEventListener("mousedown", (event) => event.preventDefault());
      node.addEventListener("click", () => choose(row.rel));
      list.appendChild(node);
    });
  }

  function choose(rel: string): void {
    dispose(); // first: the modal gives the terminal focus on close (edge case 18)
    options.onOpen(rel);
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
        render();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          selected = Math.max(0, Math.min(rows.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1)));
          render();
          list.children[selected]?.scrollIntoView?.({ block: "nearest" });
        } else if (event.key === "Enter" && rows[selected]) {
          event.preventDefault();
          choose(rows[selected].rel);
        }
      });
      render();
    },
    {
      className: "quick-open",
      onClose: () => {
        closed = true;
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
