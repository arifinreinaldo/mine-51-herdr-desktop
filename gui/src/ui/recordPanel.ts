// Record result panel (docs/record-spec.md §6.4): file name, duration, size,
// and Show in folder, Copy path, Close. DOM only, through `textContent`: the
// message is scrcpy's stderr, so it is untrusted. Mounted by the mirror tools
// window (`mirrorTools.ts`), which also handles Esc.

import { formatBytes, formatElapsed } from "../android/recordFormat";
import { errorMessage } from "../appApi";
import { revealInFolder, writeClipboardText, type RecordResult } from "../flutter/flutterApi";

const SUCCESS_MS = 1600;

export interface RecordPanelOptions {
  result: RecordResult;
  /** The Close button calls this. */
  onClose: () => void;
}

export interface RecordPanel {
  /** Focuses Show in folder. */
  focusInitial(): void;
  /** Sets `closed` and clears the flash timer. Safe to call twice. */
  dispose(): void;
}

function icon(name: string): HTMLElement {
  const i = document.createElement("i");
  i.className = `codicon codicon-${name}`;
  return i;
}

/** Adds `shot-body shot-body--stacked rec-body` to `container` and appends the preview and the actions. */
export function mountRecordPanel(container: HTMLElement, opts: RecordPanelOptions): RecordPanel {
  const { result } = opts;
  let closed = false;
  let revealing = false;
  let flashTimer: number | undefined;

  const preview = document.createElement("div");
  preview.className = "shot-preview";
  const frame = document.createElement("div");
  frame.className = "shot-frame";
  const status = document.createElement("div");
  status.className = `shot-placeholder rec-status${result.finalized ? "" : " shot-placeholder--error"}`;
  const label = document.createElement("span");
  label.textContent = result.finalized ? "Recording saved" : "The recording may be damaged";
  status.append(icon(result.finalized ? "device-camera-video" : "warning"), label);
  if (result.message !== null) {
    const text = document.createElement("span");
    text.className = "shot-error-text";
    text.textContent = result.message;
    text.title = result.message;
    status.appendChild(text);
  }
  frame.appendChild(status);
  preview.appendChild(frame);

  const actions = document.createElement("div");
  actions.className = "shot-actions rec-actions";

  const makeBtn = (extra: string, iconName: string, text: string, title: string, onClick: () => void) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn shot-btn ${extra}`.trim();
    btn.title = title;
    const glyph = icon(iconName);
    const span = document.createElement("span");
    span.textContent = text;
    btn.append(glyph, span);
    btn.addEventListener("click", onClick);
    return { btn, glyph, text: span };
  };

  const reveal = makeBtn("btn--primary", "folder-opened", "Show in folder", "Show in folder", () => void doReveal());
  const copy = makeBtn("", "copy", "Copy path", "Copy the file path", () => void doCopy());
  const close = makeBtn("shot-btn--close", "close", "Close", "Close", () => opts.onClose());

  const meta = document.createElement("div");
  meta.className = "shot-meta";
  const rows = [result.fileName, formatElapsed(result.seconds * 1000), formatBytes(result.bytes)];
  if (!result.audio) rows.push("No audio");
  for (const [i, line] of rows.entries()) {
    const row = document.createElement("div");
    row.textContent = line;
    if (i === 0) row.title = result.path;
    meta.appendChild(row);
  }
  const failure = document.createElement("p");
  failure.className = "shot-failure";
  failure.setAttribute("role", "alert");
  failure.hidden = true;
  const live = document.createElement("div");
  live.className = "shot-sr";
  live.setAttribute("aria-live", "polite");

  actions.append(reveal.btn, copy.btn, meta, failure, live, close.btn);

  const showFailureLine = (message: string) => {
    failure.textContent = message;
    failure.hidden = false;
  };

  const doReveal = async () => {
    if (revealing) return;
    revealing = true;
    failure.hidden = true;
    reveal.glyph.className = "codicon codicon-loading codicon-modifier-spin";
    try {
      await revealInFolder(result.path);
    } catch (err) {
      if (!closed) showFailureLine(errorMessage(err));
    } finally {
      revealing = false;
      if (!closed) reveal.glyph.className = "codicon codicon-folder-opened";
    }
  };

  const doCopy = async () => {
    failure.hidden = true;
    window.clearTimeout(flashTimer);
    try {
      const ok = await writeClipboardText(result.path);
      if (closed) return;
      if (!ok) {
        showFailureLine("Could not copy the path");
        return;
      }
      copy.glyph.className = "codicon codicon-check shot-done";
      copy.text.textContent = "Copied";
      live.textContent = "Path copied";
      flashTimer = window.setTimeout(() => {
        copy.glyph.className = "codicon codicon-copy";
        copy.text.textContent = "Copy path";
      }, SUCCESS_MS);
    } catch (err) {
      if (!closed) showFailureLine(errorMessage(err));
    }
  };

  container.classList.add("shot-body", "shot-body--stacked", "rec-body");
  container.append(preview, actions);

  return {
    focusInitial: () => reveal.btn.focus(),
    dispose: () => {
      closed = true;
      window.clearTimeout(flashTimer);
    },
  };
}
