// File viewer spec §5: the file tree, the viewer and Find File for the focused workspace. UI state lives here, in memory only (D8). Must not import appMenuBar.ts: that module imports this one.

import { listen } from "@tauri-apps/api/event";
import { api, errorMessage } from "./appApi";
import { requireConnected } from "./appConnectionGuard";
import { fileViewerEl, keyboardCapture, sidebarEl, tabListEl } from "./appDom";
import { closeDiff } from "./appSourceControl";
import { appState } from "./appState";
import type { RawSnapshot } from "./appTypes";
import { fsListDir, fsReadText, type DirEntry } from "./files/filesApi";
import { focusKeyboardCapture } from "./keyboard/focusCapture";
import { renderFileTree } from "./ui/fileTree";
import { closeTab, cycleTab, openTab, renderFileViewer, viewOf, type TabView, type ViewerContent } from "./ui/fileViewer";
import { closeFindBar } from "./ui/findBar";
import { openQuickOpen } from "./ui/quickOpen";

interface WorkspaceFiles {
  root: string; // the cwd of this state's key
  expanded: Set<string>;
  children: Map<string, DirEntry[] | { error: string }>;
  tabs: string[];
  active: string | null;
  views: Map<string, TabView>;
}

// Review W4: one state per (workspace, cwd), so a pane switch or a cd back finds its folders and tabs again.
const byKey = new Map<string, WorkspaceFiles>();
let activeKey: string | null = null;
let current: WorkspaceFiles | null = null;
let activeTabId: string | null = null;
let content: ViewerContent = { kind: "loading" };
let readSeq = 0; // drops stale reads (spec §5)

function newState(cwd: string): WorkspaceFiles {
  return { root: cwd, expanded: new Set(), children: new Map(), tabs: [], active: null, views: new Map() };
}

// The file tree lives under each workspace row (spec §6). Per workspace: its cwd from the last snapshot, whether the row is open, and one persistent element that the sidebar re-appends on each render.
const wsCwd = new Map<string, string>();
const expandedWs = new Set<string>();
const filesEls = new Map<string, HTMLElement>();
const elKey = new Map<string, string | null>(); // the key each element was last rendered for
let pendingOpen: { key: string; rel: string } | null = null; // a file opened from a tree of a workspace that is not focused yet

function keyOf(id: string): string | null {
  const cwd = wsCwd.get(id);
  return cwd ? `${id}\n${cwd}` : null;
}

function stateFor(id: string): WorkspaceFiles | null {
  const key = keyOf(id);
  if (key === null) return null;
  let state = byKey.get(key);
  if (!state) {
    state = newState(wsCwd.get(id)!);
    byKey.set(key, state);
  }
  return state;
}

export function isFilesExpanded(id: string): boolean {
  return expandedWs.has(id);
}

export function workspaceFilesElement(id: string): HTMLElement {
  let el = filesEls.get(id);
  if (!el) {
    el = document.createElement("div");
    el.className = "ws-files";
    el.setAttribute("role", "tree");
    el.setAttribute("aria-label", "Files");
    filesEls.set(id, el);
    renderWs(id);
  }
  return el;
}

function renderWs(id: string): void {
  const el = workspaceFilesElement(id);
  const state = stateFor(id);
  elKey.set(id, keyOf(id));
  if (!state) {
    el.textContent = "";
    const none = document.createElement("div");
    none.className = "sc-message";
    none.textContent = "No folder";
    el.appendChild(none);
    return;
  }
  renderFileTree(el, state, { onToggle: (rel) => toggleFolder(id, rel), onOpen: (rel) => openFromTree(id, rel) });
}

async function loadDir(ws: WorkspaceFiles, rel: string): Promise<void> {
  try {
    ws.children.set(rel, await fsListDir(ws.root, rel));
  } catch (err) {
    ws.children.set(rel, { error: errorMessage(err) });
  }
  for (const id of filesEls.keys()) if (stateFor(id) === ws) renderWs(id);
}

function toggleFolder(id: string, rel: string): void {
  const ws = stateFor(id);
  if (!ws) return;
  if (ws.expanded.delete(rel)) {
    renderWs(id);
    return;
  }
  ws.expanded.add(rel);
  renderWs(id);
  void loadDir(ws, rel); // D7: each expand reads the folder again.
}

/** The row chevron. The caller re-renders the sidebar afterwards. */
export function toggleWorkspaceFiles(id: string): void {
  if (expandedWs.delete(id)) return;
  expandedWs.add(id);
  const ws = stateFor(id);
  renderWs(id);
  // D7: an expand reads the root and every open folder again; this replaces a refresh button.
  if (ws) for (const rel of ["", ...ws.expanded]) void loadDir(ws, rel);
}

function openFromTree(id: string, rel: string): void {
  const key = keyOf(id);
  if (key === null) return;
  if (key === activeKey) {
    openFileInViewer(rel);
    return;
  }
  if (!requireConnected()) return;
  pendingOpen = { key, rel };
  void api("workspace.focus", { workspace_id: id }).then((result) => {
    if (result === undefined && pendingOpen?.key === key) pendingOpen = null;
  });
}

