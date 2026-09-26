// Frontend bootstrap (spec §6). Wires the sidebar, tab strip, action
// toolbar, terminal canvas, usage bar, and connection banner to the
// src-tauri backend: a `Channel` of compact binary surface frames
// (`decoder.ts`/`grid.ts`), and `snapshot`/`usage`/`connection-status`
// events (JSON, small and infrequent, per spec §2 "Data flow").
//
// "The first paint shows the chrome immediately (sidebar skeleton + usage
// bar), then the terminal when the first surface arrives. Call
// report_ready after two requestAnimationFrames following the first chrome
// paint."

import "./style.css";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentRow, AgentStatus } from "./agents";
import { sortAgents } from "./agents";
import { cssColor, DEFAULT_PALETTE } from "./colors";
import { decodeSurfaceFrame } from "./decoder";
import type { Grid } from "./grid";
import { applyDecodedFrame, createEmptyGrid } from "./grid";
import type { KeyboardEventLike } from "./input/keymap";
import { mapKeyboardEvent } from "./input/keymap";
import type { UsageState as FormatUsageState } from "./usage";
import { formatUsage, usageColor, worstActivePct } from "./usage";

// ---------------------------------------------------------------------------
// Raw snapshot JSON shapes (spec §1 "Snapshot"), field names verbatim from
// the wire (`ClientShellSnapshot` and children, `src/protocol/wire.rs`).
// ---------------------------------------------------------------------------

interface RawWorkspace {
  workspace_id: string;
  label: string;
  focused: boolean;
  agent_status: AgentStatus;
}

interface RawTab {
  tab_id: string;
  workspace_id: string;
  label: string;
  focused: boolean;
  agent_status: AgentStatus;
}

interface RawPane {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  focused: boolean;
}

interface RawAgent {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  agent_status: AgentStatus;
  state_change_seq: number;
  display_agent: string | null;
  name: string | null;
}

interface RawSnapshot {
  boot_id: string;
  focused_workspace_id: string | null;
  focused_tab_id: string | null;
  focused_pane_id: string | null;
  workspaces: RawWorkspace[];
  tabs: RawTab[];
  panes: RawPane[];
  agents: RawAgent[];
}

interface UsageEventPayload {
  five_hour: { used_pct: number; resets_at: number } | null;
  seven_day: { used_pct: number; resets_at: number } | null;
  captured_at: number | null;
  status: "ok" | "missing" | "invalid";
}

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const bannerEl = document.getElementById("banner") as HTMLDivElement;
const sidebarEl = document.getElementById("sidebar") as HTMLElement;
const sidebarResizeHandleEl = document.getElementById("sidebar-resize-handle") as HTMLDivElement;
const tabStripEl = document.getElementById("tab-strip") as HTMLDivElement;
const toolbarEl = document.getElementById("toolbar") as HTMLDivElement;
const canvas = document.getElementById("terminal") as HTMLCanvasElement;
const keyboardCapture = document.getElementById("keyboard-capture") as HTMLTextAreaElement;
const usageBarEl = document.getElementById("usage-bar") as HTMLElement;
const errorNoticesEl = document.getElementById("error-notices") as HTMLDivElement;
const ctx = canvas.getContext("2d", { alpha: false });

// ---------------------------------------------------------------------------
// Error notices (spec, code review finding #15): every `invoke` call below
// goes through `invokeSafe`, which shows a transient, non-modal, auto-hide
// notice on failure instead of silently discarding the error. Never
// alert()/confirm().
// ---------------------------------------------------------------------------

const ERROR_NOTICE_DURATION_MS = 4000;

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return String(err);
}

function showErrorNotice(message: string): void {
  const notice = document.createElement("div");
  notice.className = "error-notice";
  notice.textContent = message;
  errorNoticesEl.appendChild(notice);
  window.setTimeout(() => notice.remove(), ERROR_NOTICE_DURATION_MS);
}

