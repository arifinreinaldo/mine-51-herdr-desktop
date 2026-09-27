// Wizard step 2 -- Agent providers (Phase 1.6 spec §4.2).

import { api, invokeSafe, showErrorNotice } from "../appApi";
import { appState } from "../appState";
import { sendCommandLineToPane } from "../appTerminalInput";
import { button, el, renderInlineConsent } from "./dom";
import {
  canExecute,
  deriveProviderCardState,
  grantConsent,
  requestConsent,
  splitKnownAndMoreIntegrations,
  type ConsentFlow,
  type IntegrationInfo,
  type ProviderCardState,
  type WizardRunSummary,
} from "./logic";
import { waitForFocusedPaneId } from "./paneFocus";
import { PROVIDER_TABLE, TOP_PROVIDER_IDS, providerById, type ProviderRow } from "./providers";

const KNOWN_HERDR_TARGETS: ReadonlySet<string> = new Set(
  PROVIDER_TABLE.map((row) => row.herdrTarget).filter((t): t is Exclude<typeof t, null> => t !== null),
);

const REFRESH_INTERVAL_MS = 5000;
// Spec §4.2: "Wait for that pane's first surface frame (shell startup),
// with a 5s cap." The renderer has no per-pane "first frame for pane X"
// signal exposed to JS (the compact surface stream carries no pane IDs --
// only `pane_at`/geometry does); this fixed grace period is a documented
// simplification of that wait, safely inside the 5s cap.
const SHELL_STARTUP_GRACE_MS = 800;

interface ProvidersStepState {
  integrations: IntegrationInfo[];
  geminiAvailable: boolean | undefined;
  nodeVersion: string | null;
  signedIn: Set<string>;
  consent: ConsentFlow | null;
  /** The provider id whose consent is pending, and what confirming it does. */
  consentAction: { providerId: string; kind: "install" | "signIn" | "node" } | null;
  busy: Set<string>;
  /** The most recent `integration.install` result, rendered by the *next*
   * `render()` call (spec §4.2 "Show the `details.messages`"). Routed
   * through state rather than a captured DOM node: `render()` rebuilds the
   * whole step's DOM on every state change, so any node captured by an
   * earlier render is stale/detached by the time an async call resolves. */
  lastConnectResult: { providerId: string; card: string; messages: string[] } | null;
  /** Finding #10 "Node gate": once a winget Node install has actually run
   * this session, the GUI's own process still has the `PATH` it launched
   * with -- only a fresh process picks up the new one. Sticky once true,
   * across every card, until the user restarts. */
  nodeRestartNeeded: boolean;
}

function newState(): ProvidersStepState {
  return {
    integrations: [],
    geminiAvailable: undefined,
    nodeVersion: null,
    signedIn: new Set(),
    consent: null,
    consentAction: null,
    busy: new Set(),
    lastConnectResult: null,
    nodeRestartNeeded: false,
  };
}

async function refreshData(state: ProvidersStepState): Promise<void> {
  const [listResult, gemini, node] = await Promise.all([
    api<{ integrations: IntegrationInfo[] }>("integration.list", {}),
    invokeSafe<string | undefined>("gemini_version"),
    invokeSafe<string | undefined>("node_version"),
  ]);
  state.integrations = listResult?.integrations ?? [];
  state.geminiAvailable = gemini !== undefined && gemini !== null;
  state.nodeVersion = node ?? null;
}

/** Consent -> `tab.create` in the focused workspace -> wait for its pane to
 * focus and the shell to start -> type the command through the existing
 * input path (spec §4.2 steps 2-4). Finding #6 "typing into the wrong
 * pane": if `tab.create` itself fails/returns nothing, or the focused pane
 * never actually changes to a new one, this shows a notice and types
 * NOTHING -- never falls back to whatever pane happened to be focused
 * before. */
async function runInPane(label: string, command: string): Promise<void> {
  const previousPaneId = appState.snapshot?.focused_pane_id ?? null;
  const created = await api("tab.create", {
    workspace_id: appState.snapshot?.focused_workspace_id ?? undefined,
    focus: true,
    label,
  });
  if (created === undefined) {
    showErrorNotice(`Could not open a new tab; "${command}" was not typed.`);
    return;
  }
  const paneId = await waitForFocusedPaneId(previousPaneId);
  if (!paneId) {
    showErrorNotice(`Could not find the new pane; "${command}" was not typed.`);
    return;
  }
  await new Promise((resolve) => window.setTimeout(resolve, SHELL_STARTUP_GRACE_MS));
  await sendCommandLineToPane(paneId, command);
}

