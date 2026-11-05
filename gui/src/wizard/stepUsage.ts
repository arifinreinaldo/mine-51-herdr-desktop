// Wizard step 3 -- Claude usage bar / statusLine tap (Phase 1.6 spec §4.3).
// Shown only when Claude is available (the caller decides that; this
// module just renders whatever step it's given).

import { invokeOk, invokeSafe } from "../appApi";
import { button, el } from "./dom";
import type { WizardRunSummary } from "./logic";

interface StatuslineStatusWire {
  class: "none" | "herdr" | "other";
  otherCommand: string | null;
  error: string | null;
  /** settings.json is a symlink (shared with a dotfiles repo or another
   * machine); this is the file it points to. */
  sharedTarget: string | null;
  /** class is "herdr" but the installed script is older than the bundled one. */
  scriptOutdated?: boolean;
}

function renderConsent(container: HTMLElement, detail: string, onConfirm: () => void, onCancel: () => void): void {
  const box = el("div", "wizard-consent");
  box.appendChild(el("p", "wizard-consent__label", "This will:"));
  box.appendChild(el("p", undefined, detail));
  const actions = el("div", "wizard-consent__actions");
  actions.appendChild(button("Cancel", onCancel, "btn"));
  actions.appendChild(button("Install", onConfirm, "btn btn--primary"));
  box.appendChild(actions);
  container.appendChild(box);
}

export function renderUsageStep(
  container: HTMLElement,
  onComplete: () => void,
  onSkip: () => void,
  summary: WizardRunSummary,
): () => void {
  let disposed = false;

  function render(): void {
    if (disposed) return;
    container.innerHTML = "";
    container.appendChild(el("h3", undefined, "Claude usage bar"));
    void load();
  }

  async function load(): Promise<void> {
    const status = await invokeSafe<StatuslineStatusWire>("statusline_status");
    if (disposed || !status) return;
    renderStatus(status);
  }

  function renderStatus(status: StatuslineStatusWire): void {
    if (disposed) return;
    const body = el("div", "wizard-usage-body");

    if (status.error) {
      body.appendChild(el("p", undefined, `Could not read settings.json: ${status.error}`));
      body.appendChild(footerRow(false));
      container.appendChild(body);
      return;
    }

    if (status.class === "herdr") {
      summary.statuslineInstalled = true;
      body.appendChild(el("p", undefined, "herdr's usage tap is already installed."));
      if (status.scriptOutdated) {
        body.appendChild(
          el("p", "wizard-step-description", "A newer tap script is available (adds session cost, model and context)."),
        );
        body.appendChild(
          button(
            "Update script",
            () => {
              void (async () => {
                await invokeOk("statusline_install");
                render();
              })();
            },
            "btn btn--primary",
          ),
        );
      }
      body.appendChild(undoRow());
      body.appendChild(footerRow(true));
      container.appendChild(body);
      return;
    }

    if (status.class === "other") {
      body.appendChild(el("p", undefined, `A different statusLine command is set: "${status.otherCommand}"`));
      body.appendChild(
        el(
          "p",
          "wizard-step-description",
          "Installing herdr's tap will chain the existing command -- it still runs, and its output still shows.",
        ),
      );
    } else {
      body.appendChild(el("p", undefined, "No statusLine command is configured yet."));
    }

    const installBtn = button("Install", () => {
      installBtn.remove();
      renderConsent(
        body,
        status.sharedTarget
          ? `Copy the usage tap script to ~/.claude/statusline/, back up settings.json, and edit the shared file it links to (${status.sharedTarget}). ` +
            "The statusLine becomes one line that runs the tap on this machine and keeps the current command as the fallback for machines without it. " +
            "The link stays a link; commit the change in that repository yourself."
          : "Copy the usage tap script to ~/.claude/statusline/, back up settings.json, and set statusLine " +
            (status.class === "other" ? "(chaining the existing command)." : "."),
        () => void runInstall(body),
        () => render(),
      );
    });
    body.appendChild(installBtn);
    body.appendChild(footerRow(false));
    container.appendChild(body);
  }

  async function runInstall(body: HTMLElement): Promise<void> {
    body.innerHTML = "";
    body.appendChild(el("p", undefined, "Installing…"));
    const result = await invokeSafe<{ backupPath: string | null; chained: boolean }>("statusline_install");
    if (disposed) return;
    body.innerHTML = "";
    if (result) {
      summary.statuslineInstalled = true;
      body.appendChild(el("p", undefined, "Installed the herdr usage tap."));
      body.appendChild(undoRow());
      body.appendChild(footerRow(true));
    } else {
      body.appendChild(el("p", undefined, "Install failed; nothing was changed."));
      body.appendChild(footerRow(false));
    }
  }

  function undoRow(): HTMLElement {
    const row = el("div", "wizard-step-footer");
    row.appendChild(
      button(
        "Undo",
        () => {
          void (async () => {
            const ok = await invokeOk("statusline_undo");
            if (ok) render();
          })();
        },
        "btn wizard-link",
      ),
    );
    return row;
  }

  function footerRow(showContinue: boolean): HTMLElement {
    const row = el("div", "wizard-step-footer");
    if (showContinue) row.appendChild(button("Continue", onComplete, "btn btn--primary"));
    row.appendChild(button("Skip", onSkip, "btn wizard-link"));
    return row;
  }

  render();
  return () => {
    disposed = true;
  };
}
