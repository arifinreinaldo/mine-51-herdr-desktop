// @vitest-environment jsdom
//
// Finding #10 "usage popover works only once": each re-render of the
// persistent `#status-usage` element (~every 30s, and on every `usage`
// event) used to add a *fresh* set of listeners with their own
// independent, never-reset `closePopover` closure variable, so the popover
// could only ever be opened+closed successfully via the very first set of
// listeners -- every later attempt's `if (closePopover) return;` guard was
// already stuck non-null. These tests exercise the fix against a real
// (jsdom) DOM and real timers, since the bug is specifically about
// listener accumulation across repeated calls and closure state, which a
// plain-object fake can't reproduce.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderUsageStatusItem } from "../../../src/ui/statusbar";
import type { UsageState } from "../../../src/usage";

const NOW = 1_000_000;

function usage(overrides: Partial<UsageState> = {}): UsageState {
  return {
    five_hour: { used_pct: 15, resets_at: NOW + 5940 },
    seven_day: { used_pct: 6, resets_at: NOW + 100_000 },
    captured_at: NOW - 60,
    status: "ok",
    ...overrides,
  };
}

let el: HTMLDivElement;
let overlayRoot: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  el = document.createElement("div");
  overlayRoot = document.createElement("div");
  document.body.append(el, overlayRoot);
});

afterEach(() => {
  vi.useRealTimers();
  el.remove();
  overlayRoot.remove();
});

function popoverCount(): number {
  return overlayRoot.querySelectorAll(".usage-popover").length;
}

describe("renderUsageStatusItem: open/close across many re-renders (finding #10)", () => {
  it("opens on hover, closes on leave, and can open again after several re-renders", () => {
    renderUsageStatusItem(el, overlayRoot, usage(), NOW);
    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.runAllTimers();
    expect(popoverCount()).toBe(1);

    el.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(150);
    expect(popoverCount()).toBe(0);

    // Simulate the ~30s refresh tick re-rendering the same element several
    // times in between -- this must not corrupt the wiring.
    renderUsageStatusItem(el, overlayRoot, usage(), NOW + 30);
    renderUsageStatusItem(el, overlayRoot, usage(), NOW + 60);
    renderUsageStatusItem(el, overlayRoot, usage(), NOW + 90);

    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.runAllTimers();
    expect(popoverCount()).toBe(1); // must still open -- the pre-fix bug made this a no-op
  });

  it("re-rendering does not accumulate duplicate listeners (opening twice never opens two popovers)", () => {
    for (let i = 0; i < 5; i++) renderUsageStatusItem(el, overlayRoot, usage(), NOW + i);
    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.runAllTimers();
    expect(popoverCount()).toBe(1);
  });

  it("closes 150ms after the pointer leaves the item, even without entering the popover", () => {
    renderUsageStatusItem(el, overlayRoot, usage(), NOW);
    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.runAllTimers();
    expect(popoverCount()).toBe(1);

    el.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(149);
    expect(popoverCount()).toBe(1); // not yet
    vi.advanceTimersByTime(1);
    expect(popoverCount()).toBe(0);
  });

  it("does not close if the pointer enters the popover before the 150ms leave timer fires", () => {
    renderUsageStatusItem(el, overlayRoot, usage(), NOW);
    el.dispatchEvent(new MouseEvent("mouseenter"));
    vi.runAllTimers();
    const popover = overlayRoot.querySelector(".usage-popover")!;

    el.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(100);
    popover.dispatchEvent(new MouseEvent("mouseenter")); // entered the popover in time
    vi.advanceTimersByTime(200);
    expect(popoverCount()).toBe(1);

    popover.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(150);
    expect(popoverCount()).toBe(0);
  });

  it("keyboard focus opens the popover and blur closes it", () => {
    renderUsageStatusItem(el, overlayRoot, usage(), NOW);
    el.dispatchEvent(new FocusEvent("focus"));
    expect(popoverCount()).toBe(1);

    el.dispatchEvent(new FocusEvent("blur"));
    expect(popoverCount()).toBe(0);
  });

  it("click toggles the popover open and closed, repeatedly", () => {
    renderUsageStatusItem(el, overlayRoot, usage(), NOW);
    el.dispatchEvent(new MouseEvent("click"));
    expect(popoverCount()).toBe(1);
    el.dispatchEvent(new MouseEvent("click"));
    expect(popoverCount()).toBe(0);
    el.dispatchEvent(new MouseEvent("click"));
    expect(popoverCount()).toBe(1);
    el.dispatchEvent(new MouseEvent("click"));
    expect(popoverCount()).toBe(0);
  });
});
