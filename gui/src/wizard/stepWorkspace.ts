// Wizard step 4 -- First workspace (Phase 1.6 spec §4.4): the existing New
// Workspace… flow, plus an optional "Start <provider> here".

import { api, invokeSafe, showErrorNotice } from "../appApi";
import { appState } from "../appState";
import { newWorkspaceFlow } from "../appWorkspaceFlows";
import { sendCommandLineToPane } from "../appTerminalInput";
import type { IntegrationInfo } from "./logic";
import { button, el } from "./dom";
import { waitForFocusedPaneId } from "./paneFocus";
import { TOP_PROVIDER_IDS, providerById, type ProviderRow } from "./providers";

/** The first provider already *connected* to herdr (`state === "current"`),
 * falling back to the first merely *available* one, in `TOP_PROVIDER_IDS`
 * order (finding #11) -- re-checked here rather than threaded from step
 * 2's own (private) state, so this step has no coupling to how step 2
 * tracks its cards. Gemini has no herdr target/state, so it can never be
 * "connected" and only ever qualifies in the fallback pass. */
async function firstConnectedOrAvailableProvider(): Promise<ProviderRow | undefined> {
  const [listResult, gemini] = await Promise.all([
    api<{ integrations: IntegrationInfo[] }>("integration.list", {}),
    invokeSafe<string | undefined>("gemini_version"),
  ]);
  const integrations = listResult?.integrations ?? [];
  const geminiAvailable = gemini !== undefined && gemini !== null;

  for (const id of TOP_PROVIDER_IDS) {
    const row = providerById(id);
    if (!row?.herdrTarget) continue;
    const info = integrations.find((i) => i.target === row.herdrTarget);
    if (info?.available && info.state === "current") return row;
  }
  for (const id of TOP_PROVIDER_IDS) {
    const row = providerById(id);
    if (!row) continue;
    const available = row.herdrTarget
      ? Boolean(integrations.find((i) => i.target === row.herdrTarget)?.available)
      : geminiAvailable;
    if (available) return row;
  }
  return undefined;
}

export function renderWorkspaceStep(container: HTMLElement, onComplete: () => void, onSkip: () => void): () => void {
  let disposed = false;

  container.innerHTML = "";
  container.appendChild(el("h3", undefined, "First workspace"));
  container.appendChild(el("p", "wizard-step-description", "Pick a folder to open as your first workspace."));

  let footerEl = footerRow(false);
  const pickBtn = button("New Workspace…", () => {
    void (async () => {
      const previousPaneId = appState.snapshot?.focused_pane_id ?? null;
      const before = appState.snapshot?.workspaces.length ?? 0;
      await newWorkspaceFlow();
      if (disposed) return;
      const after = appState.snapshot?.workspaces.length ?? 0;
      pickBtn.remove();
      if (after > before) {
        container.appendChild(el("p", undefined, "Workspace created."));
        renderStartHere(previousPaneId);
      }
      footerEl.remove();
      footerEl = footerRow(true);
      container.appendChild(footerEl);
    })();
  });
  container.appendChild(pickBtn);
  container.appendChild(footerEl);

  function renderStartHere(previousPaneId: string | null): void {
    void (async () => {
      const target = await firstConnectedOrAvailableProvider();
      if (disposed || !target) return;
      const startBtn = button(`Start ${target.card} here`, () => {
        void (async () => {
          startBtn.disabled = true;
          // Finding #6/#11: verify the new workspace's pane actually
          // focused before typing into it -- never fall back to whatever
          // pane happened to be focused before.
          const paneId = await waitForFocusedPaneId(previousPaneId);
          if (!paneId) {
            showErrorNotice(`Could not find the new workspace's pane; "${target.launchCommand}" was not typed.`);
            startBtn.disabled = false;
            return;
          }
          await sendCommandLineToPane(paneId, target.launchCommand);
        })();
      });
      container.appendChild(startBtn);
    })();
  }

  function footerRow(showContinue: boolean): HTMLElement {
    const row = el("div", "wizard-step-footer");
    if (showContinue) row.appendChild(button("Continue", onComplete, "btn btn--primary"));
    row.appendChild(button("Skip", onSkip, "btn wizard-link"));
    return row;
  }

  return () => {
    disposed = true;
  };
}
