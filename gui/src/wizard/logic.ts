// Pure wizard logic (Phase 1.6 spec §4, §9 Vitest list): the step state
// machine, provider card state derivation, the "More (N)" grouping, the
// consent gate, and the Node-version gate. No DOM here -- `wizard.ts` is
// the controller that wires these to the page and to Rust commands.

import type { ProviderHerdrTarget, ProviderRow } from "./providers";

// ---------------------------------------------------------------------
// Step state machine (spec §4 "skip, finish later, done")
// ---------------------------------------------------------------------

export type WizardStepId = "engine" | "providers" | "usage" | "workspace" | "done";

export const WIZARD_STEPS: readonly WizardStepId[] = ["engine", "providers", "usage", "workspace", "done"];

export type StepStatus = "pending" | "completed" | "skipped";

export interface WizardState {
  active: WizardStepId;
  status: Readonly<Record<WizardStepId, StepStatus>>;
}

export function initialWizardState(): WizardState {
  const status = {} as Record<WizardStepId, StepStatus>;
  for (const id of WIZARD_STEPS) status[id] = "pending";
  return { active: WIZARD_STEPS[0], status };
}

function nextPendingStep(status: Readonly<Record<WizardStepId, StepStatus>>, from: WizardStepId): WizardStepId {
  const fromIndex = WIZARD_STEPS.indexOf(from);
  for (let i = fromIndex + 1; i < WIZARD_STEPS.length; i++) {
    if (status[WIZARD_STEPS[i]] === "pending") return WIZARD_STEPS[i];
  }
  // Nothing pending after this step: land on the last step (Done) so the
  // user always ends up somewhere real, never past the end of the list.
  return WIZARD_STEPS[WIZARD_STEPS.length - 1];
}

/** Marks `id` completed. If it was the active step, advances to the next
 * pending one (spec §4 "Every step can be skipped" walkthrough pattern). */
export function completeStep(state: WizardState, id: WizardStepId): WizardState {
  const status = { ...state.status, [id]: "completed" as StepStatus };
  return { active: id === state.active ? nextPendingStep(status, id) : state.active, status };
}

/** Marks `id` skipped (spec §4 "Every step can be skipped"). */
export function skipStep(state: WizardState, id: WizardStepId): WizardState {
  const status = { ...state.status, [id]: "skipped" as StepStatus };
  return { active: id === state.active ? nextPendingStep(status, id) : state.active, status };
}

/** The left-column "step list" lets the user jump to any step directly
 * (spec §4 "shape"), regardless of its status. */
export function goToStep(state: WizardState, id: WizardStepId): WizardState {
  return { ...state, active: id };
}

/** True once every step is completed or skipped -- nothing left pending.
 * "Finish later" (spec §4) never calls this: it just closes the wizard
 * while leaving `firstRunComplete=false`, without touching step status. */
export function isWizardDone(state: WizardState): boolean {
  return WIZARD_STEPS.every((id) => state.status[id] !== "pending");
}

// ---------------------------------------------------------------------
// Provider card state (spec §4.2 "Per card")
// ---------------------------------------------------------------------

export type IntegrationState = "not_installed" | "current" | "outdated";

/** Mirrors herdr's `IntegrationInfo` (`src/api/schema/integrations.rs`):
 * `target` is snake_case (spec §4.2: "Match cards by these strings, and
 * send them back verbatim"). */
export interface IntegrationInfo {
  target: string;
  label: string;
  command: string;
  available: boolean;
  state: IntegrationState;
}

export interface ProviderCardState {
  id: string;
  card: string;
  herdrTarget: ProviderHerdrTarget;
  available: boolean;
  /** `null` for a card with no herdr target (Gemini). */
  integrationState: IntegrationState | null;
  showInstall: boolean;
  showConnect: boolean;
  showSignIn: boolean;
  /** The Node prerequisite (spec §4.2) is unmet: offer the Node installer
   * before this card's own install command. */
  needsNode: boolean;
}

