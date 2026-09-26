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
export function usageColor(_usedPct: number): UsageColor {
  throw new Error("not implemented: usageColor");
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
export function formatUsage(_state: UsageState, _now: number): string {
  throw new Error("not implemented: formatUsage");
}
