// @vitest-environment jsdom
//
// UX pass 1 spec §1 "[P0] Safe close-workspace confirm": Cancel -- never
// the destructive button -- has focus on open, so a bare Enter cancels;
// the destructive action needs an explicit click or a focus move (Tab)
// first. Plus §1's "Name what stops" agent list (5-line limit handled by
// the caller; this only renders whatever it's given).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerKeyboardCapture } from "../../../src/keyboard/focusCapture";
import { openConfirmPopover } from "../../../src/ui/confirmPopover";
import { openOverlay } from "../../../src/ui/overlay";

let root: HTMLDivElement;
let anchor: HTMLButtonElement;

beforeEach(() => {
  root = document.createElement("div");
  anchor = document.createElement("button");
  document.body.append(root, anchor);
});

afterEach(() => {
  root.remove();
  anchor.remove();
});

function open(overrides: Partial<Parameters<typeof openConfirmPopover>[2]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const dispose = openConfirmPopover(root, anchor, {
    titlePrefix: "Close ",
    titleName: "my-workspace",
    titleSuffix: "?",
    detail: "Stops 1 blocked agent.",
    confirmLabel: "Close",
    onConfirm,
    onCancel,
    ...overrides,
  });
  return { onConfirm, onCancel, dispose };
}

describe("openConfirmPopover (UX pass 1 spec §1)", () => {
  it("focuses Cancel on open, never the destructive button", () => {
    open();
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(document.activeElement?.classList.contains("btn--danger")).toBe(false);
  });

  it("a bare Enter (Cancel still focused) cancels, not confirms", () => {
    const { onConfirm, onCancel } = open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("the destructive action fires on an explicit click", () => {
    const { onConfirm, onCancel } = open();
    const danger = root.querySelector<HTMLButtonElement>(".btn--danger")!;
    danger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("the destructive action fires on Enter only after focus moves onto it (Tab)", () => {
    const { onConfirm, onCancel } = open();
    const danger = root.querySelector<HTMLButtonElement>(".btn--danger")!;
    danger.focus(); // simulates the effect of pressing Tab from Cancel
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("the destructive button keeps its red style", () => {
    open();
    const danger = root.querySelector<HTMLButtonElement>(".btn--danger")!;
    expect(danger.textContent).toBe("Close");
  });

  it("Escape cancels regardless of which button has focus", () => {
    const { onConfirm, onCancel } = open();
    root.querySelector<HTMLButtonElement>(".btn--danger")!.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders no agent-list section when agentLines is omitted", () => {
    open();
    expect(root.querySelector(".confirm-popover__agent-list")).toBeNull();
  });

  it("renders one line per agent, with a status dot and '<tab> · <agent>' text", () => {
    open({
      agentLines: {
        lines: [
          { status: "blocked", tabLabel: "review", agentName: "claude" },
          { status: "working", tabLabel: "build", agentName: "codex" },
        ],
        overflow: 0,
      },
    });
    const lines = root.querySelectorAll(".confirm-popover__agent-line");
    expect(lines).toHaveLength(2);
    expect(lines[0].querySelector(".status-dot--blocked")).not.toBeNull();
    expect(lines[0].textContent).toContain("review · claude");
    expect(lines[1].textContent).toContain("build · codex");
    expect(root.querySelector(".confirm-popover__agent-more")).toBeNull();
  });

  // MAJOR P0 (UX pass 1 review, `confirmPopover.ts:155-170`): `openOverlay`
  // must close any *other* already-open overlay (e.g. a pinned agent
  // popover) *before* Cancel is focused, not after -- that overlay's own
  // `dispose()` returns focus to the terminal capture, which used to run
  // second and steal focus right back off Cancel, leaving a bare Enter on
  // open reach the terminal instead of cancelling.
  it("Cancel keeps focus even when another overlay (e.g. a pinned agent popover) was open, and Enter still cancels", () => {
    const captureEl = document.createElement("textarea");
    document.body.appendChild(captureEl);
    registerKeyboardCapture(captureEl);
    // Stands in for the pinned agent popover's own `dispose()` (`ui/
    // statusbar.ts`), which calls `focusKeyboardCapture()` on close.
    const otherOverlayDispose = vi.fn(() => captureEl.focus());
    openOverlay(otherOverlayDispose);

    const { onConfirm, onCancel } = open();

    expect(otherOverlayDispose).toHaveBeenCalledTimes(1); // closed by openConfirmPopover
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(document.activeElement).not.toBe(captureEl);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    captureEl.remove();
  });

  it("renders an 'and N more' line when overflow > 0", () => {
    open({
      agentLines: {
        lines: [{ status: "blocked", tabLabel: "review", agentName: "claude" }],
        overflow: 3,
      },
    });
    expect(root.querySelector(".confirm-popover__agent-more")?.textContent).toBe("and 3 more");
  });
});
