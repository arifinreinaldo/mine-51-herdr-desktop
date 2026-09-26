import { describe, expect, it, vi } from "vitest";
import { waitForTabFocusedPane, type FocusedTabSnapshot, type TabFocusWaiterDeps } from "../../../src/workspace/tabFocusWait";

function fakeDeps(overrides: Partial<TabFocusWaiterDeps> = {}): TabFocusWaiterDeps & {
  emit(snapshot: FocusedTabSnapshot): void;
  fireTimeout(): void;
  subscriberCount(): number;
} {
  let current: FocusedTabSnapshot | null = null;
  const subscribers: ((snapshot: FocusedTabSnapshot) => void)[] = [];
  let timeoutFn: (() => void) | undefined;

  const deps: TabFocusWaiterDeps = {
    getSnapshot: () => current,
    subscribeSnapshot: (handler) => {
      subscribers.push(handler);
      return Promise.resolve(() => {
        const i = subscribers.indexOf(handler);
        if (i !== -1) subscribers.splice(i, 1);
      });
    },
    setTimeout: (fn) => {
      timeoutFn = fn;
      return 1;
    },
    clearTimeout: () => {
      timeoutFn = undefined;
    },
    ...overrides,
  };

  return {
    ...deps,
    emit(snapshot: FocusedTabSnapshot) {
      current = snapshot;
      for (const sub of [...subscribers]) sub(snapshot);
    },
    fireTimeout() {
      timeoutFn?.();
    },
    subscriberCount() {
      return subscribers.length;
    },
  };
}

describe("waitForTabFocusedPane", () => {
  it("resolves immediately, with no subscription, when the current snapshot already matches", async () => {
    const deps = fakeDeps({
      getSnapshot: () => ({ focused_tab_id: "t1", focused_pane_id: "p1" }),
    });
    const result = await waitForTabFocusedPane(deps, "t1");
    expect(result).toBe("p1");
    expect(deps.subscriberCount()).toBe(0);
  });

  it("waits for a later snapshot event matching the tab id", async () => {
    const deps = fakeDeps();
    const promise = waitForTabFocusedPane(deps, "t1");
    await Promise.resolve(); // let the subscribeSnapshot promise settle
    deps.emit({ focused_tab_id: "t2", focused_pane_id: "p2" }); // a different tab first
    deps.emit({ focused_tab_id: "t1", focused_pane_id: "p1" });
    expect(await promise).toBe("p1");
  });

  it("resolves to null on a timeout with nothing matching", async () => {
    const deps = fakeDeps();
    const promise = waitForTabFocusedPane(deps, "t1", 2000);
    await Promise.resolve();
    deps.fireTimeout();
    expect(await promise).toBeNull();
  });

  it("unsubscribes once resolved, whether by match or by timeout", async () => {
    const deps = fakeDeps();
    const promise = waitForTabFocusedPane(deps, "t1");
    await Promise.resolve();
    expect(deps.subscriberCount()).toBe(1);
    deps.emit({ focused_tab_id: "t1", focused_pane_id: "p1" });
    await promise;
    expect(deps.subscriberCount()).toBe(0);
  });

  it("a null focused_pane_id on the matching snapshot resolves to null, not undefined", async () => {
    const deps = fakeDeps();
    const promise = waitForTabFocusedPane(deps, "t1");
    await Promise.resolve();
    deps.emit({ focused_tab_id: "t1", focused_pane_id: null });
    expect(await promise).toBeNull();
  });

  it("catches a snapshot that already arrived in the gap before the subscription attached", async () => {
    // `subscribeSnapshot` is async to attach (mirrors `listen()`); a
    // matching snapshot can update `getSnapshot()` before that promise
    // settles. The re-check after attaching must catch it rather than
    // waiting the full timeout for an event that will never re-fire.
    let current: FocusedTabSnapshot | null = null;
    const deps = fakeDeps({
      getSnapshot: () => current,
      subscribeSnapshot: (handler) => {
        // Simulate the race: the snapshot "arrives" while the subscribe
        // promise is still pending.
        current = { focused_tab_id: "t1", focused_pane_id: "p1" };
        return Promise.resolve(() => void handler); // never actually invoked
      },
    });
    const result = await waitForTabFocusedPane(deps, "t1");
    expect(result).toBe("p1");
  });

  it("does not fire twice if both a matching event and the re-check could apply", async () => {
    const onEvent = vi.fn();
    const deps = fakeDeps();
    const promise = waitForTabFocusedPane(deps, "t1").then((v) => {
      onEvent(v);
      return v;
    });
    await Promise.resolve();
    deps.emit({ focused_tab_id: "t1", focused_pane_id: "p1" });
    deps.emit({ focused_tab_id: "t1", focused_pane_id: "p-should-be-ignored" });
    deps.fireTimeout();
    expect(await promise).toBe("p1");
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});
