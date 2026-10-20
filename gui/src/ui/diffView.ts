// Diff overlay (git MVP spec §6.2): a read-only unified diff with old/new
// line-number gutters over the terminal canvas. DOM only; the fetching and the
// open/close rules live in `appSourceControl.ts`. Diff text comes from the
// repo and is untrusted, so all text uses `textContent`.

import { parseUnifiedDiff } from "../git/diffParse";
import type { GitDiff } from "../git/gitApi";
import { FONT_STACK } from "../render/renderer";

export interface DiffViewModel {
  path: string;
  staged: boolean;
  untracked: boolean;
  /** `null` while loading. */
  diff: GitDiff | null;
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

export function renderDiffView(rootEl: HTMLElement, model: DiffViewModel, fontSizePx: number, onClose: () => void): void {
  rootEl.textContent = "";

  const header = el("div", "diff-view__header");
  header.appendChild(el("span", "diff-view__path", model.path));
  const tag = model.staged ? "(staged)" : model.untracked ? "(untracked)" : "";
  header.appendChild(el("span", "diff-view__tag", tag));
  const closeBtn = el("button", "icon-btn");
  closeBtn.type = "button";
  closeBtn.title = "Close (Esc)";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(el("i", "codicon codicon-close"));
  closeBtn.addEventListener("click", onClose);
  header.appendChild(closeBtn);
  rootEl.appendChild(header);

  const body = el("div", "diff-view__body");
  body.style.fontFamily = FONT_STACK;
  body.style.fontSize = `${fontSizePx}px`;
  const { diff } = model;
  if (diff === null) {
    body.appendChild(el("div", "diff-view__note", "Loading…"));
  } else if (diff.binary) {
    body.appendChild(el("div", "diff-view__note", "Binary file, no text diff"));
  } else {
    const lines = el("div", "diff-view__lines");
    for (const line of parseUnifiedDiff(diff.text)) {
      const row = el("div", `diff-row diff-row--${line.kind}`);
      const hasNumbers = line.kind !== "hunk" && line.kind !== "meta";
      row.appendChild(el("span", "diff-row__no", hasNumbers && line.oldNo !== null ? String(line.oldNo) : ""));
      row.appendChild(el("span", "diff-row__no", hasNumbers && line.newNo !== null ? String(line.newNo) : ""));
      row.appendChild(el("span", "diff-row__text", line.text));
      lines.appendChild(row);
    }
    body.appendChild(lines);
    if (diff.truncated) body.appendChild(el("div", "diff-view__note", "Diff truncated at 2 MiB"));
  }
  rootEl.appendChild(body);
}
