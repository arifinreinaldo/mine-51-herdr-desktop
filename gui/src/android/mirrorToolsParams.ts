// Pure helpers for the mirror tools page (docs/mirror-toolbar-spec.md §6.4).
// Rust builds the page URL, and the page does not trust it: both sides
// validate the device id and clean the name by the same rule.

import { isValidDeviceId } from "../flutter/runState";

export const DEVICE_NAME_MAX_CHARS = 80;

export interface MirrorToolsParams {
  deviceId: string;
  deviceName: string;
}

/** `search` is `location.search`. `null` unless `device` passes `isValidDeviceId`. */
export function parseMirrorToolsParams(search: string): MirrorToolsParams | null {
  const query = new URLSearchParams(search);
  const deviceId = query.get("device") ?? "";
  if (!isValidDeviceId(deviceId)) return null;
  const name = (query.get("name") ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  const deviceName = Array.from(name).slice(0, DEVICE_NAME_MAX_CHARS).join("");
  return { deviceId, deviceName: deviceName || deviceId };
}

/** "left" | "right" from an event payload, else null. */
export function dockSideFrom(payload: unknown): "left" | "right" | null {
  return payload === "left" || payload === "right" ? payload : null;
}

export interface InstallView {
  /** adb is running: show the bar. */
  busy: boolean;
  tone: "busy" | "ok" | "failed";
  text: string;
  file: string;
}

/** The strip's install status for a `mirror-install` payload. `null` when the payload is malformed or names another
 * device: a page-wide `listen` also receives events Rust sends to other tools windows. */
export function installView(payload: unknown, deviceId: string): InstallView | null {
  if (!payload || typeof payload !== "object") return null;
  const { device, phase, index, total, file } = payload as Record<string, unknown>;
  if (device !== deviceId || typeof file !== "string") return null;
  if (phase === "ok") return { busy: false, tone: "ok", text: "Installed", file };
  if (phase === "failed") return { busy: false, tone: "failed", text: "Failed", file };
  if (phase !== "start" || typeof index !== "number" || typeof total !== "number") return null;
  if (!Number.isInteger(index) || !Number.isInteger(total)) return null;
  return { busy: true, tone: "busy", text: total > 1 ? `Installing ${index} of ${total}` : "Installing", file };
}
