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
