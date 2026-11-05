// Status bar usage item + popover formatting (spec phase1.5 §7). Kept
// separate from `tests/unit/usage.test.ts` (Phase 1's `formatUsage` tests,
// left untouched) since these are new, additive exports.

import { describe, expect, it } from "vitest";
import {
  formatAsOfLabel,
  formatFiveHourPopoverRow,
  formatFiveHourStatusBarLabel,
  formatWeeklyPopoverRow,
  latestSession,
  sessionRows,
  todayCost,
  type SessionUsage,
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

function session(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return {
    updated_at: 0,
    model: "Opus",
    cost_usd: 1.5,
    lines_added: 10,
    lines_removed: 2,
    context_pct: 42.5,
    ...overrides,
  };
}

const epoch = (y: number, m: number, d: number, h: number) => Math.floor(new Date(y, m, d, h).getTime() / 1000);

describe("latestSession", () => {
  it("picks the newest updated_at and is null when absent or empty", () => {
    expect(latestSession(undefined)).toBeNull();
    expect(latestSession([])).toBeNull();
    const newest = session({ updated_at: 30, model: "new" });
    expect(latestSession([session({ updated_at: 10 }), newest, session({ updated_at: 20 })])).toBe(newest);
  });
});

describe("sessionRows", () => {
  it("formats cost, lines and context", () => {
    expect(sessionRows(session())).toEqual([
      { label: "Cost", value: "$1.50" },
      { label: "Lines", value: "+10 / -2" },
      { label: "Context", value: "42.5%" },
    ]);
  });

  it("leaves out absent facts", () => {
    expect(sessionRows(session({ cost_usd: null, lines_added: null, lines_removed: 4, context_pct: null }))).toEqual([
      { label: "Lines", value: "+0 / -4" },
    ]);
    expect(sessionRows(session({ cost_usd: null, lines_added: null, lines_removed: null, context_pct: null }))).toEqual(
      [],
    );
  });
});

describe("todayCost", () => {
  const now = epoch(2026, 5, 10, 15);

  it("sums only sessions updated on the local date of now", () => {
    const sessions = [
      session({ updated_at: epoch(2026, 5, 10, 0), cost_usd: 1 }),
      session({ updated_at: epoch(2026, 5, 10, 14), cost_usd: 2.5 }),
      session({ updated_at: epoch(2026, 5, 9, 23), cost_usd: 100 }),
      session({ updated_at: epoch(2026, 5, 10, 9), cost_usd: null }),
    ];
    expect(todayCost(sessions, now)).toBe(3.5);
  });

  it("is null with no sessions, no cost, or only other days", () => {
    expect(todayCost(undefined, now)).toBeNull();
    expect(todayCost([], now)).toBeNull();
    expect(todayCost([session({ updated_at: epoch(2026, 5, 10, 9), cost_usd: null })], now)).toBeNull();
    expect(todayCost([session({ updated_at: epoch(2026, 5, 8, 9) })], now)).toBeNull();
  });
});
