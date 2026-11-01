import { describe, expect, it, vi } from "vitest";
import type { RawSnapshot } from "../../src/appTypes";
import { createSnapshotBus } from "../../src/snapshotBus";

const snap = (id: string) => ({ boot_id: id }) as unknown as RawSnapshot;

describe("snapshotBus", () => {
  it("delivers each snapshot to every subscriber in subscription order", () => {
    const bus = createSnapshotBus();
    const seen: string[] = [];
    bus.subscribe((s) => seen.push(`a:${s.boot_id}`));
    bus.subscribe((s) => seen.push(`b:${s.boot_id}`));
    bus.publish(snap("1"));
    bus.publish(snap("2"));
    expect(seen).toEqual(["a:1", "b:1", "a:2", "b:2"]);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = createSnapshotBus();
    const handler = vi.fn();
    const off = bus.subscribe(handler);
    bus.publish(snap("1"));
    off();
    bus.publish(snap("2"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("keeps delivering when one subscriber throws", () => {
    const bus = createSnapshotBus();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe(after);
    bus.publish(snap("1"));
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("lets a subscriber unsubscribe another during delivery without skipping anyone", () => {
    const bus = createSnapshotBus();
    const later = vi.fn();
    let offLater = () => {};
    bus.subscribe(() => offLater());
    offLater = bus.subscribe(later);
    bus.publish(snap("1"));
    expect(later).toHaveBeenCalledTimes(1); // the copy was taken before delivery
    bus.publish(snap("2"));
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("works with no subscribers", () => {
    expect(() => createSnapshotBus().publish(snap("1"))).not.toThrow();
  });
});
