// The device explorer page. A folder tree on the left has three roots:
// Shared storage (`/sdcard`), App data (debug builds, read through
// `run-as`) and Device root (`/`). The pane on the right lists the selected
// folder, and every item there can be saved to this PC. Only Shared storage
// takes writes: upload, sync, drop from the PC and delete. Errors show
// inline (`#error-notices` does not exist on this page). Every name comes
// from the device, so the page sets text with `textContent` and never uses
// `innerHTML`.

import "./style.css";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { SDCARD_PATH, childPath, isDeletablePath, isStatDenied, parentWithin, pushStatus } from "./android/deviceFiles";
import { parseMirrorToolsParams } from "./android/mirrorToolsParams";
import { formatBytes } from "./android/recordFormat";
import { errorMessage } from "./appApi";
import {
  androidDebuggableApps,
  androidDeletePath,
  androidListDir,
  androidPullPath,
  androidPushDropped,
  androidPushPaths,
  type DeviceEntry,
  type DirListing,
  type PushKind,
} from "./flutter/flutterApi";
import { applySavedTheme } from "./themes/savedTheme";
import { openConfirmPopover } from "./ui/confirmPopover";

/** One root of the folder tree. With `pkg`, every call runs as that app (`run-as`). */
interface TreeRoot {
  id: string;
  label: string;
  base: string;
  icon: string;
  pkg?: string;
  /** Upload, sync, drop and delete: Shared storage only. The backend checks every path again. */
  writable: boolean;
}

/** A folder listing, or adb's reason when Android refused the folder. */
type Listed = DirListing | { denied: string };

const SHARED: TreeRoot = { id: "shared", label: "sdcard", base: SDCARD_PATH, icon: "device-mobile", writable: true };
const DEVICE: TreeRoot = { id: "device", label: "/ (device root)", base: "/", icon: "root-folder", writable: false };

// Folders that the adb shell user can open below folders it cannot list
// (live, SM-A145F and 2412DPC0AG: `ls /data` and `ls /data/local` are refused,
// `ls /data/local/tmp` works).
const KNOWN_CHILDREN: Record<string, string[]> = { "/data": ["local"], "/data/local": ["tmp"] };

function appRoot(pkg: string): TreeRoot {
  return { id: `app:${pkg}`, label: pkg, base: `/data/data/${pkg}`, icon: "package", pkg, writable: false };
}

function isDenied(listed: Listed | undefined): listed is { denied: string } {
  return listed !== undefined && "denied" in listed;
}

function readOnlyText(path: string): string {
  return `${path} is read-only. Upload, sync, drop and delete work only in Shared storage`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, icon?: string): HTMLButtonElement {
  const btn = el("button", className);
  btn.type = "button";
  if (icon) btn.append(el("i", `codicon codicon-${icon}`));
  if (text) btn.append(el("span", undefined, text));
  return btn;
}

