// New Workspace folder dedup (spec phase1.5 §1 "Duplicate folder", §13
// "Path normalization + dedup rules").
//
// "If the chosen folder is already a workspace, focus that workspace
// instead. `new_workspace_cwd` is not the workspace root: it is the active
// pane's current cwd after the `new_terminal_cwd` policy. Match in this
// order: 1. Match a persisted `{workspace_id -> folder}` map ... 2.
// Otherwise, dedup only when exactly one workspace's normalized
// `new_workspace_cwd` equals the folder and no two workspaces share that
// value. 3. Otherwise, create a new workspace." Compared normalized:
// case-insensitive on Windows, `/` equal to `\`, trailing separators
// stripped.

export interface WorkspaceCwdCandidate {
  workspaceId: string;
  /** `ClientShellWorkspace.new_workspace_cwd` (spec: not the workspace
   * root -- the active pane's cwd after the server's own cwd policy). */
  newWorkspaceCwd: string;
}

export type DedupeResult = { kind: "focus"; workspaceId: string } | { kind: "create" };

/** Case-insensitive, `\`/`/`-agnostic, trailing-separator-agnostic path
 * comparison key. UNC paths (`\\server\share\...`) normalize the same way:
 * every backslash becomes a forward slash before lowercasing. */
export function normalizePathForCompare(path: string): string {
  const slashed = path.replace(/\\/g, "/").toLowerCase();
  let end = slashed.length;
  // Never strip a lone root slash/drive-root ("/" or "c:/").
  while (end > 1 && slashed[end - 1] === "/") end--;
  return slashed.slice(0, end);
}

/**
 * Removes persisted `{workspace_id -> folder}` entries for workspaces that
 * are no longer live (spec §1: "pruned against the snapshot").
 */
export function prunePersistedFolders(
  persisted: Readonly<Record<string, string>>,
  liveWorkspaceIds: readonly string[],
): Record<string, string> {
  const live = new Set(liveWorkspaceIds);
  const next: Record<string, string> = {};
  for (const [workspaceId, folder] of Object.entries(persisted)) {
    if (live.has(workspaceId)) next[workspaceId] = folder;
  }
  return next;
}

/**
 * Decides whether `folder` (a path just chosen in the New Workspace folder
 * picker) matches an existing live workspace. `persistedFolders` should
 * already be pruned to live workspace ids (see `prunePersistedFolders`);
 * this function additionally ignores any persisted id not present in
 * `liveWorkspaces` defensively.
 */
export function findDuplicateWorkspace(
  folder: string,
  persistedFolders: Readonly<Record<string, string>>,
  liveWorkspaces: readonly WorkspaceCwdCandidate[],
): DedupeResult {
  const target = normalizePathForCompare(folder);
  const liveIds = new Set(liveWorkspaces.map((w) => w.workspaceId));

  for (const [workspaceId, persistedFolder] of Object.entries(persistedFolders)) {
    if (liveIds.has(workspaceId) && normalizePathForCompare(persistedFolder) === target) {
      return { kind: "focus", workspaceId };
    }
  }

  const matches = liveWorkspaces.filter(
    (w) => normalizePathForCompare(w.newWorkspaceCwd) === target,
  );
  if (matches.length === 1) {
    return { kind: "focus", workspaceId: matches[0].workspaceId };
  }

  return { kind: "create" };
}
