// Screenshot preview panel (docs/screenshot-design.md): captures the device
// screen at once, shows it, and offers Copy, Save as… and Close. DOM only;
// the device text (adb errors) goes in through `textContent`. Rust keeps the
// latest PNG, so Copy and Save never send the bytes back. Mounted by the
// mirror tools window (`mirrorTools.ts`).

import { isBlackFrame, screenshotFileName } from "../android/screenshotFormat";
import { errorMessage } from "../appApi";
import { androidScreenshot, screenshotCopy, screenshotSave } from "../flutter/flutterApi";

const SUCCESS_MS = 1600;

export interface ScreenshotPanelOptions {
  deviceName: string;
  deviceId: string;
  /** The Close button calls this. */
  onClose: () => void;
  /** "side": preview left, actions right (the modal). "stacked": actions under the preview (the tools window). */
  layout?: "side" | "stacked";
}

export interface ScreenshotPanel {
  /** Starts a new capture (Capturing state). The mount also calls it once. */
  capture(): void;
  /** Focuses Close (Copy is disabled while capturing). */
  focusInitial(): void;
  /** Sets `closed`, clears both timers, removes the document key listener. Safe to call twice. */
  dispose(): void;
}

type State = "capturing" | "ready" | "failed";

function icon(name: string): HTMLElement {
  const i = document.createElement("i");
  i.className = `codicon codicon-${name}`;
  return i;
}

/** `img-src` in the CSP allows `data:` but not `blob:`. */
function toDataUrl(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image"));
    reader.readAsDataURL(new Blob([buffer], { type: "image/png" }));
  });
}

