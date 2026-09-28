// Keyboard input mapping (spec §6 "Input"): printable text and IME
// composition go through TextCommit; the listed named keys and Ctrl/Alt
// combinations go through Key with kind: Press. Stubbed: the mapping table
// and its lookup function are application logic, left for the implementer.
//
// `ClientKeyCode` variants and modifier bits are copied from
// `src/protocol/wire.rs:65-84` via `herdr-wire`'s Rust copy; this file must
// stay in sync with `gui/crates/herdr-wire/src/client.rs`.

/** Mirrors `herdr_wire::ClientKeyCode` (`wire.rs:65-84`) as a tagged union. */
export type ClientKeyCode =
  | { kind: "Backspace" }
  | { kind: "Enter" }
  | { kind: "Left" }
  | { kind: "Right" }
  | { kind: "Up" }
  | { kind: "Down" }
  | { kind: "Home" }
  | { kind: "End" }
  | { kind: "PageUp" }
  | { kind: "PageDown" }
  | { kind: "Tab" }
  | { kind: "BackTab" }
  | { kind: "Delete" }
  | { kind: "Insert" }
  | { kind: "Esc" }
  | { kind: "Char"; value: string }
  | { kind: "F"; value: number }
  | { kind: "Null" };

/** Crossterm modifier bits (spec §1: "SHIFT 1, CONTROL 2, ALT 4, SUPER 8"). */
export const MODIFIER_SHIFT = 1;
export const MODIFIER_CONTROL = 2;
export const MODIFIER_ALT = 4;
export const MODIFIER_SUPER = 8;

export interface MappedKey {
  code: ClientKeyCode;
  modifiers: number;
}

/** The four modifier flags every DOM input event (`KeyboardEvent`,
 * `PointerEvent`, `WheelEvent`, ...) carries, factored out so
 * `modifierBits` works for mouse events too (`mouse/mouseWire.ts`'s
 * `domModifierBits` is a thin re-export of this), not just keyboard ones. */
export interface ModifierKeysLike {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * A minimal, framework-independent subset of `KeyboardEvent`, so the mapper
 * (and its tests) don't need a DOM environment.
 */
export interface KeyboardEventLike extends ModifierKeysLike {
  key: string;
  code: string;
}

/** Named (non-printable) keys that always map to a `ClientKeyCode`, keyed by `KeyboardEvent.key`. */
const NAMED_KEYS: Record<string, ClientKeyCode> = {
  Backspace: { kind: "Backspace" },
  Enter: { kind: "Enter" },
  ArrowLeft: { kind: "Left" },
  ArrowRight: { kind: "Right" },
  ArrowUp: { kind: "Up" },
  ArrowDown: { kind: "Down" },
  Home: { kind: "Home" },
  End: { kind: "End" },
  PageUp: { kind: "PageUp" },
  PageDown: { kind: "PageDown" },
  Delete: { kind: "Delete" },
  Insert: { kind: "Insert" },
  Escape: { kind: "Esc" },
};

/** Bare modifier keypresses that must not be mapped on their own. */
const BARE_MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** Shared with `mouse/mouseWire.ts` (`domModifierBits`): both keyboard and
 * mouse events carry the same crossterm-shaped modifier byte, so there is
 * exactly one place that reads `shiftKey`/`ctrlKey`/`altKey`/`metaKey` off a
 * DOM event into it. */
export function modifierBits(event: ModifierKeysLike): number {
  let bits = 0;
  if (event.shiftKey) bits |= MODIFIER_SHIFT;
  if (event.ctrlKey) bits |= MODIFIER_CONTROL;
  if (event.altKey) bits |= MODIFIER_ALT;
  if (event.metaKey) bits |= MODIFIER_SUPER;
  return bits;
}

/**
 * Maps a keydown-like event to a `ClientKeyCode` + modifier bits, for the
 * named keys and Ctrl/Alt combinations listed in spec §6. Returns `null`
 * for keys that should instead go through `TextCommit` (printable text) or
 * are not handled (e.g. bare modifier keypresses).
 */
export function mapKeyboardEvent(event: KeyboardEventLike): MappedKey | null {
  if (BARE_MODIFIER_KEYS.has(event.key)) {
    return null;
  }

  // Shift+Tab is BackTab, not Tab with the SHIFT bit set.
  if (event.key === "Tab") {
    const code: ClientKeyCode = event.shiftKey ? { kind: "BackTab" } : { kind: "Tab" };
    const modifiers = modifierBits(event) & ~MODIFIER_SHIFT;
    return { code, modifiers };
  }

  const fMatch = /^F(\d{1,2})$/.exec(event.key);
  if (fMatch) {
    return { code: { kind: "F", value: Number(fMatch[1]) }, modifiers: modifierBits(event) };
  }

  const named = NAMED_KEYS[event.key];
  if (named) {
    return { code: named, modifiers: modifierBits(event) };
  }

  // A single printable character: only handled here when a modifier that
  // changes semantics (Ctrl/Alt/Meta) is held, e.g. Ctrl+C. Plain
  // characters (with or without Shift, e.g. "a"/"A") go through
  // TextCommit instead.
  if (event.key.length === 1 && (event.ctrlKey || event.altKey || event.metaKey)) {
    return {
      code: { kind: "Char", value: event.key.toLowerCase() },
      modifiers: modifierBits(event),
    };
  }

  return null;
}
