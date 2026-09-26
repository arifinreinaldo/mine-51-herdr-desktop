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

/**
 * A minimal, framework-independent subset of `KeyboardEvent`, so the mapper
 * (and its tests) don't need a DOM environment.
 */
export interface KeyboardEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * Maps a keydown-like event to a `ClientKeyCode` + modifier bits, for the
 * named keys and Ctrl/Alt combinations listed in spec §6. Returns `null`
 * for keys that should instead go through `TextCommit` (printable text) or
 * are not handled (e.g. bare modifier keypresses).
 */
export function mapKeyboardEvent(_event: KeyboardEventLike): MappedKey | null {
  throw new Error("not implemented: mapKeyboardEvent");
}
