// @vitest-environment jsdom
//
// Status bar usage item + popover formatting (spec phase1.5 §7). Kept
// separate from `tests/unit/usage.test.ts` (Phase 1's `formatUsage` tests,
// left untouched) since these are new, additive exports.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderUsageBarNow, wireUsageRefresh } from "../../src/appStatusBar";
import type { RawSnapshot } from "../../src/appTypes";
import { publishSnapshot } from "../../src/snapshotBus";
import {
  formatAsOfLabel,
  formatContextRow,
  formatCostRow,
  formatFiveHourPopoverRow,
  formatFiveHourStatusBarLabel,
  formatLinesRow,
  formatSessionHeader,
  formatTokens,
  formatWeeklyPopoverRow,
  sessionForPane,
  type SessionUsage,
} from "../../src/usage";

// `renderUsageBarNow` pulls in the whole chrome bootstrap; mock all of it but the snapshot bus.
const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  appState: { snapshot: null as unknown, usagePayload: null as unknown },
}));
vi.mock("../../src/ui/statusbar", () => ({ renderUsageStatusItem: mocks.render }));
vi.mock("../../src/appState", () => ({
  appState: mocks.appState,
  highlightCards: {},
  hoveredHighlightPaneIds: new Set(),
  persistSettings: vi.fn(),
  seenDoneTabs: {},
  statusAge: {},
}));
vi.mock("../../src/appDom", () => ({ overlayRoot: {}, statusAgentCountsEl: {}, statusConnectionEl: {}, statusUsageEl: {} }));
vi.mock("../../src/appApi", () => ({ api: vi.fn() }));
vi.mock("../../src/appConnectionGuard", () => ({ requireConnected: vi.fn() }));
vi.mock("../../src/appLookups", () => ({ currentThemeDef: vi.fn(), tabLabel: vi.fn(), workspaceLabel: vi.fn() }));
vi.mock("../../src/macShell", () => ({ syncDockBadge: vi.fn() }));
vi.mock("../../src/wizard/usageSetup", () => ({ openUsageSetup: vi.fn() }));

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
    session_id: "s",
    pane_id: null,
    captured_at: null,
    cwd: null,
    model: { display_name: null },
    effort_level: null,
    fast_mode: null,
    context: { used_pct: null, size: null },
    cost: { usd: null, duration_ms: null, api_duration_ms: null, lines_added: null, lines_removed: null },
    ...overrides,
  };
}

describe("sessionForPane", () => {
  it("prefers the exact pane over a newer session", () => {
    const sessions = [
      session({ session_id: "a", pane_id: "w1:p1", captured_at: 10 }),
      session({ session_id: "b", pane_id: "w1:p2", captured_at: 99 }),
    ];
    const match = sessionForPane(sessions, "w1:p1", null);
    expect(match?.kind).toBe("pane");
    expect(match?.session.session_id).toBe("a");
  });

  it("takes the newest of two sessions in the same pane", () => {
    const sessions = [
      session({ session_id: "old", pane_id: "w1:p1", captured_at: 10 }),
      session({ session_id: "new", pane_id: "w1:p1", captured_at: 20 }),
    ];
    expect(sessionForPane(sessions, "w1:p1", null)?.session.session_id).toBe("new");
  });

  it("falls back to a unique normalized cwd", () => {
    const sessions = [
      session({ session_id: "a", cwd: "C:\\Repo\\App\\", captured_at: 1 }),
      session({ session_id: "b", cwd: "/other", captured_at: 2 }),
    ];
    const match = sessionForPane(sessions, "w1:p9", "c:/repo/app");
    expect(match?.kind).toBe("cwd");
    expect(match?.session.session_id).toBe("a");
  });

  it("falls back to the newest session when the cwd is ambiguous", () => {
    const sessions = [
      session({ session_id: "a", cwd: "/x", captured_at: 1 }),
      session({ session_id: "b", cwd: "/x", captured_at: 2 }),
    ];
    const match = sessionForPane(sessions, "w1:p9", "/x");
    expect(match?.kind).toBe("latest");
    expect(match?.session.session_id).toBe("b");
  });

  it("works with a null pane id and a null cwd", () => {
    const match = sessionForPane([session({ session_id: "a", captured_at: 1 })], null, null);
    expect(match?.kind).toBe("latest");
  });

  it("is null with no sessions", () => {
    expect(sessionForPane([], "w1:p1", "/x")).toBeNull();
  });
});

