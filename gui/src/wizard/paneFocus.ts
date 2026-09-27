// Shared "did the newly created tab/workspace actually get a new focused
// pane" wait (Phase 1.6 spec §4.2 steps 2-3; finding #6 "typing into the
// wrong pane"): both the provider install/sign-in flow (stepProviders.ts)
// and the first-workspace "Start <provider> here" flow (stepWorkspace.ts)
// must never type a command into a pane that isn't actually the new one.

import { appState } from "../appState";

const PANE_FOCUS_WAIT_MS = 2000;
const PANE_FOCUS_POLL_MS = 100;

/** Polls `appState.snapshot.focused_pane_id` for up to 2s, waiting for it
 * to become a *different*, non-empty pane id from `previousPaneId`
 * (finding #6): a timeout, or a focused id that never actually changed
 * (still equal to `previousPaneId`), both return `null` -- never the
 * stale/unchanged id. Callers must treat `null` as "do not type anything,
 * show a notice instead." */
export async function waitForFocusedPaneId(previousPaneId: string | null | undefined): Promise<string | null> {
  const deadline = Date.now() + PANE_FOCUS_WAIT_MS;
  while (Date.now() < deadline) {
    const current = appState.snapshot?.focused_pane_id ?? null;
    if (current && current !== previousPaneId) return current;
    await new Promise((resolve) => window.setTimeout(resolve, PANE_FOCUS_POLL_MS));
  }
  const finalId = appState.snapshot?.focused_pane_id ?? null;
  return finalId && finalId !== previousPaneId ? finalId : null;
}
