// Flutter run orchestration (flutter-run-spec §4, §5, §10): project
// detection per workspace, the device list (adb first, flutter devices
// merged in), and Play / Hot Reload / Hot Restart / Stop through the
// endpoint API. The pure logic lives in `flutter/runState.ts`.

import { listen } from "@tauri-apps/api/event";
import { api, errorMessage, invokeSafe, showErrorNotice } from "./appApi";
import { keyEvent } from "./appTerminalInput";
import { overlayRoot, runToolbarEl } from "./appDom";
import { appState, persistSettings } from "./appState";
import type { RawSnapshot } from "./appTypes";
import {
  androidDevices,
  flutterDevices,
  flutterFlavors,
  flutterProject,
  flutterRunAlive,
  type AndroidDevice,
  type FlutterProject,
} from "./flutter/flutterApi";
import { isValidDeviceId, isValidFlavor, mergeDevices, onPlay, onStop, reconcile, statusFor, type RunMap } from "./flutter/runState";
import { keyboardCaptureReturnTarget } from "./keyboard/focusCapture";
import { openFlavorPicker } from "./ui/flavorPicker";
import { openMenu, type MenuItemSpec } from "./ui/menu";
import { closeActiveOverlay } from "./ui/overlay";
import { createRunToolbar } from "./ui/runToolbar";

const SHELL_STARTUP_GRACE_MS = 800;
const BUTTON_GUARD_MS = 300;
/** A run younger than this is not checked: `flutter` may not have started yet. */
const ALIVE_GRACE_MS = 10_000;
const ALIVE_POLL_MS = 3000;

const runs: RunMap = new Map();
const projectCache = new Map<string, FlutterProject | null>();
const flavorCache = new Map<string, string[]>();
const playedAt = new Map<string, number>();

/** The active workspace's id and cwd, and its project once resolved. */
let activeWorkspaceId: string | null = null;
let activeCwd: string | null = null;
let project: FlutterProject | null = null;
let flavors: string[] = [];

/** Device lists. `null` = not loaded yet (adb: or not installed), or (flutter) failed. */
let adbDevices: AndroidDevice[] | null = null;
let adbErrorCode: string | null = null;
let adbErrorMessage: string | null = null;
let flutterList: AndroidDevice[] | null = null;
/** Generation counters (spec §10.2): a result from an older load is dropped. */
let adbGeneration = 0;
let flutterGeneration = 0;
let adbLoading = false;
let flutterLoading = false;

let playing = false;
let actionsGuarded = false;
let menuDispose: (() => void) | null = null;
let menuAnchor: HTMLElement | null = null;

const toolbar = createRunToolbar(runToolbarEl, {
  onDeviceClick: (anchor) => openDeviceMenu(anchor),
  onFlavorClick: () => openFlavorMenu(),
  onPlay: () => void play(),
  onReload: () => void sendRunKey("r"),
  onRestart: () => void sendRunKey("R"),
  onStop: () => void sendRunKey("q", true),
});

function allDevices(): AndroidDevice[] {
  return mergeDevices(adbDevices ?? [], flutterList);
}

/** The saved device if it is listed, else the first runnable one. The saved
 * value is not overwritten by the fallback: the phone can come back. */
function selectedDevice(): AndroidDevice | null {
  const devices = allDevices();
  const saved = project ? appState.settings.flutterDevices[project.dir] : undefined;
  return devices.find((d) => d.id === saved) ?? devices.find((d) => d.state === "device") ?? null;
}

/** The saved flavor if the project still has it, else the first one. `null`
 * when the project has no flavors. */
function selectedFlavor(): string | null {
  if (flavors.length === 0) return null;
  const saved = project ? appState.settings.flutterFlavors[project.dir] : undefined;
  return flavors.find((f) => f === saved) ?? flavors[0] ?? null;
}

/** Both sources finished and neither gave a list (spec §10.2: the error
 * label shows only when both fail). */
function bothFailed(): boolean {
  return adbErrorCode !== null && adbDevices === null && flutterList === null && !adbLoading && !flutterLoading;
}

