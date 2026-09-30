// The mirror tools page (docs/mirror-toolbar-spec.md §6.3): a 52 px strip
// with Screenshot and Record, docked beside the scrcpy window by Rust. The
// Screenshot button grows the window to hold the shared preview panel.
// Imports stay out of the main window's world (`appState`, `main.ts`,
// `dragDropFiles.ts`), and errors show inline: `#error-notices` does not
// exist on this page.

import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { dockSideFrom, parseMirrorToolsParams } from "./android/mirrorToolsParams";
import { errorMessage } from "./appApi";
import { mirrorToolsResize } from "./flutter/flutterApi";
import { ThemeRegistry, applyThemeById, importedThemeId } from "./themes/index";
import { mountScreenshotPanel, type ScreenshotPanel } from "./ui/screenshotPanel";

const NOTE_MS = 2000;

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
  recordBtn.className = "mt-btn";
  recordBtn.setAttribute("aria-label", "Record");
  recordBtn.title = "Record (coming soon)";
  recordBtn.appendChild(codicon("record"));
  const note = document.createElement("p");
  note.className = "mt-note";
  note.hidden = true;
  const live = document.createElement("div");
  live.className = "shot-sr";
  live.setAttribute("aria-live", "polite");
  strip.append(shotBtn, recordBtn, note, live);

  const panelEl = document.createElement("div");
  panelEl.className = "mt-panel";
  panelEl.hidden = true;
  root.append(strip, panelEl);

  let panel: ScreenshotPanel | undefined;
  let expanded = false;
  let resizing = false;
  let noteTimer: number | undefined;

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

  const collapse = async () => {
    if (!expanded) return;
    expanded = false;
    resizing = true;
    panel?.dispose();
    panel = undefined;
    panelEl.textContent = "";
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

  const expand = async () => {
    resizing = true;
    try {
      const side = await mirrorToolsResize(true);
      setSide(side);
      expanded = true;
      shotBtn.setAttribute("aria-pressed", "true");
      panelEl.hidden = false;
      // Expand first, so the panel never renders into a 52 px window.
      const mounted = mountScreenshotPanel(panelEl, {
        deviceId: params.deviceId,
        deviceName: params.deviceName,
        layout: "stacked",
        onClose: () => void collapse(),
      });
      panel = mounted;
      window.setTimeout(() => mounted.focusInitial(), 0);
    } catch (err) {
      const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
      if (code === "no_room") showNote("No room");
      else showNote("Failed", errorMessage(err));
    } finally {
      resizing = false;
    }
  };

  shotBtn.addEventListener("click", () => {
    if (resizing) return;
    if (expanded) panel?.capture();
    else void expand();
  });

  recordBtn.addEventListener("click", () => {
    showNote("Coming soon");
    // Cleared first: a screen reader does not announce the same text twice.
    live.textContent = "";
    window.setTimeout(() => {
      live.textContent = "Recording is coming soon";
    }, 0);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !expanded) return;
    event.preventDefault();
    void collapse();
  });

  await listen<unknown>("mirror-tools-side", (event) => {
    const side = dockSideFrom(event.payload);
    if (side) setSide(side);
  });
  // The first call is the ready signal: Rust shows the window only after it.
  try {
    setSide(await mirrorToolsResize(false));
  } catch (err) {
    console.warn("mirror tools ready call failed", err);
  }
}

void main();