function cardForRow(row: ProviderRow, state: ProvidersStepState): ProviderCardState {
  const herdrInfo = row.herdrTarget ? state.integrations.find((i) => i.target === row.herdrTarget) : undefined;
  return deriveProviderCardState(row, herdrInfo, state.geminiAvailable, state.nodeVersion);
}

function renderConsentBox(container: HTMLElement, state: ProvidersStepState, render: () => void): boolean {
  if (!state.consent || !state.consentAction) return false;
  renderInlineConsent(
    container,
    state.consent.command,
    () => {
      const granted = grantConsent(state.consent!);
      const action = state.consentAction!;
      state.consentAction = null;
      const consentedCommand = granted.command;
      // Finding #15: actually gate on `canExecute` (the same gate
      // `logic.test.ts` already covers in isolation) before typing
      // anything, rather than trusting that this call site can only ever
      // be reached once consent is granted.
      const shouldRun = canExecute(granted);
      state.consent = null;
      if (!shouldRun) {
        render();
        return;
      }
      void (async () => {
        state.busy.add(action.providerId);
        render();
        try {
          await runInPane(`${action.kind} ${action.providerId}`, consentedCommand);
          if (action.kind === "signIn") {
            // Marked done by the explicit "I've signed in" click, not here.
          }
        } finally {
          state.busy.delete(action.providerId);
          if (action.kind === "node") {
            state.nodeVersion = (await invokeSafe<string | undefined>("node_version")) ?? null;
            state.nodeRestartNeeded = true;
          }
          render();
        }
      })();
    },
    () => {
      state.consent = null;
      state.consentAction = null;
      render();
    },
  );
  return true;
}

function renderProviderCard(
  container: HTMLElement,
  row: ProviderRow,
  card: ProviderCardState,
  state: ProvidersStepState,
  render: () => void,
  summary: WizardRunSummary,
): void {
  const cardEl = el("div", "wizard-provider-card");
  const header = el("div", "wizard-provider-card__header");
  header.appendChild(el("b", undefined, row.card));
  header.appendChild(
    el("span", card.available ? "wizard-tag wizard-tag--ok" : "wizard-tag", card.available ? "Detected" : "Not installed"),
  );
  cardEl.appendChild(header);

  if (row.herdrTarget && card.integrationState) {
    cardEl.appendChild(el("div", "wizard-provider-card__meta", `herdr hook: ${card.integrationState.replace("_", " ")}`));
  }

  const isBusy = state.busy.has(row.id);
  const isConsentOpen = state.consentAction?.providerId === row.id;

  if (isConsentOpen) {
    renderConsentBox(cardEl, state, render);
  } else if (isBusy) {
    cardEl.appendChild(el("p", "wizard-provider-card__meta", "Running in a herdr pane…"));
  } else {
    const actions = el("div", "wizard-provider-card__actions");

    if (card.needsNode) {
      if (state.nodeRestartNeeded) {
        // Finding #10 "Node gate": the GUI's own process still has the
        // `PATH` it launched with, so re-checking `node --version` from
        // here can't see a Node a winget install just added -- only a
        // fresh process can.
        cardEl.appendChild(
          el("p", "wizard-provider-card__meta", "Restart herdr GUI so it sees the new Node on PATH."),
        );
        actions.appendChild(button("Restart GUI", () => void invokeSafe("restart_gui"), "btn btn--primary"));
      } else {
        actions.appendChild(
          button(`Install Node.js (≥ ${row.nodeMinimumMajor})`, () => {
            state.consent = requestConsent(row.id, "winget install --id OpenJS.NodeJS.LTS -e");
            state.consentAction = { providerId: row.id, kind: "node" };
            render();
          }),
        );
      }
    } else if (card.showInstall) {
      actions.appendChild(
        button(`Install ${row.card}`, () => {
          state.consent = requestConsent(row.id, row.installCommand);
          state.consentAction = { providerId: row.id, kind: "install" };
          render();
        }),
      );
    }

    if (card.showConnect) {
      actions.appendChild(
        button("Connect to herdr", () => {
          void (async () => {
            state.busy.add(row.id);
            render();
            const result = await api<{ details: { messages: string[] } }>("integration.install", {
              target: row.herdrTarget,
            });
            state.busy.delete(row.id);
            if (result?.details?.messages) {
              state.lastConnectResult = { providerId: row.id, card: row.card, messages: result.details.messages };
              if (!summary.providersConnected.includes(row.card)) summary.providersConnected.push(row.card);
            }
            await refreshData(state);
            render();
          })();
        }),
      );
    }

    if (card.showSignIn && !state.signedIn.has(row.id)) {
      actions.appendChild(
        button("Sign in", () => {
          state.consent = requestConsent(row.id, row.signInCommand);
          state.consentAction = { providerId: row.id, kind: "signIn" };
          render();
        }),
      );
      actions.appendChild(
        button(
          "I've signed in",
          () => {
            state.signedIn.add(row.id);
            render();
          },
          "btn wizard-link",
        ),
      );
    } else if (state.signedIn.has(row.id)) {
      actions.appendChild(el("span", "wizard-tag wizard-tag--ok", "Signed in"));
    }

    cardEl.appendChild(actions);
  }

  container.appendChild(cardEl);
}

