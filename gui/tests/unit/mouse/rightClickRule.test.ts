import { describe, expect, it } from "vitest";
import { shouldForwardRightClickToApp } from "../../../src/mouse/rightClickRule";

describe("shouldForwardRightClickToApp", () => {
  it("forwards only when mouse-reporting, passthrough is on, and no modifiers are held", () => {
    expect(shouldForwardRightClickToApp(true, true, 0)).toBe(true);
  });

  it("never forwards without mouse reporting, regardless of passthrough", () => {
    expect(shouldForwardRightClickToApp(false, true, 0)).toBe(false);
  });

  it("never forwards without right_click_passthrough set", () => {
    expect(shouldForwardRightClickToApp(true, false, 0)).toBe(false);
  });

  it("never forwards with any modifier held, even with passthrough on", () => {
    expect(shouldForwardRightClickToApp(true, true, 1)).toBe(false);
    expect(shouldForwardRightClickToApp(true, true, 2)).toBe(false);
  });
});
