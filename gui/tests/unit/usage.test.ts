import { describe, expect, it } from "vitest";
import type { UsageState } from "../../src/usage";
import {
  USAGE_STALE_SECONDS,
  addUsageSample,
  formatBurnEta,
  formatUsage,
  isUsageStale, usageColor,
  worstActivePct,
} from "../../src/usage";

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

describe("worstActivePct", () => {
  it("is the higher of two active (not-yet-reset) windows", () => {
    const state: UsageState = {
      five_hour: { used_pct: 40, resets_at: NOW + 3600 },
      seven_day: { used_pct: 95, resets_at: NOW + 3600 },
      captured_at: NOW,
      status: "ok",
    };
    expect(worstActivePct(state, NOW)).toBe(95);
  });

  it("excludes a window that has already reset from the worst-case colour", () => {
    // Code review finding #11: a window past its resets_at displays as
    // "-- (reset)" and must not still drive the danger/warning colour.
    const state: UsageState = {
      five_hour: { used_pct: 99, resets_at: NOW - 1 }, // reset, ignored
      seven_day: { used_pct: 20, resets_at: NOW + 3600 }, // active
      captured_at: NOW,
      status: "ok",
    };
    expect(worstActivePct(state, NOW)).toBe(20);
  });

  it("is 0 when every window is absent or has reset", () => {
    const state: UsageState = {
      five_hour: { used_pct: 99, resets_at: NOW - 1 },
      seven_day: null,
      captured_at: NOW,
      status: "ok",
    };
    expect(worstActivePct(state, NOW)).toBe(0);
  });
});

describe("isUsageStale", () => {
  it("is fresh at exactly the threshold and stale just after", () => {
    expect(isUsageStale(NOW - USAGE_STALE_SECONDS, NOW)).toBe(false);
    expect(isUsageStale(NOW - USAGE_STALE_SECONDS - 1, NOW)).toBe(true);
  });

  it("is not stale without captured_at", () => {
    expect(isUsageStale(null, NOW)).toBe(false);
  });
});

describe("burn-rate ETA", () => {
  const window = { used_pct: 20, resets_at: NOW + 5 * 3600 };

  it("projects 100% from two samples", () => {
    // 10% -> 20% in 10 minutes = 1% per minute; 80% left = 80 minutes.
    let samples = addUsageSample([], NOW - 600, 10);
    samples = addUsageSample(samples, NOW, 20);
    expect(formatBurnEta(samples, window, NOW)).toBe("at this pace: 100% in ~1h20m");
  });

  it("shows nothing for flat usage", () => {
    let samples = addUsageSample([], NOW - 600, 20);
    samples = addUsageSample(samples, NOW, 20);
    expect(formatBurnEta(samples, window, NOW)).toBeNull();
  });

  it("shows nothing when 100% would land after the window resets", () => {
    let samples = addUsageSample([], NOW - 600, 10);
    samples = addUsageSample(samples, NOW, 20);
    expect(formatBurnEta(samples, { ...window, resets_at: NOW + 3600 }, NOW)).toBeNull();
  });

  it("shows nothing with one sample or a span under 2 minutes", () => {
    expect(formatBurnEta(addUsageSample([], NOW, 20), window, NOW)).toBeNull();
    let samples = addUsageSample([], NOW - 119, 10);
    samples = addUsageSample(samples, NOW, 20);
    expect(formatBurnEta(samples, window, NOW)).toBeNull();
  });

  it("ignores a duplicate or older captured_at", () => {
    const samples = addUsageSample([], NOW, 20);
    expect(addUsageSample(samples, NOW, 25)).toBe(samples);
    expect(addUsageSample(samples, NOW - 5, 25)).toBe(samples);
  });

  it("clears the samples when usage decreases (window reset)", () => {
    let samples = addUsageSample([], NOW - 600, 80);
    samples = addUsageSample(samples, NOW, 3);
    expect(samples).toEqual([{ t: NOW, pct: 3 }]);
  });

  it("keeps only the newest 12 samples", () => {
    let samples: ReturnType<typeof addUsageSample> = [];
    for (let i = 0; i < 20; i++) samples = addUsageSample(samples, NOW + i, i);
    expect(samples).toHaveLength(12);
    expect(samples[0].t).toBe(NOW + 8);
  });
});
