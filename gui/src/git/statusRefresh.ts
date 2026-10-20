// Git MVP spec §6.3 ordering rules as pure logic (no DOM, unit-tested): one
// git_status in flight; a trigger during a run causes exactly one follow-up;
// a result for a cwd that is no longer active is dropped; an unchanged result
// is not applied again, so the list does not flicker every poll.

import type { ChangeKind, GitStatus } from "./gitApi";

export interface StatusRefresherDeps<T> {
  fetch(cwd: string): Promise<T>;
  /** The active workspace's `new_workspace_cwd`, or `null` with no workspace. */
  currentCwd(): string | null;
  /** Called only when the result differs (JSON) from the last one applied. */
  onResult(cwd: string, result: T): void;
  onError(cwd: string, err: unknown): void;
}

export interface StatusRefresher {
  /** Starts a run, or marks one follow-up when a run is in flight. */
  request(): void;
  /** Forgets the last result, so the next one is applied even when equal. */
  reset(): void;
}

export function createStatusRefresher<T>(deps: StatusRefresherDeps<T>): StatusRefresher {
  let running = false;
  let dirty = false;
  let lastJson: string | null = null;

  async function run(): Promise<void> {
    const cwd = deps.currentCwd();
    if (cwd === null) return;
    running = true;
    try {
      const result = await deps.fetch(cwd);
      if (deps.currentCwd() !== cwd) return; // stale: the workspace changed
      const json = JSON.stringify(result);
      if (json === lastJson) return;
      lastJson = json;
      deps.onResult(cwd, result);
    } catch (err) {
      if (deps.currentCwd() !== cwd) return;
      lastJson = null; // the next success must render, to clear the error line
      deps.onError(cwd, err);
    } finally {
      running = false;
      if (dirty) {
        dirty = false;
        void run();
      }
    }
  }

  return {
    request() {
      if (running) {
        dirty = true;
        return;
      }
      void run();
    },
    reset() {
      lastJson = null;
    },
  };
}

export interface OpenDiffRef {
  path: string;
  staged: boolean;
  kind: ChangeKind;
}

export type DiffFollow =
  | { action: "keep" }
  | { action: "close" }
  | { action: "refetch"; staged: boolean; kind: ChangeKind };

/** After a status change: keep the open diff, re-fetch it only when the
 * file's list or kind changed, or close it when the file left both lists. */
export function followOpenDiff(open: OpenDiffRef, status: GitStatus): DiffFollow {
  const same = (open.staged ? status.staged : status.unstaged).find((f) => f.path === open.path);
  if (same) return same.kind === open.kind ? { action: "keep" } : { action: "refetch", staged: open.staged, kind: same.kind };
  const other = (open.staged ? status.unstaged : status.staged).find((f) => f.path === open.path);
  if (other) return { action: "refetch", staged: !open.staged, kind: other.kind };
  return { action: "close" };
}
