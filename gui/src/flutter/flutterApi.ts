// Flutter run: the TypeScript side of `src-tauri/src/flutter.rs`. These
// wrappers reject with the backend's `{ code, message }` `ApiError` instead
// of showing a notice: the device loader treats each source's failure
// differently (flutter-run-spec §10.2), so the caller decides what to show.

import { invoke } from "@tauri-apps/api/core";

export interface FlutterProject {
  dir: string;
  name: string;
}

export interface AndroidDevice {
  id: string;
  name: string;
  /** adb's state word; only `"device"` is runnable. Every flutter entry is `"device"`. */
  state: string;
  emulator: boolean;
}

export function flutterProject(cwd: string): Promise<FlutterProject | null> {
  return invoke<FlutterProject | null>("flutter_project", { cwd });
}

export function androidDevices(): Promise<AndroidDevice[]> {
  return invoke<AndroidDevice[]>("android_devices");
}

export function flutterDevices(): Promise<AndroidDevice[]> {
  return invoke<AndroidDevice[]>("flutter_devices");
}

/** Flavor names from the project's `android/app/build.gradle(.kts)`: every
 * combination of the flavor dimensions, camelCase (`devSales`). */
export function flutterFlavors(dir: string): Promise<string[]> {
  return invoke<string[]>("flutter_flavors", { dir });
}

/** Whether a `flutter run -d <deviceId>` process is still alive. */
export function flutterRunAlive(deviceId: string): Promise<boolean> {
  return invoke<boolean>("flutter_run_alive", { deviceId });
}

/** Starts a scrcpy window for the device. Rejects `scrcpy_not_found` when scrcpy is missing. */
export function androidMirror(deviceId: string): Promise<void> {
  return invoke<void>("android_mirror", { deviceId });
}

/** `adb install -r` of an absolute `.apk` path. Resolves adb's output. */
export function androidInstallApk(deviceId: string, path: string): Promise<string> {
  return invoke<string>("android_install_apk", { deviceId, path });
}

/** Installs scrcpy with winget (Windows). */
export function installScrcpy(): Promise<void> {
  return invoke<void>("install_scrcpy");
}
