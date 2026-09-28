import { describe, expect, it } from "vitest";
import {
  canExecute,
  completeStep,
  deriveProviderCardState,
  engineStepNeedsInstallFlow,
  goToStep,
  grantConsent,
  initialWizardState,
  isWizardDone,
  newWizardRunSummary,
  nodeSatisfies,
  parseNodeMajor,
  requestConsent,
  skipStep,
  splitKnownAndMoreIntegrations,
  WIZARD_STEPS,
  type IntegrationInfo,
} from "../../../src/wizard/logic";
import { providerById } from "../../../src/wizard/providers";

// -- step state machine (spec §4, §9 "skip, finish later, done") --

describe("wizard step state machine", () => {
  it("starts on the first step, everything pending", () => {
    const state = initialWizardState();
    expect(state.active).toBe("engine");
    for (const id of WIZARD_STEPS) expect(state.status[id]).toBe("pending");
  });

  it("completing the active step advances to the next pending one", () => {
    let state = initialWizardState();
    state = completeStep(state, "engine");
    expect(state.status.engine).toBe("completed");
    expect(state.active).toBe("providers");
  });

  it("skipping the active step also advances", () => {
    let state = initialWizardState();
    state = skipStep(state, "engine");
    expect(state.status.engine).toBe("skipped");
    expect(state.active).toBe("providers");
  });

  it("completing a step that is not the active one does not move active", () => {
    let state = initialWizardState();
    state = goToStep(state, "usage");
    state = completeStep(state, "engine");
    expect(state.status.engine).toBe("completed");
    expect(state.active).toBe("usage");
  });

  it("goToStep jumps directly regardless of status (the left-column list)", () => {
    const state = goToStep(initialWizardState(), "done");
    expect(state.active).toBe("done");
  });

  it("is not done while any step is pending", () => {
    expect(isWizardDone(initialWizardState())).toBe(false);
  });

  it("is done once every step is completed or skipped", () => {
    let state = initialWizardState();
    for (const id of WIZARD_STEPS) state = skipStep(state, id);
    expect(isWizardDone(state)).toBe(true);
  });

  it("a mix of completed and skipped steps counts as done", () => {
    let state = initialWizardState();
    state = completeStep(state, "engine");
    state = skipStep(state, "providers");
    state = skipStep(state, "usage");
    state = skipStep(state, "workspace");
    state = completeStep(state, "done");
    expect(isWizardDone(state)).toBe(true);
  });

  it("completing the last step lands on Done, not past the end", () => {
    let state = initialWizardState();
    for (const id of WIZARD_STEPS) {
      if (id !== "done") state = skipStep(state, id);
    }
    expect(state.active).toBe("done");
    state = completeStep(state, "done");
    expect(state.active).toBe("done");
  });

  it("'finish later' is just closing the wizard: it never mutates step status", () => {
    // There is no `finishLater()` mutator in the pure state machine on
    // purpose (spec §4): the caller simply stops rendering the overlay and
    // leaves `firstRunComplete=false` in settings, without touching any
    // step's completed/skipped/pending status.
    const before = initialWizardState();
    const stillPending = WIZARD_STEPS.filter((id) => before.status[id] === "pending");
    expect(stillPending).toEqual([...WIZARD_STEPS]);
  });
});

// -- provider card state (spec §4.2, §9 "every state combination") --

function info(target: string, available: boolean, state: IntegrationInfo["state"]): IntegrationInfo {
  return { target, label: target, command: target, available, state };
}

describe("deriveProviderCardState", () => {
  const claude = providerById("claude")!;
  const gemini = providerById("gemini")!;
  const codex = providerById("codex")!;

  it("not_installed + unavailable: offers install, no connect, no sign-in", () => {
    const card = deriveProviderCardState(claude, info("claude", false, "not_installed"), undefined, null);
    expect(card.available).toBe(false);
    expect(card.showInstall).toBe(true);
    expect(card.showConnect).toBe(false);
    expect(card.showSignIn).toBe(false);
  });

  it("available + not_installed: offers connect and sign-in, no install", () => {
    const card = deriveProviderCardState(claude, info("claude", true, "not_installed"), undefined, null);
    expect(card.showInstall).toBe(false);
    expect(card.showConnect).toBe(true);
    expect(card.showSignIn).toBe(true);
  });

  it("available + outdated: still offers connect (state != current)", () => {
    const card = deriveProviderCardState(claude, info("claude", true, "outdated"), undefined, null);
    expect(card.showConnect).toBe(true);
  });

  it("available + current: no connect action left", () => {
    const card = deriveProviderCardState(claude, info("claude", true, "current"), undefined, null);
    expect(card.showConnect).toBe(false);
    expect(card.showSignIn).toBe(true);
  });

  it("unavailable + current (edge case): still offers install, no connect", () => {
    // Not a state herdr should normally report, but the derivation must
    // not crash or contradict itself on it.
    const card = deriveProviderCardState(claude, info("claude", false, "current"), undefined, null);
    expect(card.showInstall).toBe(true);
    expect(card.showConnect).toBe(false);
  });

  it("no herdr info at all is treated as not_installed/unavailable", () => {
    const card = deriveProviderCardState(claude, undefined, undefined, null);
    expect(card.available).toBe(false);
    expect(card.integrationState).toBe("not_installed");
    expect(card.showInstall).toBe(true);
  });

  it("Gemini (no herdr target) uses geminiAvailable, never herdrInfo", () => {
    const unavailable = deriveProviderCardState(gemini, undefined, false, null);
    expect(unavailable.available).toBe(false);
    expect(unavailable.integrationState).toBeNull();
    expect(unavailable.showConnect).toBe(false); // Gemini has no Connect action

    const available = deriveProviderCardState(gemini, undefined, true, null);
    expect(available.available).toBe(true);
    expect(available.showConnect).toBe(false);
    expect(available.showSignIn).toBe(true);
  });

  it("needsNode is set when unavailable and Node is missing, for an npm-based card", () => {
    const card = deriveProviderCardState(codex, info("codex", false, "not_installed"), undefined, null);
    expect(card.needsNode).toBe(true);
  });

  it("needsNode is false once available, even if Node would otherwise be too old", () => {
    const card = deriveProviderCardState(codex, info("codex", true, "current"), undefined, "18.0.0");
    expect(card.needsNode).toBe(false);
  });

  it("needsNode is never set for a native-installer card (no Node minimum)", () => {
    const card = deriveProviderCardState(claude, info("claude", false, "not_installed"), undefined, null);
    expect(card.needsNode).toBe(false);
  });
});