/** Wraps `invoke`, showing an inline error notice instead of discarding a
 * rejected call (finding #15). Resolves to `undefined` on failure so
 * call sites don't need their own try/catch. */
function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  return invoke<T>(cmd, args).catch((err: unknown) => {
    showErrorNotice(errorMessage(err));
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let grid: Grid = createEmptyGrid();
let snapshot: RawSnapshot | null = null;
let cellWidthPx = 8;
let cellHeightPx = 16;
let fontSizePx = 13;
let resizeDebounceTimer: number | undefined;
let usagePayload: UsageEventPayload = {
  five_hour: null,
  seven_day: null,
  captured_at: null,
  status: "missing",
};

// rAF-coalesced dirty-row repaint (spec §2 "Repaint dirty rows only, and
// coalesce with requestAnimationFrame").
let pendingDirtyRows: Set<number> | "all" | null = null;
let rafScheduled = false;

function markDirty(rows: number[] | "all"): void {
  if (rows === "all" || pendingDirtyRows === "all") {
    pendingDirtyRows = "all";
  } else {
    if (!pendingDirtyRows) pendingDirtyRows = new Set();
    for (const y of rows) pendingDirtyRows.add(y);
  }
  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(flushRender);
  }
}

function flushRender(): void {
  rafScheduled = false;
  const rows = pendingDirtyRows;
  pendingDirtyRows = null;
  if (!rows) return;
  if (rows === "all") {
    paintRows(range(0, grid.height));
  } else {
    paintRows([...rows].filter((y) => y >= 0 && y < grid.height));
  }
  paintCursor();
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------
// Canvas: cell measurement + rendering (spec §6 "Terminal canvas")
// ---------------------------------------------------------------------------

function terminalFont(): string {
  return `${fontSizePx}px "Cascadia Mono", "Consolas", monospace`;
}

function measureCell(): void {
  if (!ctx) return;
  ctx.font = terminalFont();
  const metrics = ctx.measureText("M");
  cellWidthPx = Math.max(1, Math.round(metrics.width));
  const ascent = metrics.actualBoundingBoxAscent ?? fontSizePx * 0.8;
  const descent = metrics.actualBoundingBoxDescent ?? fontSizePx * 0.2;
  cellHeightPx = Math.max(1, Math.round((ascent + descent) * 1.3));
}

function resizeCanvasBackingStore(): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function paintRows(rows: number[]): void {
  if (!ctx || grid.width === 0) return;
  for (const y of rows) {
    paintRow(y);
  }
}

function paintRow(y: number): void {
  if (!ctx) return;
  const rowY = y * cellHeightPx;
  // Clear the row first: a skip cell leaves the background painted, not
  // stale glyph pixels from a previous, wider grapheme at the same slot.
  ctx.fillStyle = DEFAULT_BG;
  ctx.fillRect(0, rowY, grid.width * cellWidthPx, cellHeightPx);

  ctx.textBaseline = "top";
  ctx.font = terminalFont();

  for (let x = 0; x < grid.width; x++) {
    const cell = grid.cells[y * grid.width + x];
    if (!cell || cell.skip || !cell.symbol) continue;

    const cellX = x * cellWidthPx;
    const bold = (cell.modifier & 0x0001) !== 0;
    const dim = (cell.modifier & 0x0002) !== 0;
    const italic = (cell.modifier & 0x0004) !== 0;
    const underlined = (cell.modifier & 0x0008) !== 0;
    const reversed = (cell.modifier & 0x0040) !== 0;

    let fg = cssColor(cell.fg, DEFAULT_PALETTE);
    let bg = cssColor(cell.bg, DEFAULT_PALETTE);
    if (cell.bg === 0) bg = DEFAULT_BG;
    if (cell.fg === 0) fg = DEFAULT_FG;
    if (reversed) {
      [fg, bg] = [bg, fg];
    }

    if (bg !== DEFAULT_BG) {
      ctx.fillStyle = bg;
      ctx.fillRect(cellX, rowY, cellWidthPx, cellHeightPx);
    }

    ctx.fillStyle = fg;
    ctx.globalAlpha = dim ? 0.65 : 1;
    ctx.font = `${bold ? "bold " : ""}${italic ? "italic " : ""}${terminalFont()}`;
    ctx.fillText(cell.symbol, cellX, rowY);
    ctx.globalAlpha = 1;

    if (underlined) {
      ctx.strokeStyle = fg;
      ctx.beginPath();
      const lineY = rowY + cellHeightPx - 1;
      ctx.moveTo(cellX, lineY);
      ctx.lineTo(cellX + cellWidthPx, lineY);
      ctx.stroke();
    }
  }
}

const DEFAULT_BG = "#0c0c0c";
const DEFAULT_FG = "#d4d4d4";

function paintCursor(): void {
  if (!ctx || !grid.cursor || !grid.cursor.visible) return;
  const { x, y } = grid.cursor;
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x * cellWidthPx, y * cellHeightPx, cellWidthPx, cellHeightPx);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Surface channel: raw compact binary frames (spec §5), decoded here.
// ---------------------------------------------------------------------------

function toBytes(data: unknown): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  // Small raw payloads may arrive as a plain array of byte values
  // (tauri's direct-eval fast path for small Channel<Raw> messages).
  return new Uint8Array(data as ArrayLike<number>);
}

async function subscribeSurface(): Promise<void> {
  const channel = new Channel<unknown>();
  channel.onmessage = (message) => {
    const frame = decodeSurfaceFrame(toBytes(message));
    const previousCursor = grid.cursor;
    const { grid: nextGrid, dirtyRows } = applyDecodedFrame(grid, frame);
    const widthChanged = nextGrid.width !== grid.width;
    grid = nextGrid;
    if (widthChanged) {
      markDirty("all");
      return;
    }
    // A patch's cursor replaces the old one outright (spec §1, code review
    // finding #7): repaint both the old and the new cursor's row, or the
    // old highlight stays as a ghost (the canvas keeps whatever was drawn
    // there last frame until something repaints that row).
    const rows = new Set(dirtyRows);
    if (previousCursor) rows.add(previousCursor.y);
    if (grid.cursor) rows.add(grid.cursor.y);
    markDirty([...rows]);
  };
  await invokeSafe("subscribe_surface", { channel });
}

// ---------------------------------------------------------------------------
// Sidebar: workspaces/tabs + priority-sorted agents (spec §6 "Sidebar")
// ---------------------------------------------------------------------------

function statusDotClass(status: AgentStatus): string {
  return `status-dot status-dot--${status}`;
}

// Persisted across `renderSidebar()` rebuilds (spec §6 "Sidebar": workspace
// groups are collapsible, finding #12). `renderSidebar` clears and rebuilds
// the whole sidebar on every `snapshot` event, so collapse state can't live
// on the DOM nodes themselves.
const collapsedWorkspaceIds = new Set<string>();

function toggleWorkspaceCollapsed(workspaceId: string): void {
  if (collapsedWorkspaceIds.has(workspaceId)) {
    collapsedWorkspaceIds.delete(workspaceId);
  } else {
    collapsedWorkspaceIds.add(workspaceId);
  }
  renderSidebar();
}

async function focusAgent(agent: RawAgent): Promise<void> {
  // Awaited in order (code review finding #9): workspace, then tab, then
  // pane, each depending on the previous one's focus having taken effect.
  await invokeSafe("api", { method: "workspace.focus", params: { workspace_id: agent.workspace_id } });
  await invokeSafe("api", { method: "tab.focus", params: { tab_id: agent.tab_id } });
  await invokeSafe("api", { method: "pane.focus", params: { pane_id: agent.pane_id } });
}

function renderSidebar(): void {
  sidebarEl.textContent = "";
  if (!snapshot) return;

  for (const workspace of snapshot.workspaces) {
    const collapsed = collapsedWorkspaceIds.has(workspace.workspace_id);
    const group = document.createElement("div");
    group.className = "sidebar-group";

    const header = document.createElement("div");
    header.className = "sidebar-group__header";
    header.textContent = `${collapsed ? "▸" : "▾"} ${workspace.label}`;
    header.addEventListener("click", () => toggleWorkspaceCollapsed(workspace.workspace_id));
    group.appendChild(header);

    if (!collapsed) {
      const tabs = snapshot.tabs.filter((t) => t.workspace_id === workspace.workspace_id);
      for (const tab of tabs) {
        const row = document.createElement("div");
        row.className = `sidebar-tab${tab.focused ? " is-focused" : ""}`;
        const dot = document.createElement("span");
        dot.className = statusDotClass(tab.agent_status);
        row.appendChild(dot);
        const label = document.createElement("span");
        label.textContent = tab.label;
        row.appendChild(label);
        row.addEventListener("click", () => {
          void invokeSafe("api", { method: "tab.focus", params: { tab_id: tab.tab_id } });
        });
        group.appendChild(row);
      }
    }

    sidebarEl.appendChild(group);
  }

  const agentsGroup = document.createElement("div");
  agentsGroup.className = "sidebar-group";
  const agentsHeader = document.createElement("div");
  agentsHeader.className = "sidebar-group__header";
  agentsHeader.textContent = "Agents";
  agentsGroup.appendChild(agentsHeader);

  const agentRows: (RawAgent & AgentRow)[] = snapshot.agents.map((agent) => ({
    ...agent,
  }));
  for (const agent of sortAgents(agentRows)) {
    const row = document.createElement("div");
    row.className = `sidebar-agent${agent.agent_status === "blocked" ? " is-blocked" : ""}`;
    const dot = document.createElement("span");
    dot.className = statusDotClass(agent.agent_status);
    row.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = agent.display_agent ?? agent.name ?? agent.pane_id;
    row.appendChild(label);
    row.addEventListener("click", () => {
      void focusAgent(agent);
    });
    agentsGroup.appendChild(row);
  }
  sidebarEl.appendChild(agentsGroup);
}

function renderTabStrip(): void {
  tabStripEl.textContent = "";
  if (!snapshot) return;
  const activeWorkspaceId = snapshot.focused_workspace_id;
  const tabs = snapshot.tabs.filter((t) => t.workspace_id === activeWorkspaceId);
  for (const tab of tabs) {
    const chip = document.createElement("div");
    chip.className = `tab-chip${tab.focused ? " is-focused" : ""}`;
    chip.textContent = tab.label;
    chip.addEventListener("click", () => {
      void invokeSafe("api", { method: "tab.focus", params: { tab_id: tab.tab_id } });
    });
    tabStripEl.appendChild(chip);
  }
}

// ---------------------------------------------------------------------------
// Action toolbar with inline confirm popovers (spec §6 "Actions"; never
// window.confirm/alert)
// ---------------------------------------------------------------------------

function closeAnyPopover(): void {
  toolbarEl.querySelector(".confirm-popover")?.remove();
}

function showConfirmPopover(anchor: HTMLElement, message: string, onConfirm: () => void): void {
  closeAnyPopover();
  const popover = document.createElement("div");
  popover.className = "confirm-popover";
  popover.style.left = `${anchor.offsetLeft}px`;

  const text = document.createElement("div");
  text.textContent = message;
  popover.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "confirm-popover__actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "toolbar-btn";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => popover.remove());

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "toolbar-btn";
  confirmBtn.textContent = "Confirm";
  confirmBtn.addEventListener("click", () => {
    popover.remove();
    onConfirm();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  popover.appendChild(actions);
  toolbarEl.appendChild(popover);

  const onOutsideClick = (event: MouseEvent) => {
    if (!popover.contains(event.target as Node) && event.target !== anchor) {
      popover.remove();
      document.removeEventListener("mousedown", onOutsideClick);
    }
  };
  document.addEventListener("mousedown", onOutsideClick);
}

function addToolbarButton(label: string, onClick: (anchor: HTMLElement) => void): void {
  const btn = document.createElement("button");
  btn.className = "toolbar-btn";
  btn.textContent = label;
  btn.addEventListener("click", () => onClick(btn));
  toolbarEl.appendChild(btn);
}

function renderToolbar(): void {
  toolbarEl.textContent = "";

  addToolbarButton("New workspace", () => {
    void invokeSafe("api", { method: "workspace.create", params: { focus: true } });
  });
  addToolbarButton("New tab", () => {
    void invokeSafe("api", {
      method: "tab.create",
      params: { workspace_id: snapshot?.focused_workspace_id ?? undefined, focus: true },
    });
  });
  addToolbarButton("Split right", () => {
    void invokeSafe("api", { method: "pane.split", params: { direction: "right", focus: true } });
  });
  addToolbarButton("Split down", () => {
    void invokeSafe("api", { method: "pane.split", params: { direction: "down", focus: true } });
  });
  addToolbarButton("Close pane", (anchor) => {
    const paneId = snapshot?.focused_pane_id;
    if (!paneId) return;
    showConfirmPopover(anchor, "Close the focused pane?", () => {
      void invokeSafe("api", { method: "pane.close", params: { pane_id: paneId } });
    });
  });
  addToolbarButton("Close tab", (anchor) => {
    const tabId = snapshot?.focused_tab_id;
    if (!tabId) return;
    showConfirmPopover(anchor, "Close the focused tab?", () => {
      void invokeSafe("api", { method: "tab.close", params: { tab_id: tabId } });
    });
  });
  addToolbarButton("Close workspace", (anchor) => {
    const workspaceId = snapshot?.focused_workspace_id;
    if (!workspaceId) return;
    showConfirmPopover(anchor, "Close the focused workspace?", () => {
      void invokeSafe("api", { method: "workspace.close", params: { workspace_id: workspaceId } });
    });
  });
}

// ---------------------------------------------------------------------------
// Usage bar (spec §6 "Usage bar")
// ---------------------------------------------------------------------------

function renderUsageBar(): void {
  const state: FormatUsageState = {
    five_hour: usagePayload.five_hour,
    seven_day: usagePayload.seven_day,
    captured_at: usagePayload.captured_at,
    status: usagePayload.status,
  };
  const now = Math.floor(Date.now() / 1000);
  usageBarEl.textContent = formatUsage(state, now);
  usageBarEl.classList.remove("usage--warning", "usage--danger");
  // Only windows that have not reset yet drive the colour (code review
  // finding #11): an already-reset window displays as "-- (reset)" and
  // must not still read as a warning/danger colour.
  const color = usageColor(worstActivePct(state, now));
  if (color === "warning") usageBarEl.classList.add("usage--warning");
  if (color === "danger") usageBarEl.classList.add("usage--danger");
}

const USAGE_REFRESH_INTERVAL_MS = 30_000;

/** Re-renders the usage bar every 30s even with no new `usage` event
 * (finding #11), so its countdowns, "as of Xm ago", and past-`resets_at`
 * "(reset)" state stay live between server-side usage-file changes. */
function wireUsageRefresh(): void {
  window.setInterval(renderUsageBar, USAGE_REFRESH_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Connection banner (spec §6 "Connection banner")
// ---------------------------------------------------------------------------

function renderBanner(status: string, socketPath: string): void {
  if (status === "unavailable" || status === "disconnected") {
    bannerEl.hidden = false;
    bannerEl.textContent = `herdr server not reachable at ${socketPath} — retrying`;
  } else {
    bannerEl.hidden = true;
    bannerEl.textContent = "";
  }
}

// ---------------------------------------------------------------------------
// Input: keyboard, IME, paste, click-to-focus (spec §6 "Input")
// ---------------------------------------------------------------------------

function targetPaneId(): string | null {
  return snapshot?.focused_pane_id ?? null;
}

function sendKeyEvent(mapped: { code: unknown; modifiers: number }): void {
  const paneId = targetPaneId();
  if (!paneId) return;
  const event = {
    Key: {
      code: mapped.code,
      modifiers: mapped.modifiers,
      kind: "Press",
      repeat_count: 1,
      shifted_codepoint: null,
      generated_text: null,
      tracks_release: false,
      physical_key_id: null,
      windows_record: null,
    },
  };
  void invokeSafe("send_input", { paneId, events: [event] });
}

function sendTextCommit(text: string): void {
  if (!text) return;
  const paneId = targetPaneId();
  if (!paneId) return;
  void invokeSafe("send_input", { paneId, events: [{ TextCommit: text }] });
}

function sendPaste(text: string): void {
  if (!text) return;
  const paneId = targetPaneId();
  if (!paneId) return;
  void invokeSafe("send_input", { paneId, events: [{ Paste: text }] });
}

/** Converts `mapKeyboardEvent`'s TS `ClientKeyCode` tagged union into the
 * wire's default serde enum JSON: a unit variant is a bare string, and a
 * one-field tuple variant (`Char`/`F`) is `{ VariantName: value }`. */
function keyCodeToWire(code: { kind: string; value?: unknown }): unknown {
  if (code.kind === "Char" || code.kind === "F") {
    return { [code.kind]: code.value };
  }
  return code.kind;
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.isComposing) return;

  // Ctrl+Shift+V is the explicit "paste" override (spec §6): read the
  // clipboard directly rather than sending a literal Ctrl+Shift+V key.
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") {
    event.preventDefault();
    void navigator.clipboard.readText().then(sendPaste);
    return;
  }

  const likeEvent: KeyboardEventLike = {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
  };
  const mapped = mapKeyboardEvent(likeEvent);
  if (mapped) {
    event.preventDefault();
    sendKeyEvent({ code: keyCodeToWire(mapped.code), modifiers: mapped.modifiers });
  }
  // Otherwise: a plain printable character falls through to the
  // textarea's native `input` event, handled below.
}

function onCompositionEnd(event: CompositionEvent): void {
  keyboardCapture.value = "";
  sendTextCommit(event.data);
}

function onInput(event: Event): void {
  const inputEvent = event as InputEvent;
  if (inputEvent.isComposing) return;
  const text = keyboardCapture.value;
  keyboardCapture.value = "";
  if (text) sendTextCommit(text);
}

function onPaste(event: ClipboardEvent): void {
  event.preventDefault();
  const text = event.clipboardData?.getData("text") ?? "";
  sendPaste(text);
}

function focusKeyboardCapture(): void {
  keyboardCapture.focus({ preventScroll: true });
}

async function onCanvasClick(event: MouseEvent): Promise<void> {
  focusKeyboardCapture();
  // Click-to-focus (spec §6, code review finding #6): convert the click's
  // pixel offset into cell coordinates using the measured cell size, hit-
  // test via the backend's `pane_at` (which knows `mirror.panes[].
  // inner_rect` -- geometry the binary surface stream and the snapshot
  // both omit), then `pane.focus` only if it names a pane other than the
  // one already focused.
  const rect = canvas.getBoundingClientRect();
  const col = Math.floor((event.clientX - rect.left) / cellWidthPx);
  const row = Math.floor((event.clientY - rect.top) / cellHeightPx);
  const paneId = await invokeSafe<string | null>("pane_at", { col, row });
  if (paneId && paneId !== targetPaneId()) {
    void invokeSafe("api", { method: "pane.focus", params: { pane_id: paneId } });
  }
}

function wireInputHandlers(): void {
  canvas.addEventListener("click", (event) => void onCanvasClick(event));
  keyboardCapture.addEventListener("keydown", onKeyDown);
  keyboardCapture.addEventListener("compositionend", onCompositionEnd);
  keyboardCapture.addEventListener("input", onInput);
  keyboardCapture.addEventListener("paste", onPaste);
  focusKeyboardCapture();
}

// ---------------------------------------------------------------------------
// Resize: ResizeObserver -> cols/rows -> `resize` (debounced 50ms)
// ---------------------------------------------------------------------------

function currentColsRows(): { cols: number; rows: number } {
  const rect = canvas.getBoundingClientRect();
  const cols = Math.max(1, Math.floor(rect.width / cellWidthPx));
  const rows = Math.max(1, Math.floor(rect.height / cellHeightPx));
  return { cols, rows };
}

function scheduleResize(): void {
  if (resizeDebounceTimer !== undefined) {
    window.clearTimeout(resizeDebounceTimer);
  }
  resizeDebounceTimer = window.setTimeout(() => {
    resizeDebounceTimer = undefined;
    measureCell();
    resizeCanvasBackingStore();
    const { cols, rows } = currentColsRows();
    void invokeSafe("resize", { cols, rows, cellW: cellWidthPx, cellH: cellHeightPx });
    markDirty("all");
  }, 50);
}

function wireResizeObserver(): void {
  const observer = new ResizeObserver(() => scheduleResize());
  observer.observe(canvas);
  window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.(
    "change",
    scheduleResize,
  );
}

// ---------------------------------------------------------------------------
// Chrome skeleton + report_ready (spec §6)
// ---------------------------------------------------------------------------

function paintChromeSkeleton(): void {
  sidebarEl.textContent = "";
  usageBarEl.textContent = "Claude usage: waiting for a Claude Code session";
}

function reportReadyAfterTwoFrames(startedAt: number): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const ms = performance.now() - startedAt;
      void invokeSafe("report_ready", { ms });
    });
  });
}

