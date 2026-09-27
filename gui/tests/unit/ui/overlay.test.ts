// Direct unit coverage of `ui/overlay.ts`'s "one overlay open at a time"
// tracker, including the two additions from the UX pass 1 review:
// `escapableFromOutside` (finding #3, consumed by `keyboard/routing.ts`)
// and `onSupersededReopen` (finding #5, consumed by `ui/statusbar.ts`'s
// pinned agent popover). `keyboard/routing.test.ts` and
// `ui/agentPopover.test.ts` cover these at their real call sites; this file
// exercises the tracker itself in isolation.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeActiveOverlay,
  isActiveOverlayEscapableFromOutside,
  isOverlayOpen,
  notifyOverlayClosed,
  openOverlay,
} from "../../../src/ui/overlay";

afterEach(() => {
  closeActiveOverlay(); // never leak an open overlay into the next test
});

describe("openOverlay / closeActiveOverlay / isOverlayOpen", () => {
  it("is not open before anything registers", () => {
    expect(isOverlayOpen()).toBe(false);
  });

  it("opening registers it as open; closing disposes it and clears the flag", () => {
    const dispose = vi.fn();
    openOverlay(dispose);
    expect(isOverlayOpen()).toBe(true);
    closeActiveOverlay();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(isOverlayOpen()).toBe(false);
  });

  it("opening a second overlay disposes the first (supersedes it)", () => {
    const first = vi.fn();
    const second = vi.fn();
    openOverlay(first);
    openOverlay(second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(isOverlayOpen()).toBe(true);
  });

  it("notifyOverlayClosed lets a disposer that closed itself naturally clear the flag", () => {
    const dispose = vi.fn();
    openOverlay(dispose);
    notifyOverlayClosed(dispose);
    expect(isOverlayOpen()).toBe(false);
  });

  it("notifyOverlayClosed with a stale/mismatched disposer is a no-op", () => {
    const dispose = vi.fn();
    openOverlay(dispose);
    notifyOverlayClosed(vi.fn());
    expect(isOverlayOpen()).toBe(true);
  });

  it("closeActiveOverlay is a no-op when nothing is open", () => {
    expect(() => closeActiveOverlay()).not.toThrow();
  });
});

// Finding #3: an overlay may opt out of the central router's "Esc closes
// the open overlay even when focus never left the terminal" rule.
describe("isActiveOverlayEscapableFromOutside", () => {
  it("defaults to true (permissive) when nothing is open", () => {
    expect(isActiveOverlayEscapableFromOutside()).toBe(true);
  });

  it("defaults to true for an overlay opened with no options", () => {
    openOverlay(vi.fn());
    expect(isActiveOverlayEscapableFromOutside()).toBe(true);
  });

  it("is true when explicitly opted in", () => {
    openOverlay(vi.fn(), { escapableFromOutside: true });
    expect(isActiveOverlayEscapableFromOutside()).toBe(true);
  });

  it("is false for an overlay opened with escapableFromOutside: false", () => {
    openOverlay(vi.fn(), { escapableFromOutside: false });
    expect(isActiveOverlayEscapableFromOutside()).toBe(false);
  });

  it("reflects whichever overlay is currently active, not the first one opened", () => {
    openOverlay(vi.fn(), { escapableFromOutside: false });
    openOverlay(vi.fn()); // supersedes it, defaults to true
    expect(isActiveOverlayEscapableFromOutside()).toBe(true);
  });
});

// Finding #5: `onSupersededReopen` fires once the overlay that superseded
// this one itself later closes -- never immediately, and never for any
// other close reason.
describe("openOverlay onSupersededReopen", () => {
  it("does not fire when this overlay closes on its own (not superseded)", () => {
    const reopen = vi.fn();
    openOverlay(vi.fn(), { onSupersededReopen: reopen });
    closeActiveOverlay();
    expect(reopen).not.toHaveBeenCalled();
  });

  it("does not fire immediately when superseded -- only once the new overlay later closes", () => {
    const reopen = vi.fn();
    openOverlay(vi.fn(), { onSupersededReopen: reopen });
    openOverlay(vi.fn()); // supersedes the first
    expect(reopen).not.toHaveBeenCalled();
  });

  it("fires once the superseding overlay closes via closeActiveOverlay", () => {
    const reopen = vi.fn();
    openOverlay(vi.fn(), { onSupersededReopen: reopen });
    openOverlay(vi.fn());
    closeActiveOverlay();
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("fires once the superseding overlay closes via its own notifyOverlayClosed", () => {
    const reopen = vi.fn();
    openOverlay(vi.fn(), { onSupersededReopen: reopen });
    const secondDispose = vi.fn();
    openOverlay(secondDispose);
    notifyOverlayClosed(secondDispose);
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("survives a chain of supersedes (menu -> hover popover), firing once the whole stack empties", () => {
    const reopen = vi.fn();
    openOverlay(vi.fn(), { onSupersededReopen: reopen }); // e.g. the pinned popover
    openOverlay(vi.fn()); // e.g. a menu, which has no reopen of its own
    openOverlay(vi.fn()); // e.g. a hover popover superseding the menu
    expect(reopen).not.toHaveBeenCalled();
    closeActiveOverlay(); // the hover popover closes; nothing left open
    expect(reopen).toHaveBeenCalledTimes(1);
  });

  it("fires only once even if the stack empties more than once afterward", () => {
    const reopen = vi.fn();
    openOverlay(vi.fn(), { onSupersededReopen: reopen });
    openOverlay(vi.fn());
    closeActiveOverlay();
    expect(reopen).toHaveBeenCalledTimes(1);
    openOverlay(vi.fn());
    closeActiveOverlay();
    expect(reopen).toHaveBeenCalledTimes(1); // still just once
  });
});
