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

import { handleCopyModeKeydown, isCopyModeActive } from "../copyMode";
import type { KeyboardEventLike, MappedKey } from "../input/keymap";
import { altGrTextCommit, macCmdTextKey, mapKeyboardEvent } from "../input/keymap";
import { findShortcut, IS_MAC, type ShortcutAction } from "../shortcuts";
import { createDoubleShiftTracker } from "./doubleShift";

/** Cmd+C acts on the terminal only while it has focus; in a text field (find
 * bar, dialogs) it must stay the native copy. */
const TERMINAL_ONLY_MAC_IDS = new Set(["pane.copy"]);
/** Paste and the scrollback keys act on the terminal only while it has focus,
 * on every OS: in a text field (find bar, dialogs, the commit box) Shift+Insert,
 * Shift+PgUp/PgDn/Home/End and Cmd+V/Up/Down must stay native. */
const TERMINAL_ONLY_IDS = new Set([
  "pane.paste",
  "pane.scrollPageUp",
  "pane.scrollPageDown",
  "pane.scrollToTop",
  "pane.scrollToBottom",
]);
import { closeActiveOverlay, isActiveOverlayEscapableFromOutside, isOverlayOpen } from "../ui/overlay";

/** File viewer spec §8.1: inside the viewer, these tab actions act on the file tabs. */
const FILE_TAB_IDS = new Set(["tab.close", "tab.next", "tab.previous"]);
/** File viewer spec §7.1: one tracker for the document; every keydown, keyup, pointerdown and wheel feeds it. */
const doubleShift = createDoubleShiftTracker();

export interface KeyboardRoutingHandlers {
  onShortcut(action: ShortcutAction): void;
  onTerminalKey(mapped: MappedKey): void;
  /** Ctrl+Shift+V is reserved (never a claimed shortcut, spec §1), but
   * while the terminal has focus it still means "paste from the clipboard"
   * (carried over from Phase 1's input handling). */
  onPasteOverride(): void;
  /** Terminal-parity spec P0 #2 "AltGr": an AltGr press while the terminal
   * capture has focus, sent as `TextCommit(text)` rather than a `Key` press. */
  onTerminalTextCommit(text: string): void;
  /** File viewer spec §8.1: a tab action while focus is inside `#file-viewer`. */
  onFileTabAction(id: string): void;
  /** File viewer spec §7.1: a double tap on Shift opens Find File. */
  onDoubleShift(): void;
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

  // File viewer spec §7.1: first, so that any other key cancels a pending tap. A pinned
  // agent popover holds the overlay slot but is not escapable from outside; it must not
  // block the finder (the finder supersedes it, and it reopens afterwards).
  // A text field (tab rename, commit box) keeps its Shift taps: the finder would steal focus and commit a half-typed value.
  const inTextField = activeElement !== keyboardCaptureEl && !!(activeElement as Element | null)?.matches?.("input, textarea, [contenteditable]");
  if (doubleShift.keydown(event, event.timeStamp) && !inTextField && !(isOverlayOpen() && isActiveOverlayEscapableFromOutside())) {
    handlers.onDoubleShift();
    return;
  }

  if (isPasteOverride(event) && activeElement === keyboardCaptureEl) {
    event.preventDefault();
    handlers.onPasteOverride();
    return;
  }

