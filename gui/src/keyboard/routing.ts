// The single document-level keyboard router (spec phase1.5 §1 "Keyboard
// routing"):
//
// "One `document` capture-phase `keydown` listener handles every key, in
// this order:
//  1. Skip if `isComposing || keyCode===229` (IME).
//  2. Check the `shortcuts.ts` table.
//  3. If `activeElement` is `#keyboard-capture` -> keymap -> terminal.
//  4. Otherwise, chrome keys (F2, Shift+F10, arrows, Enter, Esc) act on the
//     focused element."
//
// Step 4 is deliberately a no-op *here*: once neither a claimed shortcut
// nor the terminal capture matches, this router does nothing and lets the
// event bubble to whatever chrome widget is focused (a `.tab`, a sidebar
// row, a menu item, a popover) -- each of those owns its own local
// Enter/Arrow/Esc/Shift+F10 keydown handling. Capturing everything into one
// giant switch here would just re-implement per-widget listeners in a
// different place.
//
// Finding #4 adds one exception between steps 2 and 3: Esc while an
// overlay (menu, popover, modal, confirm) is open always goes to that
// overlay, even when `activeElement` still happens to be the terminal
// capture (an overlay opened by the mouse, not by keyboard focus, never
// moved focus off it) -- otherwise step 3 would forward it to the
// terminal's shell instead.
//
// "Tab UI focus" (spec §1) means `activeElement` is a `.tab`.

import type { KeyboardEventLike, MappedKey } from "../input/keymap";
import { mapKeyboardEvent } from "../input/keymap";
import { findShortcut, type ShortcutAction } from "../shortcuts";
import { closeActiveOverlay, isOverlayOpen } from "../ui/overlay";

export interface KeyboardRoutingHandlers {
  onShortcut(action: ShortcutAction): void;
  onTerminalKey(mapped: MappedKey): void;
  /** Ctrl+Shift+V is reserved (never a claimed shortcut, spec §1), but
   * while the terminal has focus it still means "paste from the clipboard"
   * (carried over from Phase 1's input handling). */
  onPasteOverride(): void;
}

export function hasTabUiFocus(activeElement: Element | null): boolean {
  return activeElement?.classList.contains("tab") ?? false;
}

function isPasteOverride(event: KeyboardEventLike): boolean {
  return (
    event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.code === "KeyV"
  );
}

/**
 * The router's decision logic, exercised directly by unit tests against a
 * plain object implementing `KeyboardEventLike` + `code`/`preventDefault`,
 * without needing a real `KeyboardEvent`/DOM.
 */
export function routeKeydown(
  event: KeyboardEvent,
  keyboardCaptureEl: Element,
  activeElement: Element | null,
  handlers: KeyboardRoutingHandlers,
): void {
  if (event.isComposing || event.keyCode === 229) return;

  if (isPasteOverride(event) && activeElement === keyboardCaptureEl) {
    event.preventDefault();
    handlers.onPasteOverride();
    return;
  }

  const hasTabFocus = hasTabUiFocus(activeElement);
  const shortcut = findShortcut(event, hasTabFocus);
  if (shortcut) {
    event.preventDefault();
    handlers.onShortcut(shortcut);
    return;
  }

  // Finding #4: an overlay (menu, popover, modal, confirm) that doesn't
  // move keyboard focus off the terminal capture when it opens by the
  // mouse -- the usage popover on hover, the agent popover auto-opening on
  // a Done transition -- otherwise leaves `activeElement` on the capture,
  // and step 3 below would forward Esc straight to the terminal's shell
  // instead of closing the overlay. Gated on the capture actually having
  // focus so this never pre-empts a menu's own, more specific Esc handling
  // (e.g. "Esc closes just the open submenu") when focus is already
  // elsewhere in the chrome -- those cases already work via each widget's
  // own listener and must reach it untouched.
  if (event.key === "Escape" && activeElement === keyboardCaptureEl && isOverlayOpen()) {
    event.preventDefault();
    closeActiveOverlay();
    return;
  }

  if (activeElement === keyboardCaptureEl) {
    const mapped = mapKeyboardEvent(event);
    if (mapped) {
      event.preventDefault();
      handlers.onTerminalKey(mapped);
    }
    return;
  }

  // Step 4: let it bubble to the focused chrome widget's own handler.
}

/** Installs the single capture-phase `document` `keydown` listener and
 * returns a disposer. */
export function installKeyboardRouting(
  keyboardCaptureEl: Element,
  handlers: KeyboardRoutingHandlers,
): () => void {
  const listener = (event: KeyboardEvent) => {
    routeKeydown(event, keyboardCaptureEl, document.activeElement, handlers);
  };
  document.addEventListener("keydown", listener, true);
  return () => document.removeEventListener("keydown", listener, true);
}
