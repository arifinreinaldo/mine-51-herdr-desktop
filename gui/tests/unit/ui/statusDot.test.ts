// @vitest-environment jsdom
//
// UX pass 1 spec §2 "Status dots get distinct shapes as well as colours ...
// Every dot gets role="img" and aria-label="<status>"."

import { describe, expect, it } from "vitest";
import { createStatusDot, statusWord, type AgentStatus } from "../../../src/ui/statusDot";

const STATUSES: readonly AgentStatus[] = ["working", "blocked", "done", "idle", "unknown"];

describe("createStatusDot", () => {
  it("sets role=img and aria-label=<status word> for every status", () => {
    for (const status of STATUSES) {
      const dot = createStatusDot(status);
      expect(dot.getAttribute("role")).toBe("img");
      expect(dot.getAttribute("aria-label")).toBe(statusWord(status));
    }
  });

  it("classes every dot status-dot and status-dot--<status>, distinct per status", () => {
    const classNames = STATUSES.map((status) => createStatusDot(status).className);
    expect(new Set(classNames).size).toBe(STATUSES.length);
    for (const status of STATUSES) {
      expect(createStatusDot(status).className).toBe(`status-dot status-dot--${status}`);
    }
  });
});

describe("statusWord", () => {
  it("returns the exact words the spec names", () => {
    expect(statusWord("working")).toBe("working");
    expect(statusWord("blocked")).toBe("blocked");
    expect(statusWord("done")).toBe("done");
    expect(statusWord("idle")).toBe("idle");
    expect(statusWord("unknown")).toBe("unknown");
  });
});