export function parseNodeMajor(version: string | null): number | null {
  if (!version) return null;
  const match = /^v?(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

export function nodeSatisfies(version: string | null, minimumMajor: number | null): boolean {
  if (minimumMajor === null) return true;
  const major = parseNodeMajor(version);
  return major !== null && major >= minimumMajor;
}

/** Derives one card's view state (spec §4.2's exact rules):
 * - `available`/`herdrInfo` comes from herdr for a herdr target, or from
 *   the GUI's own `gemini --version` check for Gemini.
 * - `showConnect` only for a herdr target that's available and not
 *   already `current`.
 * - `showInstall` only when not available.
 * - `needsNode` only matters while not yet available (once installed,
 *   whatever Node version got it there is already good enough). */
export function deriveProviderCardState(
  row: ProviderRow,
  herdrInfo: IntegrationInfo | undefined,
  geminiAvailable: boolean | undefined,
  nodeVersion: string | null,
): ProviderCardState {
  const available = row.herdrTarget !== null ? Boolean(herdrInfo?.available) : Boolean(geminiAvailable);
  const integrationState: IntegrationState | null = row.herdrTarget !== null ? herdrInfo?.state ?? "not_installed" : null;
  return {
    id: row.id,
    card: row.card,
    herdrTarget: row.herdrTarget,
    available,
    integrationState,
    showInstall: !available,
    showConnect: row.herdrTarget !== null && available && integrationState !== "current",
    showSignIn: available,
    needsNode: !available && !nodeSatisfies(nodeVersion, row.nodeMinimumMajor),
  };
}

// ---------------------------------------------------------------------
// "More (N)" grouping (spec §4.2 "The rest go behind 'More (N)'")
// ---------------------------------------------------------------------

/** Splits herdr's `integration.list` result into the cards this wizard
 * curates (`knownTargets`, matched by the exact snake_case string) and
 * everything else, which the "More (N)" section shows plainly. */
export function splitKnownAndMoreIntegrations(
  infos: readonly IntegrationInfo[],
  knownTargets: ReadonlySet<string>,
): { known: IntegrationInfo[]; more: IntegrationInfo[] } {
  const known: IntegrationInfo[] = [];
  const more: IntegrationInfo[] = [];
  for (const info of infos) {
    (knownTargets.has(info.target) ? known : more).push(info);
  }
  return { known, more };
}

// ---------------------------------------------------------------------
// Consent gate (spec §4.2/§5 "no command is typed before consent")
// ---------------------------------------------------------------------

export type ConsentState = "awaiting" | "granted";

export interface ConsentFlow {
  providerId: string;
  command: string;
  state: ConsentState;
}

export function requestConsent(providerId: string, command: string): ConsentFlow {
  return { providerId, command, state: "awaiting" };
}

export function grantConsent(flow: ConsentFlow): ConsentFlow {
  return { ...flow, state: "granted" };
}

/** The one gate every command-typing call site must pass (spec §5:
 * "only... after consent"): `null` or an ungranted flow both refuse. */
export function canExecute(flow: ConsentFlow | null): boolean {
  return flow !== null && flow.state === "granted";
}

// ---------------------------------------------------------------------
// Engine step install decision (Cowbell rebrand spec §B: no bundled
// version any more, so "found" is always enough)
// ---------------------------------------------------------------------

/** Whether wizard step 1 should show the "not installed" consent-install
 * flow, rather than the "found, starting the server" flow. Cowbell rebrand
 * spec §B: this build no longer bundles a herdr release to compare
 * versions against, so Missing/Broken need the install flow and Found
 * never does. */
export function engineStepNeedsInstallFlow(status: { kind: string }): boolean {
  return status.kind !== "found";
}

// ---------------------------------------------------------------------
// Wizard-run summary (finding #11 "Done step shows a summary of what this
// wizard run did")
// ---------------------------------------------------------------------

export interface WizardRunSummary {
  /** herdr ended this run installed and in a `Found` state (whether it
   * needed installing this run or was already there). */
  herdrInstalled: boolean;
  /** The herdr server was confirmed running by the end of step 1. */
  serverStarted: boolean;
  /** Provider card labels (`ProviderRow.card`) newly connected to herdr
   * ("Connect to herdr") during this run. */
  providersConnected: string[];
  /** The Claude usage tap ended this run installed (whether installed
   * this run or already present). Gates the Done step's Undo link. */
  statuslineInstalled: boolean;
}

export function newWizardRunSummary(): WizardRunSummary {
  return {
    herdrInstalled: false,
    serverStarted: false,
    providersConnected: [],
    statuslineInstalled: false,
  };
}
