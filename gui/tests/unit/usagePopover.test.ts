// Status bar usage item + popover formatting (spec phase1.5 §7). Kept
// separate from `tests/unit/usage.test.ts` (Phase 1's `formatUsage` tests,
// left untouched) since these are new, additive exports.

import { describe, expect, it } from "vitest";
import {
  formatAsOfLabel,
  formatFiveHourPopoverRow,
  formatFiveHourStatusBarLabel,
  formatWeeklyPopoverRow,
} from "../../src/usage";

const NOW = 1_000_000;

describe("formatFiveHourStatusBarLabel", () => {
  it("formats percent and remaining time", () => {
    expect(formatFiveHourStatusBarLabel({ used_pct: 15, resets_at: NOW + 5940 }, NOW)).toBe(
      "15% · 1h39m left",
    );
  });

  it("shows (reset) once the window has passed", () => {
    expect(formatFiveHourStatusBarLabel({ used_pct: 15, resets_at: NOW - 1 }, NOW)).toBe("-- (reset)");
  });

  it("is null with no window", () => {
    expect(formatFiveHourStatusBarLabel(null, NOW)).toBeNull();
  });
});

describe("formatFiveHourPopoverRow", () => {
  it('matches "15% · resets in 1h39m"', () => {
    expect(formatFiveHourPopoverRow({ used_pct: 15, resets_at: NOW + 5940 }, NOW)).toBe(
      "15% · resets in 1h39m",
    );
  });
});

describe("formatWeeklyPopoverRow", () => {
  it('matches "6% · resets <weekday> HH:MM" in local time', () => {
    const resetsAt = Math.floor(new Date(2026, 0, 10, 8, 0, 0).getTime() / 1000); // a Saturday
    const row = formatWeeklyPopoverRow({ used_pct: 6, resets_at: resetsAt }, NOW);
    expect(row).toBe("6% · resets Sat 08:00");
  });

  it("is null with no window", () => {
    expect(formatWeeklyPopoverRow(null, NOW)).toBeNull();
  });
});

describe("formatAsOfLabel", () => {
  it('matches "as of N m ago"', () => {
    expect(formatAsOfLabel(NOW - 180, NOW)).toBe("as of 3m ago");
  });

  it("is null with no captured_at", () => {
    expect(formatAsOfLabel(null, NOW)).toBeNull();
  });
});