// -- Node-version gate (spec §4.2, §9) --

describe("node version gate", () => {
  it("parses a v-prefixed version", () => {
    expect(parseNodeMajor("v20.10.0")).toBe(20);
  });

  it("parses a bare version", () => {
    expect(parseNodeMajor("22.1.0")).toBe(22);
  });

  it("null version parses to null", () => {
    expect(parseNodeMajor(null)).toBeNull();
  });

  it("no minimum is always satisfied", () => {
    expect(nodeSatisfies(null, null)).toBe(true);
  });

  it("this machine's Node 20.10 satisfies OpenCode's >= 18 but not Codex's >= 22", () => {
    expect(nodeSatisfies("20.10.0", 18)).toBe(true);
    expect(nodeSatisfies("20.10.0", 22)).toBe(false);
  });

  it("exactly the minimum major satisfies", () => {
    expect(nodeSatisfies("22.0.0", 22)).toBe(true);
  });

  it("missing Node never satisfies a real minimum", () => {
    expect(nodeSatisfies(null, 18)).toBe(false);
  });
});

// -- "More (N)" grouping (spec §4.2, §9 "including snake_case targets") --

describe("splitKnownAndMoreIntegrations", () => {
  const known = new Set(["claude", "codex", "opencode", "copilot", "cursor"]);

  it("keeps the top 5 herdr targets out of More", () => {
    const infos = [info("claude", true, "current"), info("codex", false, "not_installed")];
    const { known: knownList, more } = splitKnownAndMoreIntegrations(infos, known);
    expect(knownList).toHaveLength(2);
    expect(more).toHaveLength(0);
  });

  it("puts every other target in More, including snake_case ones", () => {
    const infos = [
      info("claude", true, "current"),
      info("antigravity_cli", false, "not_installed"),
      info("pi", true, "outdated"),
    ];
    const { known: knownList, more } = splitKnownAndMoreIntegrations(infos, known);
    expect(knownList.map((i) => i.target)).toEqual(["claude"]);
    expect(more.map((i) => i.target)).toEqual(["antigravity_cli", "pi"]);
  });

  it("an empty integration list produces empty groups", () => {
    const { known: knownList, more } = splitKnownAndMoreIntegrations([], known);
    expect(knownList).toEqual([]);
    expect(more).toEqual([]);
  });
});

// -- consent gate (spec §4.2/§5, §9 "no command is typed before consent") --

describe("consent gate", () => {
  it("refuses execution with no consent flow at all", () => {
    expect(canExecute(null)).toBe(false);
  });

  it("refuses execution while only awaiting consent", () => {
    const flow = requestConsent("claude", "irm https://claude.ai/install.ps1 | iex");
    expect(canExecute(flow)).toBe(false);
  });

  it("allows execution only after consent is explicitly granted", () => {
    const flow = grantConsent(requestConsent("claude", "irm https://claude.ai/install.ps1 | iex"));
    expect(canExecute(flow)).toBe(true);
  });

  it("granting consent never mutates the original flow object", () => {
    const original = requestConsent("codex", "npm install -g @openai/codex");
    grantConsent(original);
    expect(original.state).toBe("awaiting");
  });
});

// -- engine step install decision (Cowbell rebrand spec §B: no bundled
// version to compare against any more) --

describe("engineStepNeedsInstallFlow", () => {
  it("does not need the install flow when found", () => {
    expect(engineStepNeedsInstallFlow({ kind: "found" })).toBe(false);
  });

  it("needs the install flow when missing", () => {
    expect(engineStepNeedsInstallFlow({ kind: "missing" })).toBe(true);
  });

  it("needs the install flow when broken", () => {
    expect(engineStepNeedsInstallFlow({ kind: "broken" })).toBe(true);
  });
});

// -- wizard-run summary (spec finding #11 "Done step shows a summary") --

describe("newWizardRunSummary", () => {
  it("starts with every fact false/empty", () => {
    const summary = newWizardRunSummary();
    expect(summary.herdrInstalled).toBe(false);
    expect(summary.serverStarted).toBe(false);
    expect(summary.providersConnected).toEqual([]);
    expect(summary.statuslineInstalled).toBe(false);
  });
});
