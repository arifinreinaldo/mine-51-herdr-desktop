// Agent-done transition detection and in-app highlight stacking (spec
// phase1.5 §7 "Done notification").
//
// "Detection: diff consecutive snapshots per `pane_id`. A notification
// fires when `agent_status` becomes `done` from any other status with a
// higher `state_change_seq`. The baseline resets on a `boot_id` change, on
// a `connection-status` other than connected, and on the `sync_state`
// replay. Never fire from a baseline. Ignore agents whose pane has
// disappeared." "Several transitions within 8s stack as highlight cards,
// up to 3."

import type { AgentStatus } from "../agents";

export interface AgentForDetection {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  agent_status: AgentStatus;
  state_change_seq: number;
}

/**
 * Tracks the last-seen agent list (by `pane_id`) and reports which agents
 * just transitioned to `done`. `resetBaseline` re-anchors without ever
 * reporting a transition (boot_id change / disconnect / `sync_state`
 * replay); `diff` is the normal per-snapshot path.
 */
export class DoneTransitionDetector {
  private baseline: Map<string, AgentForDetection> | null = null;

  /**
   * Discards the baseline outright (finding #8): the *next* `diff()` call
   * then has no baseline to compare against, so -- per `diff()`'s own
   * "never fires with no baseline yet" rule -- that next snapshot only
   * re-seeds the baseline; it can never itself report a transition, no
   * matter how much the agents in it differ from whatever was true before
   * the reset. Call sites: a `boot_id` change, a `connection-status` other
   * than `connected`, and before the `sync_state` replay.
   *
   * The previous implementation took the *current* agents and used them
   * directly as the new baseline, which is subtly wrong: it made the very
   * next `diff()` call able to fire immediately if that seed snapshot's
   * status differs from the one after it, defeating "never fire from a
   * baseline" for exactly the snapshot right after a reset.
   */
  resetBaseline(): void {
    this.baseline = null;
  }

  /**
   * Diffs `agents` against the stored baseline, then updates the baseline
   * to `agents`. Returns the agents that transitioned to `done` from a
   * different status at a strictly higher `state_change_seq`. Returns `[]`
   * (never fires) when there is no baseline yet -- the very first snapshot
   * this detector ever sees.
   */
  diff(agents: readonly AgentForDetection[]): AgentForDetection[] {
    const transitions: AgentForDetection[] = [];
    if (this.baseline) {
      const baseline = this.baseline;
      for (const agent of agents) {
        const prev = baseline.get(agent.pane_id);
        if (
          prev !== undefined &&
          prev.agent_status !== "done" &&
          agent.agent_status === "done" &&
          agent.state_change_seq > prev.state_change_seq
        ) {
          transitions.push(agent);
        }
      }
    }
    this.baseline = toBaselineMap(agents);
    return transitions;
  }
}

function toBaselineMap(agents: readonly AgentForDetection[]): Map<string, AgentForDetection> {
  return new Map(agents.map((agent) => [agent.pane_id, agent]));
}

/**
 * Terminal-parity spec P1 #13 "Bell and notifications": `ServerMessage::
 * SemanticNotification` is a second source for the same done toast this
 * detector's own `diff()` already drives -- whichever arrives first (the
 * next snapshot, or a `SemanticNotification{kind: Finished}`) must win, the
 * other must be suppressed. Keyed by `pane_id:state_change_seq`, so a
 * genuinely new transition (a higher `state_change_seq`) is never
 * suppressed by an older one already shown.
 */
export class DoneToastDedup {
  private shown = new Set<string>();

  /** Returns `true` (and marks it shown) the first time this exact
   * `pane_id`/`seq` pair is seen; `false` on every later call for the same
   * pair. */
  shouldShow(paneId: string, seq: number): boolean {
    const key = `${paneId}:${seq}`;
    if (this.shown.has(key)) return false;
    this.shown.add(key);
    return true;
  }
}

// ---------------------------------------------------------------------------
// In-app highlight card stacking
// ---------------------------------------------------------------------------

export interface HighlightCard {
  transition: AgentForDetection;
  /** `Date.now()`-style epoch ms when this card was pushed. */
  firedAt: number;
}

const DEFAULT_MAX_CARDS = 3;
const DEFAULT_AUTO_HIDE_MS = 8000;

/**
 * Newest-first stack of highlight cards, capped at `maxCards` (spec:
 * "stack as highlight cards, up to 3"), each auto-hiding after
 * `autoHideMs` (spec: "auto-hides after 8s") unless its `pane_id` is in the
 * paused set passed to `prune` (spec: "hover pauses the timer").
 */
export class HighlightCardStack {
  private cards: HighlightCard[] = [];

  constructor(
    private readonly maxCards: number = DEFAULT_MAX_CARDS,
    private readonly autoHideMs: number = DEFAULT_AUTO_HIDE_MS,
  ) {}

  push(transition: AgentForDetection, now: number): void {
    this.cards = [{ transition, firedAt: now }, ...this.cards].slice(0, this.maxCards);
  }

  /** Removes cards whose auto-hide window has elapsed, except those whose
   * `pane_id` is in `pausedPaneIds` (the pointer is hovering that card). */
  prune(now: number, pausedPaneIds: ReadonlySet<string> = new Set()): void {
    this.cards = this.cards.filter(
      (card) =>
        pausedPaneIds.has(card.transition.pane_id) || now - card.firedAt < this.autoHideMs,
    );
  }

  list(): readonly HighlightCard[] {
    return this.cards;
  }
}
