// The keyboard-capture textarea's IME/paste wiring, and the resize/DPR
// watchers that drive the renderer's own metrics recompute (finding #16
// extraction from `main.ts`; the renderer itself still owns metrics/paint).
// Canvas click-to-focus-pane moved to `appTerminalMouse.ts`'s pointerdown
// handler (herdr-native mouse selection): that handler already resolves
// the pane and focuses it on every Down, mirroring herdr's own TUI client
// exactly, so a separate `click`-driven focus here would focus twice.

import { Channel } from "@tauri-apps/api/core";
import { invokeSafe } from "./appApi";
import { refreshPaneChrome } from "./paneChrome/paneChrome";
import { clearSelectionOnInput } from "./appTerminalMouse";
import { keyboardCapture, terminalWrapEl } from "./appDom";
import { targetPaneId } from "./appLookups";
import { appState } from "./appState";
import { applyDecodedFrame } from "./grid";
import { decodeSurfaceFrame } from "./decoder";
import { positionKeyboardCaptureAtCursor } from "./imePosition";
import { focusKeyboardCapture, registerKeyboardCapture } from "./keyboard/focusCapture";

export function sendTextCommit(text: string): void {
  if (!text) return;
  const paneId = targetPaneId();
  if (!paneId) return;
  clearSelectionOnInput(); // P0 #1: "... until the next click or input"
  void invokeSafe("send_input", { paneId, events: [{ TextCommit: text }] });
}

export function sendPaste(text: string): void {
  if (!text) return;
  const paneId = targetPaneId();
  if (!paneId) return;
  clearSelectionOnInput();
  void invokeSafe("send_input", { paneId, events: [{ Paste: text }] });
}

export function keyEvent(code: unknown, modifiers: number): unknown {
  return {
    Key: {
      code,
      modifiers,
      kind: "Press",
      repeat_count: 1,
      shifted_codepoint: null,
      generated_text: null,
      tracks_release: false,
      physical_key_id: null,
      windows_record: null,
    },
  };
}

export function sendKeyEvent(mapped: { code: unknown; modifiers: number }): void {
  const paneId = targetPaneId();
  if (!paneId) return;
  clearSelectionOnInput();
  void invokeSafe("send_input", { paneId, events: [keyEvent(mapped.code, mapped.modifiers)] });
}

/** Types `command` into `paneId` and presses Enter, through the exact same
 * `ClientShellPaneInput` events a user's own typing produces
 * (`TextCommit` then `Key Enter`) -- the wizard's provider-install/sign-in
 * flow uses this (Phase 1.6 spec §4.2 "through the existing input path"),
 * targeting a specific pane rather than whichever one currently has focus. */
export async function sendCommandLineToPane(paneId: string, command: string): Promise<void> {
  await invokeSafe("send_input", { paneId, events: [{ TextCommit: command }] });
  await invokeSafe("send_input", { paneId, events: [keyEvent("Enter", 0)] });
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
    refreshPaneChrome();
    positionKeyboardCaptureAtCursor(); // P1 #16 "IME": cell size may have changed.
    // 150ms of quiet before sending the size: every width change makes the
    // shell reflow and redraw its input line (PSReadLine mangles it when
    // several arrive mid-typing), so a window drag sends one size, not many.
  }, 150);
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
    refreshPaneChrome();
    positionKeyboardCaptureAtCursor(); // P1 #16 "IME"
  };
  await invokeSafe("subscribe_surface", { channel });
}
