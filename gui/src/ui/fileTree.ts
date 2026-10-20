// File tree sidebar section (file viewer spec §6). DOM only; the state, the
// lazy loading and the toggling live in `appFiles.ts`. File and folder names
// come from disk and are untrusted, so all text uses `textContent`.

import type { DirEntry } from "../files/filesApi";

export interface FileTreeModel {
  root: string;
  expanded: ReadonlySet<string>;
  children: ReadonlyMap<string, readonly DirEntry[] | { error: string }>;
}

export interface FileTreeCallbacks {
  onToggle(rel: string): void;
  onOpen(rel: string): void;
}

/** Up to 4 lower-case characters after the last dot; `.gitignore` has none. */
export function extLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase().slice(0, 4) : "";
}

/** The absolute path for a tooltip, with the separator style of `root`. */
export function absolutePath(root: string, rel: string): string {
  if (rel === "") return root;
  const sep = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[/\\]+$/, "")}${sep}${rel.split("/").join(sep)}`;
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

function focusSibling(bodyEl: HTMLElement, row: HTMLElement, step: 1 | -1): void {
  const rows = Array.from(bodyEl.querySelectorAll<HTMLElement>(".ft-row[tabindex]"));
  rows[rows.indexOf(row) + step]?.focus();
}

function renderRows(
  bodyEl: HTMLElement,
  model: FileTreeModel,
  callbacks: FileTreeCallbacks,
  parent: string,
  depth: number,
): void {
  const entries = model.children.get(parent);
  if (!entries) return;
  if (!Array.isArray(entries)) {
    const row = el("div", "ft-row ft-row--error");
    for (let i = 0; i <= depth; i++) row.appendChild(el("span", "ft-guide"));
    row.appendChild(el("span", "ft-name", (entries as { error: string }).error));
    bodyEl.appendChild(row);
    return;
  }
  for (const entry of entries as readonly DirEntry[]) {
    const rel = parent === "" ? entry.name : `${parent}/${entry.name}`;
    const expanded = entry.isDir && model.expanded.has(rel);
    const row = el("div", "ft-row");
    row.tabIndex = 0;
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-level", String(depth + 1));
    row.dataset.rel = rel;
    row.title = absolutePath(model.root, rel);
    if (entry.isDir) {
      row.dataset.dir = "1";
      row.setAttribute("aria-expanded", String(expanded));
    }
    for (let i = 0; i < depth; i++) row.appendChild(el("span", "ft-guide"));
    if (entry.isDir) {
      row.appendChild(el("i", `codicon codicon-chevron-${expanded ? "down" : "right"} ft-chevron`));
      row.appendChild(el("i", `codicon codicon-folder${expanded ? "-opened" : ""}`));
    } else {
      row.appendChild(el("span", "ft-chevron"));
      const ext = extLabel(entry.name);
      row.appendChild(ext ? el("span", "ft-ext", ext) : el("i", "codicon codicon-file"));
    }
    row.appendChild(el("span", "ft-name", entry.name));
    const activate = (): void => (entry.isDir ? callbacks.onToggle(rel) : callbacks.onOpen(rel));
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusSibling(bodyEl, row, event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "ArrowRight" && entry.isDir && !expanded) {
        event.preventDefault();
        callbacks.onToggle(rel);
      } else if (event.key === "ArrowLeft" && entry.isDir && expanded) {
        event.preventDefault();
        callbacks.onToggle(rel);
      } else if (event.key === "Enter") {
        event.preventDefault();
        activate();
      }
    });
    bodyEl.appendChild(row);
    if (expanded) renderRows(bodyEl, model, callbacks, rel, depth + 1);
  }
}

export function renderFileTree(bodyEl: HTMLElement, model: FileTreeModel | null, callbacks: FileTreeCallbacks): void {
  const active = document.activeElement;
  const focusedRel = active instanceof HTMLElement && bodyEl.contains(active) ? (active.dataset.rel ?? null) : null;
  bodyEl.textContent = "";
  if (!model) {
    bodyEl.appendChild(el("div", "sc-message", "No workspace"));
    return;
  }
  renderRows(bodyEl, model, callbacks, "", 0);
  if (focusedRel === null) return;
  // A loop, not a selector: jsdom has no CSS.escape.
  for (const row of Array.from(bodyEl.querySelectorAll<HTMLElement>(".ft-row[tabindex]"))) {
    if (row.dataset.rel === focusedRel) {
      row.focus();
      return;
    }
  }
}