function render(): void {
  if (!project) {
    toolbar.render({
      visible: false,
      label: "",
      labelTitle: "",
      loading: false,
      status: "idle",
      starting: false,
      playDisabled: true,
      playTitle: "",
      flavor: null,
      actionsDisabled: true,
    });
    return;
  }
  const device = selectedDevice();
  const status = activeWorkspaceId ? statusFor(runs, activeWorkspaceId) : "idle";
  let label = device?.name ?? "No device";
  let labelTitle = device ? `${device.name} — ${device.id}` : "Choose a device";
  let loading = false;
  let playTitle = `Run on ${device?.name ?? "the selected device"}`;

  if (!device && (adbLoading || flutterLoading) && adbDevices === null) {
    label = "Loading devices…";
    labelTitle = label;
    loading = true;
  } else if (bothFailed()) {
    if (adbErrorCode === "adb_not_found") {
      label = "adb not found";
      labelTitle = "Install Android SDK platform-tools";
    } else {
      label = "Devices unavailable";
      labelTitle = label;
    }
  }
  let playDisabled = false;
  if (!device) {
    playDisabled = true;
    playTitle = bothFailed()
      ? labelTitle
      : allDevices().some((d) => d.state === "unauthorized")
        ? "Accept the USB debugging prompt on the phone, then Refresh devices"
        : "No devices. Connect a device, then Refresh devices";
  } else if (device.state !== "device") {
    playDisabled = true;
    playTitle =
      device.state === "unauthorized"
        ? "Accept the USB debugging prompt on the phone, then Refresh devices"
        : `${device.name} is ${device.state}`;
  }
  if (playing) {
    playDisabled = true;
    playTitle = "Starting flutter run…";
  } else if (status === "running") {
    playDisabled = true;
    playTitle = "Running. Press Stop to end it";
  }

  toolbar.render({
    visible: true,
    label,
    labelTitle,
    loading,
    status,
    starting: playing,
    playDisabled,
    playTitle,
    flavor: selectedFlavor(),
    actionsDisabled: actionsGuarded,
  });
}

// ---------------------------------------------------------------------
// Device loading
// ---------------------------------------------------------------------

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "unknown";
}

/** adb alone: the dropdown open. Renders as soon as adb returns. */
function loadAdb(force: boolean): void {
  if (adbLoading && !force) return;
  const generation = ++adbGeneration;
  adbLoading = true;
  render();
  androidDevices()
    .then((devices) => {
      if (generation !== adbGeneration) return;
      adbDevices = devices;
      adbErrorCode = null;
      adbErrorMessage = null;
    })
    .catch((err: unknown) => {
      if (generation !== adbGeneration) return;
      adbDevices = null;
      adbErrorCode = errorCode(err);
      adbErrorMessage = errorMessage(err);
    })
    .finally(() => {
      if (generation !== adbGeneration) return;
      adbLoading = false;
      settled();
    });
}

function loadFlutter(): void {
  const generation = ++flutterGeneration;
  flutterLoading = true;
  render();
  refreshOpenMenu();
  flutterDevices()
    .then((devices) => {
      if (generation !== flutterGeneration) return;
      flutterList = devices;
    })
    .catch((err: unknown) => {
      if (generation !== flutterGeneration) return;
      // Silent (spec §10.2): the adb list stays.
      console.warn("flutter devices failed:", errorMessage(err));
      flutterList = null;
    })
    .finally(() => {
      if (generation !== flutterGeneration) return;
      flutterLoading = false;
      settled();
    });
}

function settled(): void {
  // Only when both sources failed, and adb was not simply missing.
  if (bothFailed() && adbErrorCode !== "adb_not_found" && adbErrorMessage) {
    showErrorNotice(adbErrorMessage);
    adbErrorMessage = null;
  }
  render();
  refreshOpenMenu();
}

/** "Refresh devices": both sources. A non-forced call does nothing while
 * a load is running. Workspace activation runs adb only (spec §10.2). */
function loadAllDevices(force: boolean): void {
  if (!force && (adbLoading || flutterLoading)) return;
  loadAdb(true);
  loadFlutter();
}

// ---------------------------------------------------------------------
// Device menu
// ---------------------------------------------------------------------

function deviceMenuItems(): MenuItemSpec[] {
  const selected = selectedDevice();
  const items: MenuItemSpec[] = allDevices().map((device) => {
    const runnable = device.state === "device";
    return {
      id: `flutter.device.${device.id}`,
      label: runnable ? `${device.name} — ${device.id}` : `${device.name} (${device.state})`,
      checked: device.id === selected?.id,
      disabled: !runnable,
      onSelect: () => chooseDevice(device.id),
    };
  });
  if (flutterLoading) {
    items.push({
      id: "flutter.device.looking",
      label: "Looking for more devices…",
      icon: "loading codicon-modifier-spin",
      disabled: true,
    });
  }
  items.push({
    id: "flutter.device.refresh",
    label: "Refresh devices",
    separatorBefore: true,
    onSelect: () => loadAllDevices(true),
  });
  return items;
}

