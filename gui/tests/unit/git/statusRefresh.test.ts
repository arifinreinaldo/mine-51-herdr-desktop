import { describe, expect, it, vi } from "vitest";
import type { ChangeKind, GitStatus } from "../../../src/git/gitApi";
import { createStatusRefresher, followOpenDiff } from "../../../src/git/statusRefresh";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(err: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(initialCwd: string | null = "/repo-a") {
  let cwd = initialCwd;
  const calls: string[] = [];
  const pending: Deferred<string>[] = [];
  const onResult = vi.fn();
  const onError = vi.fn();
  const refresher = createStatusRefresher<string>({
    fetch: (c) => {
      calls.push(c);
      const d = deferred<string>();
      pending.push(d);
      return d.promise;
    },
    currentCwd: () => cwd,
    onResult,
    onError,
  });
  return {
    refresher,
    calls,
    pending,
    onResult,
    onError,
    setCwd: (c: string | null) => {
      cwd = c;
    },
  };
}

describe("createStatusRefresher", () => {
  it("runs one fetch for the active cwd and applies the result", async () => {
    const t = setup();
    t.refresher.request();
    expect(t.calls).toEqual(["/repo-a"]);
    t.pending[0].resolve("one");
    await flush();
    expect(t.onResult).toHaveBeenCalledTimes(1);
    expect(t.onResult).toHaveBeenCalledWith("/repo-a", "one");
    expect(t.onError).not.toHaveBeenCalled();
  });

  it("drops a result whose cwd is no longer active", async () => {
    const t = setup("/repo-a");
    t.refresher.request();
    t.setCwd("/repo-b");
    t.pending[0].resolve("one");
    await flush();
    expect(t.onResult).not.toHaveBeenCalled();
  });

  it("drops an error whose cwd is no longer active", async () => {
    const t = setup("/repo-a");
    t.refresher.request();
    t.setCwd("/repo-b");
    t.pending[0].reject(new Error("boom"));
    await flush();
    expect(t.onError).not.toHaveBeenCalled();
    expect(t.onResult).not.toHaveBeenCalled();
  });

  it("a trigger during a run causes exactly one follow-up", async () => {
    const t = setup();
    t.refresher.request();
    t.refresher.request();
    t.refresher.request();
    t.refresher.request();
    expect(t.calls).toHaveLength(1);
    t.pending[0].resolve("one");
    await flush();
    expect(t.calls).toHaveLength(2);
    t.pending[1].resolve("two");
    await flush();
    expect(t.calls).toHaveLength(2);
  });

  it("skips an unchanged result, and applies it again after reset()", async () => {
    const t = setup();
    t.refresher.request();
    t.pending[0].resolve("same");
    await flush();
    t.refresher.request();
    t.pending[1].resolve("same");
    await flush();
    expect(t.onResult).toHaveBeenCalledTimes(1);
    t.refresher.reset();
    t.refresher.request();
    t.pending[2].resolve("same");
    await flush();
    expect(t.onResult).toHaveBeenCalledTimes(2);
  });

  it("does nothing without an active cwd", async () => {
    const t = setup(null);
    t.refresher.request();
    await flush();
    expect(t.calls).toEqual([]);
    expect(t.onResult).not.toHaveBeenCalled();
    expect(t.onError).not.toHaveBeenCalled();
  });
});

function statusOf(staged: [string, ChangeKind][], unstaged: [string, ChangeKind][]): GitStatus {
  const file = ([path, kind]: [string, ChangeKind]) => ({ path, origPath: null, kind });
  return {
    repo: "/repo",
    branch: "main",
    ahead: 0,
    behind: 0,
    unborn: false,
    staged: staged.map(file),
    unstaged: unstaged.map(file),
  };
}

describe("followOpenDiff", () => {
  it("keeps the diff when the file keeps its list and kind", () => {
    const status = statusOf([], [["a.txt", "modified"]]);
    expect(followOpenDiff({ path: "a.txt", staged: false, kind: "modified" }, status)).toEqual({ action: "keep" });
  });

  it("re-fetches when the kind changed", () => {
    const status = statusOf([], [["a.txt", "deleted"]]);
    expect(followOpenDiff({ path: "a.txt", staged: false, kind: "modified" }, status)).toEqual({
      action: "refetch",
      staged: false,
      kind: "deleted",
    });
  });

  it("follows the file into the other list", () => {
    const status = statusOf([["a.txt", "added"]], []);
    expect(followOpenDiff({ path: "a.txt", staged: false, kind: "untracked" }, status)).toEqual({
      action: "refetch",
      staged: true,
      kind: "added",
    });
  });

  it("closes when the file left both lists", () => {
    const status = statusOf([["b.txt", "modified"]], [["c.txt", "modified"]]);
    expect(followOpenDiff({ path: "a.txt", staged: false, kind: "modified" }, status)).toEqual({ action: "close" });
  });
});