// ---------------------------------------------------------------------------
// Sidebar resize handle (spec §6 "Sidebar": resizable 180-400px, finding #12)
// ---------------------------------------------------------------------------

const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 400;

function wireSidebarResize(): void {
  let dragging = false;
  sidebarResizeHandleEl.addEventListener("pointerdown", (event) => {
    dragging = true;
    sidebarResizeHandleEl.setPointerCapture(event.pointerId);
  });
  sidebarResizeHandleEl.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    // The sidebar starts flush against the window's left edge, so the
    // pointer's viewport-relative x is already the desired sidebar width.
    const width = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, event.clientX));
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
  });
  const stopDragging = (): void => {
    dragging = false;
  };
  sidebarResizeHandleEl.addEventListener("pointerup", stopDragging);
  sidebarResizeHandleEl.addEventListener("pointercancel", stopDragging);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function wireEvents(): Promise<void> {
  await listen<RawSnapshot>("snapshot", (event) => {
    snapshot = event.payload;
    renderSidebar();
    renderTabStrip();
    // renderToolbar() deliberately not called here (code review finding
    // #10): the toolbar has no snapshot-dependent DOM, and re-rendering it
    // on every snapshot destroyed any open confirm popover and leaked a
    // mousedown listener each time. It's rendered once, in main().
  });
  await listen<UsageEventPayload>("usage", (event) => {
    usagePayload = event.payload;
    renderUsageBar();
  });
  await listen<{ status: string; socketPath: string }>("connection-status", (event) => {
    renderBanner(event.payload.status, event.payload.socketPath);
  });
}

async function main(): Promise<void> {
  const startedAt = performance.now();
  paintChromeSkeleton();
  renderToolbar();
  measureCell();
  resizeCanvasBackingStore();
  wireInputHandlers();
  wireResizeObserver();
  wireSidebarResize();
  wireUsageRefresh();
  // Register every listener and subscribe to the surface channel *before*
  // calling sync_state (spec §4 v3, code review finding #1): events the
  // backend emitted before the webview started listening (the reconnect
  // loop's initial `connecting` status, the first snapshot, the first
  // usage read) are otherwise lost for good. sync_state re-delivers the
  // last of each, plus a full frame of the mirror, once listening is safe.
  await wireEvents();
  await subscribeSurface();
  await invokeSafe("sync_state");
  reportReadyAfterTwoFrames(startedAt);
}

void main();
