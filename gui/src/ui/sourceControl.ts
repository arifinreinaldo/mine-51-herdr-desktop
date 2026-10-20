// Source Control sidebar section (git MVP spec §6.1), read-only: the branch
// line and the staged / unstaged file groups. DOM only; the polling and the
// ordering rules live in `appSourceControl.ts` and `git/statusRefresh.ts`.
// Paths come from the repo and are untrusted, so all text uses `textContent`.

import type { ChangeKind, FileChange, GitStatus } from "../git/gitApi";
import type { ThemeColors } from "../themes/tokens";

export type SourceControlView =
  | { kind: "noWorkspace" }
  | { kind: "loading" }
  | { kind: "gitMissing" }
  | { kind: "notRepo"; cwd: string }
  | { kind: "status"; status: GitStatus };

export interface SourceControlCallbacks {
  onOpenGitDownload(): void;
  onOpenFile(file: FileChange, staged: boolean): void;
  onStage(files: FileChange[]): void;
  onUnstage(files: FileChange[]): void;
}

export const MAX_ROWS_PER_GROUP = 500;

const STATUS_LETTER: Record<ChangeKind, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typechanged: "T",
  untracked: "U",
  conflicted: "!",
};

/** Theme key for the status letter. Set only when the theme defines it (the
 * built-in themes do not), otherwise the CSS default stays. */
const STATUS_THEME_KEY: Record<ChangeKind, string> = {
  added: "gitDecoration.addedResourceForeground",
  modified: "gitDecoration.modifiedResourceForeground",
  typechanged: "gitDecoration.modifiedResourceForeground",
  deleted: "gitDecoration.deletedResourceForeground",
  renamed: "gitDecoration.renamedResourceForeground",
  copied: "gitDecoration.renamedResourceForeground",
  untracked: "gitDecoration.untrackedResourceForeground",
  conflicted: "gitDecoration.conflictingResourceForeground",
};

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

function renderBranch(branchEl: HTMLElement, view: SourceControlView): void {
  branchEl.textContent = "";
  if (view.kind !== "status") {
    branchEl.hidden = true;
    return;
  }
  const { status } = view;
  branchEl.hidden = false;
  branchEl.appendChild(el("i", "codicon codicon-git-branch"));
  branchEl.appendChild(el("span", "sc-branch__name", status.branch ?? "detached HEAD"));
  if (status.ahead > 0) branchEl.appendChild(el("span", "sc-branch__ahead", `↑${status.ahead}`));
  if (status.behind > 0) branchEl.appendChild(el("span", "sc-branch__behind", `↓${status.behind}`));
  const repo = status.repo ?? "";
  const repoEl = el("span", "sc-branch__repo", repo.split(/[/\\]/).filter(Boolean).pop() ?? repo);
  repoEl.title = repo;
  branchEl.appendChild(repoEl);
}

function iconButton(icon: string, label: string, className: string, onClick: () => void): HTMLButtonElement {
  const button = el("button", className);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(el("i", `codicon codicon-${icon}`));
  button.addEventListener("click", (event) => {
    event.stopPropagation(); // a row action must not open the diff
    onClick();
  });
  return button;
}

function renderRow(
  change: FileChange,
  staged: boolean,
  colors: ThemeColors,
  callbacks: SourceControlCallbacks,
): HTMLElement {
  const row = el("div", "sc-row");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.addEventListener("click", () => callbacks.onOpenFile(change, staged));
  row.addEventListener("keydown", (event) => {
    if (event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    callbacks.onOpenFile(change, staged);
  });
  row.dataset.path = change.path;
  row.title = change.kind === "conflicted" ? "Resolve conflicts in a terminal" : change.path;
  const letter = el("span", "sc-row__status", STATUS_LETTER[change.kind]);
  const color = colors[STATUS_THEME_KEY[change.kind]];
  if (color !== undefined) letter.style.color = color;
  const slash = change.path.lastIndexOf("/");
  row.appendChild(letter);
  row.appendChild(el("span", "sc-row__name", change.path.slice(slash + 1)));
  row.appendChild(el("span", "sc-row__dir", slash >= 0 ? change.path.slice(0, slash) : ""));
  if (change.kind !== "conflicted") {
    row.appendChild(
      staged
        ? iconButton("remove", "Unstage Changes", "icon-btn sc-row__action", () => callbacks.onUnstage([change]))
        : iconButton("add", "Stage Changes", "icon-btn sc-row__action", () => callbacks.onStage([change])),
    );
  }
  return row;
}

function renderGroup(
  bodyEl: HTMLElement,
  title: string,
  changes: FileChange[],
  staged: boolean,
  colors: ThemeColors,
  callbacks: SourceControlCallbacks,
): void {
  if (changes.length === 0) return;
  const header = el("div", "sc-group-header");
  header.appendChild(el("span", "sc-group-header__title", `${title} (${changes.length})`));
  if (staged) {
    header.appendChild(
      iconButton("remove", "Unstage All Changes", "icon-btn", () => callbacks.onUnstage(changes)),
    );
  } else {
    // "Stage All" leaves conflicted files out: `git add` would mark them resolved.
    const stageable = changes.filter((c) => c.kind !== "conflicted");
    if (stageable.length > 0) {
      header.appendChild(iconButton("add", "Stage All Changes", "icon-btn", () => callbacks.onStage(stageable)));
    }
  }
  bodyEl.appendChild(header);
  // shortcut: no virtual list; add one if repos with more than 500 changes turn out to be common.
  for (const change of changes.slice(0, MAX_ROWS_PER_GROUP)) {
    bodyEl.appendChild(renderRow(change, staged, colors, callbacks));
  }
  if (changes.length > MAX_ROWS_PER_GROUP) {
    bodyEl.appendChild(el("div", "sc-row sc-row--more", `and ${changes.length - MAX_ROWS_PER_GROUP} more`));
  }
}

export function renderSourceControl(
  branchEl: HTMLElement,
  bodyEl: HTMLElement,
  view: SourceControlView,
  error: string | null,
  colors: ThemeColors,
  callbacks: SourceControlCallbacks,
): void {
  renderBranch(branchEl, view);
  bodyEl.textContent = "";
  if (error !== null) bodyEl.appendChild(el("div", "sc-error", error));
  switch (view.kind) {
    case "noWorkspace":
      bodyEl.appendChild(el("div", "sc-message", "No workspace"));
      break;
    case "loading":
      break;
    case "gitMissing": {
      const message = el("div", "sc-message", "Git is not installed ");
      const link = el("span", "sc-link", "git-scm.com");
      link.setAttribute("role", "link");
      link.tabIndex = 0;
      link.addEventListener("click", callbacks.onOpenGitDownload);
      link.addEventListener("keydown", (event) => {
        if (event.key === "Enter") callbacks.onOpenGitDownload();
      });
      message.appendChild(link);
      bodyEl.appendChild(message);
      break;
    }
    case "notRepo": {
      bodyEl.appendChild(el("div", "sc-message", "Not a git repository"));
      const cwd = el("div", "sc-message", view.cwd);
      cwd.title = view.cwd;
      bodyEl.appendChild(cwd);
      break;
    }
    case "status": {
      const { staged, unstaged } = view.status;
      if (staged.length === 0 && unstaged.length === 0) {
        bodyEl.appendChild(el("div", "sc-message", "No changes"));
        break;
      }
      renderGroup(bodyEl, "Staged Changes", staged, true, colors, callbacks);
      renderGroup(bodyEl, "Changes", unstaged, false, colors, callbacks);
      break;
    }
  }
}
