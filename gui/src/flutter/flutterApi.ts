// Flutter run: the TypeScript side of `src-tauri/src/flutter.rs`. These
// wrappers reject with the backend's `{ code, message }` `ApiError` instead
// of showing a notice: the device loader treats each source's failure
// differently (flutter-run-spec §10.2), so the caller decides what to show.

import { invoke } from "@tauri-apps/api/core";

export interface FlutterProject {
  dir: string;
  name: string;
  /** "android": a native Android project. The run toolbar then hides Play and flavors. */
  kind: "flutter" | "android";
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

/** Opens the SQLite inspector window for an adb device, or focuses the open one. */
export function androidDbWindow(deviceId: string, deviceName?: string): Promise<void> {
  return invoke<void>("android_db_window", { deviceId, deviceName });
}

/** Third-party packages with a running process on the device, sorted. */
export function androidRunningApps(deviceId: string): Promise<string[]> {
  return invoke<string[]>("android_running_apps", { deviceId });
}

/** Paths, relative to the app data folder, of the SQLite databases the app holds open now. Rejects `not_running` and `not_debuggable`. */
export function androidAppDatabases(deviceId: string, packageName: string): Promise<string[]> {
  return invoke<string[]>("android_app_databases", { deviceId, packageName });
}

export interface PulledDatabase {
  /** The local copy, for a tooltip. */
  path: string;
  tables: string[];
}

/** Pulls the database with its `-wal` and `-shm` to a temp copy (replacing the last one) and lists its tables and views. */
export function androidPullDatabase(deviceId: string, packageName: string, dbPath: string): Promise<PulledDatabase> {
  return invoke<PulledDatabase>("android_pull_database", { deviceId, packageName, dbPath });
}

export interface QueryPage {
  columns: string[];
  /** Display text per cell; `null` is SQL NULL. Integers are strings, so 64-bit values keep every digit. */
  rows: (string | null)[][];
  hasMore: boolean;
  /** True when write mode ran a statement that changed the copy: one "Rows changed" row. */
  wrote: boolean;
}

/** Runs one statement on the local copy, up to 100 rows from `offset`. Read-only unless `write`. */
export function androidDbQuery(deviceId: string, packageName: string, dbPath: string, sql: string, offset: number, write: boolean): Promise<QueryPage> {
  return invoke<QueryPage>("android_db_query", { deviceId, packageName, dbPath, sql, offset, write });
}

export interface PushedDatabase {
  /** The device database as it was before the push, for a tooltip. */
  backupPath: string;
}

/** Force-stops the app, backs up its database, copies the local copy over it and checks the SHA-1. */
export function androidPushDatabase(deviceId: string, packageName: string, dbPath: string): Promise<PushedDatabase> {
  return invoke<PushedDatabase>("android_push_database", { deviceId, packageName, dbPath });
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
