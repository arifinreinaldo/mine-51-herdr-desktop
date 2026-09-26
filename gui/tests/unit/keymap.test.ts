import { describe, expect, it } from "vitest";
import type { KeyboardEventLike } from "../../src/input/keymap";
import {
  mapKeyboardEvent,
  MODIFIER_ALT,
  MODIFIER_CONTROL,
  MODIFIER_SHIFT,
} from "../../src/input/keymap";

function key(overrides: Partial<KeyboardEventLike>): KeyboardEventLike {
  return {
    key: "a",
    code: "KeyA",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe("mapKeyboardEvent: named keys", () => {
  const cases: Array<[string, KeyboardEventLike["key"], { kind: string }]> = [
    ["Enter", "Enter", { kind: "Enter" }],
    ["Backspace", "Backspace", { kind: "Backspace" }],
    ["Tab", "Tab", { kind: "Tab" }],
    ["Escape", "Escape", { kind: "Esc" }],
    ["ArrowLeft", "ArrowLeft", { kind: "Left" }],
    ["ArrowRight", "ArrowRight", { kind: "Right" }],
    ["ArrowUp", "ArrowUp", { kind: "Up" }],
    ["ArrowDown", "ArrowDown", { kind: "Down" }],
    ["Home", "Home", { kind: "Home" }],
    ["End", "End", { kind: "End" }],
    ["PageUp", "PageUp", { kind: "PageUp" }],
    ["PageDown", "PageDown", { kind: "PageDown" }],
    ["Delete", "Delete", { kind: "Delete" }],
  ];

  for (const [label, domKey, expectedCode] of cases) {
    it(`maps ${label} to ${expectedCode.kind}`, () => {
      const mapped = mapKeyboardEvent(key({ key: domKey }));
      expect(mapped?.code).toEqual(expectedCode);
    });
  }

  for (let n = 1; n <= 12; n++) {
    it(`maps F${n} to F(${n})`, () => {
      const mapped = mapKeyboardEvent(key({ key: `F${n}` }));
      expect(mapped?.code).toEqual({ kind: "F", value: n });
    });
  }
});

describe("mapKeyboardEvent: modifiers", () => {
  it("Ctrl+C maps to Char('c') with the CONTROL bit set", () => {
    const mapped = mapKeyboardEvent(key({ key: "c", ctrlKey: true }));
    expect(mapped?.code).toEqual({ kind: "Char", value: "c" });
    expect(mapped?.modifiers).toBe(MODIFIER_CONTROL);
  });

  it("Shift+Tab maps to BackTab, not Tab+SHIFT", () => {
    const mapped = mapKeyboardEvent(key({ key: "Tab", shiftKey: true }));
    expect(mapped?.code).toEqual({ kind: "BackTab" });
  });

  it("Alt+Enter carries the ALT bit", () => {
    const mapped = mapKeyboardEvent(key({ key: "Enter", altKey: true }));
    expect(mapped?.code).toEqual({ kind: "Enter" });
    expect(mapped?.modifiers).toBe(MODIFIER_ALT);
  });

  it("combines multiple modifier bits", () => {
    const mapped = mapKeyboardEvent(key({ key: "x", ctrlKey: true, shiftKey: true }));
    expect(mapped?.modifiers).toBe(MODIFIER_CONTROL | MODIFIER_SHIFT);
  });

  it("a bare modifier keypress (e.g. just pressing Control) is not mapped", () => {
    expect(mapKeyboardEvent(key({ key: "Control", ctrlKey: true }))).toBeNull();
  });
});

describe("mapKeyboardEvent: printable text is not handled here", () => {
  it("returns null for plain printable characters (they go through TextCommit instead)", () => {
    expect(mapKeyboardEvent(key({ key: "a" }))).toBeNull();
  });
});
