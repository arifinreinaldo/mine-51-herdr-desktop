// Git MVP spec §4: the TypeScript side of `src-tauri/src/git.rs`. Each
// wrapper is one `invoke` and rejects with the backend's `{ code, message }`
// `ApiError`; the caller picks an inline error (poll) or a notice (action),
// spec §7.

import { invoke } from "@tauri-apps/api/core";

/** `ChangeKind` serialized lowercase: `TypeChanged` is `"typechanged"`. */
export type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechanged"
  | "untracked"
  | "conflicted";

export interface FileChange {
  /** Repo-relative with `/` separators, exactly as git prints it. */
  path: string;
  origPath: string | null;
  kind: ChangeKind;
}

export interface GitStatus {
  /** `rev-parse --show-toplevel`; `null` outside a git repository. */
  repo: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
  unborn: boolean;
  staged: FileChange[];
  unstaged: FileChange[];
}

export interface GitDiff {
  text: string;
  truncated: boolean;
  binary: boolean;
}

export interface CommitResult {
  hash: string;
  summary: string;
}

export function gitStatus(cwd: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { cwd });
}

export function gitDiff(repo: string, path: string, staged: boolean, untracked: boolean): Promise<GitDiff> {
  return invoke<GitDiff>("git_diff", { repo, path, staged, untracked });
}

export function gitStage(repo: string, paths: string[]): Promise<void> {
  return invoke<void>("git_stage", { repo, paths });
}

export function gitUnstage(repo: string, paths: string[]): Promise<void> {
  return invoke<void>("git_unstage", { repo, paths });
}

export function gitCommit(repo: string, message: string): Promise<CommitResult> {
  return invoke<CommitResult>("git_commit", { repo, message });
}
