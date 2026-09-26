// Returning keyboard focus to the terminal's `#keyboard-capture` element
// after a chrome interaction finishes (spec §1 "A left click on a tab
// returns focus to the capture"; finding #3 extends this rule to every
// other chrome interaction that closes/completes: menu close, popover/
// modal/confirm close, and a sidebar row click -- without it, focus was
// landing on `document.body` instead, where no keystroke reaches either
// the terminal or a claimed shortcut).
//
// A small shared module (mirrors `ui/overlay.ts`'s registry pattern)
// because the call sites needing it span several UI modules
// (`ui/tabs.ts`, `ui/sidebar.ts`, `ui/menus.ts`, `ui/statusbar.ts`,
// `ui/confirmPopover.ts`, `ui/modal.ts`) that don't otherwise share a
// reference to the capture element -- threading a callback parameter
// through every one of their option objects would be far more invasive
// than this.

let captureEl: HTMLElement | null = null;

export function registerKeyboardCapture(el: HTMLElement): void {
  captureEl = el;
}

/** The inline tab-rename `<input>` (`ui/tabs.ts`'s `startInlineRename`)
 * carries this class; while it has focus, nothing here may steal it
 * (finding #3 "Never steal focus from an active inline rename input"). */
const RENAME_INPUT_CLASS = "tab-rename-input";

function isRenameInputActive(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement && active.classList.contains(RENAME_INPUT_CLASS);
}

/** Moves keyboard focus back to the terminal capture, unless an inline
 * rename input currently has it. */
export function focusKeyboardCapture(): void {
  if (!captureEl || isRenameInputActive()) return;
  captureEl.focus({ preventScroll: true });
}

/** For callers that pass the capture element as a `returnFocusTo` target
 * (e.g. `openMenu`'s options, which call `.focus()` on it unconditionally
 * from its own disposer) rather than calling `focusKeyboardCapture()`
 * directly: `undefined` while an inline rename is active, so that
 * mechanism can't steal focus from it either. */
export function keyboardCaptureReturnTarget(): HTMLElement | undefined {
  return captureEl && !isRenameInputActive() ? captureEl : undefined;
}