function clock(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Adds `shot-body` (and `shot-body--stacked` for "stacked") to `container`, appends the preview and the actions, and starts the first capture. */
export function mountScreenshotPanel(container: HTMLElement, opts: ScreenshotPanelOptions): ScreenshotPanel {
  let state: State = "capturing";
  let closed = false;
  let generation = 0;
  let copying = false;
  let saving = false;
  let copyTimer: number | undefined;
  let saveTimer: number | undefined;
  let size = "";
  let capturedAt = "";
  let savedName = "";
  let savedPath = "";

  const preview = document.createElement("div");
  preview.className = "shot-preview";
  const frame = document.createElement("div");
  frame.className = "shot-frame";
  const hint = document.createElement("p");
  hint.className = "shot-hint";
  hint.hidden = true;
  hint.textContent = "The screen looks black. The phone may be locked, or the app blocks screenshots.";
  preview.append(frame, hint);

  const actions = document.createElement("div");
  actions.className = "shot-actions";

  const makeBtn = (extra: string, iconName: string, label: string, title: string, onClick: () => void) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn shot-btn ${extra}`;
    btn.title = title;
    const glyph = icon(iconName);
    const text = document.createElement("span");
    text.textContent = label;
    btn.append(glyph, text);
    btn.addEventListener("click", onClick);
    return { btn, glyph, text };
  };

  const copy = makeBtn("btn--primary", "copy", "Copy", "Copy image to clipboard (Ctrl+C)", () => void doCopy());
  const retry = makeBtn("btn--primary", "refresh", "Retry", "Capture again", () => capture());
  retry.btn.hidden = true;
  const save = makeBtn("", "save-as", "Save as…", "Save as… (Ctrl+S)", () => void doSave());
  const close = makeBtn("shot-btn--close", "close", "Close", "Close", () => opts.onClose());

  const meta = document.createElement("div");
  meta.className = "shot-meta";
  const failure = document.createElement("p");
  failure.className = "shot-failure";
  failure.setAttribute("role", "alert");
  failure.hidden = true;
  const live = document.createElement("div");
  live.className = "shot-sr";
  live.setAttribute("aria-live", "polite");

  // Close last so `margin-top: auto` pins it to the bottom, under the meta block.
  actions.append(copy.btn, retry.btn, save.btn, meta, failure, live, close.btn);

  const announce = (message: string) => {
    live.textContent = message;
  };

  const renderMeta = () => {
    meta.textContent = "";
    const lines = [opts.deviceName];
    if (state === "ready") lines.push(size, capturedAt);
    for (const line of lines) {
      const row = document.createElement("div");
      row.textContent = line;
      meta.appendChild(row);
    }
    if (savedName) {
      const row = document.createElement("div");
      row.textContent = savedName;
      row.title = savedPath;
      meta.appendChild(row);
    }
  };

  const renderButtons = () => {
    const ready = state === "ready";
    copy.btn.hidden = state === "failed";
    retry.btn.hidden = state !== "failed";
    save.btn.hidden = state === "failed";
    copy.btn.disabled = !ready || copying;
    save.btn.disabled = !ready || saving;
  };

  const setState = (next: State) => {
    state = next;
    renderButtons();
    renderMeta();
  };

  const showPlaceholder = () => {
    frame.textContent = "";
    const box = document.createElement("div");
    box.className = "shot-placeholder";
    const spin = icon("loading");
    spin.classList.add("codicon-modifier-spin");
    const text = document.createElement("span");
    text.textContent = "Capturing…";
    box.append(spin, text);
    frame.appendChild(box);
  };

  const showFailure = (message: string) => {
    frame.textContent = "";
    const box = document.createElement("div");
    box.className = "shot-placeholder shot-placeholder--error";
    const glyph = icon("error");
    const text = document.createElement("span");
    text.className = "shot-error-text";
    text.textContent = message;
    text.title = message;
    box.append(glyph, text);
    frame.appendChild(box);
    setState("failed");
    announce(`Screenshot failed. ${message}`);
    window.setTimeout(() => retry.btn.focus(), 0);
  };

  const flash = (part: typeof copy, label: string, reset: string, which: "copy" | "save") => {
    part.glyph.className = "codicon codicon-check shot-done";
    part.text.textContent = label;
    const timer = window.setTimeout(() => {
      part.glyph.className = `codicon codicon-${which === "copy" ? "copy" : "save-as"}`;
      part.text.textContent = reset;
    }, SUCCESS_MS);
    if (which === "copy") copyTimer = timer;
    else saveTimer = timer;
  };

  const clearFlash = () => {
    window.clearTimeout(copyTimer);
    window.clearTimeout(saveTimer);
    copy.glyph.className = "codicon codicon-copy";
    copy.text.textContent = "Copy";
    save.glyph.className = "codicon codicon-save-as";
    save.text.textContent = "Save as…";
  };

  const showFailureLine = (message: string) => {
    failure.textContent = message;
    failure.hidden = false;
  };

  const doCopy = async () => {
    if (state !== "ready" || copying) return;
    copying = true;
    failure.hidden = true;
    window.clearTimeout(copyTimer);
    copy.glyph.className = "codicon codicon-loading codicon-modifier-spin";
    renderButtons();
    try {
      await screenshotCopy();
      if (closed) return;
      flash(copy, "Copied", "Copy", "copy");
      announce("Copied to clipboard");
    } catch (err) {
      if (closed) return;
      copy.glyph.className = "codicon codicon-copy";
      showFailureLine(errorMessage(err));
    } finally {
      copying = false;
      if (!closed) renderButtons();
    }
  };

  const doSave = async () => {
    if (state !== "ready" || saving) return;
    saving = true;
    failure.hidden = true;
    window.clearTimeout(saveTimer);
    save.glyph.className = "codicon codicon-loading codicon-modifier-spin";
    renderButtons();
    try {
      const path = await screenshotSave(screenshotFileName(new Date()));
      if (closed) return;
      if (path === null) {
        save.glyph.className = "codicon codicon-save-as";
        return;
      }
      savedPath = path;
      savedName = path.split(/[\\/]/).pop() ?? path;
      renderMeta();
      flash(save, "Saved", "Save as…", "save");
      announce(`Saved ${savedName}`);
    } catch (err) {
      if (closed) return;
      save.glyph.className = "codicon codicon-save-as";
      showFailureLine(errorMessage(err));
    } finally {
      saving = false;
      if (!closed) renderButtons();
    }
  };

  const showImage = (url: string, gen: number) => {
    const img = document.createElement("img");
    img.className = "shot-img";
    img.addEventListener("load", () => {
      if (closed || gen !== generation) return;
      size = `${img.naturalWidth} × ${img.naturalHeight}`;
      img.alt = `Screenshot of ${opts.deviceName}, ${img.naturalWidth} by ${img.naturalHeight} pixels`;
      capturedAt = clock(new Date());
      frame.textContent = "";
      frame.appendChild(img);
      // A canvas failure must not hide the image.
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 36;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, 16, 36);
          hint.hidden = !isBlackFrame(ctx.getImageData(0, 0, 16, 36).data);
        }
      } catch {
        hint.hidden = true;
      }
      setState("ready");
      announce("Screenshot ready");
      copy.btn.focus();
    });
    img.addEventListener("error", () => {
      if (closed || gen !== generation) return;
      showFailure("The image could not be shown");
    });
    img.src = url;
  };

  const capture = () => {
    const gen = ++generation;
    clearFlash();
    savedName = "";
    savedPath = "";
    failure.hidden = true;
    hint.hidden = true;
    showPlaceholder();
    setState("capturing");
    androidScreenshot(opts.deviceId)
      .then(toDataUrl)
      .then((url) => {
        if (closed || gen !== generation) return;
        showImage(url, gen);
      })
      .catch((err: unknown) => {
        if (closed || gen !== generation) return;
        showFailure(errorMessage(err));
      });
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (state !== "ready" || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "s") return;
    // Ctrl+C on selected text (device name, error line) copies that text.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    event.preventDefault();
    void (key === "c" ? doCopy() : doSave());
  };
  document.addEventListener("keydown", onKeydown, true);

  container.classList.add("shot-body");
  if (opts.layout === "stacked") container.classList.add("shot-body--stacked");
  container.append(preview, actions);
  capture();

  const dispose = () => {
    closed = true;
    window.clearTimeout(copyTimer);
    window.clearTimeout(saveTimer);
    document.removeEventListener("keydown", onKeydown, true);
  };
  return {
    capture,
    // Copy is disabled while capturing, so focus Close; the load handler
    // moves focus to Copy when the image is ready.
    focusInitial: () => close.btn.focus(),
    dispose,
  };
}
