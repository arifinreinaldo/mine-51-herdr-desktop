// The Setup wizard shell (Phase 1.6 spec §4, addendum §11 item 2): a
// full-window overlay, VS Code walkthrough pattern -- a left column of
// steps with their completion state, the active step's content on the
// right. Every step can be skipped; "Finish later" closes it without
// setting `firstRunComplete`. Opens only from herdr menu ▸ Setup… -- there
// is no first-run auto-open (spec addendum §11 item 2).

import { listen } from "@tauri-apps/api/event";
import { invokeOk, invokeSafe } from "../appApi";
import { appState, persistSettings } from "../appState";
import { closeActiveOverlay, notifyOverlayClosed, openOverlay } from "../ui/overlay";
import { focusKeyboardCapture } from "../keyboard/focusCapture";
import { button, el } from "./dom";
import {
  completeStep,
  engineInstallOffered,
  engineStepNeedsInstallFlow,
  goToStep,
  initialWizardState,
  isWizardDone,
  newWizardRunSummary,
  skipStep,
  WIZARD_STEPS,
  type WizardRunSummary,
  type WizardState,
  type WizardStepId,
} from "./logic";
import { renderProvidersStep } from "./stepProviders";
import { renderUsageStep } from "./stepUsage";
import { renderWorkspaceStep } from "./stepWorkspace";

const STEP_TITLES: Readonly<Record<WizardStepId, string>> = {
  engine: "herdr engine",
  providers: "Agent providers",
  usage: "Claude usage bar",
  workspace: "First workspace",
  done: "Done",
};

interface EngineStatusWire {
  kind: "missing" | "found" | "broken";
  path?: string;
  version?: string;
  error?: string;
  bundledVersion: string;
  needsInstall: boolean;
  /** Spec addendum §11.1: false for a dev build with no bundled herdr
   * engine (`HERDR_GUI_EMBED_ENGINE` unset at build time). */
  installAvailable: boolean;
}

let wizardOpen = false;

export function isWizardOpenNow(): boolean {
  return wizardOpen;
}

export function openWizard(): () => void {
  if (wizardOpen) return () => {};
  wizardOpen = true;

  const backdrop = el("div", "wizard-backdrop");
  const panel = el("div", "wizard-panel");
  const sidebar = el("div", "wizard-sidebar");
  // Spec addendum §11 item 2: "titled 'Setup'".
  const titleEl = el("h2", "wizard-title", "Setup");
  const stepListEl = el("div", "wizard-step-list");
  const content = el("div", "wizard-content");
  sidebar.appendChild(titleEl);
  sidebar.appendChild(stepListEl);
  const finishLaterBtn = button("Finish later", () => dispose(), "btn wizard-finish-later");
  sidebar.appendChild(finishLaterBtn);
  panel.appendChild(sidebar);
  panel.appendChild(content);
  backdrop.appendChild(panel);

  let state: WizardState = initialWizardState();
  let stepDispose: (() => void) | null = null;
  const runSummary: WizardRunSummary = newWizardRunSummary();

  function renderStepList(): void {
    stepListEl.innerHTML = "";
    for (const id of WIZARD_STEPS) {
      const row = el("div", `wizard-step-row wizard-step-row--${state.status[id]}` + (id === state.active ? " is-active" : ""));
      row.appendChild(el("span", "wizard-step-row__title", STEP_TITLES[id]));
      if (state.status[id] === "completed") row.appendChild(el("i", "codicon codicon-check"));
      else if (state.status[id] === "skipped") row.appendChild(el("span", "wizard-tag", "skipped"));
      row.addEventListener("click", () => {
        state = goToStep(state, id);
        renderAll();
      });
      stepListEl.appendChild(row);
    }
  }

  function advance(next: (s: WizardState, id: WizardStepId) => WizardState): void {
    const id = state.active;
    state = next(state, id);
    if (isWizardDone(state)) {
      finishWizard();
      return;
    }
    renderAll();
  }

  function renderStep(): void {
    stepDispose?.();
    stepDispose = null;
    content.innerHTML = "";
    switch (state.active) {
      case "engine":
        stepDispose = renderEngineStep(content, () => advance(completeStep), () => advance(skipStep), runSummary);
        break;
      case "providers":
        stepDispose = renderProvidersStep(content, () => advance(completeStep), () => advance(skipStep), runSummary);
        break;
      case "usage":
        stepDispose = renderUsageStep(content, () => advance(completeStep), () => advance(skipStep), runSummary);
        break;
      case "workspace":
        stepDispose = renderWorkspaceStep(content, () => advance(completeStep), () => advance(skipStep));
        break;
      case "done":
        stepDispose = renderDoneStep(content, () => finishWizard(), runSummary);
        break;
    }
  }

  function renderAll(): void {
    renderStepList();
    renderStep();
  }

  function finishWizard(): void {
    appState.settings.firstRunComplete = true;
    persistSettings();
    dispose();
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dispose();
    }
  };
  document.addEventListener("keydown", onKeydown, true);

  document.body.appendChild(backdrop);
  openOverlay(dispose);
  renderAll();

  function dispose(): void {
    wizardOpen = false;
    stepDispose?.();
    document.removeEventListener("keydown", onKeydown, true);
    backdrop.remove();
    notifyOverlayClosed(dispose);
    focusKeyboardCapture();
  }

  return dispose;
}

