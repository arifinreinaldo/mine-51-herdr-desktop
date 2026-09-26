import { describe, expect, it } from "vitest";
import type { UsageState } from "../../src/usage";
import { formatUsage, usageColor } from "../../src/usage";

const NOW = 1_790_400_000; // arbitrary fixed "now" for deterministic tests

describe("usageColor", () => {
  it("is normal below 70", () => {
    expect(usageColor(0)).toBe("normal");
    expect(usageColor(69.9)).toBe("normal");
  });

  it("is warning from 70 up to (not including) 90", () => {
    expect(usageColor(70)).toBe("warning");
    expect(usageColor(89.9)).toBe("warning");
  });

  it("is danger at 90 and above", () => {
    expect(usageColor(90)).toBe("danger");
    expect(usageColor(100)).toBe("danger");
  });
});

describe("formatUsage", () => {
  it("formats the full sample with both windows and an 'as of' label", () => {
    const state: UsageState = {
      five_hour: { used_pct: 14, resets_at: NOW + 2 * 3600 },
      seven_day: { used_pct: 1, resets_at: NOW + 100 * 3600 },
      captured_at: NOW - 3 * 60,
      status: "ok",
    };
    const text = formatUsage(state, NOW);
    expect(text).toContain("5h 14%");
    expect(text).toContain("7d 1%");
    expect(text).toContain("as of 3m ago");
  });

  it("shows a window with a past resets_at as '5h -- (reset)'", () => {
    const state: UsageState = {
      five_hour: { used_pct: 50, resets_at: NOW - 1 },
      seven_day: null,
      captured_at: NOW,
      status: "ok",
    };
    expect(formatUsage(state, NOW)).toContain("5h -- (reset)");
  });

  it("omits a window that is absent", () => {
    const state: UsageState = {
      five_hour: { used_pct: 10, resets_at: NOW + 3600 },
      seven_day: null,
      captured_at: NOW,
      status: "ok",
    };
    expect(formatUsage(state, NOW)).not.toContain("7d");
  });

  it("status Missing shows the waiting message", () => {
    const state: UsageState = { five_hour: null, seven_day: null, captured_at: null, status: "missing" };
    expect(formatUsage(state, NOW)).toBe("Claude usage: waiting for a Claude Code session");
  });

  it("status Invalid shows the unreadable-file message", () => {
    const state: UsageState = { five_hour: null, seven_day: null, captured_at: null, status: "invalid" };
    expect(formatUsage(state, NOW)).toBe("Claude usage: unreadable file");
  });
});
