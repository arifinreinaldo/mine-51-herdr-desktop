import { describe, expect, it } from "vitest";
import { agentDisplayName, agentTaskTitle } from "../../src/agentText";

const base = { display_agent: null, agent: null, name: null, title: null, terminal_title_stripped: null };

describe("agentDisplayName", () => {
  it("falls back display_agent → agent → name → 'agent'", () => {
    expect(agentDisplayName({ ...base, display_agent: "Claude" , agent: "claude" })).toBe("Claude");
    expect(agentDisplayName({ ...base, agent: "claude" })).toBe("claude");
    expect(agentDisplayName({ ...base, name: "n" })).toBe("n");
    expect(agentDisplayName(base)).toBe("agent");
  });
});

describe("agentTaskTitle", () => {
  it("prefers title, then the stripped terminal title", () => {
    expect(agentTaskTitle({ ...base, title: "running tests", terminal_title_stripped: "x" })).toBe("running tests");
    expect(agentTaskTitle({ ...base, terminal_title_stripped: "deploy worker" })).toBe("deploy worker");
  });
  it("drops titles that are only a program path", () => {
    expect(agentTaskTitle({ ...base, terminal_title_stripped: String.raw`C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe` })).toBeNull();
    expect(agentTaskTitle({ ...base, terminal_title_stripped: "pwsh.exe" })).toBeNull();
    expect(agentTaskTitle({ ...base, terminal_title_stripped: "\\\\server\\share" })).toBeNull();
    expect(agentTaskTitle({ ...base, terminal_title_stripped: "   " })).toBeNull();
  });
});
