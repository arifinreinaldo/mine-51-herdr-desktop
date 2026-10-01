// The mirror tools page (docs/mirror-toolbar-spec.md §6.3): a 52 px strip
// with Screenshot and Record, docked beside the scrcpy window by Rust. The
// Screenshot button grows the window to hold the shared preview panel.
// Record is a toggle (docs/record-spec.md §6.3); its result opens in the same
// panel slot.
// Imports stay out of the main window's world (`appState`, `main.ts`,
// `dragDropFiles.ts`), and errors show inline: `#error-notices` does not
// exist on this page.

import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dockSideFrom, parseMirrorToolsParams } from "./android/mirrorToolsParams";
import { errorMessage } from "./appApi";
import { COUNTDOWN_SECONDS, formatElapsed, recordButtonView, recordFailureText, type RecState } from "./android/recordFormat";
import { mirrorRecordStart, mirrorRecordStop, mirrorToolsResize, type RecordResult } from "./flutter/flutterApi";
import { ThemeRegistry, applyThemeById, importedThemeId } from "./themes/index";
import { mountRecordPanel } from "./ui/recordPanel";
import { mountScreenshotPanel, type ScreenshotPanel } from "./ui/screenshotPanel";

const NOTE_MS = 2000;
const TIMER_MS = 500;
const ENDED_EVENT = "mirror-record-ended";
const FAILED_EVENT = "mirror-record-failed";

interface PanelHandle {
  dispose(): void;
  focusInitial(): void;
}

function errorCode(err: unknown): unknown {
  return err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
}

/** Applies the saved theme once, at startup. A later change in the main window reaches this page with the next tools window. */
async function applyTheme(): Promise<void> {
  const registry = new ThemeRegistry();
  let themeId = "dark-modern";
  try {
    const { settings } = await invoke<{ settings: { theme: string } }>("settings_get");
    themeId = settings.theme;
    const imported = await invoke<{ slug: string; name: string; type: string; colors: Record<string, string> }[]>(
      "list_imported_themes",
    );
    registry.setImported(
      imported.map((t) => ({
        id: importedThemeId(t.slug),
        label: t.name,
        kind: t.type as "light" | "dark" | "hc",
        colors: t.colors,
      })),
    );
  } catch {
    themeId = "dark-modern";
  }
  applyThemeById(registry, themeId, document.documentElement.style);
}

function codicon(name: string): HTMLElement {
  const i = document.createElement("i");
  i.className = `codicon codicon-${name}`;
  return i;
}