function chooseDevice(id: string): void {
  if (!project) return;
  appState.settings.flutterDevices = { ...appState.settings.flutterDevices, [project.dir]: id };
  persistSettings();
  render();
}

function openFlavorMenu(): void {
  if (!project || flavors.length === 0) return;
  const dir = project.dir;
  openFlavorPicker(flavors, selectedFlavor(), (flavor) => {
    appState.settings.flutterFlavors = { ...appState.settings.flutterFlavors, [dir]: flavor };
    persistSettings();
    render();
  });
}

function openDeviceMenu(anchor: HTMLElement, reopening = false): void {
  if (menuDispose && !reopening) {
    closeActiveOverlay();
    return;
  }
  // Opening the dropdown re-runs adb only (spec §10.2); the menu is rebuilt
  // when a result arrives while it is open.
  if (!reopening) loadAdb(false);
  menuAnchor = anchor;
  const rect = anchor.getBoundingClientRect();
  const rootRect = overlayRoot.getBoundingClientRect();
  const dispose = openMenu(
    overlayRoot,
    { left: rect.left - rootRect.left, top: rect.bottom - rootRect.top },
    deviceMenuItems(),
    {
      returnFocusTo: keyboardCaptureReturnTarget(),
      onClose: () => {
        if (menuDispose === dispose) menuDispose = null;
      },
    },
  );
  menuDispose = dispose;
}

/** Rebuilds the menu in place when a load changes the list under it. */
function refreshOpenMenu(): void {
  if (!menuDispose || !menuAnchor) return;
  const anchor = menuAnchor;
  const dispose = menuDispose;
  menuDispose = null;
  dispose();
  openDeviceMenu(anchor, true);
}

// ---------------------------------------------------------------------
// Play, Hot Reload, Hot Restart, Stop
// ---------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Types into `paneId` through the GUI's own keyboard path
 * (`ClientShellPaneInput`). `pane.send_text`, `pane.send_keys` and
 * `pane.read` are not on herdr's client-endpoint allowlist
 * (`src/server/client_commands.rs` `CLIENT_SHELL_METHODS`, herdr repo
 * root): the server answers "method ... is not available on this machine".
 * `false` when the send failed (`invokeSafe` already showed the notice). */
async function sendToPane(paneId: string, events: unknown[]): Promise<boolean> {
  return (await invokeSafe("send_input", { paneId, events })) !== undefined;
}

async function play(): Promise<void> {
  if (playing || !project || !activeWorkspaceId || !appState.snapshot) return;
  const device = selectedDevice();
  if (!device || device.state !== "device") return;
  // Settings are editable on disk, and this id is typed into a shell.
  if (!isValidDeviceId(device.id)) {
    showErrorNotice(`Unsafe device id: ${device.id}`);
    return;
  }
  const flavor = selectedFlavor();
  // Settings are editable on disk, and this name is typed into a shell.
  if (flavor !== null && !isValidFlavor(flavor)) {
    showErrorNotice(`Unsafe flavor: ${flavor}`);
    return;
  }
  const workspaceId = activeWorkspaceId;
  const projectInfo = project;
  const previous = runs.get(workspaceId);
  const reuse = previous?.status === "stopped" && previous.projectDir === projectInfo.dir;
  playing = true;
  render();
  try {
    let paneId: string;
    if (reuse) {
      paneId = runs.get(workspaceId)?.paneId ?? "";
      // Clears a leftover `q` at the prompt (PSReadLine and cmd).
      if (!(await sendToPane(paneId, [keyEvent("Esc", 0)]))) return;
    } else {
      const target = appState.snapshot.focused_pane_id;
      if (!target) {
        showErrorNotice("No focused pane to split");
        return;
      }
      // `api()` resolves the endpoint reply's `result` member only, not the
      // whole envelope: `conn.rs::endpoint_request` returns
      // `value["result"]` (an `error` member becomes a rejected
      // `ApiError`), and `commands.rs::api` passes that through, so the
      // reply is `{ type: "pane_info", pane: { pane_id, .. } }` with no
      // `id` or `result` wrapper.
      const split = await api<{ pane?: { pane_id?: string } }>("pane.split", {
        target_pane_id: target,
        direction: "down",
        cwd: projectInfo.dir,
        focus: false,
      });
      const newPaneId = split?.pane?.pane_id;
      if (!newPaneId) {
        showErrorNotice("pane.split returned no pane id");
        return;
      }
      paneId = newPaneId;
      if ((await api("pane.rename", { pane_id: paneId, label: "flutter" })) === undefined) return;
      // ponytail: fixed grace for the new shell to start, like the wizard
      // (`stepProviders.ts` SHELL_STARTUP_GRACE_MS). `pane.read` would be the
      // real signal, but the client endpoint does not allow it (above).
      await sleep(SHELL_STARTUP_GRACE_MS);
    }
    if (!(await sendToPane(paneId, [{ TextCommit: `flutter run -d ${device.id}${flavor ? ` --flavor ${flavor}` : ""}` }]))) return;
    if (!(await sendToPane(paneId, [keyEvent("Enter", 0)]))) return;
    onPlay(runs, workspaceId, paneId, projectInfo.dir, device.id);
    playedAt.set(workspaceId, Date.now());
  } finally {
    playing = false;
    render();
  }
}

