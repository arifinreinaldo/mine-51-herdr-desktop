import { describe, expect, it } from "vitest";
import type { KeyboardEventLike } from "../../src/input/keymap";
import {
  altGrTextCommit,
  macCmdTextKey,
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

// P0 #2 "AltGr": German AltGr+Q = @, Polish AltGr+A = ą (spec's own test
// cases), both reported by Windows as Ctrl+Alt.
describe("altGrTextCommit", () => {
  it("AltGraph modifier state alone is enough, regardless of the Ctrl+Alt heuristic", () => {
    const event = key({
      key: "@",
      code: "KeyQ",
      ctrlKey: true,
      altKey: true,
      getModifierState: (k) => k === "AltGraph",
    });
    expect(altGrTextCommit(event)).toBe("@");
  });

  it("falls back to the Ctrl+Alt heuristic when AltGraph isn't reported", () => {
    expect(altGrTextCommit(key({ key: "ą", code: "KeyA", ctrlKey: true, altKey: true }))).toBe("ą");
  });

  it("excludes a bare ASCII letter from the heuristic (leaves it to the ordinary Ctrl+Alt Char path)", () => {
    expect(altGrTextCommit(key({ key: "k", code: "KeyK", ctrlKey: true, altKey: true }))).toBeNull();
  });

  it("is null with neither Ctrl nor Alt held", () => {
    expect(altGrTextCommit(key({ key: "@", code: "KeyQ" }))).toBeNull();
  });

  it("is null for a multi-character key (named keys are never AltGr text)", () => {
    expect(
      altGrTextCommit(key({ key: "Enter", code: "Enter", ctrlKey: true, altKey: true })),
    ).toBeNull();
  });

  it("is null with only Ctrl or only Alt held (not the AltGr combination)", () => {
    expect(altGrTextCommit(key({ key: "@", code: "KeyQ", ctrlKey: true }))).toBeNull();
    expect(altGrTextCommit(key({ key: "@", code: "KeyQ", altKey: true }))).toBeNull();
  });
});

describe("macCmdTextKey (macOS line editing)", () => {
  it("Cmd+Left/Right send Home/End", () => {
    expect(macCmdTextKey(key({ key: "ArrowLeft", code: "ArrowLeft", metaKey: true }))).toEqual({ code: { kind: "Home" }, modifiers: 0 });
    expect(macCmdTextKey(key({ key: "ArrowRight", code: "ArrowRight", metaKey: true }))).toEqual({ code: { kind: "End" }, modifiers: 0 });
  });

  it("Cmd+Backspace sends Ctrl+U", () => {
    expect(macCmdTextKey(key({ key: "Backspace", code: "Backspace", metaKey: true }))).toEqual({
      code: { kind: "Char", value: "u" },
      modifiers: MODIFIER_CONTROL,
    });
  });

  it("leaves every other Cmd combo to the native menu", () => {
    expect(macCmdTextKey(key({ key: "q", code: "KeyQ", metaKey: true }))).toBeNull();
    expect(macCmdTextKey(key({ key: "h", code: "KeyH", metaKey: true }))).toBeNull();
    expect(macCmdTextKey(key({ key: "ArrowLeft", code: "ArrowLeft", metaKey: true, shiftKey: true }))).toBeNull();
  });

  it("ignores presses without Cmd", () => {
    expect(macCmdTextKey(key({ key: "ArrowLeft", code: "ArrowLeft" }))).toBeNull();
  });
});
