import { describe, expect, it } from "vitest";
import { PROVIDER_TABLE, TOP_PROVIDER_IDS, providerByHerdrTarget, providerById } from "../../../src/wizard/providers";

describe("PROVIDER_TABLE", () => {
  it("has exactly the 6 curated cards, each with a unique id", () => {
    expect(PROVIDER_TABLE).toHaveLength(6);
    const ids = new Set(PROVIDER_TABLE.map((r) => r.id));
    expect(ids.size).toBe(6);
  });

  it("every row has a non-empty install and sign-in command", () => {
    for (const row of PROVIDER_TABLE) {
      expect(row.installCommand.length).toBeGreaterThan(0);
      expect(row.signInCommand.length).toBeGreaterThan(0);
      expect(row.source.length).toBeGreaterThan(0);
    }
  });

  it("every row has a non-empty launch command, matching the spec's exact bare-CLI names (finding #11)", () => {
    const launchCommands: Record<string, string> = {
      claude: "claude",
      codex: "codex",
      opencode: "opencode",
      copilot: "copilot",
      cursor: "agent",
      gemini: "gemini",
    };
    for (const row of PROVIDER_TABLE) {
      expect(row.launchCommand.length).toBeGreaterThan(0);
      expect(row.launchCommand).toBe(launchCommands[row.id]);
    }
  });

  it("only Gemini has no herdr target", () => {
    const withoutTarget = PROVIDER_TABLE.filter((r) => r.herdrTarget === null);
    expect(withoutTarget.map((r) => r.id)).toEqual(["gemini"]);
  });

  it("herdr targets are snake_case strings matching IntegrationTarget's rename_all", () => {
    for (const row of PROVIDER_TABLE) {
      if (row.herdrTarget) expect(row.herdrTarget).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("TOP_PROVIDER_IDS matches every table row, in the spec's exact order", () => {
    expect(TOP_PROVIDER_IDS).toEqual(["claude", "codex", "opencode", "copilot", "cursor", "gemini"]);
    for (const id of TOP_PROVIDER_IDS) expect(providerById(id)).toBeDefined();
  });

  it("providerByHerdrTarget resolves each herdr-target row and nothing else", () => {
    expect(providerByHerdrTarget("claude")?.id).toBe("claude");
    expect(providerByHerdrTarget("cursor")?.id).toBe("cursor");
    expect(providerByHerdrTarget("antigravity_cli")).toBeUndefined();
  });

  it("Node minimums match this machine's known-relevant versions (spec §4.2)", () => {
    expect(providerById("codex")?.nodeMinimumMajor).toBe(22);
    expect(providerById("copilot")?.nodeMinimumMajor).toBe(22);
    expect(providerById("gemini")?.nodeMinimumMajor).toBe(20);
    expect(providerById("opencode")?.nodeMinimumMajor).toBe(18);
    expect(providerById("claude")?.nodeMinimumMajor).toBeNull();
    expect(providerById("cursor")?.nodeMinimumMajor).toBeNull();
  });
});
