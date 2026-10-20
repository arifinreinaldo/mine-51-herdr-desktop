// Source Control section orchestration (git MVP spec §6.1, §6.3): the toggle,
// the 3 s poll, active-workspace tracking and inline poll errors. The ordering
// rules are pure logic in `git/statusRefresh.ts`; the DOM is `ui/sourceControl.ts`.
// Must not import `appMenuBar.ts`: that module imports this one.

import { listen } from "@tauri-apps/api/event";
import { errorMessage, invokeSafe, showErrorNotice, showInfoNotice } from "./appApi";
import {
  diffViewEl,
  keyboardCapture,
  sourceControlBodyEl,
  sourceControlBranchEl,
  sourceControlCommitBtn,
  sourceControlCommitEl,
  sourceControlEl,
  sourceControlMessageEl,
  sourceControlRefreshBtn,
} from "./appDom";
import { currentThemeDef } from "./appLookups";
import { appState } from "./appState";
import type { RawSnapshot } from "./appTypes";
import { gitCommit, gitDiff, gitStage, gitStatus, gitUnstage, type FileChange, type GitDiff, type GitStatus } from "./git/gitApi";
import { createStatusRefresher, followOpenDiff, type OpenDiffRef } from "./git/statusRefresh";
import { focusKeyboardCapture } from "./keyboard/focusCapture";
import { IS_MAC } from "./shortcuts";
import { renderDiffView } from "./ui/diffView";
import { renderSourceControl, type SourceControlView } from "./ui/sourceControl";

// shortcut: 3 s poll, not a file watcher; add notify-based watching if the poll shows up in the perf HUD on large repos.
const POLL_MS = 3000;

let activeWorkspaceId: string | null = null;
let activeCwd: string | null = null;
let view: SourceControlView = { kind: "noWorkspace" };
let pollError: string | null = null;
let openDiff: (OpenDiffRef & { repo: string; untracked: boolean }) | null = null;
let diffSeq = 0; // drops stale diff responses
let committing = false;

function isActive(): boolean {
  return appState.settings.sourceControlOpen && appState.settings.sidebarVisible;
}

/** The repo of the rendered status, or `null` when the view is not a repo. */
function currentRepo(): string | null {
  return view.kind === "status" ? view.status.repo : null;
}

function updateCommitBox(): void {
  sourceControlCommitEl.hidden = view.kind !== "status";
  sourceControlCommitBtn.disabled =
    committing ||
    sourceControlMessageEl.value.trim() === "" ||
    view.kind !== "status" ||
    view.status.staged.length === 0;
}

function render(): void {
  renderSourceControl(sourceControlBranchEl, sourceControlBodyEl, view, pollError, currentThemeDef().colors, {
    onOpenGitDownload: () => void invokeSafe("open_external_url", { url: "https://git-scm.com" }),
    onOpenFile: openFile,
    onStage: (files) => void runWrite(() => gitStage(currentRepo()!, files.map((f) => f.path))),
    onUnstage: (files) =>
      void runWrite(() =>
        gitUnstage(
          currentRepo()!,
          // A staged rename also needs its old path, or reset leaves the deletion staged.
          files.flatMap((f) => (f.origPath !== null ? [f.path, f.origPath] : [f.path])),
        ),
      ),
  });
  updateCommitBox();
}

function showDiff(diff: GitDiff | null): void {
  if (!openDiff) return;
  const fontSize = appState.renderer?.getFontSizePx() ?? appState.settings.fontSize;
  renderDiffView(
    diffViewEl,
    { path: openDiff.path, staged: openDiff.staged, untracked: openDiff.untracked, diff },
    fontSize,
    () => closeDiff(),
  );
}

async function fetchDiff(): Promise<void> {
  if (!openDiff) return;
  const seq = ++diffSeq;
  const { repo, path, staged, untracked } = openDiff;
  try {
    const diff = await gitDiff(repo, path, staged, untracked);
    if (seq === diffSeq && openDiff) showDiff(diff);
  } catch (err) {
    if (seq !== diffSeq) return;
    showErrorNotice(errorMessage(err)); // an action error, so it toasts (spec §7)
    closeDiff();
  }
}

