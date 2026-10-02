// Herdr-native mouse selection with auto-copy, mouse-wheel scroll, the
// right-click menu, Ctrl+click/hover links, double/triple-click word/line
// selection, and scrollbar-thumb dragging on the terminal canvas. Mirrors
// herdr's TUI client's own per-event decision (`src/client/shell/
// mouse.rs::handle_mouse`), scoped to what the canvas actually needs (see
// the scope notes below each gesture branch for what was deliberately left
// out and why).
//
// Gesture kinds, decided once per pointerdown:
//
//   - "forward": the pane app receives mouse reporting (e.g. vim, htop, a
//     nested herdr/Claude Code TUI). Raw `ClientPaneInputEvent::Mouse`
//     events are forwarded through the existing `send_input` command, the
//     same path keyboard input already uses. No host-side selection --
//     unless Shift is held on a Left button (terminal-parity spec P1 #11
//     "Shift+drag ... selects instead of forwarding"), which falls through
//     to "select" instead.
//   - "select": a plain shell prompt with no mouse reporting (or a Shift+
//     drag override). A host-side text selection is tracked locally
//     (mirroring `crate::selection::Selection`), highlighted with
//     `mouse/selectionOverlay.ts`, and read via `pane.selection.read` on
//     release (mirroring `request_selection_copy`,
//     `src/client/shell/actions.rs`).
//   - "scrollbar": a Down within the pane's `scrollbar_rect` and on its
//     thumb (P1 #10) starts a drag that maps subsequent rows to
//     `pane.scroll` calls; a Down on the *track* (not the thumb) jump-
//     scrolls once, with no ongoing gesture -- both mirror
//     `src/client/shell/mouse.rs:2133-2169`'s own `PaneScrollbar` handling.
//
// Right-click (P0 #5) follows herdr's TUI rule exactly
// (`mouse/rightClickRule.ts`): forwarded to the app only when
// `mouse_reporting && right_click_passthrough && no modifiers`; otherwise
// it opens the GUI's own context menu (`ui/paneContextMenu.ts`).
//
// Deliberately out of scope (not asked for by the feature's item list, and
// each a materially larger addition on its own): edge-of-pane autoscroll
// while dragging a selection (`update_selection_drag`'s autoscroll in
// mouse.rs), and extending a double/triple-click selection word-by-word
// while dragging (`word_selection.rs`'s `drag_word_selection`) -- a
// double/triple click here selects and auto-copies once, matching the
// item's own wording ("Both auto-copy the same way as a drag selection"),
// without also supporting a subsequent word-wise drag-extend.

import { invoke } from "@tauri-apps/api/core";
import { api, invokeSafe } from "./appApi";
import { canvas, overlayRoot, terminalWrapEl } from "./appDom";
import { appState } from "./appState";
import { showCopiedNotice } from "./copyNotice";
import { focusKeyboardCapture } from "./keyboard/focusCapture";
import { activateLink, hoverCallAllowed, resolveLinkRegions, type PaneLinkRegion } from "./links";
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
import { paneOverlayOrigin } from "./mouse/overlayGeometry";
import { shouldForwardRightClickToApp } from "./mouse/rightClickRule";
import {
  scrollbarOffsetFromDragRow,
  scrollbarOffsetFromRow,
  scrollbarThumbGrabOffset,
  type ScrollMetricsLike,
} from "./mouse/scrollbar";
import { SelectionOverlay } from "./mouse/selectionOverlay";
import { probeCell, scrollMakesDrag, selectionPointFor, viewportChanged, viewportFor } from "./mouse/selectionFollow";
import { wordBoundsAtColumn } from "./mouse/wordBounds";
import { WheelAccumulator } from "./mouse/wheelAccumulator";
import { requestClosePane } from "./paneClose";
import { clearPane, pasteIntoPane, toggleRightClickPassthrough, writeToClipboard } from "./paneActions";
import type { TerminalRenderer } from "./render/renderer";
import { openPaneContextMenu } from "./ui/paneContextMenu";

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
  content_revision: number;
  scrollbar_rect: CellRect | null;
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
  contentRevision: number;
  dragged: boolean;
  /** `offset_from_bottom` at mouse-down: a different value later means the user scrolled. */
  startOffset: number;
  /** The pointer's last screen cell. The follow-up (`followScroll`) re-derives the cursor from it when the pane scrolls under a still pointer. */
  lastCell: { col: number; row: number };
}

