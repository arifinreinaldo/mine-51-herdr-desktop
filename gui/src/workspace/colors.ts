// Workspace colour assignment (spec phase1.5 §6a "Workspace colours").
//
// "When a workspace id is first seen, give it the lowest palette index that
// no live workspace is using. If all 10 are in use, cycle by count."
// "Persist it in settings.json as `workspaceColors: {workspace_id: index}`,
// pruned against the snapshot. A colour never changes on its own." A manual
// override (right-click -> Change Color) is just another entry in that same
// map, so it is carried over exactly like an auto-assigned one -- no
// separate "override" field is needed for it to stick.

export const WORKSPACE_PALETTE_SIZE = 10;

export type WorkspaceColorAssignment = Readonly<Record<string, number>>;

/**
 * Returns the next assignment map for `liveWorkspaceIds` (in snapshot
 * order), given the currently persisted `existing` map:
 * - Ids no longer live are dropped (pruning).
 * - Ids already assigned keep their index unchanged (stability, and this is
 *   also how a manual override survives: it's just an `existing` entry).
 * - A newly-seen id gets the lowest palette index no other *live* id is
 *   using; once all 10 are taken, it cycles by the running assignment
 *   count (`assignedSoFar % 10`).
 */
export function assignWorkspaceColors(
  liveWorkspaceIds: readonly string[],
  existing: WorkspaceColorAssignment,
): WorkspaceColorAssignment {
  const next: Record<string, number> = {};

  for (const id of liveWorkspaceIds) {
    if (existing[id] !== undefined) {
      next[id] = existing[id];
    }
  }

  const used = new Set(Object.values(next));
  for (const id of liveWorkspaceIds) {
    if (next[id] !== undefined) continue;
    let index = -1;
    for (let i = 0; i < WORKSPACE_PALETTE_SIZE; i++) {
      if (!used.has(i)) {
        index = i;
        break;
      }
    }
    if (index === -1) {
      index = Object.keys(next).length % WORKSPACE_PALETTE_SIZE;
    }
    next[id] = index;
    used.add(index);
  }

  return next;
}
