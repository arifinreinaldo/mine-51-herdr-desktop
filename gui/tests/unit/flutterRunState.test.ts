import { describe, expect, it } from "vitest";
import type { AndroidDevice } from "../../src/flutter/flutterApi";
import {
  filterFlavors,
  isValidDeviceId,
  isValidFlavor,
  mergeDevices,
  onPlay,
  onStop,
  reconcile,
  statusFor,
  type RunMap,
} from "../../src/flutter/runState";

function dev(id: string, name = id): AndroidDevice {
  return { id, name, state: "device", emulator: false };
}

describe("run state", () => {
  it("is idle without an entry", () => {
    expect(statusFor(new Map() as RunMap, "w1")).toBe("idle");
  });

  it("play gives running", () => {
    const map: RunMap = new Map();
    onPlay(map, "w1", "p1", "C:\app", "RF8W3085JEW");
    expect(statusFor(map, "w1")).toBe("running");
    expect(map.get("w1")).toEqual({ paneId: "p1", projectDir: "C:\app", deviceId: "RF8W3085JEW", status: "running" });
  });

  it("stop gives stopped and keeps the pane", () => {
    const map: RunMap = new Map();
    onPlay(map, "w1", "p1", "C:\app", "dev");
    onStop(map, "w1");
    expect(statusFor(map, "w1")).toBe("stopped");
    expect(map.get("w1")?.paneId).toBe("p1");
  });

  it("stop on an idle workspace does nothing", () => {
    const map: RunMap = new Map();
    onStop(map, "w1");
    expect(statusFor(map, "w1")).toBe("idle");
  });

  it("reconcile without the pane gives idle", () => {
    const map: RunMap = new Map();
    onPlay(map, "w1", "p1", "C:\app", "dev");
    reconcile(map, new Set(["p2"]));
    expect(statusFor(map, "w1")).toBe("idle");
  });

  it("reconcile keeps an entry whose pane is alive", () => {
    const map: RunMap = new Map();
    onPlay(map, "w1", "p1", "C:\app", "dev");
    reconcile(map, new Set(["p1"]));
    expect(statusFor(map, "w1")).toBe("running");
  });

  it("keeps two workspaces independent", () => {
    const map: RunMap = new Map();
    onPlay(map, "w1", "p1", "C:\a", "dev");
    onPlay(map, "w2", "p2", "C:\b", "dev");
    onStop(map, "w1");
    reconcile(map, new Set(["p1"]));
    expect(statusFor(map, "w1")).toBe("stopped");
    expect(statusFor(map, "w2")).toBe("idle");
  });
});

describe("isValidDeviceId", () => {
  it("accepts adb and flutter ids", () => {
    for (const id of ["RF8W3085JEW", "emulator-5554", "windows", "adb-X._adb-tls-connect._tcp", "192.168.1.5:5555"]) {
      expect(isValidDeviceId(id)).toBe(true);
    }
  });

  it("rejects anything a shell would read", () => {
    for (const id of ["a b", "x;rm", "$(x)", "", "--release"]) {
      expect(isValidDeviceId(id)).toBe(false);
    }
  });
});

describe("mergeDevices", () => {
  it("drops a flutter device that adb already has", () => {
    const merged = mergeDevices([dev("RF8W3085JEW", "SM A145F")], [dev("RF8W3085JEW", "other name"), dev("windows")]);
    expect(merged.map((d) => d.id)).toEqual(["RF8W3085JEW", "windows"]);
    expect(merged[0].name).toBe("SM A145F");
  });

  it("appends windows and chrome after the adb entries", () => {
    const merged = mergeDevices([dev("a1"), dev("a2")], [dev("windows"), dev("chrome")]);
    expect(merged.map((d) => d.id)).toEqual(["a1", "a2", "windows", "chrome"]);
  });

  it("gives the flutter list when adb is empty", () => {
    expect(mergeDevices([], [dev("windows")]).map((d) => d.id)).toEqual(["windows"]);
  });

  it("gives the adb list when flutter is null", () => {
    expect(mergeDevices([dev("a1")], null).map((d) => d.id)).toEqual(["a1"]);
  });
});

describe("flavors", () => {
  const all = ["devSales", "devWms", "playSales"];

  it("filters by case-insensitive substring", () => {
    expect(filterFlavors(all, "SALES")).toEqual(["devSales", "playSales"]);
    expect(filterFlavors(all, "dev w")).toEqual([]);
  });

  it("a blank query keeps every flavor", () => {
    expect(filterFlavors(all, "  ")).toEqual(all);
  });

  it("accepts only shell-safe names", () => {
    expect(isValidFlavor("devSales")).toBe(true);
    expect(isValidFlavor("dev sales")).toBe(false);
    expect(isValidFlavor("dev;rm")).toBe(false);
    expect(isValidFlavor("1dev")).toBe(false);
    expect(isValidFlavor("")).toBe(false);
  });
});