interface ScrollbarGesture {
  mode: "scrollbar";
  paneId: string;
  buttonNum: number;
  track: CellRect;
  metrics: ScrollMetricsLike;
  grabRowOffset: number;
}

type Gesture = ForwardGesture | SelectGesture | ScrollbarGesture | null;

let gesture: Gesture = null;
let overlay: SelectionOverlay | null = null;
let linkHoverOverlay: SelectionOverlay | null = null;
const wheelAccumulators = new Map<string, WheelAccumulator>();
const moveThrottler = createFrameThrottler();

/** Terminal-parity spec P0 #1 "Ctrl+Shift+C = Copy": the last completed
 * host-side selection (drag, double/triple-click, or Select All), kept
 * after mouse release with its highlight still visible, until the next
 * click (`overlay?.clear()` below, at the top of every `onPointerDown`) or
 * the next input sent to a pane (`clearSelectionOnInput`, called from
 * `appTerminalInput.ts`). `null` means "no selection, do nothing" for
 * `copyLastSelection`. */
interface LastSelection {
  paneId: string;
  anchor: AbsolutePoint;
  cursor: AbsolutePoint;
  contentRevision: number;
  /** The viewport the highlight was last painted for; `followScroll` repaints when the pane scrolls. */
  innerRect: CellRect;
  viewportTop: number;
  viewportRows: number;
}
let lastSelection: LastSelection | null = null;

/** Double/triple-click chain tracking (P1 #9), mirroring
 * `ClientPaneClick`/`is_double_click_for` (`src/client/shell/state.rs:
 * 756-771`): same pane, within 350ms, pane-local row/col each within ±1
 * cell of the previous click. `chainLength` counts consecutive matches;
 * herdr's TUI only ever escalates to a *double*-click word-select
 * (`mouse.rs:2221-2231`) -- triple-click line-select is this feature's own
 * extension of the exact same chaining rule, not a TUI behavior being
 * mirrored 1:1. */
interface PaneClickRecord {
  paneId: string;
  localRow: number;
  localCol: number;
  at: number;
}
let lastClick: PaneClickRecord | null = null;
let clickChainLength = 0;
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_CELL_TOLERANCE = 1;

function isChainedClick(previous: PaneClickRecord, next: PaneClickRecord): boolean {
  return (
    previous.paneId === next.paneId &&
    next.at - previous.at <= DOUBLE_CLICK_MS &&
    Math.abs(previous.localRow - next.localRow) <= DOUBLE_CLICK_CELL_TOLERANCE &&
    Math.abs(previous.localCol - next.localCol) <= DOUBLE_CLICK_CELL_TOLERANCE
  );
}

function overlayFor(): SelectionOverlay {
  if (!overlay) overlay = new SelectionOverlay(terminalWrapEl);
  return overlay;
}

function linkHoverOverlayFor(): SelectionOverlay {
  if (!linkHoverOverlay) linkHoverOverlay = new SelectionOverlay(terminalWrapEl, "terminal-link-hover-row");
  return linkHoverOverlay;
}

function eventToCell(event: { clientX: number; clientY: number }, renderer: TerminalRenderer): { col: number; row: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const { width: cellWidthPx, height: cellHeightPx } = renderer.getCellSizeDevicePx();
  return pixelToCell(event.clientX, event.clientY, rect.left, rect.top, dpr, cellWidthPx, cellHeightPx);
}