async function main(): Promise<void> {
  const root = document.getElementById("fx-root");
  if (!root) return;
  const params = parseMirrorToolsParams(location.search);
  if (!params) {
    root.textContent = "Invalid explorer parameters";
    return;
  }
  const id = params.deviceId;
  await applySavedTheme();
  document.title = "Files — " + params.deviceName;

  // One listing per folder feeds the tree and the pane. A late answer only
  // fills this store: the page always renders `sel` from it.
  const listings = new Map<string, Listed>();
  // At most one adb listing per folder at a time; a second caller shares it.
  const inflight = new Map<string, Promise<void>>();
  // Open tree rows. The same folder can sit under two roots, so the key holds the root.
  const open = new Set<string>();
  let sel: { root: TreeRoot; path: string } = { root: SHARED, path: SHARED.base };
  let apps: TreeRoot[] = [];
  let appsOpen = false;
  let appsLoading = false;
  let appsNote = "";
  // A pull never blocks browsing. `writing` keeps one upload, sync, drop or delete at a time.
  let pulling = false;
  let writing = false;
  // What the pane rows show now, so a listing for the tree does not rebuild them.
  let shown: Listed | undefined;
  let shownRoot: TreeRoot | undefined;

  const listKey = (r: TreeRoot, path: string): string => `${r.pkg ?? ""}:${path}`;
  const nodeKey = (r: TreeRoot, path: string): string => `${r.id}:${path}`;

  const upBtn = button("icon-btn db-page-btn", "", "arrow-up");
  upBtn.title = "Up one folder";
  upBtn.setAttribute("aria-label", upBtn.title);
  const refreshBtn = button("icon-btn db-page-btn", "", "refresh");
  refreshBtn.title = "List the folder again";
  refreshBtn.setAttribute("aria-label", refreshBtn.title);
  const pathText = el("span", "fx-path");
  const badge = el("span");
  const uploadFilesBtn = button("btn db-btn", "Upload files", "cloud-upload");
  const uploadFolderBtn = button("btn db-btn", "Upload folder", "cloud-upload");
  const syncBtn = button("btn db-btn", "Sync folder here", "sync");
  const status = el("span", "db-status");
  status.setAttribute("aria-live", "polite");
  const progress = el("div", "db-progress");
  progress.setAttribute("aria-hidden", "true");
  const bar = el("div", "db-bar");
  bar.append(upBtn, refreshBtn, pathText, badge, uploadFilesBtn, uploadFolderBtn, syncBtn, status, progress);

  const errorText = el("span", "db-error__text");
  const errorBar = el("div", "db-error");
  errorBar.setAttribute("role", "alert");
  errorBar.append(el("i", "codicon codicon-error"), errorText);
  errorBar.hidden = true;

  const appsChev = el("i");
  const appsHead = el("button", "db-side__head fx-section");
  appsHead.type = "button";
  appsHead.dataset.key = "apps";
  appsHead.title = "Apps installed from a debug build. Their data is read-only here";
  appsHead.append(appsChev, el("span", undefined, "App data · debug builds"));
  const tree = el("div", "db-tables");
  const side = el("nav", "db-side fx-side");
  side.setAttribute("aria-label", "Device folders");
  side.append(tree);

  const table = el("table", "db-result");
  const emptyText = el("p", "db-empty");
  const deniedText = el("span");
  const deniedPanel = el("div", "db-empty fx-denied");
  deniedPanel.append(el("i", "codicon codicon-lock"), el("strong", undefined, "Permission denied"), deniedText);
  const grid = el("div", "db-grid");
  grid.append(table, emptyText, deniedPanel);
  const dropHint = el("div", "fx-drop");
  dropHint.hidden = true;
  const pane = el("div", "fx-pane");
  pane.append(grid, dropHint);
  const mainEl = el("div", "db-main fx-main");
  mainEl.append(side, pane);
  root.append(bar, errorBar, mainEl);

  function showError(text: string): void {
    errorText.textContent = text;
    errorBar.hidden = false;
  }

  function renderAll(): void {
    renderTree();
    renderPane();
    renderControls();
  }

  /** Rebuilds the tree from `open` and `listings`, and keeps the keyboard focus on the same row. */
  function renderTree(): void {
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement && tree.contains(active) ? active.dataset.key : undefined;
    appsHead.setAttribute("aria-expanded", String(appsOpen));
    appsChev.className = `codicon codicon-chevron-${appsOpen ? "down" : "right"}`;
    const parts: HTMLElement[] = [el("div", "db-side__head", "Shared storage"), treeGroup("Shared storage", [SHARED]), appsHead];
    if (appsOpen) parts.push(apps.length > 0 ? treeGroup("App data", apps) : el("p", "fx-note", appsNote));
    parts.push(el("div", "db-side__head", "Device root"), treeGroup("Device root", [DEVICE]));
    tree.replaceChildren(...parts);
    if (focusKey) tree.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  function treeGroup(label: string, roots: TreeRoot[]): HTMLElement {
    const list = el("div");
    list.setAttribute("role", "tree");
    list.setAttribute("aria-label", label);
    for (const r of roots) addNode(list, r, r.base, r.label, 0, false);
    return list;
  }

  /** One tree row, then its folders when open. A folder that Android refuses shows a lock. */
  function addNode(list: HTMLElement, r: TreeRoot, path: string, label: string, depth: number, statDenied: boolean): void {
    const key = nodeKey(r, path);
    const listed = listings.get(listKey(r, path));
    const known = r === DEVICE ? KNOWN_CHILDREN[path] : undefined;
    const locked = statDenied || isDenied(listed);
    const expandable = !locked || known !== undefined;
    const expanded = expandable && open.has(key);
    const selected = sel.root === r && sel.path === path;
    const node = el("button", selected ? "db-table fx-node is-active" : "db-table fx-node");
    node.type = "button";
    node.dataset.key = key;
    node.style.setProperty("--depth", String(depth));
    node.title = locked ? `${path}: Permission denied` : path;
    node.setAttribute("role", "treeitem");
    node.setAttribute("aria-level", String(depth + 1));
    node.setAttribute("aria-selected", String(selected));
    if (expandable) node.setAttribute("aria-expanded", String(expanded));
    const chev = el("i", `codicon codicon-chevron-${expanded ? "down" : "right"} fx-chev`);
    chev.style.visibility = expandable ? "" : "hidden";
    node.append(chev, el("i", `codicon codicon-${locked ? "lock" : depth === 0 ? r.icon : "folder"}`), el("span", undefined, label));
    chev.addEventListener("click", (event) => {
      event.stopPropagation();
      if (expandable) toggle(r, path);
    });
    node.addEventListener("click", () => select(r, path));
    node.addEventListener("keydown", (event) => {
      if ((event.key === "ArrowRight" && expandable && !expanded) || (event.key === "ArrowLeft" && expanded)) {
        event.preventDefault();
        toggle(r, path);
      }
    });
    list.append(node);
    if (!expanded) return;
    if (listed !== undefined && !isDenied(listed)) {
      for (const child of listed.entries) {
        if (child.isDir) addNode(list, r, childPath(path, child.name), child.name, depth + 1, isStatDenied(child));
      }
    } else {
      for (const name of known ?? []) addNode(list, r, childPath(path, name), name, depth + 1, false);
    }
  }

  /** Rebuilds the rows only when the selected folder gets a new listing, so a tree listing keeps the scroll and focus. */
  function renderPane(): void {
    const r = sel.root;
    const dir = sel.path;
    const listed = listings.get(listKey(r, dir));
    if (listed === shown && r === shownRoot) return;
    shown = listed;
    shownRoot = r;
    table.replaceChildren();
    if (listed === undefined || isDenied(listed) || listed.entries.length === 0) return;
    const head = el("tr");
    head.append(el("th", undefined, "Name"), el("th", "db-num", "Size"), el("th", undefined, "Modified"), el("th", undefined, "Permissions"), el("th"), el("th"));
    const thead = el("thead");
    thead.append(head);
    const body = el("tbody");
    for (const entry of listed.entries) {
      // Fixed here: a listing that lands later must not retarget a save or a delete.
      const target = childPath(dir, entry.name);
      const locked = isStatDenied(entry);
      const nameCell = el("td");
      nameCell.title = entry.name;
      if (entry.isDir) {
        const openBtn = button("db-table", entry.name, locked ? "lock" : "folder");
        openBtn.addEventListener("click", () => select(r, target));
        nameCell.append(openBtn);
      } else {
        const file = el("div", "db-table fx-file");
        file.append(el("i", `codicon codicon-${locked ? "lock" : "file"}`), el("span", undefined, entry.name));
        nameCell.append(file);
      }
      const size = el("td", "db-num", entry.isDir || locked ? "" : formatBytes(entry.size));
      if (!entry.isDir && !locked) size.title = `${entry.size} bytes`;
      const saveCell = el("td");
      if (!locked) {
        const save = button("icon-btn db-page-btn", "", "cloud-download");
        save.dataset.save = "";
        save.title = `Save ${entry.name} to this PC`;
        save.setAttribute("aria-label", save.title);
        save.addEventListener("click", () => void pull(r, target, entry));
        saveCell.append(save);
      }
      const deleteCell = el("td");
      if (r.writable && isDeletablePath(target)) {
        const del = button("icon-btn db-page-btn", "", "trash");
        del.dataset.delete = "";
        del.title = `Delete ${entry.name} from the device`;
        del.setAttribute("aria-label", del.title);
        del.addEventListener("click", () => confirmDelete(del, target, entry.isDir));
        deleteCell.append(del);
      }
      const tr = el("tr");
      tr.append(nameCell, size, el("td", undefined, entry.modified), el("td", "fx-mode", entry.mode), saveCell, deleteCell);
      body.append(tr);
    }
    if (listed.truncated) {
      const td = el("td", "db-null", `Showing the first ${listed.entries.length} items`);
      td.colSpan = 6;
      const tr = el("tr");
      tr.append(td);
      body.append(tr);
    }
    table.append(thead, body);
  }

  function renderControls(): void {
    const key = listKey(sel.root, sel.path);
    const listed = listings.get(key);
    const listing = inflight.has(key);
    const canWrite = sel.root.writable && listed !== undefined && !isDenied(listed);
    upBtn.disabled = parentWithin(sel.path, sel.root.base) === null;
    refreshBtn.disabled = listing;
    pathText.textContent = sel.path;
    pathText.title = sel.path;
    badge.className = sel.root.writable ? "fx-rw" : "db-dirty";
    badge.textContent = sel.root.writable ? "Read and write" : "Read-only";
    badge.title = sel.root.writable ? "Upload, sync, drop and delete work in this folder" : readOnlyText(sel.path);
    uploadFilesBtn.disabled = uploadFolderBtn.disabled = syncBtn.disabled = !canWrite || writing;
    uploadFilesBtn.title = sel.root.writable ? `Copy files from this PC into ${sel.path}` : readOnlyText(sel.path);
    uploadFolderBtn.title = sel.root.writable ? `Copy a folder from this PC into ${sel.path}` : readOnlyText(sel.path);
    syncBtn.title = sel.root.writable
      ? `Copy a PC folder into ${sel.path}/<folder name>. Files whose time differs replace the device copy. Nothing on the device is deleted`
      : readOnlyText(sel.path);
    progress.classList.toggle("is-busy", inflight.size > 0 || appsLoading || pulling || writing);
    for (const btn of Array.from(table.querySelectorAll<HTMLButtonElement>("button[data-save]"))) btn.disabled = pulling;
    for (const btn of Array.from(table.querySelectorAll<HTMLButtonElement>("button[data-delete]"))) btn.disabled = listing || writing;
    const empty = listed === undefined ? (listing ? "Loading…" : "") : !isDenied(listed) && listed.entries.length === 0 ? "This folder is empty" : "";
    emptyText.textContent = empty;
    emptyText.hidden = empty === "";
    deniedPanel.hidden = !isDenied(listed);
    deniedText.textContent = isDenied(listed) ? listed.denied : "";
  }

  /** Lists a folder into `listings`. A refused folder is stored with adb's reason; other errors reject. */
  function load(r: TreeRoot, path: string): Promise<void> {
    const key = listKey(r, path);
    const running = inflight.get(key);
    if (running) return running;
    const task = androidListDir(id, path, r.pkg)
      .then(
        (listing) => {
          listings.set(key, listing);
        },
        (err: unknown) => {
          if ((err as { code?: string })?.code !== "permission_denied") throw err;
          listings.set(key, { denied: errorMessage(err) });
        },
      )
      .finally(() => {
        inflight.delete(key);
        renderAll();
      });
    inflight.set(key, task);
    renderAll();
    return task;
  }

  function reload(r: TreeRoot, path: string): void {
    void load(r, path).catch((err) => showError(errorMessage(err)));
  }

  /** Shows `path` in the pane at once (old rows or "Loading…") and lists it again. */
  function select(r: TreeRoot, path: string): void {
    if (sel.root !== r || sel.path !== path) grid.scrollTop = 0;
    sel = { root: r, path };
    open.add(nodeKey(r, path));
    errorBar.hidden = true;
    renderAll();
    void load(r, path).catch((err) => {
      if (sel.root === r && sel.path === path) showError(errorMessage(err));
    });
  }

  function toggle(r: TreeRoot, path: string): void {
    const key = nodeKey(r, path);
    if (!open.delete(key)) {
      open.add(key);
      if (!listings.has(listKey(r, path))) reload(r, path);
    }
    renderAll();
  }

  /** Opens or closes App data. An open with no apps yet scans the device (one adb call, about 2.5 s). */
  async function toggleApps(): Promise<void> {
    appsOpen = !appsOpen;
    renderAll();
    if (!appsOpen || appsLoading || apps.length > 0) return;
    appsLoading = true;
    appsNote = "Looking for debug builds…";
    renderAll();
    try {
      apps = (await androidDebuggableApps(id)).map(appRoot);
      appsNote = apps.length === 0 ? "No debug builds on this device. Install one with flutter run or a debug APK" : "";
    } catch (err) {
      appsNote = errorMessage(err);
    } finally {
      appsLoading = false;
      renderAll();
    }
  }

  /** A save dialog or folder picker, then a copy to this PC. One pull at a time. */
  async function pull(r: TreeRoot, target: string, entry: DeviceEntry): Promise<void> {
    if (pulling) return;
    pulling = true;
    errorBar.hidden = true;
    status.textContent = `Saving ${entry.name}…`;
    status.title = "";
    renderControls();
    try {
      const saved = await androidPullPath(id, target, entry.isDir, r.pkg);
      status.textContent = saved ? `Saved ${entry.name}` : "";
      status.title = saved ? `${saved.path}\n${saved.summary}` : "";
    } catch (err) {
      status.textContent = "";
      showError(errorMessage(err));
    } finally {
      pulling = false;
      renderControls();
    }
  }

  // An arrow, not a function declaration: `root` and `params` keep their non-null narrowing only here.
  /** Always asks first. The popover names the item and shows the full device path. */
  const confirmDelete = (anchor: HTMLButtonElement, target: string, isDir: boolean): void => {
    openConfirmPopover(root, anchor, {
      titlePrefix: "Delete ",
      titleName: target.slice(target.lastIndexOf("/") + 1),
      titleSuffix: isDir ? " and everything inside it?" : "?",
      detail: isDir
        ? `${target} and every file and folder inside it are deleted from ${params.deviceName}. There is no undo.`
        : `${target} is deleted from ${params.deviceName}. There is no undo.`,
      confirmLabel: "Delete",
      onConfirm: () => void deleteItem(target, isDir),
      onCancel: () => anchor.focus(),
    });
  };

  /** `rm` on the device; the backend checks that the name is gone. Only Shared storage rows have a delete icon. */
  async function deleteItem(target: string, isDir: boolean): Promise<void> {
    if (writing) return;
    writing = true;
    const slash = target.lastIndexOf("/");
    const name = target.slice(slash + 1);
    errorBar.hidden = true;
    status.textContent = `Deleting ${name}…`;
    status.title = target;
    renderControls();
    try {
      await androidDeletePath(id, target, isDir);
      status.textContent = `Deleted ${name}`;
      reload(SHARED, target.slice(0, slash));
    } catch (err) {
      status.textContent = "";
      showError(errorMessage(err));
    } finally {
      writing = false;
      renderControls();
    }
  }

  /** A native picker, then `adb push` into the folder on screen. One device write at a time. */
  async function push(kind: PushKind): Promise<void> {
    const r = sel.root;
    const dir = sel.path;
    if (writing || !r.writable) return;
    writing = true;
    errorBar.hidden = true;
    status.textContent = kind === "sync" ? `Syncing into ${dir}…` : `Uploading to ${dir}…`;
    status.title = "";
    renderControls();
    try {
      const pushed = await androidPushPaths(id, dir, kind);
      status.textContent = pushed ? pushStatus(kind, dir, pushed.names) : "";
      status.title = pushed ? `${status.textContent}\n${pushed.summary}` : "";
      if (pushed) reload(r, dir);
    } catch (err) {
      status.textContent = "";
      showError(errorMessage(err));
    } finally {
      writing = false;
      renderControls();
    }
  }

  /** Tauri gives the drag position in physical pixels, relative to the webview. */
  function overPane(position: { x: number; y: number }): boolean {
    const rect = pane.getBoundingClientRect();
    const x = position.x / devicePixelRatio;
    const y = position.y / devicePixelRatio;
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
  }

  /** `adb push --sync` of dropped PC paths into the folder on screen. A file that exists there is refused; a folder merges. */
  async function dropUpload(paths: string[]): Promise<void> {
    const r = sel.root;
    const dir = sel.path;
    if (!r.writable) {
      showError(readOnlyText(dir));
      return;
    }
    if (writing) {
      showError("Another upload, sync or delete is running. Drop again when it ends");
      return;
    }
    writing = true;
    errorBar.hidden = true;
    status.textContent = `Uploading to ${dir}…`;
    status.title = "";
    renderControls();
    try {
      const pushed = await androidPushDropped(id, dir, paths);
      status.textContent = pushStatus("drop", dir, pushed.names);
      status.title = `${status.textContent}\n${pushed.summary}`;
      reload(r, dir);
    } catch (err) {
      status.textContent = "";
      showError(errorMessage(err));
    } finally {
      writing = false;
      renderControls();
    }
  }

  upBtn.addEventListener("click", () => {
    const up = parentWithin(sel.path, sel.root.base);
    if (up) select(sel.root, up);
  });
  refreshBtn.addEventListener("click", () => {
    errorBar.hidden = true;
    reload(sel.root, sel.path);
  });
  appsHead.addEventListener("click", () => void toggleApps());
  uploadFilesBtn.addEventListener("click", () => void push("files"));
  uploadFolderBtn.addEventListener("click", () => void push("folder"));
  syncBtn.addEventListener("click", () => void push("sync"));
  getCurrentWebview()
    .onDragDropEvent((event) => {
      const drag = event.payload;
      if (drag.type === "leave") {
        dropHint.hidden = true;
        return;
      }
      const over = overPane(drag.position);
      if (drag.type === "drop") {
        dropHint.hidden = true;
        if (over && drag.paths.length > 0) void dropUpload(drag.paths);
        return;
      }
      dropHint.hidden = !over;
      dropHint.classList.toggle("is-refused", !sel.root.writable);
      dropHint.textContent = sel.root.writable ? `Drop to upload to ${sel.path}` : readOnlyText(sel.path);
    })
    .catch((err) => showError(`Drop to upload does not work in this window: ${errorMessage(err)}`));

  select(SHARED, SHARED.base);
}

void main();