/** herdr menu ▸ Setup… -- the wizard's only trigger (spec addendum §11 item
 * 2: "No first-run wizard... opens only from herdr menu ▸ Setup…"). */
export function openSetupWizard(): void {
  closeActiveOverlay();
  openWizard();
}

// ---------------------------------------------------------------------
// Step 1 -- herdr engine (spec §4.1)
// ---------------------------------------------------------------------

function renderEngineStep(
  container: HTMLElement,
  onComplete: () => void,
  onSkip: () => void,
  summary: WizardRunSummary,
): () => void {
  let disposed = false;
  let unlistenInstallLog: (() => void) | null = null;

  function footer(showContinue: boolean, onSkip?: () => void): HTMLElement {
    const row = el("div", "wizard-step-footer");
    if (showContinue) row.appendChild(button("Continue", onComplete, "btn btn--primary"));
    if (onSkip) row.appendChild(button("Skip", onSkip, "btn wizard-link"));
    return row;
  }

  /** `justInstalled`: finding #2 "clean-machine ordering" -- right after
   * an install, use the guard-free force-start path instead of
   * `engine_ensure_server_started`. The reconnect loop's own auto-start
   * attempt shares a once-per-launch guard with that command; a start
   * immediately following an install must never share in a guard some
   * *other* attempt already claimed. */
  async function render(justInstalled = false): Promise<void> {
    if (disposed) return;
    container.innerHTML = "";
    container.appendChild(el("h3", undefined, "herdr engine"));
    const status = await invokeSafe<EngineStatusWire>("engine_status");
    if (disposed || !status) return;

    if (!engineStepNeedsInstallFlow(status)) {
      summary.herdrInstalled = true;
      container.appendChild(el("p", undefined, `herdr ${status.version} found at ${status.path}`));
      const startingEl = el("p", undefined, "Starting the server…");
      container.appendChild(startingEl);
      const started = justInstalled
        ? await invokeSafe<boolean>("engine_force_start_server")
        : await invokeSafe<boolean>("engine_ensure_server_started");
      if (disposed) return;
      if (started) {
        summary.serverStarted = true;
        startingEl.textContent = "Server running.";
        container.appendChild(footer(true));
      } else {
        startingEl.textContent = "Could not confirm the server started.";
        container.appendChild(
          button("Start herdr", () => {
            void (async () => {
              const ok = await invokeSafe<boolean>("engine_force_start_server");
              if (ok) {
                summary.serverStarted = true;
                await render();
              }
            })();
          }),
        );
        container.appendChild(footer(false, onSkip));
      }
      return;
    }

    // Finding #5 "older herdr never upgraded": Missing/Broken, or Found
    // but outdated (never a downgrade -- `needsInstall` already encodes
    // that on the Rust side).
    container.appendChild(
      el(
        "p",
        undefined,
        status.kind === "found"
          ? `herdr ${status.version} found — update to ${status.bundledVersion}.`
          : status.kind === "broken"
            ? `herdr at ${status.path} did not run correctly: ${status.error}`
            : "herdr is not installed.",
      ),
    );

    // Spec addendum §11.1: "An empty payload (a dev build) -> ... Setup
    // shows 'This build has no bundled herdr engine. Install herdr from
    // herdr.dev'. It never crashes" -- no [Install] button offered at all
    // in that case, since it would only ever fail.
    if (!engineInstallOffered(status)) {
      container.appendChild(
        el("p", "wizard-note", "This build has no bundled herdr engine. Install herdr from herdr.dev"),
      );
      container.appendChild(footer(false, onSkip));
      return;
    }

    const logEl = el("pre", "wizard-log");
    let consentShown = false;
    const installBtn = button(`Install herdr ${status.bundledVersion}`, () => {
      if (consentShown) return;
      consentShown = true;
      const consentBox = el("div", "wizard-consent");
      consentBox.appendChild(el("p", "wizard-consent__label", "This will run install.ps1 in local-package mode (no network) to install the bundled herdr release."));
      const actions = el("div", "wizard-consent__actions");
      const cancelBtn = button("Cancel", () => void render(), "btn");
      // Finding #13 "double-click install": disable both buttons on the
      // first click, so a second click can't fire `runInstall` twice.
      const confirmBtn = button(
        "Install",
        () => {
          if (confirmBtn.disabled) return;
          confirmBtn.disabled = true;
          cancelBtn.disabled = true;
          void runInstall(logEl);
        },
        "btn btn--primary",
      );
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      consentBox.appendChild(actions);
      container.insertBefore(consentBox, logEl);
      installBtn.remove();
    });
    container.appendChild(installBtn);
    container.appendChild(logEl);
    container.appendChild(footer(false, onSkip));
  }

  async function runInstall(logEl: HTMLElement): Promise<void> {
    unlistenInstallLog = await listen<string>("engine-install-log", (event) => {
      logEl.appendChild(document.createTextNode(`${event.payload}\n`));
      logEl.scrollTop = logEl.scrollHeight;
    });
    const ok = await invokeOk("engine_install");
    unlistenInstallLog?.();
    unlistenInstallLog = null;
    if (disposed) return;
    if (ok) {
      summary.herdrInstalled = true;
      await render(true);
    } else {
      container.appendChild(el("p", undefined, "Install failed -- see the log above."));
    }
  }

  void render();
  return () => {
    disposed = true;
    unlistenInstallLog?.();
  };
}

