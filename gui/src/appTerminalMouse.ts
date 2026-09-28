// Herdr-native mouse selection with auto-copy, and mouse-wheel scroll, on
// the terminal canvas. Mirrors herdr's TUI client's own per-event decision
// (`src/client/shell/mouse.rs::handle_mouse`), scoped to what the canvas
// actually needs (see the scope notes below each gesture branch for what
// was deliberately left out and why).
//
// Two gesture kinds, decided once per pointerdown from the hit pane's
// `mouse_reporting` flag (`herdr_wire::PaneSurfacePane`), exactly like
// herdr's own `handle_mouse`:
//
//   - "forward": the pane app receives mouse reporting (e.g. vim, htop, a
//     nested herdr/Claude Code TUI). Raw `ClientPaneInputEvent::Mouse`
//     events are forwarded through the existing `send_input` command, the
//     same path keyboard input already uses. No host-side selection.
//   - "select": a plain shell prompt with no mouse reporting. A host-side
//     text selection is tracked locally (mirroring `crate::selection::
//     Selection`) and highlighted with `mouse/selectionOverlay.ts`; on
//     release, the selected text is read via the `pane.selection.read`
//     endpoint (mirroring `request_selection_copy` in
//     `src/client/shell/actions.rs`) and written to the OS clipboard.
//
// Deliberately out of scope (not asked for by the feature's item list, and
// each a materially larger addition on its own): edge-of-pane autoscroll
// while dragging a selection (`update_selection_drag`'s autoscroll in
// mouse.rs), double/triple-click word/line selection
// (`src/client/shell/word_selection.rs`), scrollbar-thumb dragging, and the
// `pane_owns_right_click`/`right_click_passthrough_modifiers` gate on
// right-click forwarding (simplified here to "forward whenever the pane
// reports mouse events", which is herdr's own default-config behavior).

import { api, invokeOk, invokeSafe } from "./appApi";
import { canvas, terminalWrapEl } from "./appDom";
import { appState } from "./appState";
import { showCopiedNotice } from "./copyNotice";
import { focusKeyboardCapture } from "./keyboard/focusCapture";
import {
  absoluteRowForViewportRow,
  clampToPaneLocal,
  orderSelectionPoints,
  pixelToCell,
  selectionRowRects,
  toPaneLocal,
  viewportTopRow,
  type AbsolutePoint,
  type CellRect,
} from "./mouse/geometry";
import { createFrameThrottler } from "./mouse/frameThrottle";
import { buildMouseEvent, domModifierBits, pointerButtonToWire, pointerButtonsBit, type WireMouseButton, type WireMouseKind } from "./mouse/mouseWire";
import { SelectionOverlay } from "./mouse/selectionOverlay";
import { WheelAccumulator } from "./mouse/wheelAccumulator";
import type { TerminalRenderer } from "./render/renderer";

interface PaneMouseScrollHit {
  offset_from_bottom: number;
  max_offset_from_bottom: number;
  viewport_rows: number;
}

/** Mirrors `commands::PaneMouseHit` (`gui/src-tauri/src/commands.rs`). */
interface PaneMouseHit {
  pane_id: string;
  inner_rect: CellRect;
  mouse_reporting: boolean;
  focused: boolean;
  scroll: PaneMouseScrollHit | null;
}

interface ForwardGesture {
  mode: "forward";
  paneId: string;
  buttonNum: number;
  button: WireMouseButton;
  innerRect: CellRect;
}

interface SelectGesture {
  mode: "select";
  paneId: string;
  buttonNum: number;
  innerRect: CellRect;
  viewportTop: number;
  viewportRows: number;
  anchor: AbsolutePoint;
  cursor: AbsolutePoint;
  dragged: boolean;
}

type Gesture = ForwardGesture | SelectGesture | null;

let gesture: Gesture = null;
let overlay: SelectionOverlay | null = null;
const wheelAccumulators = new Map<string, WheelAccumulator>();
const moveThrottler = createFrameThrottler();

function overlayFor(): SelectionOverlay {
  if (!overlay) overlay = new SelectionOverlay(terminalWrapEl);
  return overlay;
}

function eventToCell(event: { clientX: number; clientY: number }, renderer: TerminalRenderer): { col: number; row: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const { width: cellWidthPx, height: cellHeightPx } = renderer.getCellSizeDevicePx();
  return pixelToCell(event.clientX, event.clientY, rect.left, rect.top, dpr, cellWidthPx, cellHeightPx);
}

function sendMouse(
  paneId: string,
  kind: WireMouseKind,
  local: { col: number; row: number },
  modifiers: number,
  lines?: number,
): void {
  void invokeSafe("send_input", {
    paneId,
    events: [buildMouseEvent(kind, local.col, local.row, modifiers, lines)],
  });
}

