// Pure helpers for the device explorer page (`deviceExplorer.ts`). No DOM, no Tauri.
// The path rules are the same as `is_valid_device_path` and `is_deletable_path` in `src-tauri/src/device_explorer.rs`.

import type { PushKind } from "../flutter/flutterApi";

export const SDCARD_PATH = "/sdcard";

const PATH_MAX_BYTES = 4096;

/** An absolute device path under `/sdcard` or `/storage`: no empty, `.` or `..` segment, no control character, at most 4096 bytes. */
export function isValidDevicePath(path: string): boolean {
  if (new TextEncoder().encode(path).length > PATH_MAX_BYTES || /[\u0000-\u001f\u007f-\u009f]/.test(path)) return false;
  const [first, root, ...rest] = path.split("/");
  return first === "" && (root === "sdcard" || root === "storage") && rest.every((s) => s !== "" && s !== "." && s !== "..");
}

/** `name` inside the device folder `dir`; the device root `/` gets no second slash. */
export function childPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

/** The parent folder, or `null` at `base` (the root of the tree section: `/sdcard`, `/data/data/<pkg>` or `/`) and outside it. */
export function parentWithin(path: string, base: string): string | null {
  if (path === base || !path.startsWith(base === "/" ? "/" : `${base}/`)) return null;
  return path.slice(0, path.lastIndexOf("/")) || "/";
}

/** `ls` could not stat the item (mode `d?????????`): Android refuses it to the adb shell user. */
export function isStatDenied(entry: { mode: string }): boolean {
  return entry.mode.includes("?");
}

/** Same rule as `is_deletable_path`: at least two segments below the storage volume (`/sdcard`, `/storage/emulated/<user>`, `/storage/self/primary`, `/storage/<uuid>`), three below `Android` in any case. */
export function isDeletablePath(path: string): boolean {
  const segments = path.split("/").slice(1);
  const volume = segments[0] === "sdcard" ? 1 : segments[1] === "emulated" || segments[1] === "self" ? 3 : 2;
  const below = segments.slice(volume);
  return isValidDevicePath(path) && below.length >= (below[0]?.toLowerCase() === "android" ? 3 : 2);
}

/** The status line after `androidPushPaths` or a drop (`androidPushDropped`). Each pushed name is at `<dir>/<name>`. */
export function pushStatus(kind: PushKind | "drop", dir: string, names: string[]): string {
  if (kind === "sync") return `Synced into ${dir}/${names[0]}. Nothing on the device was deleted`;
  if (names.length === 1) return `Uploaded to ${dir}/${names[0]}`;
  return `Uploaded ${names.length} ${kind === "drop" ? "items" : "files"} to ${dir}`;
}
