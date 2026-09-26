// Canvas click-to-focus-pane, the keyboard-capture textarea's IME/paste
// wiring, and the resize/DPR watchers that drive the renderer's own
// metrics recompute (finding #16 extraction from `main.ts`; the renderer
// itself still owns metrics/paint).

import { Channel } from "@tauri-apps/api/core";
import { api, invokeSafe } from "./appApi";
import { canvas, keyboardCapture, terminalWrapEl } from "./appDom";
import { targetPaneId } from "./appLookups";
import { appState } from "./appState";
import { applyDecodedFrame } from "./grid";
import { decodeSurfaceFrame } from "./decoder";
import { focusKeyboardCapture, registerKeyboardCapture } from "./keyboard/focusCapture";

function sendTextCommit(text: string): void {
  if (!text) return;
  const paneId = targetPaneId();
  if (!paneId) return;
  void invokeSafe("send_input", { paneId, events: [{ TextCommit: text }] });
}

export function sendPaste(text: string): void {
  if (!text) return;
  const paneId = targetPaneId();
  if (!paneId) return;
  void invokeSafe("send_input", { paneId, events: [{ Paste: text }] });
}

export function sendKeyEvent(mapped: { code: unknown; modifiers: number }): void {
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

async function onCanvasClick(event: MouseEvent): Promise<void> {
  focusKeyboardCapture();
  const renderer = appState.renderer;
  if (!renderer) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const { width: cellWidthPx, height: cellHeightPx } = renderer.getCellSizeDevicePx();
  const col = Math.floor(((event.clientX - rect.left) * dpr) / Math.max(1, cellWidthPx));
  const row = Math.floor(((event.clientY - rect.top) * dpr) / Math.max(1, cellHeightPx));
  const paneId = await invokeSafe<string | null>("pane_at", { col, row });
  if (paneId && paneId !== targetPaneId()) {
    void api("pane.focus", { pane_id: paneId });
  }
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

export function wireInputHandlers(): void {
  registerKeyboardCapture(keyboardCapture);
  canvas.addEventListener("click", (event) => void onCanvasClick(event));
  keyboardCapture.addEventListener("compositionend", onCompositionEnd);
  keyboardCapture.addEventListener("input", onInput);
  keyboardCapture.addEventListener("paste", onPaste);
  keyboardCapture.addEventListener("blur", () => appState.renderer?.setFocused(false));
  keyboardCapture.addEventListener("focus", () => appState.renderer?.setFocused(true));
  focusKeyboardCapture();
}

function scheduleResize(): void {
  if (appState.resizeDebounceTimer !== undefined) window.clearTimeout(appState.resizeDebounceTimer);
  appState.resizeDebounceTimer = window.setTimeout(() => {
    appState.resizeDebounceTimer = undefined;
    appState.renderer?.measureAndResize();
  }, 50);
}

/**
 * Watches for a DPR change via `matchMedia` (spec §8.2 "Recompute on font
 * size, DPR ... or container resize"). Finding #15 "DPR matchMedia
 * re-created after each change": a `matchMedia("(resolution: NdppxX)")`
 * query is permanently bound to that one fixed value `N`; its `change`
 * event fires (at most) once, the moment the *actual* DPR first moves away
 * from `N`, and then never again for any later change (e.g. moving the
 * window between two differently-scaled monitors more than once) --
 * because nothing was still watching the *new* current DPR. The listener
 * re-subscribes itself against the DPR that is current after it fires.
 */
function watchDprChanges(onChange: () => void): void {
  let mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const handler = () => {
    mql.removeEventListener?.("change", handler);
    onChange();
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mql.addEventListener?.("change", handler);
  };
  mql.addEventListener?.("change", handler);
}

export function wireResizeObserver(): void {
  const observer = new ResizeObserver(() => scheduleResize());
  observer.observe(terminalWrapEl);
  watchDprChanges(scheduleResize);
}

export async function subscribeSurface(): Promise<void> {
  const channel = new Channel<unknown>();
  channel.onmessage = (message) => {
    const decodeStart = performance.now();
    const bytes =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : message instanceof Uint8Array
          ? message
          : new Uint8Array(message as ArrayLike<number>);
    const frame = decodeSurfaceFrame(bytes);
    const { grid: nextGrid, dirtyRows } = applyDecodedFrame(appState.grid, frame);
    appState.grid = nextGrid;
    appState.renderer?.recordDecodeMs(performance.now() - decodeStart);
    appState.renderer?.recordRustUs(frame.rustUs);
    appState.renderer?.setGrid(appState.grid, dirtyRows);
  };
  await invokeSafe("subscribe_surface", { channel });
}