describe("session formatters", () => {
  const cost = { usd: null, duration_ms: null, api_duration_ms: null, lines_added: null, lines_removed: null };

  it("formatTokens", () => {
    expect(formatTokens(200_000)).toBe("200k");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(999)).toBe("999");
  });

  it("formatContextRow", () => {
    expect(formatContextRow({ used_pct: null, size: null })).toBe("–");
    expect(formatContextRow({ used_pct: null, size: 200_000 })).toBe("–");
    expect(formatContextRow({ used_pct: 42, size: null })).toBe("42%");
    expect(formatContextRow({ used_pct: 42, size: 200_000 })).toBe("42% of 200k");
  });

  it("formatCostRow", () => {
    expect(formatCostRow({ ...cost, usd: 1.234, duration_ms: 47 * 60_000, api_duration_ms: 18 * 60_000 })).toBe(
      "$1.23 · 47m (api 18m)",
    );
    expect(formatCostRow({ ...cost, usd: 1.5 })).toBe("$1.50");
    expect(formatCostRow({ ...cost, duration_ms: 60_000 })).toBe("1m");
    expect(formatCostRow(cost)).toBeNull();
  });

  it("formatLinesRow", () => {
    expect(formatLinesRow({ ...cost, lines_added: 312, lines_removed: 88 })).toBe("+312 −88");
    expect(formatLinesRow({ ...cost, lines_added: 5 })).toBe("+5 −0");
    expect(formatLinesRow(cost)).toBeNull();
  });

  it("formatSessionHeader", () => {
    expect(formatSessionHeader({ session: session(), kind: "pane" })).toBe("THIS PANE");
    expect(formatSessionHeader({ session: session(), kind: "cwd" })).toBe("LAST ACTIVE SESSION");
    expect(formatSessionHeader({ session: session(), kind: "latest" })).toBe("LAST ACTIVE SESSION");
  });
});

describe("renderUsageBarNow feeds the focused pane's session to the status item", () => {
  const sessions = [
    session({ session_id: "a", pane_id: "w1:p1", captured_at: 10 }),
    session({ session_id: "b", pane_id: "w1:p2", captured_at: 20 }),
  ];
  const snapshot = (focused: string): RawSnapshot =>
    ({
      focused_pane_id: focused,
      panes: [
        { pane_id: "w1:p1", cwd: null, foreground_cwd: null },
        { pane_id: "w1:p2", cwd: null, foreground_cwd: null },
      ],
    }) as unknown as RawSnapshot;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.render.mockClear();
    mocks.appState.usagePayload = { five_hour: null, seven_day: null, captured_at: 5, status: "ok", sessions };
    mocks.appState.snapshot = snapshot("w1:p1");
  });
  afterEach(() => vi.useRealTimers());

  it("passes sessions and the matched session", () => {
    renderUsageBarNow();
    const passed = mocks.render.mock.calls[0][2];
    expect(passed.sessions).toBe(sessions);
    expect(passed.session.kind).toBe("pane");
    expect(passed.session.session.session_id).toBe("a");
    expect(passed.captured_at).toBe(5);
  });

  it("re-renders on a snapshot only when the focused pane changes", () => {
    wireUsageRefresh();
    mocks.render.mockClear();
    publishSnapshot(snapshot("w1:p1"));
    expect(mocks.render).toHaveBeenCalledTimes(1); // first snapshot
    publishSnapshot(snapshot("w1:p1"));
    expect(mocks.render).toHaveBeenCalledTimes(1); // same focus
    mocks.appState.snapshot = snapshot("w1:p2");
    publishSnapshot(snapshot("w1:p2"));
    expect(mocks.render).toHaveBeenCalledTimes(2);
    expect(mocks.render.mock.calls[1][2].session.session.session_id).toBe("b");
  });
});
