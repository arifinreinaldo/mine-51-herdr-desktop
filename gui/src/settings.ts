// Client-side settings shape + persistence wrapper (spec phase1.5 §9.4
// "Settings persistence"). Mirrors `src-tauri/src/settings.rs::Settings`
// field-for-field (camelCase on the wire both sides).

import { invoke } from "@tauri-apps/api/core";

export type AgentSort = "priority" | "server_order";

export interface Settings {
  theme: string;
  workspaceFolders: Record<string, string>;
  workspaceColors: Record<string, number>;
  sidebarWidth: number;
  sidebarVisible: boolean;
  fontSize: number;
  agentSort: AgentSort;
  desktopNotifications: boolean;
  /** Phase 1.6 §4: the first-run wizard's trigger. */
  firstRunComplete: boolean;
}

export interface SettingsGetResponse {
  settings: Settings;
  corrupted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark-modern",
  workspaceFolders: {},
  workspaceColors: {},
  sidebarWidth: 260,
  sidebarVisible: true,
  fontSize: 14,
  agentSort: "priority",
  desktopNotifications: true,
  firstRunComplete: false,
};

export async function loadSettings(): Promise<SettingsGetResponse> {
  return invoke<SettingsGetResponse>("settings_get");
}

export async function saveSettings(settings: Settings): Promise<void> {
  await invoke("settings_set", { settings });
}
