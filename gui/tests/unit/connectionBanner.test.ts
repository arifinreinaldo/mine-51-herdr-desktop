import { describe, expect, it } from "vitest";
import { decideConnectionBanner } from "../../src/connectionBanner";

// Phase 1.6 addendum §11.3/§11.5: "the banner state for Missing vs down."

describe("decideConnectionBanner", () => {
  it("is hidden while connecting, regardless of engine status", () => {
    expect(decideConnectionBanner("connecting", "found", "sock").visible).toBe(false);
    expect(decideConnectionBanner("connecting", "missing", "sock").visible).toBe(false);
  });

  it("is hidden while connected", () => {
    expect(decideConnectionBanner("connected", "found", "sock").visible).toBe(false);
  });

  it("shows a neutral checking message with no action while the engine status is still unknown", () => {
    const decision = decideConnectionBanner("unavailable", null, "sock");
    expect(decision.visible).toBe(true);
    expect(decision.action).toBeNull();
    expect(decision.message).not.toBe("");
  });

  it("unavailable + engine missing: 'herdr engine is not installed' + Open Setup", () => {
    const decision = decideConnectionBanner("unavailable", "missing", "\\\\.\\pipe\\herdr");
    expect(decision.visible).toBe(true);
    expect(decision.message).toBe("herdr engine is not installed");
    expect(decision.action).toBe("open_setup");
  });

  it("unavailable + engine broken: same Open Setup guidance as missing", () => {
    const decision = decideConnectionBanner("unavailable", "broken", "\\\\.\\pipe\\herdr");
    expect(decision.message).toBe("herdr engine is not installed");
    expect(decision.action).toBe("open_setup");
  });

  it("unavailable + engine found: keeps the existing 'not reachable... retrying' + Start herdr", () => {
    const decision = decideConnectionBanner("unavailable", "found", "\\\\.\\pipe\\herdr");
    expect(decision.message).toContain("not reachable");
    expect(decision.message).toContain("\\\\.\\pipe\\herdr");
    expect(decision.action).toBe("start_herdr");
  });

  it("disconnected behaves the same as unavailable for a missing engine", () => {
    const decision = decideConnectionBanner("disconnected", "missing", "sock");
    expect(decision.visible).toBe(true);
    expect(decision.action).toBe("open_setup");
  });

  it("disconnected behaves the same as unavailable for a found engine", () => {
    const decision = decideConnectionBanner("disconnected", "found", "sock");
    expect(decision.action).toBe("start_herdr");
  });
});
