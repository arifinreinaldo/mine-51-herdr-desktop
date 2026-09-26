import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "../../src/debounce";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Finding #7 "in TS debounce (150ms)": several near-simultaneous settings
// mutations must coalesce into one `settings_set` call, not one per change.
describe("debounce", () => {
  it("coalesces several rapid calls into one, after the delay", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls again after a later, separate burst", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    debounced();
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("passes through the arguments of the last call", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced("a");
    debounced("b");
    debounced("c");
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });

  it("resets the timer on every call within the window", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 150);
    debounced();
    vi.advanceTimersByTime(100);
    debounced(); // resets the 150ms window
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled(); // only 200ms since the first call, but 100ms since the second
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