function onSnapshot(snapshot: RawSnapshot): void {
  const live = new Set<string>();
  for (const w of snapshot.workspaces) {
    live.add(w.workspace_id);
    if (w.new_workspace_cwd) wsCwd.set(w.workspace_id, w.new_workspace_cwd);
    else wsCwd.delete(w.workspace_id);
  }
  for (const id of [...wsCwd.keys(), ...expandedWs, ...filesEls.keys()]) {
    if (live.has(id)) continue;
    wsCwd.delete(id);
    expandedWs.delete(id);
    filesEls.delete(id);
    elKey.delete(id);
  }
  for (const key of [...byKey.keys()]) if (!live.has(key.split("\n")[0])) byKey.delete(key);
  for (const id of [...filesEls.keys()]) {
    if (elKey.get(id) === keyOf(id)) continue;
    renderWs(id);
    const ws = stateFor(id);
    if (ws && expandedWs.has(id) && !ws.children.has("")) void loadDir(ws, "");
  }
  const focused = snapshot.workspaces.find((w) => w.focused);
  const key = focused ? keyOf(focused.workspace_id) : null;
  const tabId = snapshot.focused_tab_id;
  if (key === activeKey && tabId === activeTabId) return;
  // Spec §5 plus review W1: a workspace, cwd or terminal-tab switch hides the viewer. Every
  // tab switch in this GUI is a user move: Alt+1..9, Ctrl+Tab outside the viewer, New Tab,
  // All Tabs, an agent-popover row (edge case 20).
  activeTabId = tabId;
  hideFileViewer();
  if (key === activeKey) return;
  activeKey = key;
  current = focused ? stateFor(focused.workspace_id) : null;
  // The pending open comes after the hide above, which a key change always does.
  const pending = pendingOpen;
  pendingOpen = null;
  if (pending && pending.key === key) openFileInViewer(pending.rel);
}

export async function initFiles(): Promise<void> {
  fileViewerEl.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    hideFileViewer(); // spec §5: keeps the tabs
  });
  // Review W1: popovers, menus and modals give the terminal focus when they close
  // (statusbar.ts:185,680, modal.ts:65). Keys must not reach a terminal under the viewer.
  keyboardCapture.addEventListener("focus", () => {
    if (!fileViewerEl.hidden) fileViewerEl.focus();
  });
  // Review W1: a left press on a terminal tab or a workspace row is a move to the terminal.
  for (const el of [tabListEl, sidebarEl]) {
    el.addEventListener(
      "pointerdown",
      (event) => {
        // A press inside a file tree opens a file or moves in the tree: not a move to the terminal.
        if (event.button === 0 && !(event.target as Element).closest(".ws-files, .ws-chevron")) hideFileViewer();
      },
      true,
    );
  }
  await listen<RawSnapshot>("snapshot", (e) => onSnapshot(e.payload));
}

function renderViewer(): void {
  if (!current || current.active === null) return;
  renderFileViewer(
    fileViewerEl,
    { root: current.root, tabs: current.tabs, active: current.active, content, view: viewOf(current, current.active) },
    appState.renderer?.getFontSizePx() ?? appState.settings.fontSize,
    { onActivate: activateTab, onClose: closeFileTab },
  );
}

/** Reads the active file again on each activation (D7). */
async function readActive(): Promise<void> {
  const ws = current;
  if (!ws || ws.active === null) return;
  const seq = ++readSeq;
  content = { kind: "loading" };
  renderViewer();
  let next: ViewerContent;
  try {
    const result = await fsReadText(ws.root, ws.active);
    if (result.kind === "text") next = { kind: "text", text: result.content ?? "" };
    else if (result.kind === "binary") next = { kind: "binary" };
    else next = { kind: "tooLarge", size: result.size };
  } catch (err) {
    next = (err as { code?: string })?.code === "not_found" ? { kind: "missing" } : { kind: "error", message: errorMessage(err) };
  }
  if (seq !== readSeq) return;
  content = next;
  renderViewer();
}

function openFileInViewer(rel: string): void {
  if (!current) return;
  openTab(current, rel);
  closeDiff(false);
  closeFindBar(); // the find bar sits under the viewer (z-index), so it must not stay open behind it
  fileViewerEl.hidden = false;
  fileViewerEl.focus();
  void readActive();
}

function activateTab(rel: string): void {
  if (!current || current.active === rel) return; // W3: a click on the active tab does not read again
  current.active = rel;
  void readActive();
}

function closeFileTab(rel: string): void {
  if (!current) return;
  const before = current.active;
  closeTab(current, rel);
  if (current.active === null) hideFileViewer();
  else if (current.active !== before) void readActive();
  else renderViewer(); // the view of the active tab restores its scroll position and current line
}

export function hideFileViewer(): void {
  if (fileViewerEl.hidden) return;
  const hadFocus = fileViewerEl.contains(document.activeElement); // read first: hiding blurs to body
  ++readSeq;
  fileViewerEl.hidden = true;
  fileViewerEl.textContent = "";
  // Only when the viewer held focus: a hide that a snapshot causes must not take focus from the finder or the commit box.
  if (hadFocus) focusKeyboardCapture();
}

export function openFindFile(): void {
  const ws = current;
  if (!ws) return;
  openQuickOpen({
    root: ws.root,
    openTabs: [...ws.tabs],
    // The workspace can change while the finder is open.
    onOpen: (rel) => {
      if (ws === current) openFileInViewer(rel);
    },
  });
}

export function fileTabAction(id: string): void {
  if (!current || fileViewerEl.hidden || current.active === null) return;
  if (id === "tab.close") {
    closeFileTab(current.active);
    return;
  }
  cycleTab(current, id === "tab.next" ? 1 : -1);
  void readActive();
}
