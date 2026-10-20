import { describe, expect, it } from "vitest";
import { createDoubleShiftTracker, type ShiftKeyLike } from "../../../src/keyboard/doubleShift";

function key(code: string, overrides: Partial<ShiftKeyLike> = {}): ShiftKeyLike {
  return { code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, ...overrides };
}
const shift = (overrides: Partial<ShiftKeyLike> = {}) => key("ShiftLeft", overrides);

describe("createDoubleShiftTracker", () => {
  it("fires on a fast second tap, either Shift key", () => {
    const t = createDoubleShiftTracker();
    expect(t.keydown(shift(), 0)).toBe(false);
    t.keyup(shift(), 80);
    expect(t.keydown(key("ShiftRight"), 200)).toBe(true);
  });

  it("does not fire when the second tap is outside the window", () => {
    const t = createDoubleShiftTracker();
    t.keydown(shift(), 0);
    t.keyup(shift(), 80);
    expect(t.keydown(shift(), 600)).toBe(false);
  });

  it("does not fire after a long hold", () => {
    const t = createDoubleShiftTracker();
    t.keydown(shift(), 0);
    expect(t.keydown(shift({ repeat: true }), 300)).toBe(false);
    t.keyup(shift(), 500);
    expect(t.keydown(shift(), 600)).toBe(false);
  });

  it("W7 misfire 1: a key pressed while Shift is held cancels", () => {
    const t = createDoubleShiftTracker();
    t.keydown(shift(), 0);
    expect(t.keydown(key("KeyH"), 20)).toBe(false);
    t.keyup(shift(), 50);
    expect(t.keydown(shift(), 300)).toBe(false);
  });

  it("W7 misfire 2: a key between the taps cancels", () => {
    const t = createDoubleShiftTracker();
    t.keydown(shift(), 0);
    t.keyup(shift(), 30);
    expect(t.keydown(key("KeyH"), 60)).toBe(false);
    expect(t.keydown(shift(), 100)).toBe(false);
  });

  it("does not fire on a repeat event as the second press", () => {
    const t = createDoubleShiftTracker();
    t.keydown(shift(), 0);
    t.keyup(shift(), 50);
    expect(t.keydown(shift({ repeat: true }), 100)).toBe(false);
  });

  it("does not fire with Ctrl held", () => {
    const t = createDoubleShiftTracker();
    t.keydown(shift({ ctrlKey: true }), 0);
    t.keyup(shift({ ctrlKey: true }), 50);
    expect(t.keydown(shift({ ctrlKey: true }), 100)).toBe(false);
  });

  it("does not fire after cancel() between the taps", () => {
    const t = createDoubleShiftTracker();
    t.keydown(shift(), 0);
    t.keyup(shift(), 50);
    t.cancel();
    expect(t.keydown(shift(), 100)).toBe(false);
  });

  it("fires once on a triple tap", () => {
    const t = createDoubleShiftTracker();
    const fired: boolean[] = [];
    for (const at of [0, 100, 200]) {
      fired.push(t.keydown(shift(), at));
      t.keyup(shift(), at + 40);
    }
    expect(fired).toEqual([false, true, false]);
  });
});
