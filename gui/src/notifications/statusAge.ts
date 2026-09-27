// Client-side "how long has this pane been in its current status" tracking
// (UX pass 1 spec §2 "Age"). herdr exposes no such timestamp itself, so this
// is inferred purely from consecutive snapshots: a pane's age starts
// counting the moment its `agent_status` or `state_change_seq` first
// changes *after* a baseline was established, mirroring
// `DoneTransitionDetector`'s "never fire from a baseline" shape -- a pane
// seen for the first time (at startup, or right after `reset()`) has an
// unknown age until a real change is later observed for it, never "0m".

export interface PaneStatusForAge {
  pane_id: string;
  agent_status: string;
  state_change_seq: number;
}

interface BaselineEntry {
  status: string;
  seq: number;
}

/**
 * Tracks, per `pane_id`, the epoch ms at which its status last changed.
 * `update()` is the normal per-snapshot path; `reset()` re-anchors without
 * recording anything (a `boot_id` change, a disconnect, or the
 * `sync_state` replay -- the same three call sites `DoneTransitionDetector`
 * resets at).
 */
export class StatusAgeTracker {
  private baseline = new Map<string, BaselineEntry>();
  private since = new Map<string, number>();

  /** Call once per snapshot with every live pane. Prunes ids no longer
   * live, and records `now` as the "since" timestamp for any pane whose
   * status or `state_change_seq` differs from its stored baseline. */
  update(panes: readonly PaneStatusForAge[], now: number): void {
    const liveIds = new Set(panes.map((p) => p.pane_id));
    for (const id of this.since.keys()) if (!liveIds.has(id)) this.since.delete(id);
    for (const id of this.baseline.keys()) if (!liveIds.has(id)) this.baseline.delete(id);

    for (const pane of panes) {
      const prev = this.baseline.get(pane.pane_id);
      const changed = prev !== undefined && (prev.status !== pane.agent_status || prev.seq !== pane.state_change_seq);
      if (changed) this.since.set(pane.pane_id, now);
      this.baseline.set(pane.pane_id, { status: pane.agent_status, seq: pane.state_change_seq });
    }
  }

  /** The age in ms, or `undefined` if unknown (never observed a change for
   * this pane since the last `reset()`, including a pane seen for the very
   * first time). */
  ageMs(paneId: string, now: number): number | undefined {
    const since = this.since.get(paneId);
    return since === undefined ? undefined : Math.max(0, now - since);
  }

  /** Discards every recorded "since" timestamp and baseline (spec: "After
   * a reconnect or boot_id change, the unknown age shows nothing, not
   * '0m'"). The next `update()` call re-seeds baselines silently. */
  reset(): void {
    this.baseline.clear();
    this.since.clear();
  }
}

/** "now" (< 1 minute), else "Nm", "Nh", then "Nd" -- floored, not rounded.
 * `undefined` (unknown) formats as `""`, never "0m". */
export function formatAge(ms: number | undefined): string {
  if (ms === undefined) return "";
  if (ms < 60_000) return "now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** The largest known age among `paneIds` ("oldest first" -- spec §3's
 * Needs You group and the sidebar's "oldest blocked"), ignoring unknown
 * ages. `undefined` if none of them have a known age. */
export function oldestAgeMs(paneIds: readonly string[], ageMsFor: (paneId: string) => number | undefined): number | undefined {
  let max: number | undefined;
  for (const id of paneIds) {
    const age = ageMsFor(id);
    if (age === undefined) continue;
    if (max === undefined || age > max) max = age;
  }
  return max;
}

/** The smallest known age among `paneIds` ("newest first" -- spec §3's
 * Done group), ignoring unknown ages. `undefined` if none of them have a
 * known age. */
export function newestAgeMs(paneIds: readonly string[], ageMsFor: (paneId: string) => number | undefined): number | undefined {
  let min: number | undefined;
  for (const id of paneIds) {
    const age = ageMsFor(id);
    if (age === undefined) continue;
    if (min === undefined || age < min) min = age;
  }
  return min;
}
