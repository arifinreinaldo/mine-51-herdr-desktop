import { describe, expect, it } from "vitest";
import { LAST_FOCUS_SHORTCUT_DIGIT, resolveIndexForShortcut } from "../../../src/workspace/focusByIndex";

describe("resolveIndexForShortcut", () => {
  it("maps 1..8 to fixed 0-based positions", () => {
    for (let n = 1; n <= 8; n++) {
      expect(resolveIndexForShortcut(n, 8)).toBe(n - 1);
    }
  });

  it("9 always means the last item, whatever the count", () => {
    expect(resolveIndexForShortcut(LAST_FOCUS_SHORTCUT_DIGIT, 5)).toBe(4);
    expect(resolveIndexForShortcut(LAST_FOCUS_SHORTCUT_DIGIT, 1)).toBe(0);
    expect(resolveIndexForShortcut(LAST_FOCUS_SHORTCUT_DIGIT, 20)).toBe(19);
  });

  it("a fixed position beyond the list's length is out of range (undefined)", () => {
    // Only 3 tabs open: Alt+5 has nothing to focus.
    expect(resolveIndexForShortcut(5, 3)).toBeUndefined();
  });

  it("9 (last) with an empty list is out of range (undefined), not index -1", () => {
    expect(resolveIndexForShortcut(9, 0)).toBeUndefined();
  });

  it("a fixed position with an empty list is out of range", () => {
    expect(resolveIndexForShortcut(1, 0)).toBeUndefined();
  });

  it("n outside 1-9 is always out of range", () => {
    expect(resolveIndexForShortcut(0, 10)).toBeUndefined();
    expect(resolveIndexForShortcut(10, 10)).toBeUndefined();
  });

  it("last (9) and its own fixed position agree when the list has exactly 9 items", () => {
    expect(resolveIndexForShortcut(9, 9)).toBe(8);
  });

  it("with exactly 8 items, Alt+8 and Alt+9 (last) resolve to the same index", () => {
    expect(resolveIndexForShortcut(8, 8)).toBe(7);
    expect(resolveIndexForShortcut(9, 8)).toBe(7);
  });
});
