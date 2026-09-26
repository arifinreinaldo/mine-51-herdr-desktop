// Usage bar formatting (spec §6 "Usage bar"). Distinct from the Rust
// backend's `usage.rs`, which *parses* `~/.claude/herdr-usage.json` into a
// `UsageState`; this module only *formats* an already-parsed state (received
// from the backend as a JSON event) for display. Stubbed: formatting is
// application logic, left for the implementer.

export interface UsageWindow {
  used_pct: number;
  /** Unix epoch seconds. */
  resets_at: number;
}

export interface UsageState {
  five_hour: UsageWindow | null;
  seven_day: UsageWindow | null;
  /** Unix epoch seconds. */
  captured_at: number | null;
  status: "ok" | "missing" | "invalid";
}

export type UsageColor = "normal" | "warning" | "danger";

/** Spec §6: "< 70 normal, 70-89 warning, >= 90 danger." */
export function usageColor(usedPct: number): UsageColor {
  if (usedPct >= 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "normal";
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

/** Local time, not UTC (code review finding #11): the user reads this
 * against their own wall clock, not the server's. */
function formatClockTime(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${weekday} ${hh}:${mm}`;
}

function formatWindow(label: string, window: UsageWindow, now: number): string {
  if (window.resets_at < now) {
    return `${label} -- (reset)`;
  }
  const remaining = window.resets_at - now;
  const resetLabel = label === "5h" ? formatDuration(remaining) : formatClockTime(window.resets_at);
  return `${label} ${formatPct(window.used_pct)}% · resets ${resetLabel}`;
}

function formatPct(pct: number): string {
  return Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 10) / 10);
}

function formatAgo(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h ago` : `${hours}h${minutes}m ago`;
}

/**
 * Formats the usage bar text, e.g.
 * `5h 14% · resets 1h52m │ 7d 1% · resets Thu 08:00 │ as of 3m ago`.
 *
 * - A window with `resets_at < now` shows as `5h -- (reset)`.
 * - `status: "missing"` -> `Claude usage: waiting for a Claude Code session`.
 * - `status: "invalid"` -> `Claude usage: unreadable file`.
 *
 * `now` is passed in (rather than read from `Date.now()` internally) so
 * this stays a pure, deterministically testable function.
 */
export function formatUsage(state: UsageState, now: number): string {
  if (state.status === "missing") {
    return "Claude usage: waiting for a Claude Code session";
  }
  if (state.status === "invalid") {
    return "Claude usage: unreadable file";
  }

  const segments: string[] = [];
  if (state.five_hour) {
    segments.push(formatWindow("5h", state.five_hour, now));
  }
  if (state.seven_day) {
    segments.push(formatWindow("7d", state.seven_day, now));
  }
  if (state.captured_at !== null) {
    segments.push(`as of ${formatAgo(now - state.captured_at)}`);
  }
  return segments.join(" │ ");
}

/**
 * The worst (highest) `used_pct` among windows that have **not** reset yet
 * (`resets_at >= now`), or 0 if there are none (code review finding #11:
 * the old colour computation counted an already-reset window's stale
 * `used_pct` toward the worst-case colour, even though it displays as
 * "-- (reset)" and no longer reflects real usage).
 */
export function worstActivePct(state: UsageState, now: number): number {
  const active = [state.five_hour, state.seven_day].filter(
    (window): window is UsageWindow => window !== null && window.resets_at >= now,
  );
  if (active.length === 0) return 0;
  return Math.max(...active.map((window) => window.used_pct));
}

// ---------------------------------------------------------------------------
// Status bar usage item + popover formatting (spec phase1.5 §7 "Usage
// component"/"popovers"). These format one row/label each, distinct from
// `formatUsage`'s single joined string above (kept for the status bar's
// always-visible 5-hour item), so the popover can lay each row out with its
// own meter.
// ---------------------------------------------------------------------------

/** The always-visible status bar item's percent + remaining time, e.g.
 * `"15% · 1h39m left"` (spec §7 "Left side": "5h, a 64x4px meter, then
 * `15% · 1h39m left`"), or `null` with no five-hour window. */
export function formatFiveHourStatusBarLabel(window: UsageWindow | null, now: number): string | null {
  if (!window) return null;
  if (window.resets_at < now) return "-- (reset)";
  return `${formatPct(window.used_pct)}% · ${formatDuration(window.resets_at - now)} left`;
}

/** The usage popover's 5-hour row, e.g. `"15% · resets in 1h39m"` (spec
 * §7 "Usage popover"). */
export function formatFiveHourPopoverRow(window: UsageWindow | null, now: number): string | null {
  if (!window) return null;
  if (window.resets_at < now) return "-- (reset)";
  return `${formatPct(window.used_pct)}% · resets in ${formatDuration(window.resets_at - now)}`;
}

/** The usage popover's weekly row, e.g. `"6% · resets Sat 08:00"` (local
 * time, spec §7 "Usage popover"). */
export function formatWeeklyPopoverRow(window: UsageWindow | null, now: number): string | null {
  if (!window) return null;
  if (window.resets_at < now) return "-- (reset)";
  return `${formatPct(window.used_pct)}% · resets ${formatClockTime(window.resets_at)}`;
}

/** `"as of N m ago"` (spec §7 "the title 'Claude usage' + 'as of N m ago'"). */
export function formatAsOfLabel(capturedAt: number | null, now: number): string | null {
  if (capturedAt === null) return null;
  return `as of ${formatAgo(now - capturedAt)}`;
}