function wheelAccumulatorFor(paneId: string): WheelAccumulator {
  let accumulator = wheelAccumulators.get(paneId);
  if (!accumulator) {
    accumulator = new WheelAccumulator();
    wheelAccumulators.set(paneId, accumulator);
  }
  return accumulator;
}

async function onPointerDown(event: PointerEvent): Promise<void> {
  focusKeyboardCapture();
  const renderer = appState.renderer;
  if (!renderer) return;
  const wireButton = pointerButtonToWire(event.button);
  if (wireButton === null) return;

  const cell = eventToCell(event, renderer);
  const hit = await invokeSafe<PaneMouseHit | null>("pane_mouse_hit", { col: cell.col, row: cell.row });
  if (!hit) return;

  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  const modifiers = domModifierBits(event);

  // Mirrors herdr's `handle_mouse` Down(Left): drop any still-visible
  // selection highlight from a prior gesture before starting a new one.
  overlay?.clear();

  // Click-to-focus on Down, matching herdr exactly: Left always focuses
  // (both the forwarding and host-selection branches); Right focuses only
  // when forwarding; Middle never explicitly focuses
  // (`src/client/shell/mouse.rs::handle_mouse`, the `Down(MouseButton::
  // Left)`/`Down(MouseButton::Right)`/`Down(MouseButton::Middle)` arms).
  // This *is* the GUI's click-to-focus now -- the old click-to-focus in
  // `appTerminalInput.ts`'s `onCanvasClick` was removed so a click never
  // focuses twice.
  if (event.button === 0) void api("pane.focus", { pane_id: hit.pane_id });

  if (hit.mouse_reporting) {
    if (event.button === 2) void api("pane.focus", { pane_id: hit.pane_id });
    const local = toPaneLocal(cell.col, cell.row, hit.inner_rect);
    sendMouse(hit.pane_id, { Down: wireButton }, local, modifiers);
    gesture = {
      mode: "forward",
      paneId: hit.pane_id,
      buttonNum: event.button,
      button: wireButton,
      innerRect: hit.inner_rect,
    };
    return;
  }

  // No mouse reporting: only the left button starts a host-side selection.
  // Right/Middle are no-ops here, matching herdr (which forwards Right/
  // Middle only when the pane reports mouse events; without that, herdr's
  // TUI falls back to its own pane context menu, which the GUI's canvas
  // does not have -- see this module's header).
  if (event.button !== 0) return;

  const top = viewportTopRow(hit.scroll);
  const local = clampToPaneLocal(cell.col, cell.row, hit.inner_rect);
  const anchor: AbsolutePoint = { row: absoluteRowForViewportRow(local.row, top), col: local.col };
  gesture = {
    mode: "select",
    paneId: hit.pane_id,
    buttonNum: event.button,
    innerRect: hit.inner_rect,
    viewportTop: top,
    viewportRows: hit.scroll?.viewport_rows ?? hit.inner_rect.height,
    anchor,
    cursor: anchor,
    dragged: false,
  };
}

function onPointerMove(event: PointerEvent): void {
  const active = gesture;
  if (!active) return;
  if ((event.buttons & pointerButtonsBit(active.buttonNum)) === 0) return;
  moveThrottler.schedule(() => processMove(event, active));
}

function processMove(event: PointerEvent, active: NonNullable<Gesture>): void {
  // The gesture may have ended (pointerup) between this callback being
  // queued and the animation frame it runs in; re-check against the
  // *current* gesture, not the one captured at schedule time.
  if (gesture !== active) return;
  const renderer = appState.renderer;
  if (!renderer) return;
  const cell = eventToCell(event, renderer);
  const modifiers = domModifierBits(event);

  if (active.mode === "forward") {
    const local = toPaneLocal(cell.col, cell.row, active.innerRect);
    sendMouse(active.paneId, { Drag: active.button }, local, modifiers);
    return;
  }

  const local = clampToPaneLocal(cell.col, cell.row, active.innerRect);
  const cursor: AbsolutePoint = { row: absoluteRowForViewportRow(local.row, active.viewportTop), col: local.col };
  active.cursor = cursor;
  if (cursor.row !== active.anchor.row || cursor.col !== active.anchor.col) active.dragged = true;
  renderSelection(active, renderer);
}

function onPointerUp(event: PointerEvent): void {
  const active = gesture;
  if (!active || event.button !== active.buttonNum) return;
  gesture = null;
  try {
    canvas.releasePointerCapture(event.pointerId);
  } catch {
    // Already released (e.g. the capture was implicitly lost) -- fine.
  }

  if (active.mode === "forward") {
    const renderer = appState.renderer;
    if (!renderer) return;
    const cell = eventToCell(event, renderer);
    const local = toPaneLocal(cell.col, cell.row, active.innerRect);
    sendMouse(active.paneId, { Up: active.button }, local, domModifierBits(event));
    return;
  }

  overlay?.clear();
  if (active.dragged) void copySelection(active);
}

