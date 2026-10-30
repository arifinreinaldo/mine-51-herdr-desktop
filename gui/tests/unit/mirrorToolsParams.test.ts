import { describe, expect, it } from "vitest";
import { dockSideFrom, installView, parseMirrorToolsParams } from "../../src/android/mirrorToolsParams";

describe("parseMirrorToolsParams", () => {
  it("reads a valid query", () => {
    expect(parseMirrorToolsParams("?device=RF8W3085JEW&name=Pixel")).toEqual({
      deviceId: "RF8W3085JEW",
      deviceName: "Pixel",
    });
  });

  it("accepts a network device id", () => {
    expect(parseMirrorToolsParams("?device=192.168.1.5%3A5555&name=x")?.deviceId).toBe("192.168.1.5:5555");
  });

  it("decodes + and %20 to a space", () => {
    expect(parseMirrorToolsParams("?device=a&name=My+phone")?.deviceName).toBe("My phone");
    expect(parseMirrorToolsParams("?device=a&name=My%20phone")?.deviceName).toBe("My phone");
  });

  it("gives null for a missing or unsafe device", () => {
    expect(parseMirrorToolsParams("")).toBeNull();
    expect(parseMirrorToolsParams("?name=x")).toBeNull();
    expect(parseMirrorToolsParams("?device=x;rm&name=x")).toBeNull();
    expect(parseMirrorToolsParams("?device=-s&name=x")).toBeNull();
    expect(parseMirrorToolsParams("?device=&name=x")).toBeNull();
  });

  it("removes control characters", () => {
    expect(parseMirrorToolsParams("?device=a&name=Pi%07x%0Ael%7F")?.deviceName).toBe("Pixel");
  });

  it("cuts the name to 80 characters", () => {
    const name = parseMirrorToolsParams(`?device=a&name=${"b".repeat(100)}`)?.deviceName;
    expect(name).toBe("b".repeat(80));
  });

  it("falls back to the device id for an empty name", () => {
    expect(parseMirrorToolsParams("?device=abc&name=")?.deviceName).toBe("abc");
    expect(parseMirrorToolsParams("?device=abc")?.deviceName).toBe("abc");
    expect(parseMirrorToolsParams("?device=abc&name=%20%07")?.deviceName).toBe("abc");
  });
});

describe("dockSideFrom", () => {
  it("accepts left and right", () => {
    expect(dockSideFrom("left")).toBe("left");
    expect(dockSideFrom("right")).toBe("right");
  });

  it("rejects everything else", () => {
    for (const bad of ["up", 1, null, {}, undefined, "Left"]) {
      expect(dockSideFrom(bad)).toBeNull();
    }
  });
});

describe("installView", () => {
  const ev = (p: Record<string, unknown> = {}) => ({ device: "RF8W3085JEW", phase: "start", index: 2, total: 3, file: "app.apk", ...p });

  it("shows the queue position while installing", () => {
    expect(installView(ev(), "RF8W3085JEW")).toEqual({ busy: true, tone: "busy", text: "Installing 2 of 3", file: "app.apk" });
  });

  it("drops the position for a single file", () => {
    expect(installView(ev({ index: 1, total: 1 }), "RF8W3085JEW")?.text).toBe("Installing");
  });

  it("shows the result", () => {
    expect(installView(ev({ phase: "ok" }), "RF8W3085JEW")).toEqual({ busy: false, tone: "ok", text: "Installed", file: "app.apk" });
    expect(installView(ev({ phase: "failed" }), "RF8W3085JEW")).toEqual({ busy: false, tone: "failed", text: "Failed", file: "app.apk" });
  });

  it("ignores another device's install", () => {
    expect(installView(ev(), "OTHER")).toBeNull();
  });

  it("ignores a malformed payload", () => {
    for (const bad of [null, "start", 7, ev({ phase: "x" }), ev({ file: 3 }), ev({ index: 1.5 }), ev({ total: "3" })]) {
      expect(installView(bad, "RF8W3085JEW")).toBeNull();
    }
  });
});