async function main(): Promise<void> {
  const root = document.getElementById("mt-root");
  if (!root) return;
  const params = parseMirrorToolsParams(location.search);
  if (!params) {
    root.textContent = "Invalid mirror tools parameters";
    return;
  }
  await applyTheme();

  const strip = document.createElement("div");
  strip.className = "mt-strip";
  const shotBtn = document.createElement("button");
  shotBtn.type = "button";
  shotBtn.className = "mt-btn";
  shotBtn.setAttribute("aria-label", "Screenshot");
  shotBtn.setAttribute("aria-pressed", "false");
  shotBtn.title = `Screenshot ${params.deviceName}`;
  shotBtn.appendChild(codicon("device-camera"));
  const recordBtn = document.createElement("button");
  recordBtn.type = "button";
  recordBtn.className = "mt-btn mt-btn--record";
  recordBtn.setAttribute("aria-label", "Record");
  recordBtn.setAttribute("aria-pressed", "false");
  const recordIcon = codicon("circle-filled");
  recordBtn.appendChild(recordIcon);
  const timer = document.createElement("p");
  timer.className = "mt-timer";
  timer.hidden = true;
  const note = document.createElement("p");
  note.className = "mt-note";
  note.hidden = true;
  const live = document.createElement("div");
  live.className = "shot-sr";
  live.setAttribute("aria-live", "polite");
  strip.append(shotBtn, recordBtn, timer, note, live);

  const panelEl = document.createElement("div");
  panelEl.className = "mt-panel";
  panelEl.hidden = true;
  root.append(strip, panelEl);

  let panel: PanelHandle | undefined;
  let panelKind: "shot" | "record" | undefined;
  let shotPanel: ScreenshotPanel | undefined;
  let expanded = false;
  let resizing = false;
  let noteTimer: number | undefined;
  let recState: RecState = "idle";
  let lastEnded: RecordResult | undefined;
  let startedAt = 0;
  let timerId: number | undefined;
  /** 3, 2, 1 while the countdown runs; 0 otherwise. The recorder is already starting behind it. */
  let count = 0;
  let countTimerId: number | undefined;
  /** The start call has returned: the recorder has written its header. */
  let headerReady = false;

  const setSide = (side: "left" | "right") => root.classList.toggle("mt-root--left", side === "left");

  const showNote = (text: string, title = "") => {
    note.textContent = text;
    note.title = title;
    note.hidden = false;
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => {
      note.hidden = true;
    }, NOTE_MS);
  };

  const announce = (text: string) => {
    // Cleared first: a screen reader does not announce the same text twice.
    live.textContent = "";
    window.setTimeout(() => {
      live.textContent = text;
    }, 0);
  };

  const render = () => {
    const view = recordButtonView(recState, count);
    recordBtn.setAttribute("aria-pressed", String(view.pressed));
    if (view.busy) recordBtn.setAttribute("aria-busy", "true");
    else recordBtn.removeAttribute("aria-busy");
    recordBtn.title = view.title;
    if (view.digit !== undefined) {
      recordIcon.className = "mt-count";
      recordIcon.textContent = String(view.digit);
      // Restart the tick animation for each digit.
      recordIcon.style.animation = "none";
      void recordIcon.offsetWidth;
      recordIcon.style.animation = "";
    } else {
      recordIcon.textContent = "";
      recordIcon.className = view.busy
        ? "codicon codicon-loading codicon-modifier-spin"
        : `codicon codicon-${view.icon}`;
    }
    recordBtn.classList.toggle("mt-btn--recording", view.recording);
    timer.hidden = recState !== "recording" && recState !== "stopping";
  };

  const stopTimer = () => {
    window.clearInterval(timerId);
    timerId = undefined;
  };

  const startTimer = () => {
    stopTimer();
    const tick = () => {
      timer.textContent = formatElapsed(performance.now() - startedAt);
    };
    tick();
    timerId = window.setInterval(tick, TIMER_MS);
  };

  /** Disposes the open panel and empties the slot. The panels add their classes to the container, so a new mount must start clean. */
  const clearPanel = () => {
    panel?.dispose();
    panel = undefined;
    panelKind = undefined;
    shotPanel = undefined;
    panelEl.textContent = "";
    panelEl.classList.remove("shot-body", "shot-body--stacked", "rec-body");
  };

  const collapse = async () => {
    if (!expanded) return;
    expanded = false;
    resizing = true;
    clearPanel();
    panelEl.hidden = true;
    shotBtn.setAttribute("aria-pressed", "false");
    try {
      setSide(await mirrorToolsResize(false));
    } catch (err) {
      console.warn("mirror tools collapse failed", err);
    } finally {
      resizing = false;
    }
  };

  /** Expands first when needed (so a panel never renders into a 52 px window), then mounts. Errors propagate. */
  const openPanel = async (kind: "shot" | "record", mount: (el: HTMLElement) => PanelHandle) => {
    if (!expanded) {
      resizing = true;
      try {
        setSide(await mirrorToolsResize(true));
      } finally {
        resizing = false;
      }
      expanded = true;
      panelEl.hidden = false;
    } else {
      clearPanel();
    }
    const mounted = mount(panelEl);
    panel = mounted;
    panelKind = kind;
    shotBtn.setAttribute("aria-pressed", String(kind === "shot"));
    window.setTimeout(() => mounted.focusInitial(), 0);
  };

  const openShot = async () => {
    try {
      await openPanel("shot", (el) => {
        const mounted = mountScreenshotPanel(el, {
          deviceId: params.deviceId,
          deviceName: params.deviceName,
          layout: "stacked",
          onClose: () => void collapse(),
        });
        shotPanel = mounted;
        return mounted;
      });
    } catch (err) {
      if (errorCode(err) === "no_room") showNote("No room");
      else showNote("Failed", errorMessage(err));
    }
  };

  const showResult = async (result: RecordResult) => {
    stopTimer();
    recState = "result";
    render();
    announce(
      result.finalized
        ? `Recording saved, ${result.fileName}, ${formatElapsed(result.seconds * 1000)}`
        : `Recording may be damaged, ${result.fileName}`,
    );
    try {
      await openPanel("record", (el) => mountRecordPanel(el, { result, onClose: () => void collapse() }));
    } catch (err) {
      // The file is saved either way.
      if (errorCode(err) === "no_room") showNote("Saved", result.path);
      else showNote("Failed", errorMessage(err));
    }
  };

  const stopCountdown = () => {
    window.clearInterval(countTimerId);
    countTimerId = undefined;
    count = 0;
  };

  /** The countdown and the recorder's header are both done: the recording is on. */
  const beginRecording = () => {
    if (recState !== "starting") return;
    recState = "recording";
    startedAt = performance.now();
    startTimer();
    render();
    announce("Recording started");
  };

  /** 3, 2, 1 in the button. The recorder is spawned at the click, so its 3 to 10 s start-up runs
   * behind the countdown; the recording state begins when the later of the two is done. */
  const startCountdown = () => {
    count = COUNTDOWN_SECONDS;
    announce(`Recording starts in ${count}`);
    countTimerId = window.setInterval(() => {
      count -= 1;
      if (count > 0) {
        render();
        announce(String(count));
        return;
      }
      stopCountdown();
      if (headerReady) beginRecording();
      else render(); // still starting: the spinner shows until the header exists
    }, 1000);
  };

  const startRecording = async () => {
    recState = "starting";
    lastEnded = undefined;
    headerReady = false;
    startCountdown();
    render();
    try {
      await mirrorRecordStart(params.deviceId);
    } catch (err) {
      stopCountdown();
      if (errorCode(err) === "record_cancelled") {
        recState = "idle";
        render();
        announce("Recording cancelled");
        return;
      }
      recState = "error";
      render();
      showNote("Failed", errorMessage(err));
      announce(`Recording failed. ${errorMessage(err)}`);
      return;
    }
    // A cancel clicked while the start call was finishing owns the state.
    if (recState !== "starting") return;
    headerReady = true;
    // The countdown may still be running: it starts the recording when it ends.
    if (count === 0) beginRecording();
  };

  const cancelStart = async () => {
    stopCountdown();
    recState = "stopping";
    render();
    try {
      await mirrorRecordStop(params.deviceId);
    } catch {
      // `record_empty` and `not_recording` are expected here.
    }
    recState = "idle";
    render();
  };

  const stopRecording = async () => {
    recState = "stopping";
    stopTimer();
    render();
    announce("Saving the recording");
    try {
      await showResult(await mirrorRecordStop(params.deviceId));
    } catch (err) {
      if (errorCode(err) === "not_recording") {
        // The recorder ended on its own a moment ago.
        if (lastEnded) void showResult(lastEnded);
        else {
          recState = "idle";
          render();
        }
        return;
      }
      recState = "error";
      render();
      showNote("Failed", errorMessage(err));
      announce(`Recording failed. ${errorMessage(err)}`);
    }
  };

  shotBtn.addEventListener("click", () => {
    if (resizing) return;
    if (panelKind === "shot") shotPanel?.capture();
    else void openShot();
  });

  recordBtn.addEventListener("click", () => {
    switch (recState) {
      case "idle":
      case "result":
      case "error":
        void startRecording();
        break;
      case "starting":
        void cancelStart();
        break;
      case "recording":
        void stopRecording();
        break;
      case "stopping":
        break;
    }
  });

  // Esc closes any panel. It never stops a recording.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !expanded) return;
    event.preventDefault();
    void collapse();
  });

  await listen<unknown>("mirror-tools-side", (event) => {
    const side = dockSideFrom(event.payload);
    if (side) setSide(side);
  });
  await listen<RecordResult>(ENDED_EVENT, (event) => {
    lastEnded = event.payload;
    // In any other state a stop in flight returns the same result.
    if (recState === "recording") void showResult(event.payload);
  });
  // The recorder ended by itself and left no file: leave `recording`.
  await listen<unknown>(FAILED_EVENT, (event) => {
    if (recState !== "recording") return;
    const message = recordFailureText(event.payload);
    stopTimer();
    recState = "idle";
    render();
    showNote("Failed", message);
    announce(`Recording failed. ${message}`);
  });
  // The first call is the ready signal: Rust shows the window only after it.
  try {
    setSide(await mirrorToolsResize(false));
  } catch (err) {
    console.warn("mirror tools ready call failed", err);
  }
}

void main();
