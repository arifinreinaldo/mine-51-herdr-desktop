// Small pane-targeted actions shared by the terminal's right-click context
// menu (terminal-parity spec P0 #5), the `Pane` top menu, and their keyboard
// shortcuts -- kept together so there is exactly one call site per action,
// not one per UI surface.

import { api, invokeSafe } from "./appApi";
import { focusedPaneId } from "./appLookups";

/** `Pane ▸ Clear` / the context menu's `Clear` (P1 #12): `pane.clear`. */
export function clearPane(paneId: string): void {
  void api("pane.clear", { pane_id: paneId });
}

/** The context menu's `Paste` (P0 #5), targeting the right-clicked pane
 * explicitly rather than whichever one currently has focus
 * (`appTerminalInput.ts`'s `sendPaste` always targets `targetPaneId()`,
 * which is the wrong target here). Always `Paste(text)`, so the server
 * adds bracketed paste, same as every other paste path. */
export function pasteIntoPane(paneId: string, text: string): void {
  if (!text) return;
  void invokeSafe("send_input", { paneId, events: [{ Paste: text }] });
}

/** `Pane ▸ Clear` via the keyboard shortcut (Ctrl+Shift+K) or the top menu,
 * where there is no specific pane already in hand -- targets the currently
 * focused pane, a no-op with none. */
export function clearFocusedPane(): void {
  const paneId = focusedPaneId();
  if (paneId) clearPane(paneId);
}

/** The context menu's toggle for herdr's own `right_click_passthrough`
 * (`pane.input.set {pane_id, right_click}`, P0 #5): flips whichever target
 * is currently set. `right_click: "pane"` is what makes
 * `right_click_passthrough` true server-side
 * (`src/app/api/panes.rs:108-110`). */
export function toggleRightClickPassthrough(paneId: string, currentlyPassthrough: boolean): void {
  void api("pane.input.set", {
    pane_id: paneId,
    right_click: currentlyPassthrough ? "herdr" : "pane",
  });
}

/** Best-effort clipboard write, shared by every copy path (mouse-selection
 * auto-copy, Ctrl+Shift+C, double/triple-click, Select All) so there is one
 * call site for the "show the Copied toast on success" behavior. Returns
 * whether the write actually happened (text non-empty and the OS write
 * succeeded). */
export async function writeToClipboard(text: string | undefined): Promise<boolean> {
  if (!text) return false;
  return invokeSafe<boolean>("write_clipboard_text", { text }).then((ok) => ok === true);
}
