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

/** Starts a scrcpy window for the device (and, on Windows, its mirror tools window). Rejects `scrcpy_not_found` when scrcpy is missing. */
export function androidMirror(deviceId: string, deviceName?: string): Promise<void> {
  return invoke<void>("android_mirror", { deviceId, deviceName });
}

/** Mirror tools window only: resizes it (expanded or the strip) and resolves the side it docks on. The first call is its ready signal. */
export function mirrorToolsResize(expanded: boolean): Promise<"left" | "right"> {
  return invoke<"left" | "right">("mirror_tools_resize", { expanded });
}

/** `adb install -r` of an absolute `.apk` path. Resolves adb's output. */
export function androidInstallApk(deviceId: string, path: string): Promise<string> {
  return invoke<string>("android_install_apk", { deviceId, path });
}

/** Installs scrcpy with winget (Windows). */
export function installScrcpy(): Promise<void> {
  return invoke<void>("install_scrcpy");
}

/** PNG bytes of the device screen. Rust also keeps the latest one for `screenshotCopy` and `screenshotSave`. */
export function androidScreenshot(deviceId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("android_screenshot", { deviceId });
}

/** Puts the latest screenshot on the OS clipboard. */
export function screenshotCopy(): Promise<void> {
  return invoke<void>("screenshot_copy");
}

/** Save dialog for the latest screenshot. Resolves the saved path, or `null` when cancelled. */
export function screenshotSave(suggestedName: string): Promise<string | null> {
  return invoke<string | null>("screenshot_save", { suggestedName });
}

export type StopCause = "user" | "mirror_closed" | "tools_closed" | "app_exit" | "device_lost" | "start_timeout";

export interface RecordResult {
  path: string;
  fileName: string;
  bytes: number;
  seconds: number;
  finalized: boolean;
  audio: boolean;
  cause: StopCause;
  message: string | null;
}

/** The recorder ended by itself and left no file. Same shape as an `ApiError`. */
export interface RecordFailed {
  code: string;
  message: string;
}

export interface RecordStarted {
  path: string;
  fileName: string;
}

/** Mirror tools window only. Resolves when the file has its header (the recording is real). Rejects `{ code, message }`. */
export function mirrorRecordStart(deviceId: string): Promise<RecordStarted> {
  return invoke<RecordStarted>("mirror_record_start", { deviceId });
}

/** Stops the recording and resolves the finished file. Rejects `not_recording` when it already ended. */
export function mirrorRecordStop(deviceId: string): Promise<RecordResult> {
  return invoke<RecordResult>("mirror_record_stop", { deviceId });
}

/** Shows a Cowbell recording in Explorer. Rejects `bad_path` for any other file. */
export function revealInFolder(path: string): Promise<void> {
  return invoke<void>("reveal_in_folder", { path });
}

/** Plain invoke: `invokeSafe` writes to `#error-notices`, which the tools page does not have. */
export function writeClipboardText(text: string): Promise<boolean> {
  return invoke<boolean>("write_clipboard_text", { text });
}
