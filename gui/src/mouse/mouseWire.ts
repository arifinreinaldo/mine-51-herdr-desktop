// Builds the `ClientPaneInputEvent::Mouse` JSON payload `send_input` (a
// Tauri command over `herdr_wire::ClientPaneInputEvent`) expects -- the
// same externally-tagged serde shape `appTerminalInput.ts`'s existing
// `keyEvent`/`keyCodeToWire` already use for `Key` events, applied to
// `gui/crates/herdr-wire/src/client.rs`'s `ClientMouseKind`/
// `ClientMousePosition`/`ClientPaneInputEvent::Mouse` (byte-identical copies
// of `src/protocol/wire.rs`). Kept pure/DOM-free so the exact JSON shape is
// unit-testable without a Tauri runtime.

import { modifierBits, type ModifierKeysLike } from "../input/keymap";

export type WireMouseButton = "Left" | "Right" | "Middle";

/** Mirrors `ClientMouseKind` (externally tagged: a unit variant serializes
 * as a bare string, a tuple variant as `{ Variant: payload }`). */
export type WireMouseKind =
  | { Down: WireMouseButton }
  | { Up: WireMouseButton }
  | { Drag: WireMouseButton }
  | "Moved"
  | "ScrollUp"
  | "ScrollDown"
  | "ScrollLeft"
  | "ScrollRight";

/** Mirrors `ClientPaneInputEvent::Mouse`. The GUI never has SGR-pixel-mouse
 * geometry to report (it always sends `ClientMousePosition::Cell`, never
 * `::Pixels`), so `geometry` is always `null` -- matches herdr's own
 * `push_pane_mouse_event`, which only attaches `geometry` for the `Pixels`
 * variant. */
export interface WireMouseEvent {
  Mouse: {
    kind: WireMouseKind;
    position: { Cell: { column: number; row: number } };
    geometry: null;
    modifiers: number;
    lines: number;
  };
}

/** herdr's shipped default for `ui.mouse_scroll_lines`
 * (`src/config/model.rs`'s `mouse_scroll_lines_defaults_to_three_and_parses`
 * test). The GUI has no local config file of its own to read this from (it
 * is a different client from the TUI), so it mirrors the TUI's default
 * rather than inventing a different one; `lines` on a non-scroll event is
 * ignored server-side regardless (`src/server/pane_input.rs`), so this
 * constant only actually matters for wheel events. */
export const DEFAULT_MOUSE_SCROLL_LINES = 3;

export function buildMouseEvent(
  kind: WireMouseKind,
  column: number,
  row: number,
  modifiers: number,
  lines: number = DEFAULT_MOUSE_SCROLL_LINES,
): WireMouseEvent {
  return {
    Mouse: {
      kind,
      position: { Cell: { column, row } },
      geometry: null,
      modifiers,
      lines,
    },
  };
}

/** `PointerEvent.button` -> `ClientMouseButton` (0=Left, 1=Middle,
 * 2=Right, per the DOM spec); `null` for anything else (a stylus barrel
 * button, an unmapped extra mouse button, ...), which the caller ignores. */
export function pointerButtonToWire(button: number): WireMouseButton | null {
  switch (button) {
    case 0:
      return "Left";
    case 1:
      return "Middle";
    case 2:
      return "Right";
    default:
      return null;
  }
}

/** The `MouseEvent.buttons` bitmask bit for one button (DOM spec: bit 0 =
 * left, bit 1 = right, bit 2 = middle) -- used to notice a button release
 * that a gesture's owner missed (e.g. the pointer left the window without a
 * `pointerup`). `0` for an unmapped button, which never matches any real
 * `buttons` value. */
export function pointerButtonsBit(button: number): number {
  switch (button) {
    case 0:
      return 1;
    case 2:
      return 2;
    case 1:
      return 4;
    default:
      return 0;
  }
}

/** Same crossterm-shaped modifier byte as keyboard input
 * (`input/keymap.ts`'s `modifierBits`) -- there is exactly one place that
 * reads the four DOM modifier flags into it. */
export function domModifierBits(event: ModifierKeysLike): number {
  return modifierBits(event);
}
