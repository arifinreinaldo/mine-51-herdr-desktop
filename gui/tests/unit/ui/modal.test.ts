// @vitest-environment jsdom
//
// `openModal`'s aria-modal focus trap. jsdom does not move focus on Tab, so
// these tests check the initial focus, the two wrap edges and the focus
// return. The Tab order between inner controls stays the browser's.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { focusKeyboardCapture, registerKeyboardCapture } from "../../../src/keyboard/focusCapture";
import { openModal } from "../../../src/ui/modal";
import { closeActiveOverlay, openOverlay } from "../../../src/ui/overlay";

let captureEl: HTMLTextAreaElement;

beforeEach(() => {
  document.body.innerHTML = "";
  captureEl = document.createElement("textarea");
  document.body.appendChild(captureEl);
  registerKeyboardCapture(captureEl);
  captureEl.focus();
});

afterEach(() => {
  closeActiveOverlay(); // never leak an open modal into the next test
});

/** Dispatches a keydown at the focused element, like a real key press. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

function openWithButtons(): { modal: HTMLElement; first: HTMLButtonElement; last: HTMLButtonElement } {
  const first = document.createElement("button");
  first.textContent = "Cancel";
  const last = document.createElement("button");
  last.textContent = "OK";
  openModal("Test", (body) => body.append(first, last));
  return { modal: document.querySelector<HTMLElement>(".modal")!, first, last };
}

describe("openModal focus trap", () => {
  it("moves focus from the terminal capture into the dialog on open", () => {
    const { modal } = openWithButtons();
    expect(document.activeElement).toBe(modal);
  });

  it("keeps the focus when the overlay it supersedes returns focus to the capture", () => {
    openOverlay(() => focusKeyboardCapture()); // like a popover's disposer (statusbar.ts)
    const { modal } = openWithButtons();
    expect(document.activeElement).toBe(modal);
  });

  it("Tab on the last control wraps to the first", () => {
    const { first, last } = openWithButtons();
    last.focus();
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab on the first control wraps to the last", () => {
    const { first, last } = openWithButtons();
    first.focus();
    expect(press("Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("Tab from the dialog itself goes to the first control, Shift+Tab to the last", () => {
    const { modal, first, last } = openWithButtons();
    press("Tab");
    expect(document.activeElement).toBe(first);
    modal.focus();
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("leaves Tab between two inner controls to the browser", () => {
    const { first } = openWithButtons();
    first.focus();
    expect(press("Tab").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);
  });

  it("skips a disabled control", () => {
    const { first, last } = openWithButtons();
    last.disabled = true;
    first.focus();
    expect(press("Tab").defaultPrevented).toBe(true); // first is also the last stop
    expect(document.activeElement).toBe(first);
  });

  it("keeps focus on a dialog with no controls", () => {
    openModal("About", (body) => body.append("text only"));
    const modal = document.querySelector<HTMLElement>(".modal")!;
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(modal);
  });

  it("leaves Ctrl+Tab alone: it is the Next Tab shortcut", () => {
    const { last } = openWithButtons();
    last.focus();
    expect(press("Tab", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it("Esc closes the dialog and returns focus to the terminal capture", () => {
    openWithButtons();
    press("Escape");
    expect(document.querySelector(".modal")).toBeNull();
    expect(document.activeElement).toBe(captureEl);
  });
});