function openFile(file: FileChange, staged: boolean): void {
  if (view.kind !== "status") return;
  openDiff = { path: file.path, staged, kind: file.kind, repo: view.status.repo!, untracked: file.kind === "untracked" };
  diffViewEl.hidden = false;
  showDiff(null);
  diffViewEl.focus();
  void fetchDiff();
}

export function closeDiff(refocus = true): void {
  if (!openDiff) return;
  openDiff = null; // before the focus call, so the capture-focus listener sees nothing open
  ++diffSeq;
  diffViewEl.hidden = true;
  diffViewEl.textContent = "";
  if (refocus) focusKeyboardCapture();
}

/** Runs a stage or unstage call; refreshes in `finally` (spec §6.3). */
async function runWrite(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    showErrorNotice(errorMessage(err));
  } finally {
    refresher.request();
  }
}

async function commit(): Promise<void> {
  const repo = currentRepo();
  if (sourceControlCommitBtn.disabled || repo === null) return;
  committing = true;
  updateCommitBox();
  try {
    const r = await gitCommit(repo, sourceControlMessageEl.value);
    sourceControlMessageEl.value = "";
    showInfoNotice(`Committed ${r.hash}`);
  } catch (err) {
    showErrorNotice(errorMessage(err));
  } finally {
    committing = false;
    updateCommitBox();
    refresher.request();
  }
}

const refresher = createStatusRefresher<GitStatus>({
  fetch: gitStatus,
  currentCwd: () => activeCwd,
  onResult(cwd, status) {
    pollError = null;
    view = status.repo === null ? { kind: "notRepo", cwd } : { kind: "status", status };
    render();
    if (!openDiff) return;
    if (status.repo === null) {
      closeDiff();
      return;
    }
    const follow = followOpenDiff(openDiff, status);
    if (follow.action === "close") {
      closeDiff();
    } else if (follow.action === "refetch") {
      openDiff.staged = follow.staged;
      openDiff.kind = follow.kind;
      openDiff.untracked = follow.kind === "untracked";
      void fetchDiff();
    }
  },
  onError(_cwd, err) {
    if ((err as { code?: string })?.code === "git_not_found") {
      view = { kind: "gitMissing" };
      pollError = null;
    } else {
      pollError = errorMessage(err);
    }
    render(); // poll errors never toast (spec §7)
  },
});

function onSnapshot(snapshot: RawSnapshot): void {
  // shortcut: new_workspace_cwd follows a cd only after herdr learns the pane's new cwd (the shell reports it, e.g. OSC 7); add a shell-integration hint if users expect otherwise.
  const ws = snapshot.workspaces.find((w) => w.focused);
  const id = ws?.workspace_id ?? null;
  const cwd = ws?.new_workspace_cwd || null;
  if (id === activeWorkspaceId && cwd === activeCwd) return;
  activeWorkspaceId = id;
  activeCwd = cwd;
  closeDiff();
  refresher.reset();
  pollError = null;
  view = cwd ? { kind: "loading" } : { kind: "noWorkspace" };
  render();
  if (isActive()) refresher.request();
}

export function applySourceControlVisibility(): void {
  sourceControlEl.hidden = !appState.settings.sourceControlOpen;
  if (isActive()) {
    render();
    refresher.request();
  }
}

export async function initSourceControl(): Promise<void> {
  applySourceControlVisibility();
  sourceControlRefreshBtn.addEventListener("click", () => refresher.request());
  diffViewEl.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeDiff();
  });
  // Some other control (a tab click, a menu close) gave the terminal focus: it must
  // not type behind an open diff (spec §6.2), so close without taking focus again.
  keyboardCapture.addEventListener("focus", () => closeDiff(false));
  sourceControlMessageEl.addEventListener("input", updateCommitBox);
  sourceControlMessageEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    void commit();
  });
  sourceControlCommitBtn.addEventListener("click", () => void commit());
  if (IS_MAC) sourceControlMessageEl.placeholder = "Message (⌘Return to commit)";
  window.addEventListener("focus", () => {
    if (isActive()) refresher.request();
  });
  window.setInterval(() => {
    if (isActive() && !document.hidden) refresher.request();
  }, POLL_MS);
  await listen<RawSnapshot>("snapshot", (event) => onSnapshot(event.payload));
}
