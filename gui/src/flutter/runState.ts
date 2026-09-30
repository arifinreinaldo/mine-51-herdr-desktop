// Per-workspace flutter run state (flutter-run-spec §5.1) and the device
// list merge (§10.2). Pure: no DOM, no Tauri, so it is unit-tested.

import type { AndroidDevice } from "./flutterApi";

export type RunStatus = "idle" | "running" | "stopped";

export interface RunEntry {
  paneId: string;
  projectDir: string;
  deviceId: string;
  status: "running" | "stopped";
}

export type RunMap = Map<string, RunEntry>;

export function onPlay(map: RunMap, ws: string, paneId: string, projectDir: string, deviceId: string): void {
  map.set(ws, { paneId, projectDir, deviceId, status: "running" });
}

/** Keeps `paneId` so the next Play can reuse the pane. */
export function onStop(map: RunMap, ws: string): void {
  const entry = map.get(ws);
  if (entry) map.set(ws, { ...entry, status: "stopped" });
}

/** Deletes every entry whose pane is gone from the snapshot (the user
 * closed the flutter pane or its tab). */
export function reconcile(map: RunMap, livePaneIds: ReadonlySet<string>): void {
  for (const [ws, entry] of map) {
    if (!livePaneIds.has(entry.paneId)) map.delete(ws);
  }
}

export function statusFor(map: RunMap, ws: string): RunStatus {
  return map.get(ws)?.status ?? "idle";
}

const FLAVOR_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/** Mirrors `flutter.rs::is_safe_flavor`. Typed into a shell on Play. */
export function isValidFlavor(flavor: string): boolean {
  return FLAVOR_PATTERN.test(flavor);
}

/** Case-insensitive substring filter for the flavor picker; blank = all. */
export function filterFlavors(flavors: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? flavors.filter((f) => f.toLowerCase().includes(q)) : [...flavors];
}

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:][A-Za-z0-9._:-]*$/;

/** Mirrors `flutter.rs::is_valid_device_id`. The id is typed into a shell
 * on Play, and settings.json is editable on disk, so Play checks it again. */
export function isValidDeviceId(id: string): boolean {
  return DEVICE_ID_PATTERN.test(id);
}

/** adb entries in adb order, then each flutter entry whose id is not
 * already listed (the adb entry wins). A null flutter list (pending or
 * failed) gives the adb list. */
export function mergeDevices(adb: readonly AndroidDevice[], flutter: readonly AndroidDevice[] | null): AndroidDevice[] {
  const merged = [...adb];
  if (!flutter) return merged;
  const seen = new Set(adb.map((d) => d.id));
  for (const device of flutter) {
    if (seen.has(device.id)) continue;
    seen.add(device.id);
    merged.push(device);
  }
  return merged;
}