/** Hot Reload `r`, Hot Restart `R`, Stop `q`: one raw keystroke, no Enter. */
async function sendRunKey(key: string, stops = false): Promise<void> {
  const workspaceId = activeWorkspaceId;
  const entry = workspaceId ? runs.get(workspaceId) : undefined;
  if (!workspaceId || !entry || actionsGuarded) return;
  actionsGuarded = true;
  render();
  window.setTimeout(() => {
    actionsGuarded = false;
    render();
  }, BUTTON_GUARD_MS);
  const sent = await sendToPane(entry.paneId, [{ TextCommit: key }]);
  if (sent && stops) onStop(runs, workspaceId);
  render();
}

// ---------------------------------------------------------------------
// Workspace switching and snapshots
// ---------------------------------------------------------------------

function loadFlavors(dir: string): void {
  const cached = flavorCache.get(dir);
  if (cached) {
    flavors = cached;
    return;
  }
  flavors = [];
  flutterFlavors(dir)
    .then((found) => {
      flavorCache.set(dir, found);
      if (project?.dir === dir) {
        flavors = found;
        render();
      }
    })
    .catch((err: unknown) => console.warn("flutter_flavors failed:", errorMessage(err)));
}

function activateProject(found: FlutterProject | null): void {
  const changed = found !== null && found.dir !== project?.dir;
  project = found;
  if (!found) flavors = [];
  else if (changed) loadFlavors(found.dir);
  render();
  if (!changed) return;
  // Only adb on activation; the flutter result is cached for the session
  // (spec section 10.2), and "Refresh devices" is the way to update it.
  loadAdb(false);
  if (flutterList === null && !flutterLoading) loadFlutter();
}

function onSnapshot(snapshot: RawSnapshot): void {
  reconcile(runs, new Set(snapshot.panes.map((p) => p.pane_id)));
  const workspace = snapshot.workspaces.find((w) => w.workspace_id === snapshot.focused_workspace_id);
  const workspaceId = workspace?.workspace_id ?? null;
  const cwd = workspace?.new_workspace_cwd ?? null;
  if (workspaceId === activeWorkspaceId && cwd === activeCwd) {
    render();
    return;
  }
  activeWorkspaceId = workspaceId;
  activeCwd = cwd;
  if (!cwd) {
    activateProject(null);
    return;
  }
  if (projectCache.has(cwd)) {
    activateProject(projectCache.get(cwd) ?? null);
    return;
  }
  // Hidden until the lookup returns. A stale reply (the active cwd moved
  // on meanwhile) is cached but not applied.
  activateProject(null);
  flutterProject(cwd)
    .then((found) => {
      projectCache.set(cwd, found);
      if (cwd === activeCwd) activateProject(found);
    })
    .catch((err: unknown) => {
      console.warn("flutter_project failed:", errorMessage(err));
    });
}

/** A run that ended on its own (a failed build) leaves no key press for the
 * GUI to see, so a live process check flips it to stopped. */
function pollRunsAlive(): void {
  for (const [workspaceId, entry] of runs) {
    if (entry.status !== "running") continue;
    if (Date.now() - (playedAt.get(workspaceId) ?? 0) < ALIVE_GRACE_MS) continue;
    flutterRunAlive(entry.deviceId)
      .then((alive) => {
        if (alive || runs.get(workspaceId) !== entry) return;
        onStop(runs, workspaceId);
        render();
      })
      .catch((err: unknown) => console.warn("flutter_run_alive failed:", errorMessage(err)));
  }
}

export async function wireFlutterRun(): Promise<void> {
  await listen<RawSnapshot>("snapshot", (event) => onSnapshot(event.payload));
  window.setInterval(pollRunsAlive, ALIVE_POLL_MS);
}