function renderConnectResultNote(container: HTMLElement, result: ProvidersStepState["lastConnectResult"]): void {
  if (!result) return;
  const row = providerById(result.providerId);
  const note = el("div", "wizard-note");
  note.appendChild(
    el(
      "p",
      undefined,
      `Connected ${result.card} to herdr. This adds herdr hooks to its settings, and is reversible with ` +
        `"herdr integration uninstall ${row?.herdrTarget ?? result.providerId}".`,
    ),
  );
  for (const message of result.messages) note.appendChild(el("p", "wizard-provider-card__meta", message));
  container.appendChild(note);
}

function renderMoreSection(container: HTMLElement, more: IntegrationInfo[], expanded: { value: boolean }, render: () => void): void {
  if (more.length === 0) return;
  const toggle = button(`${expanded.value ? "Hide" : "More"} (${more.length})`, () => {
    expanded.value = !expanded.value;
    render();
  }, "btn wizard-link");
  container.appendChild(toggle);
  if (!expanded.value) return;
  const list = el("div", "wizard-provider-more");
  for (const info of more) {
    const row = el("div", "wizard-provider-more__row");
    row.appendChild(el("span", undefined, info.label));
    row.appendChild(el("span", info.available ? "wizard-tag wizard-tag--ok" : "wizard-tag", info.available ? "Detected" : "Not installed"));
    row.appendChild(el("span", "wizard-provider-card__meta", info.state.replace("_", " ")));
    list.appendChild(row);
  }
  container.appendChild(list);
}

export function renderProvidersStep(
  container: HTMLElement,
  onComplete: () => void,
  onSkip: () => void,
  summary: WizardRunSummary,
): () => void {
  const state = newState();
  const moreExpanded = { value: false };
  let disposed = false;
  let refreshTimer: number | undefined;

  function render(): void {
    if (disposed) return;
    container.innerHTML = "";
    container.appendChild(el("h3", undefined, "Agent providers"));
    container.appendChild(
      el(
        "p",
        "wizard-step-description",
        "Each CLI signs in through its own login. herdr never reads, stores, or forwards provider tokens.",
      ),
    );
    renderConnectResultNote(container, state.lastConnectResult);

    const { known, more } = splitKnownAndMoreIntegrations(state.integrations, KNOWN_HERDR_TARGETS);
    const grid = el("div", "wizard-provider-grid");
    for (const id of TOP_PROVIDER_IDS) {
      const row = providerById(id);
      if (!row) continue;
      renderProviderCard(grid, row, cardForRow(row, state), state, render, summary);
    }
    container.appendChild(grid);

    // `known` (matched herdr targets not in the curated top list, if any)
    // folds into "more" too -- only the exact TOP_PROVIDER_IDS get a
    // curated card.
    const moreAll = [...more, ...known.filter((i) => !TOP_PROVIDER_IDS.some((id) => providerById(id)?.herdrTarget === i.target))];
    renderMoreSection(container, moreAll, moreExpanded, render);

    const footer = el("div", "wizard-step-footer");
    footer.appendChild(button("Re-check", () => void refreshAndRender(), "btn"));
    footer.appendChild(button("Continue", onComplete, "btn btn--primary"));
    footer.appendChild(button("Skip", onSkip, "btn wizard-link"));
    container.appendChild(footer);
  }

  async function refreshAndRender(): Promise<void> {
    await refreshData(state);
    render();
  }

  void refreshAndRender();
  refreshTimer = window.setInterval(() => void refreshAndRender(), REFRESH_INTERVAL_MS);

  return () => {
    disposed = true;
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
  };
}
