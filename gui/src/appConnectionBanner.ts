// Disconnected-banner painting (spec addendum §11.3; UX pass 1 spec §4
// "Honest disconnected state"). Extracted from `main.ts` (which owns only
// the startup sequence and event fan-out) so this DOM-painting logic is
// independently testable and main.ts stays close to its own ~200-line
// budget.

import { invokeSafe, showErrorNotice } from "./appApi";
import { bannerEl } from "./appDom";
import { decideConnectionBanner, type EngineKind } from "./connectionBanner";
import { openSetupWizard } from "./wizard/wizard";

let startHerdrBtnBusy = false;
let bannerRenderGeneration = 0;

interface EngineStatusWireForBanner {
  kind: EngineKind;
}

/** Paints one `BannerDecision` into `bannerEl`: the "checking"/"engine
 * missing" states show no button or [Open Setup]; the "server down,
 * engine found" state keeps [Start herdr]. The socket path (when present)
 * renders inside a "Details" disclosure, never inline in the message
 * (spec §4). The Start button invokes `engine_force_start_server`
 * (bypasses the once-per-launch auto-start guard, since this is an
 * explicit user click, spec §3.3), is disabled while a click is in
 * flight, and reports its result through the existing transient
 * error-notice mechanism (there is no other notice channel). */
export function paintConnectionBanner(decision: ReturnType<typeof decideConnectionBanner>): void {
  bannerEl.innerHTML = "";
  bannerEl.hidden = !decision.visible;
  if (!decision.visible) return;

  const text = document.createElement("span");
  text.className = "connection-banner__text";
  text.textContent = decision.message;
  bannerEl.appendChild(text);

  if (decision.socketPath) {
    const details = document.createElement("details");
    details.className = "connection-banner__details";
    const summary = document.createElement("summary");
    summary.textContent = "Details";
    details.appendChild(summary);
    const path = document.createElement("span");
    path.textContent = decision.socketPath;
    details.appendChild(path);
    bannerEl.appendChild(details);
  }

  if (decision.action === "open_setup") {
    const openSetupBtn = document.createElement("button");
    openSetupBtn.className = "connection-banner__start-btn";
    openSetupBtn.textContent = "Open Setup";
    openSetupBtn.addEventListener("click", () => openSetupWizard());
    bannerEl.appendChild(openSetupBtn);
    return;
  }

  if (decision.action !== "start_herdr") return;

  const startBtn = document.createElement("button");
  startBtn.className = "connection-banner__start-btn";
  startBtn.textContent = "Start herdr";
  startBtn.disabled = startHerdrBtnBusy;
  startBtn.addEventListener("click", () => {
    void (async () => {
      startHerdrBtnBusy = true;
      startBtn.disabled = true;
      startBtn.textContent = "Starting…";
      const started = await invokeSafe<boolean>("engine_force_start_server");
      startHerdrBtnBusy = false;
      showErrorNotice(started ? "herdr server started." : "Could not start the herdr server.");
      startBtn.disabled = false;
      startBtn.textContent = "Start herdr";
    })();
  });
  bannerEl.appendChild(startBtn);
}

/** The disconnected banner: rebuilt on every `connection-status` event.
 * The engine status needs its own async round trip (`engine_status`), so
 * this paints immediately from the "unknown" state, then repaints once
 * the probe resolves; a generation counter drops a stale resolve from a
 * since-superseded event (e.g. the server reconnected while the probe was
 * still in flight). */
export function renderConnectionBanner(status: string, socketPath: string): void {
  const generation = ++bannerRenderGeneration;
  paintConnectionBanner(decideConnectionBanner(status, null, socketPath));
  if (status !== "unavailable" && status !== "disconnected") return;
  void (async () => {
    const engineStatus = await invokeSafe<EngineStatusWireForBanner>("engine_status");
    if (generation !== bannerRenderGeneration) return;
    paintConnectionBanner(decideConnectionBanner(status, engineStatus?.kind ?? "missing", socketPath));
  })();
}
