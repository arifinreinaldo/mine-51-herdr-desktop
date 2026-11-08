// Title-bar run toolbar (flutter-run-spec §4): device dropdown plus Play,
// or Hot Reload / Hot Restart / Stop. DOM only; `appFlutterRun.ts` owns
// the state and hands a fresh view to `render`.

import type { RunStatus } from "../flutter/runState";
import { shortcutDisplay } from "../shortcuts";

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
  /** The SQLite inspector and Explorer buttons. Disabled unless the device is an adb device in state "device". */
  dbDisabled: boolean;
  dbTitle: string;
  explorerTitle: string;
  /** Play: Flutter projects only; a native Android project hides it. */
  playVisible: boolean;
}

export interface RunToolbarHandlers {
  onDeviceClick: (anchor: HTMLElement) => void;
  onFlavorClick: () => void;
  onMirror: () => void;
  onDatabase: () => void;
  onExplorer: () => void;
  onPlay: () => void;
  onReload: () => void;
  onRestart: () => void;
  onStop: () => void;
}

/** The toolbar actions the `run.*` shortcuts press. */
export type RunAction = "play" | "reload" | "restart";

export interface RunToolbar {
  render: (view: RunToolbarView) => void;
  /** Presses the action's button only while it shows and is enabled: a key obeys the same state as a click. */
  trigger: (action: RunAction) => void;
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

/** "Hot Reload (Ctrl+Shift+R)". The bare title where the action has no key (macOS). */
function withKey(title: string, id: string): string {
  const key = shortcutDisplay(id);
  return key ? `${title} (${key})` : title;
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
  const db = makeButton("run-btn--db", "database", "Inspect SQLite databases", handlers.onDatabase);
  const explorer = makeButton("run-btn--explorer", "folder-opened", "Browse device files", handlers.onExplorer);
  const play = makeButton("run-btn--play", "play", "Run on the selected device", handlers.onPlay);
  const playIcon = play.querySelector("i") as HTMLElement;
  const reload = makeButton("run-btn--reload", "flame", withKey("Hot Reload", "run.hotReload"), handlers.onReload);
  const restart = makeButton("run-btn--restart", "debug-restart", withKey("Hot Restart", "run.hotRestart"), handlers.onRestart);
  const stop = makeButton("run-btn--stop", "debug-stop", "Stop", handlers.onStop);
  root.append(deviceBtn, flavorBtn, mirror, db, explorer, play, reload, restart, stop);

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
      // The title changes with state; keep the accessible name in step with it.
      const retitle = (btn: HTMLButtonElement, title: string) => {
        btn.title = title;
        btn.setAttribute("aria-label", title);
      };
      mirror.disabled = view.mirrorDisabled;
      retitle(mirror, view.mirrorTitle);
      db.disabled = view.dbDisabled;
      retitle(db, view.dbTitle);
      explorer.disabled = view.dbDisabled;
      retitle(explorer, view.explorerTitle);
      play.classList.toggle("run-btn--running", running && !view.starting);
      play.disabled = view.playDisabled;
      retitle(play, view.playDisabled ? view.playTitle : withKey(view.playTitle, "run.play"));
      play.hidden = !view.playVisible;
      for (const btn of [reload, restart, stop]) {
        btn.hidden = !running;
        btn.disabled = view.actionsDisabled;
      }
    },
    trigger(action) {
      const btn = { play, reload, restart }[action];
      if (!root.hidden && !btn.hidden && !btn.disabled) btn.click();
    },
  };
}
