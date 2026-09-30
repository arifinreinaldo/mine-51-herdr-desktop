// Title-bar run toolbar (flutter-run-spec §4): device dropdown plus Play,
// or Hot Reload / Hot Restart / Stop. DOM only; `appFlutterRun.ts` owns
// the state and hands a fresh view to `render`.

import type { RunStatus } from "../flutter/runState";

export interface RunToolbarView {
  visible: boolean;
  /** Device name, "No device", "Loading devices…", "adb not found", ... */
  label: string;
  labelTitle: string;
  loading: boolean;
  status: RunStatus;
  /** Play was pressed and the split / prompt wait / typing is in flight. */
  starting: boolean;
  playDisabled: boolean;
  playTitle: string;
  /** Selected flavor; `null` hides the flavor button (no flavors). */
  flavor: string | null;
  /** The 300ms double-click guard on Hot Reload / Hot Restart / Stop. */
  actionsDisabled: boolean;
  /** scrcpy is starting, or being installed. */
  mirrorBusy: boolean;
  mirrorDisabled: boolean;
  mirrorTitle: string;
}

export interface RunToolbarHandlers {
  onDeviceClick: (anchor: HTMLElement) => void;
  onFlavorClick: () => void;
  onMirror: () => void;
  onPlay: () => void;
  onReload: () => void;
  onRestart: () => void;
  onStop: () => void;
}

export interface RunToolbar {
  render: (view: RunToolbarView) => void;
}

function makeButton(className: string, icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `run-btn ${className}`;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.tabIndex = -1;
  const i = document.createElement("i");
  i.className = `codicon codicon-${icon}`;
  btn.appendChild(i);
  btn.addEventListener("click", onClick);
  return btn;
}

export function createRunToolbar(root: HTMLElement, handlers: RunToolbarHandlers): RunToolbar {
  const deviceBtn = document.createElement("button");
  deviceBtn.className = "run-device";
  deviceBtn.tabIndex = -1;
  const deviceIcon = document.createElement("i");
  deviceIcon.className = "codicon codicon-device-mobile";
  const deviceName = document.createElement("span");
  deviceName.className = "run-device__name";
  deviceBtn.append(deviceIcon, deviceName);
  deviceBtn.addEventListener("click", () => handlers.onDeviceClick(deviceBtn));

  const flavorBtn = document.createElement("button");
  flavorBtn.className = "run-device run-flavor";
  flavorBtn.tabIndex = -1;
  flavorBtn.title = "Choose a build flavor";
  const flavorIcon = document.createElement("i");
  flavorIcon.className = "codicon codicon-tag";
  const flavorName = document.createElement("span");
  flavorName.className = "run-device__name";
  flavorBtn.append(flavorIcon, flavorName);
  flavorBtn.addEventListener("click", () => handlers.onFlavorClick());

  const mirror = makeButton("run-btn--mirror", "screen-full", "Mirror the device screen", handlers.onMirror);
  const mirrorIcon = mirror.querySelector("i") as HTMLElement;
  const play = makeButton("run-btn--play", "play", "Run on the selected device", handlers.onPlay);
  const playIcon = play.querySelector("i") as HTMLElement;
  const reload = makeButton("run-btn--reload", "flame", "Hot Reload", handlers.onReload);
  const restart = makeButton("run-btn--restart", "debug-restart", "Hot Restart", handlers.onRestart);
  const stop = makeButton("run-btn--stop", "debug-stop", "Stop", handlers.onStop);
  root.append(deviceBtn, flavorBtn, mirror, play, reload, restart, stop);

  return {
    render(view) {
      root.hidden = !view.visible;
      deviceName.textContent = view.label;
      deviceBtn.title = view.labelTitle;
      flavorBtn.hidden = view.flavor === null;
      flavorName.textContent = view.flavor ?? "";
      deviceIcon.className = view.loading
        ? "codicon codicon-loading codicon-modifier-spin"
        : "codicon codicon-device-mobile";
      // Play stays in place and shows what it is doing: a spinner while
      // starting, a green dot while running. Both are disabled.
      const running = view.status === "running";
      playIcon.className = view.starting
        ? "codicon codicon-loading codicon-modifier-spin"
        : running
          ? "codicon codicon-circle-large-filled"
          : "codicon codicon-play";
      mirrorIcon.className = view.mirrorBusy
        ? "codicon codicon-loading codicon-modifier-spin"
        : "codicon codicon-screen-full";
      mirror.disabled = view.mirrorDisabled;
      mirror.title = view.mirrorTitle;
      play.classList.toggle("run-btn--running", running && !view.starting);
      play.disabled = view.playDisabled;
      play.title = view.playTitle;
      for (const btn of [reload, restart, stop]) {
        btn.hidden = !running;
        btn.disabled = view.actionsDisabled;
      }
    },
  };
}
