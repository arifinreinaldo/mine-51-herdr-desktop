// A small ✕ at the top-right corner of the focused pane, shown only while
// the tab is split. Its rect comes from the Rust surface mirror
// (`split_focused_pane_rect`), which returns nothing on a single-pane tab,
// so the button can never close a tab or a workspace.

import { api, invokeSafe } from "./appApi";
import { canvas, terminalWrapEl } from "./appDom";
import { appState } from "./appState";
import { focusKeyboardCapture } from "./keyboard/focusCapture";

interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let button: HTMLButtonElement | null = null;
let inFlight = false;
let pending = false;

function ensureButton(): HTMLButtonElement {
  if (button) return button;
  button = document.createElement("button");
  button.className = "pane-close-button";
  button.title = "Close Pane (Alt+Shift+W)";
  button.setAttribute("aria-label", "Close Pane");
  const icon = document.createElement("i");
  icon.className = "codicon codicon-close";
  button.appendChild(icon);
  button.hidden = true;
  // Keep the terminal's own pointer handling (focus, selection) off this click.
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const paneId = appState.snapshot?.focused_pane_id;
    if (paneId) void api("pane.close", { pane_id: paneId });
    focusKeyboardCapture(); // typing keeps going to the terminal, not this button
  });
  terminalWrapEl.appendChild(button);
  return button;
}

/** Re-anchors the button. Call after each surface frame and resize; calls
 * coalesce so at most one IPC is in flight. */
export function refreshPaneCloseButton(): void {
  if (inFlight) {
    pending = true;
    return;
  }
  inFlight = true;
  void invokeSafe<CellRect | null>("split_focused_pane_rect").then((rect) => {
    place(rect ?? null);
    inFlight = false;
    if (pending) {
      pending = false;
      refreshPaneCloseButton();
    }
  });
}

function place(rect: CellRect | null): void {
  const btn = ensureButton();
  const renderer = appState.renderer;
  if (!rect || !renderer) {
    btn.hidden = true;
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const cell = renderer.getCellSizeDevicePx();
  const canvasRect = canvas.getBoundingClientRect();
  const wrapRect = terminalWrapEl.getBoundingClientRect();
  const right = canvasRect.left - wrapRect.left + ((rect.x + rect.width) * cell.width) / dpr;
  const top = canvasRect.top - wrapRect.top + (rect.y * cell.height) / dpr;
  btn.style.left = `${right - 22}px`;
  btn.style.top = `${top + 2}px`;
  btn.hidden = false;
}