// ---------------------------------------------------------------------
// Step 5 -- Done (spec §4.5)
// ---------------------------------------------------------------------

/** Finding #11 "Done step shows a summary of what this wizard run did": herdr
 * installed?, server started?, providers connected, statusline installed --
 * with the Undo link for the statusline. */
function renderDoneStep(container: HTMLElement, onFinish: () => void, summary: WizardRunSummary): () => void {
  container.innerHTML = "";
  container.appendChild(el("h3", undefined, "Done"));
  container.appendChild(el("p", undefined, "Setup is complete. You can reopen this wizard anytime from herdr menu ▸ Setup…"));

  const list = el("ul", "wizard-summary-list");
  list.appendChild(
    el("li", undefined, summary.herdrInstalled ? "herdr is installed." : "herdr installation was skipped."),
  );
  list.appendChild(
    el("li", undefined, summary.serverStarted ? "herdr server is running." : "herdr server was not confirmed running."),
  );
  list.appendChild(
    el(
      "li",
      undefined,
      summary.providersConnected.length > 0
        ? `Connected to herdr: ${summary.providersConnected.join(", ")}.`
        : "No providers connected to herdr this run.",
    ),
  );
  const statuslineItem = el("li");
  statuslineItem.appendChild(
    document.createTextNode(summary.statuslineInstalled ? "Claude usage tap installed. " : "Claude usage tap not installed. "),
  );
  if (summary.statuslineInstalled) {
    statuslineItem.appendChild(button("Undo", () => void invokeOk("statusline_undo"), "btn wizard-link"));
  }
  list.appendChild(statuslineItem);
  container.appendChild(list);

  const row = el("div", "wizard-step-footer");
  row.appendChild(button("Finish", onFinish, "btn btn--primary"));
  container.appendChild(row);
  return () => {};
}
