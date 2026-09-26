import { describe, expect, it } from "vitest";
import {
  findDuplicateWorkspace,
  normalizePathForCompare,
  prunePersistedFolders,
  type WorkspaceCwdCandidate,
} from "../../../src/workspace/dedupe";

describe("normalizePathForCompare", () => {
  it("is case-insensitive", () => {
    expect(normalizePathForCompare("C:\\Users\\Foo")).toBe(normalizePathForCompare("c:/users/foo"));
  });

  it("treats / and \\ as equal", () => {
    expect(normalizePathForCompare("C:\\Users\\Foo\\Bar")).toBe(normalizePathForCompare("C:/Users/Foo/Bar"));
  });

  it("strips a trailing separator", () => {
    expect(normalizePathForCompare("C:\\Users\\Foo\\")).toBe(normalizePathForCompare("C:\\Users\\Foo"));
  });

  it("normalizes UNC paths the same way", () => {
    expect(normalizePathForCompare("\\\\server\\share\\path")).toBe(
      normalizePathForCompare("\\\\SERVER\\Share\\Path\\"),
    );
  });

  it("never strips a lone root separator", () => {
    expect(normalizePathForCompare("/")).toBe("/");
  });
});

describe("prunePersistedFolders", () => {
  it("drops entries for workspaces no longer live", () => {
    const pruned = prunePersistedFolders({ a: "C:/a", gone: "C:/gone" }, ["a"]);
    expect(pruned).toEqual({ a: "C:/a" });
  });
});

describe("findDuplicateWorkspace", () => {
  it("matches via the persisted folder map first", () => {
    const live: WorkspaceCwdCandidate[] = [{ workspaceId: "ws-1", newWorkspaceCwd: "C:/somewhere/else" }];
    const result = findDuplicateWorkspace(
      "C:\\Projects\\foo",
      { "ws-1": "C:/Projects/foo" },
      live,
    );
    expect(result).toEqual({ kind: "focus", workspaceId: "ws-1" });
  });

  it("ignores a persisted entry for a workspace that is no longer live", () => {
    const live: WorkspaceCwdCandidate[] = [];
    const result = findDuplicateWorkspace("C:/Projects/foo", { "ws-1": "C:/Projects/foo" }, live);
    expect(result).toEqual({ kind: "create" });
  });

  it("falls back to new_workspace_cwd when exactly one workspace matches", () => {
    const live: WorkspaceCwdCandidate[] = [
      { workspaceId: "ws-1", newWorkspaceCwd: "C:/Projects/foo" },
      { workspaceId: "ws-2", newWorkspaceCwd: "C:/Projects/bar" },
    ];
    const result = findDuplicateWorkspace("C:\\Projects\\foo\\", {}, live);
    expect(result).toEqual({ kind: "focus", workspaceId: "ws-1" });
  });

  it("does not dedup when two workspaces share the same new_workspace_cwd", () => {
    const live: WorkspaceCwdCandidate[] = [
      { workspaceId: "ws-1", newWorkspaceCwd: "C:/Projects/foo" },
      { workspaceId: "ws-2", newWorkspaceCwd: "C:/Projects/foo" },
    ];
    const result = findDuplicateWorkspace("C:/Projects/foo", {}, live);
    expect(result).toEqual({ kind: "create" });
  });

  it("creates a new workspace when nothing matches", () => {
    const result = findDuplicateWorkspace("C:/Projects/new-one", {}, []);
    expect(result).toEqual({ kind: "create" });
  });
});
