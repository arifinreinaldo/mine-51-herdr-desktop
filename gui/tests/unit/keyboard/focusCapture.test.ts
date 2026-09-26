// @vitest-environment jsdom
//
// Finding #3 "focus after chrome interactions": a shared helper so every
// chrome widget that closes/completes (a tab click, a menu, a popover, a
// modal, a confirm popover, a sidebar row click) can return keyboard focus
// to the terminal capture, without stealing it from an active inline
// rename input.

import { beforeEach, describe, expect, it } from "vitest";
import { focusKeyboardCapture, keyboardCaptureReturnTarget, registerKeyboardCapture } from "../../../src/keyboard/focusCapture";

let capture: HTMLTextAreaElement;

beforeEach(() => {
  capture = document.createElement("textarea");
  document.body.appendChild(capture);
  registerKeyboardCapture(capture);
});

describe("focusKeyboardCapture", () => {
  it("moves focus to the registered capture element", () => {
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.focus();
    expect(document.activeElement).toBe(other);

    focusKeyboardCapture();
    expect(document.activeElement).toBe(capture);
    other.remove();
  });

  it("does not steal focus from an active inline rename input", () => {
    const input = document.createElement("input");
    input.className = "tab-rename-input";
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    focusKeyboardCapture();
    expect(document.activeElement).toBe(input); // unchanged
    input.remove();
  });

  it("is a no-op before any capture element is registered", () => {
    registerKeyboardCapture(null as unknown as HTMLElement);
    expect(() => focusKeyboardCapture()).not.toThrow();
  });
});

describe("keyboardCaptureReturnTarget", () => {
  it("returns the capture element normally", () => {
    expect(keyboardCaptureReturnTarget()).toBe(capture);
  });

  it("returns undefined while an inline rename input has focus", () => {
    const input = document.createElement("input");
    input.className = "tab-rename-input";
    document.body.appendChild(input);
    input.focus();
    expect(keyboardCaptureReturnTarget()).toBeUndefined();
    input.remove();
  });
});