  const hasTabFocus = hasTabUiFocus(activeElement);
  const found = findShortcut(event, hasTabFocus);
  const terminalOnly =
    found && (TERMINAL_ONLY_IDS.has(found.id) || (IS_MAC && TERMINAL_ONLY_MAC_IDS.has(found.id)));
  const shortcut = terminalOnly && activeElement !== keyboardCaptureEl ? undefined : found;
  if (shortcut) {
    event.preventDefault();
    // `closest?.`: the unit tests pass plain objects, not DOM elements.
    if (FILE_TAB_IDS.has(shortcut.id) && activeElement?.closest?.("#file-viewer")) handlers.onFileTabAction(shortcut.id);
    else handlers.onShortcut(shortcut);
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
  //
  // UX pass 1 §3 finding #3: a *pinned* agent popover opts out of this via
  // `isActiveOverlayEscapableFromOutside()` -- it must never swallow an Esc
  // meant for the terminal while focus never left the capture; Esc only
  // closes it via its own keydown listener, which requires focus actually
  // be inside it.
  if (
    event.key === "Escape" &&
    activeElement === keyboardCaptureEl &&
    isOverlayOpen() &&
    isActiveOverlayEscapableFromOutside()
  ) {
    event.preventDefault();
    closeActiveOverlay();
    return;
  }

  if (activeElement === keyboardCaptureEl) {
    // P1 #8 "Copy mode": checked first, and before `mapKeyboardEvent` gets a
    // chance -- a plain letter key (h/j/k/l/w/b/e/v/y/g) is otherwise never
    // seen by this router at all (`mapKeyboardEvent` returns `null` for
    // plain printable characters, spec §6: they go through the textarea's
    // own native `input` event -> `TextCommit` instead), so copy mode must
    // `preventDefault()` here to stop that native `input` event from ever
    // firing.
    if (isCopyModeActive() && handleCopyModeKeydown(event)) {
      event.preventDefault();
      return;
    }
    // P0 #2 "AltGr": checked before the ordinary key mapping, since an
    // unhandled AltGr press (Ctrl+Alt on Windows) would otherwise fall into
    // `mapKeyboardEvent`'s own Ctrl+Alt `Char` branch and send the wrong
    // thing (a Ctrl+Alt key press instead of the composed character).
    const altGrText = altGrTextCommit(event);
    if (altGrText !== null) {
      event.preventDefault();
      handlers.onTerminalTextCommit(altGrText);
      return;
    }
    // macOS: WebKit skips the native menu item (Cmd+Q Quit, Cmd+H, Cmd+M ...)
    // when the page calls preventDefault on its keydown, so an unclaimed Cmd
    // combo must not be forwarded to the terminal. Claimed ones (Cmd+1..9,
    // Cmd+Shift+W, ...) were already handled by `findShortcut` above.
    if (IS_MAC && event.metaKey) {
      const textKey = macCmdTextKey(event);
      if (textKey) {
        event.preventDefault();
        handlers.onTerminalKey(textKey);
      }
      return;
    }
    const mapped = mapKeyboardEvent(event);
    if (mapped) {
      event.preventDefault();
      handlers.onTerminalKey(mapped);
    }
    return;
  }

  // Step 4: let it bubble to the focused chrome widget's own handler.
}

/** Feeds a keyup to the double-Shift tracker. Exported for the unit tests. */
export function routeKeyup(event: KeyboardEvent): void {
  doubleShift.keyup(event, event.timeStamp);
}

/** Installs the single capture-phase `document` `keydown` listener, plus the
 * `keyup`, `pointerdown` and `wheel` listeners the double-Shift tracker needs,
 * and returns a disposer. */
export function installKeyboardRouting(
  keyboardCaptureEl: Element,
  handlers: KeyboardRoutingHandlers,
): () => void {
  const listener = (event: KeyboardEvent) => {
    routeKeydown(event, keyboardCaptureEl, document.activeElement, handlers);
  };
  // pointerdown, not mousedown: a pointerdown preventDefault suppresses mousedown.
  const cancelDoubleShift = (): void => doubleShift.cancel();
  document.addEventListener("keydown", listener, true);
  document.addEventListener("keyup", routeKeyup, true);
  document.addEventListener("pointerdown", cancelDoubleShift, true);
  document.addEventListener("wheel", cancelDoubleShift, { capture: true, passive: true });
  return () => {
    document.removeEventListener("keydown", listener, true);
    document.removeEventListener("keyup", routeKeyup, true);
    document.removeEventListener("pointerdown", cancelDoubleShift, true);
    document.removeEventListener("wheel", cancelDoubleShift, true);
  };
}