function pointInRect(col: number, row: number, rect: CellRect): boolean {
  return col >= rect.x && col < rect.x + rect.width && row >= rect.y && row < rect.y + rect.height;
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

/** The pane's `right_click_passthrough` (P0 #5), read from the snapshot's
 * `ClientShellPane` copy (`RawPane.right_click_passthrough`) by pane id --
 * the compact binary surface stream and `pane_mouse_hit` both omit it (it
 * isn't cell geometry), but the JSON snapshot already carries it verbatim. */
function rightClickPassthroughFor(paneId: string): boolean {
  return appState.snapshot?.panes.find((p) => p.pane_id === paneId)?.right_click_passthrough ?? false;
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
  // P0 #1: the *next click* (any button, any gesture kind) is exactly the
  // event that ends a retained selection's visible lifetime.
  overlay?.clear();
  lastSelection = null;
  closeContextMenu();

  // Click-to-focus on Down, matching herdr exactly: Left always focuses
  // (both the forwarding and host-selection branches); Right focuses only
  // when forwarding; Middle never explicitly focuses
  // (`src/client/shell/mouse.rs::handle_mouse`, the `Down(MouseButton::
  // Left)`/`Down(MouseButton::Right)`/`Down(MouseButton::Middle)` arms).
  // This *is* the GUI's click-to-focus now -- the old click-to-focus in
  // `appTerminalInput.ts`'s `onCanvasClick` was removed so a click never
  // focuses twice.
  if (event.button === 0) void api("pane.focus", { pane_id: hit.pane_id });

  // P1 #10 "scrollbar-thumb dragging": checked before the pane-content
  // branches below, since a hit here can be *outside* `inner_rect`
  // entirely (`pane_mouse_hit` now also matches `scrollbar_rect`).
  if (
    event.button === 0 &&
    hit.scrollbar_rect &&
    hit.scroll &&
    hit.scroll.max_offset_from_bottom > 0 &&
    pointInRect(cell.col, cell.row, hit.scrollbar_rect)
  ) {
    const metrics = hit.scroll;
    const track = hit.scrollbar_rect;
    const grabRowOffset = scrollbarThumbGrabOffset(metrics, track, cell.row);
    if (grabRowOffset !== null) {
      gesture = { mode: "scrollbar", paneId: hit.pane_id, buttonNum: event.button, track, metrics, grabRowOffset };
    } else {
      // A click on the track, not the thumb: one immediate jump-scroll, no
      // ongoing drag (mirrors `mouse.rs`'s own `pane_scrollbar_offset(&hit,
      // row, None)` branch).
      const offset = scrollbarOffsetFromRow(metrics, track, cell.row);
      void api("pane.scroll", { pane_id: hit.pane_id, offset_from_bottom: offset });
    }
    return;
  }

  // P1 #11 "Shift+drag over mouse-reporting apps selects instead of
  // forwarding": only for a Left-button drag; Shift+wheel is deliberately
  // left alone (still forwarded, `onWheel` below never special-cases it).
  const shiftSelectOverride = hit.mouse_reporting && event.button === 0 && event.shiftKey;

  if (hit.mouse_reporting && !shiftSelectOverride) {
    if (event.button === 2) {
      const passthrough = rightClickPassthroughFor(hit.pane_id);
      if (!shouldForwardRightClickToApp(true, passthrough, modifiers)) {
        openContextMenu(hit, event);
        return;
      }
      void api("pane.focus", { pane_id: hit.pane_id });
    }
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

  // From here: not mouse-reporting, or a Shift+drag override on one.
  if (event.button === 2) {
    // `shouldForwardRightClickToApp` above already required
    // `mouse_reporting`, so a non-reporting pane's right-click always opens
    // the menu -- matching herdr's own fallback to its pane context menu.
    openContextMenu(hit, event);
    return;
  }

  // Right/Middle are no-ops past this point (matching herdr, whose TUI
  // falls back to its own pane context menu only for Right, handled above;
  // Middle has no menu and no selection role here -- see this module's
  // header). Only the left button starts a host-side selection.
  if (event.button !== 0) return;

  const top = viewportTopRow(hit.scroll);
  const viewportRows = hit.scroll?.viewport_rows ?? hit.inner_rect.height;

  // P0 #6 "Links": Ctrl+click activates a link instead of starting a
  // selection -- only reached for a non-mouse-reporting pane (herdr's own
  // TUI client checks this only once its mouse-reporting forward path has
  // already returned, `mouse.rs:830-925`), and never for the Shift+drag
  // override (that's specifically a *drag* selection request).
  if (!shiftSelectOverride && event.ctrlKey) {
    const local = clampToPaneLocal(cell.col, cell.row, hit.inner_rect);
    void activateLink({
      pane_id: hit.pane_id,
      viewport_row: local.row,
      col: local.col,
      content_revision: hit.content_revision,
      offset_from_bottom: hit.scroll?.offset_from_bottom,
    });
    return;
  }

  // P1 #9 "Double-click word, triple-click line": chained-click detection
  // only applies with no modifiers held (matching `mouse.modifiers.is_
  // empty()`, `mouse.rs:2221`) and never for the Shift+drag override.
  const local = clampToPaneLocal(cell.col, cell.row, hit.inner_rect);
  if (!shiftSelectOverride && modifiers === 0) {
    const click: PaneClickRecord = { paneId: hit.pane_id, localRow: local.row, localCol: local.col, at: performance.now() };
    clickChainLength = lastClick && isChainedClick(lastClick, click) ? clickChainLength + 1 : 1;
    lastClick = click;
    if (clickChainLength === 2) {
      void startWordSelection(hit, top, viewportRows, local);
      return;
    }
    if (clickChainLength >= 3) {
      clickChainLength = 0; // a 4th click starts a fresh chain, not a further escalation
      void startLineSelection(hit, top, viewportRows, local);
      return;
    }
  } else {
    lastClick = null;
    clickChainLength = 0;
  }

  const anchor: AbsolutePoint = { row: absoluteRowForViewportRow(local.row, top), col: local.col };
  gesture = {
    mode: "select",
    paneId: hit.pane_id,
    buttonNum: event.button,
    innerRect: hit.inner_rect,
    viewportTop: top,
    viewportRows,
    anchor,
    cursor: anchor,
    contentRevision: hit.content_revision,
    dragged: false,
    startOffset: hit.scroll?.offset_from_bottom ?? 0,
    lastCell: { col: cell.col, row: cell.row },
  };
  ensureFollowTimer();
}

function onPointerMove(event: PointerEvent): void {
  const active = gesture;
  if (!active) {
    if (event.ctrlKey) void onCtrlHover(event);
    else clearLinkHover();
    return;
  }
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

  if (active.mode === "scrollbar") {
    const offset = scrollbarOffsetFromDragRow(active.metrics, active.track, cell.row, active.grabRowOffset);
    void api("pane.scroll", { pane_id: active.paneId, offset_from_bottom: offset });
    return;
  }

  active.lastCell = { col: cell.col, row: cell.row };
  const cursor = selectionPointFor(active.lastCell, active.innerRect, active.viewportTop);
  active.cursor = cursor;
  if (cursor.row !== active.anchor.row || cursor.col !== active.anchor.col) active.dragged = true;
  renderSelectionRange(active.anchor, active.cursor, active.viewportTop, active.viewportRows, active.innerRect, renderer);
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

  if (active.mode === "scrollbar") return;

  void (async () => {
    // One last look at the pane's scroll position, so a wheel tick just
    // before the release is part of the selection.
    await followGesture(active, () => true);
    if (active.dragged) {
      await finishSelection({
        paneId: active.paneId,
        anchor: active.anchor,
        cursor: active.cursor,
        contentRevision: active.contentRevision,
        viewportTop: active.viewportTop,
        viewportRows: active.viewportRows,
        innerRect: active.innerRect,
        live: true,
      });
    } else {
      // A plain click with no drag: no selection was made, so nothing is
      // retained and the highlight `onPointerDown` already cleared stays
      // cleared.
      overlay?.clear();
    }
  })();
}

function onPointerCancel(): void {
  // Best-effort abort: no synthetic `Up` for a forwarding gesture (there is
  // no reliable "last position" for a cancelled gesture, and a stale one
  // would be worse than none), and a selection in progress is dropped
  // without copying -- a cancelled gesture was never a deliberate release.
  gesture = null;
  overlay?.clear();
}

// ---------------------------------------------------------------------------
// The selection follows the pane's scroll
// ---------------------------------------------------------------------------
//
// A selection is kept as absolute scrollback rows, but the pointer's row and
// the highlight are viewport-relative. The wheel scrolls the pane without any
// pointer event, so a gesture that froze the viewport's top row at mouse-down
// kept mapping the pointer to the old rows and kept painting the highlight at
// the old screen position (the selection "moved" and never reached the rows
// scrolled into view). While a drag or a retained selection exists, a short
// timer reads the pane's current scroll metrics (`pane_mouse_hit` is an
// in-process lookup of the latest surface, no server round trip) and, when the
// top row changed, re-derives the drag's cursor and repaints the highlight.

const FOLLOW_MS = 60;
/** A finished selection can stay highlighted for hours: check it every Nth tick only. */
const RETAINED_EVERY_TICKS = 3;
/** Retained-selection checks that may miss its pane in a row before the timer stops. */
const RETAINED_MAX_MISSES = 3;
let followTimer: number | undefined;
let following = false;
let retainedTick = 0;
let retainedMisses = 0;

function ensureFollowTimer(): void {
  retainedMisses = 0;
  if (followTimer === undefined) followTimer = window.setInterval(() => void followScroll(), FOLLOW_MS);
}

async function paneHitAt(cell: { col: number; row: number }): Promise<PaneMouseHit | null> {
  // `invoke` directly: this runs every tick, and `invokeSafe` would show an
  // error notice for each failed one.
  return invoke<PaneMouseHit | null>("pane_mouse_hit", { col: cell.col, row: cell.row }).catch(() => null);
}

/** Re-reads the scroll position for a select gesture and, when the viewport moved, re-derives
 * its cursor from the pointer's last cell and repaints. `alive` says the gesture still counts
 * (false once a newer one replaced it). */
async function followGesture(g: Gesture, alive: () => boolean): Promise<void> {
  if (!g || g.mode !== "select") return;
  const hit = await paneHitAt(probeCell(g.lastCell, g.innerRect));
  if (!alive() || !hit || hit.pane_id !== g.paneId) return;
  // The hit knows the pane's current geometry (a split or resize may have changed it).
  g.innerRect = hit.inner_rect;
  const next = viewportFor(hit.scroll, g.innerRect.height);
  if (!viewportChanged({ top: g.viewportTop, rows: g.viewportRows }, next)) return;
  g.viewportTop = next.top;
  g.viewportRows = next.rows;
  g.cursor = selectionPointFor(g.lastCell, g.innerRect, next.top);
  // Only a user scroll makes a press a selection. Output growing at the live
  // bottom also moves the viewport's top; it must not turn a click into one.
  if (scrollMakesDrag(g.startOffset, hit.scroll, g.cursor, g.anchor)) g.dragged = true;
  const renderer = appState.renderer;
  if (renderer && g.dragged) renderSelectionRange(g.anchor, g.cursor, g.viewportTop, g.viewportRows, g.innerRect, renderer);
}

/** The same for a finished selection: its absolute rows stay put, so only the highlight moves. */
async function followRetained(sel: LastSelection): Promise<void> {
  const hit = await paneHitAt({ col: sel.innerRect.x, row: sel.innerRect.y });
  if (lastSelection !== sel) return;
  if (!hit || hit.pane_id !== sel.paneId) {
    // The pane closed or moved. Stop polling for it (the highlight stays,
    // as it did before); a new selection starts the timer again.
    retainedMisses += 1;
    if (retainedMisses >= RETAINED_MAX_MISSES) {
      window.clearInterval(followTimer);
      followTimer = undefined;
    }
    return;
  }
  retainedMisses = 0;
  sel.innerRect = hit.inner_rect;
  const next = viewportFor(hit.scroll, sel.innerRect.height);
  if (!viewportChanged({ top: sel.viewportTop, rows: sel.viewportRows }, next)) return;
  sel.viewportTop = next.top;
  sel.viewportRows = next.rows;
  const renderer = appState.renderer;
  if (renderer) renderSelectionRange(sel.anchor, sel.cursor, next.top, next.rows, sel.innerRect, renderer);
}

async function followScroll(): Promise<void> {
  if (following) return;
  following = true;
  try {
    const g = gesture;
    if (g && g.mode === "select") await followGesture(g, () => gesture === g);
    else if (lastSelection) {
      retainedTick = (retainedTick + 1) % RETAINED_EVERY_TICKS;
      if (retainedTick === 0) await followRetained(lastSelection);
    } else {
      window.clearInterval(followTimer);
      followTimer = undefined;
    }
  } finally {
    following = false;
  }
}

/** Shared by every selection-completing path (a completed drag, double/
 * triple-click, Select All): sets the retained selection (P0 #1), paints
 * its highlight, and copies it. `live` mirrors `request_selection_copy`'s
 * own flag (`src/client/shell/actions.rs:273-305`): `true` (a completed
 * drag) omits `content_revision` for an atomic "read from the live
 * terminal" read; `false` (word/line/Select All) binds the read to the
 * exact revision the selection was made against. */
async function finishSelection(opts: {
  paneId: string;
  anchor: AbsolutePoint;
  cursor: AbsolutePoint;
  contentRevision: number;
  viewportTop: number;
  viewportRows: number;
  innerRect: CellRect;
  live: boolean;
}): Promise<void> {
  const [start, end] = orderSelectionPoints(opts.anchor, opts.cursor);
  lastSelection = {
    paneId: opts.paneId,
    anchor: start,
    cursor: end,
    contentRevision: opts.contentRevision,
    innerRect: opts.innerRect,
    viewportTop: opts.viewportTop,
    viewportRows: opts.viewportRows,
  };
  ensureFollowTimer();
  const renderer = appState.renderer;
  if (renderer) renderSelectionRange(start, end, opts.viewportTop, opts.viewportRows, opts.innerRect, renderer);

  const params: Record<string, unknown> = {
    pane_id: opts.paneId,
    anchor: { row: start.row, col: start.col },
    cursor: { row: end.row, col: end.col },
  };
  if (!opts.live) params.content_revision = opts.contentRevision;
  const result = await api<{ text?: string }>("pane.selection.read", params);
  if (await writeToClipboard(result?.text)) showCopiedNotice();
}

/** P1 #9 double-click: reads the clicked row (mirroring `request_word_
 * selection_row`, `src/client/shell/word_selection.rs:62-91`), finds the
 * word bounds at the clicked column client-side
 * (`mouse/wordBounds.ts` = `app::actions::word_bounds_at_column`), and
 * finishes the selection over just that word. */
async function startWordSelection(hit: PaneMouseHit, top: number, viewportRows: number, local: { col: number; row: number }): Promise<void> {
  const row = absoluteRowForViewportRow(local.row, top);
  const width = hit.inner_rect.width;
  const rowResult = await api<{ text?: string }>("pane.selection.read", {
    pane_id: hit.pane_id,
    anchor: { row, col: 0 },
    cursor: { row, col: Math.max(0, width - 1) },
    content_revision: hit.content_revision,
  });
  const text = rowResult?.text ?? "";
  const bounds = wordBoundsAtColumn(text, local.col) ?? [local.col, local.col];
  await finishSelection({
    paneId: hit.pane_id,
    anchor: { row, col: bounds[0] },
    cursor: { row, col: bounds[1] },
    contentRevision: hit.content_revision,
    viewportTop: top,
    viewportRows,
    innerRect: hit.inner_rect,
    live: false,
  });
}

/** P1 #9 triple-click: "A line = the whole row" -- no text fetch needed, the
 * whole row's width is already known from the pane's `inner_rect`. */
async function startLineSelection(hit: PaneMouseHit, top: number, viewportRows: number, local: { col: number; row: number }): Promise<void> {
  const row = absoluteRowForViewportRow(local.row, top);
  const width = hit.inner_rect.width;
  await finishSelection({
    paneId: hit.pane_id,
    anchor: { row, col: 0 },
    cursor: { row, col: Math.max(0, width - 1) },
    contentRevision: hit.content_revision,
    viewportTop: top,
    viewportRows,
    innerRect: hit.inner_rect,
    live: false,
  });
}

function renderSelectionRange(
  anchor: AbsolutePoint,
  cursor: AbsolutePoint,
  viewportTop: number,
  viewportRows: number,
  innerRect: CellRect,
  renderer: TerminalRenderer,
): void {
  const [start, end] = orderSelectionPoints(anchor, cursor);
  const rects = selectionRowRects(start, end, viewportTop, viewportRows, innerRect.width);
  const origin = paneOverlayOrigin(innerRect, renderer);
  overlayFor().render(rects, origin.originLeft, origin.originTop, origin.cellWidthCss, origin.cellHeightCss);
}

/** P0 #1 "Ctrl+Shift+C = Copy": copies the last retained selection, or does
 * nothing with none. Never touches `lastSelection`/the highlight itself --
 * a repeat press keeps re-copying the same selection until the next click
 * or input clears it. */
export async function copyLastSelection(): Promise<void> {
  if (!lastSelection) return;
  const { paneId, anchor, cursor, contentRevision } = lastSelection;
  const result = await api<{ text?: string }>("pane.selection.read", {
    pane_id: paneId,
    anchor: { row: anchor.row, col: anchor.col },
    cursor: { row: cursor.row, col: cursor.col },
    content_revision: contentRevision,
  });
  if (await writeToClipboard(result?.text)) showCopiedNotice();
}

/** Called from `appTerminalInput.ts` on every keystroke/paste sent to a
 * pane (P0 #1: "... until the next click or input"). */
export function clearSelectionOnInput(): void {
  lastSelection = null;
  overlay?.clear();
}

// ---------------------------------------------------------------------------
// Ctrl+hover links (P0 #6)
// ---------------------------------------------------------------------------

let lastHoverCallAt: number | null = null;

function clearLinkHover(): void {
  linkHoverOverlay?.clear();
  canvas.classList.remove("is-link-hover");
}

async function onCtrlHover(event: PointerEvent): Promise<void> {
  const renderer = appState.renderer;
  if (!renderer) return;
  const now = performance.now();
  if (!hoverCallAllowed(lastHoverCallAt, now)) return;
  lastHoverCallAt = now;

  const cell = eventToCell(event, renderer);
  const hit = await invokeSafe<PaneMouseHit | null>("pane_mouse_hit", { col: cell.col, row: cell.row });
  if (!hit || hit.mouse_reporting) {
    clearLinkHover();
    return;
  }
  const viewportRows = hit.scroll?.viewport_rows ?? hit.inner_rect.height;
  const local = clampToPaneLocal(cell.col, cell.row, hit.inner_rect);
  const regions = await resolveLinkRegions({
    pane_id: hit.pane_id,
    viewport_row: local.row,
    col: local.col,
    content_revision: hit.content_revision,
    offset_from_bottom: hit.scroll?.offset_from_bottom,
  });
  paintLinkHoverRegions(regions, viewportRows, hit.inner_rect, renderer);
}

function paintLinkHoverRegions(
  regions: PaneLinkRegion[],
  viewportRows: number,
  innerRect: CellRect,
  renderer: TerminalRenderer,
): void {
  if (regions.length === 0) {
    clearLinkHover();
    return;
  }
  canvas.classList.add("is-link-hover");
  const rects = regions
    .filter((r) => r.row >= 0 && r.row < viewportRows)
    .map((r) => ({ row: r.row, startCol: r.start_col, endCol: r.end_col + 1 }));
  const origin = paneOverlayOrigin(innerRect, renderer);
  linkHoverOverlayFor().render(rects, origin.originLeft, origin.originTop, origin.cellWidthCss, origin.cellHeightCss);
}

// ---------------------------------------------------------------------------
// Right-click context menu (P0 #5)
// ---------------------------------------------------------------------------

let contextMenuDispose: (() => void) | null = null;

function closeContextMenu(): void {
  if (contextMenuDispose) {
    const dispose = contextMenuDispose;
    contextMenuDispose = null;
    dispose();
  }
}

function openContextMenu(hit: PaneMouseHit, event: PointerEvent): void {
  closeContextMenu();
  const rootRect = overlayRoot.getBoundingClientRect();
  contextMenuDispose = openPaneContextMenu(
    overlayRoot,
    { left: event.clientX - rootRect.left, top: event.clientY - rootRect.top },
    {
      hasSelection: lastSelection !== null,
      rightClickPassthrough: rightClickPassthroughFor(hit.pane_id),
      onCopy: () => void copyLastSelection(),
      onPaste: () => {
        void invokeSafe<string | null>("clipboard_read_text").then((text) => {
          if (text) pasteIntoPane(hit.pane_id, text);
        });
      },
      onSelectAll: () => void selectAllInPane(hit),
      onClear: () => clearPane(hit.pane_id),
      onSplitRight: () => void api("pane.split", { direction: "right", target_pane_id: hit.pane_id, focus: true }),
      onSplitDown: () => void api("pane.split", { direction: "down", target_pane_id: hit.pane_id, focus: true }),
      onToggleZoom: () => void api("pane.zoom", { pane_id: hit.pane_id }),
      onTogglePassthrough: () => toggleRightClickPassthrough(hit.pane_id, rightClickPassthroughFor(hit.pane_id)),
      onClosePane: () => requestClosePane(hit.pane_id),
    },
  );
}

/** "Select All" (P0 #5, a GUI-only addition -- there is no TUI equivalent):
 * the whole pane's content, from the top of scrollback to the live bottom,
 * regardless of the current scroll position. Auto-copies immediately, same
 * as a completed drag/word/line selection. */
async function selectAllInPane(hit: PaneMouseHit): Promise<void> {
  void api("pane.focus", { pane_id: hit.pane_id });
  const top = viewportTopRow(hit.scroll);
  const viewportRows = hit.scroll?.viewport_rows ?? hit.inner_rect.height;
  const maxOffsetFromBottom = hit.scroll?.max_offset_from_bottom ?? 0;
  const bottomRow = Math.max(0, maxOffsetFromBottom + viewportRows - 1);
  await finishSelection({
    paneId: hit.pane_id,
    anchor: { row: 0, col: 0 },
    cursor: { row: bottomRow, col: Math.max(0, hit.inner_rect.width - 1) },
    contentRevision: hit.content_revision,
    viewportTop: top,
    viewportRows,
    innerRect: hit.inner_rect,
    live: false,
  });
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
  // trackpad already reports true `deltaX` for a two-axis swipe. P1 #11
  // "Shift+wheel is left to the app": this remapping only changes which
  // *axis* the delta represents for a `ScrollUp`/`Down`/`Left`/`Right`
  // wire event already destined for the same target (forwarded to the app
  // when `mouse_reporting`, exactly as any other wheel tick here) -- it
  // never gates *whether* the event forwards, so Shift+wheel over a
  // mouse-reporting pane is unaffected by this feature.
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
  // The canvas is focusable (tabindex=-1), so the browser's mousedown default
  // would take focus back from #keyboard-capture right after onPointerDown
  // gave it away, and typed text would land on the canvas and be dropped.
  // onPointerDown's own preventDefault runs after an await: too late.
  canvas.addEventListener("mousedown", (event) => event.preventDefault());
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("wheel", (event) => void onWheel(event), { passive: false });
  // The GUI's own context menu (P0 #5) is opened from `pointerdown` above
  // (so it can apply herdr's TUI forwarding rule first); the browser's
  // native context menu must never appear on top of or instead of it.
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}
