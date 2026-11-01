import { describe, expect, it } from "vitest";
import { childPath, isDeletablePath, isStatDenied, isValidDevicePath, parentWithin, pushStatus } from "../../src/android/deviceFiles";

describe("isValidDevicePath", () => {
  it("accepts shared storage paths with spaces, quotes and dashes", () => {
    for (const ok of ["/sdcard", "/sdcard/Download", "/sdcard/Simplr APK", "/sdcard/Download/.nearby/-5034958385594290967", "/storage/emulated/0", "/sdcard/it's", "/sdcard/日本語"])
      expect(isValidDevicePath(ok), ok).toBe(true);
  });
  it("rejects other roots, escapes, empty segments and control characters", () => {
    for (const bad of ["", "/", "sdcard", "/sdcardx", "/data/local/tmp", "/sdcard/../data", "/sdcard/./x", "/sdcard/", "/sdcard//x", "/sdcard/a\nb", "/sdcard/a\u007fb", "/sdcard/" + "x".repeat(4096)])
      expect(isValidDevicePath(bad), JSON.stringify(bad)).toBe(false);
  });
});

describe("parentWithin", () => {
  it("goes up one folder inside its tree section", () => {
    expect(parentWithin("/sdcard/Download", "/sdcard")).toBe("/sdcard");
    expect(parentWithin("/data/data/com.x.y/files/logs", "/data/data/com.x.y")).toBe("/data/data/com.x.y/files");
    expect(parentWithin("/data/local", "/")).toBe("/data");
    expect(parentWithin("/data", "/")).toBe("/");
  });
  it("stops at the section root and outside it", () => {
    expect(parentWithin("/sdcard", "/sdcard")).toBeNull();
    expect(parentWithin("/", "/")).toBeNull();
    expect(parentWithin("/data/data/com.x.y", "/data/data/com.x.y")).toBeNull();
    expect(parentWithin("/sdcardx/a", "/sdcard")).toBeNull();
  });
});

describe("childPath", () => {
  it("joins without a double slash at the device root", () => {
    expect(childPath("/", "data")).toBe("/data");
    expect(childPath("/sdcard", "Simplr APK")).toBe("/sdcard/Simplr APK");
  });
});

describe("isStatDenied", () => {
  it("is true only for the ? modes that ls prints for an item it cannot stat", () => {
    expect(isStatDenied({ mode: "d?????????" })).toBe(true);
    expect(isStatDenied({ mode: "l?????????" })).toBe(true);
    expect(isStatDenied({ mode: "drwxrws---" })).toBe(false);
  });
});

describe("isDeletablePath", () => {
  it("accepts items two segments below a storage volume", () => {
    for (const ok of ["/sdcard/Download/a.txt", "/sdcard/Download/-rf", "/sdcard/Android/data/com.example.app", "/storage/emulated/0/Download/a.txt", "/storage/self/primary/DCIM/Camera", "/storage/1234-ABCD/DCIM/Camera"])
      expect(isDeletablePath(ok), ok).toBe(true);
  });
  it("refuses volumes, top-level folders, Android/data and invalid paths", () => {
    for (const bad of ["/sdcard", "/storage", "/storage/emulated", "/storage/self", "/sdcard/Download", "/storage/emulated/0", "/storage/self/primary", "/storage/emulated/0/Download", "/storage/1234-ABCD/DCIM", "/sdcard/Android/data", "/sdcard/android/obb", "/sdcard/Download/x/..", "/sdcard/Download/"])
      expect(isDeletablePath(bad), bad).toBe(false);
  });
});

describe("pushStatus", () => {
  it("names where the push landed, and says that sync deletes nothing", () => {
    expect(pushStatus("files", "/sdcard/Download", ["a.txt"])).toBe("Uploaded to /sdcard/Download/a.txt");
    expect(pushStatus("files", "/sdcard/Download", ["a.txt", "b.txt"])).toBe("Uploaded 2 files to /sdcard/Download");
    expect(pushStatus("folder", "/sdcard", ["Photos"])).toBe("Uploaded to /sdcard/Photos");
    expect(pushStatus("sync", "/sdcard", ["Photos"])).toBe("Synced into /sdcard/Photos. Nothing on the device was deleted");
  });
  it("counts dropped items, files and folders alike", () => {
    expect(pushStatus("drop", "/sdcard/Download", ["a.txt"])).toBe("Uploaded to /sdcard/Download/a.txt");
    expect(pushStatus("drop", "/sdcard/Download", ["a.txt", "Photos"])).toBe("Uploaded 2 items to /sdcard/Download");
  });
});