function onPointerCancel(): void {
  // Best-effort abort: no synthetic `Up` for a forwarding gesture (there is
  // no reliable "last position" for a cancelled gesture, and a stale one
  // would be worse than none), and a selection in progress is dropped
  // without copying -- a cancelled gesture was never a deliberate release.
  gesture = null;
  overlay?.clear();
}

function renderSelection(active: SelectGesture, renderer: TerminalRenderer): void {
  const [start, end] = orderSelectionPoints(active.anchor, active.cursor);
  const rects = selectionRowRects(start, end, active.viewportTop, active.viewportRows, active.innerRect.width);
  const dpr = window.devicePixelRatio || 1;
  const { width: cellWidthPx, height: cellHeightPx } = renderer.getCellSizeDevicePx();
  const cellWidthCss = cellWidthPx / dpr;
  const cellHeightCss = cellHeightPx / dpr;
  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = terminalWrapEl.getBoundingClientRect();
  const originLeft = canvasRect.left - wrapRect.left + active.innerRect.x * cellWidthCss;
  const originTop = canvasRect.top - wrapRect.top + active.innerRect.y * cellHeightCss;
  overlayFor().render(rects, originLeft, originTop, cellWidthCss, cellHeightCss);
}

/** Mirrors `request_selection_copy` (`src/client/shell/actions.rs`): reads
 * the selected text from the server (the authoritative source for wrapped-
 * line joins and scrollback, which the GUI's own grid does not attempt to
 * reconstruct) and, if non-empty, writes it to the OS clipboard. `live`
 * (omitting `content_revision`) matches the TUI's own mouse-up copy, which
 * reads "atomically from the live terminal" rather than rejecting on a
 * frame that arrived between the drag and the release. */
async function copySelection(active: SelectGesture): Promise<void> {
  const [start, end] = orderSelectionPoints(active.anchor, active.cursor);
  const result = await api<{ text?: string }>("pane.selection.read", {
    pane_id: active.paneId,
    anchor: { row: start.row, col: start.col },
    cursor: { row: end.row, col: end.col },
  });
  const text = result?.text;
  if (typeof text !== "string" || text.length === 0) return;
  if (await invokeOk("write_clipboard_text", { text })) showCopiedNotice();
}

async function onWheel(event: WheelEvent): Promise<void> {
  const renderer = appState.renderer;
  if (!renderer) return;
  event.preventDefault();
  const cell = eventToCell(event, renderer);
  const hit = await invokeSafe<PaneMouseHit | null>("pane_mouse_hit", { col: cell.col, row: cell.row });
  if (!hit) return;
  // Matches herdr's wheel handling: focus only if not already focused
  // (`src/client/shell/mouse.rs`'s `ScrollUp | ScrollDown | ScrollLeft |
  // ScrollRight` arm), unlike Down's unconditional focus.
  if (!hit.focused) void api("pane.focus", { pane_id: hit.pane_id });

  const dpr = window.devicePixelRatio || 1;
  const { width: cellWidthPx, height: cellHeightPx } = renderer.getCellSizeDevicePx();
  const cellWidthCss = cellWidthPx / dpr;
  const cellHeightCss = cellHeightPx / dpr;
  const local = toPaneLocal(cell.col, cell.row, hit.inner_rect);
  const modifiers = domModifierBits(event);
  const accumulator = wheelAccumulatorFor(hit.pane_id);

  // A mouse with only a vertical wheel reports a horizontal scroll (Shift
  // held) as `deltaY`, not `deltaX` (Windows/Firefox convention); a
  // trackpad already reports true `deltaX` for a two-axis swipe.
  let verticalDelta = event.deltaY;
  let horizontalDelta = event.deltaX;
  if (event.shiftKey && horizontalDelta === 0) {
    horizontalDelta = verticalDelta;
    verticalDelta = 0;
  }

  const verticalLines = accumulator.accumulateY(verticalDelta, event.deltaMode, cellHeightCss);
  const horizontalLines = accumulator.accumulateX(horizontalDelta, event.deltaMode, cellWidthCss);
  if (verticalLines !== 0) {
    sendMouse(hit.pane_id, verticalLines > 0 ? "ScrollDown" : "ScrollUp", local, modifiers, Math.abs(verticalLines));
  }
  if (horizontalLines !== 0) {
    sendMouse(hit.pane_id, horizontalLines > 0 ? "ScrollRight" : "ScrollLeft", local, modifiers, Math.abs(horizontalLines));
  }
}

export function wireTerminalMouse(): void {
  canvas.addEventListener("pointerdown", (event) => void onPointerDown(event));
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("wheel", (event) => void onWheel(event), { passive: false });
  // The GUI has no pane context menu on the canvas (tabs/sidebar have their
  // own, outside it); right-click is handled entirely by `onPointerDown`
  // above, forwarded to the pane when it reports mouse events.
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}
