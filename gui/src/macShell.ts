// macOS shell integration (Rust side: `src-tauri/src/macos.rs`): the Dock
// badge, the Dock bounce, and the native menu bar. Every export is a no-op
// outside a Mac webview, so Windows behaviour is unchanged.

import { listen } from "@tauri-apps/api/event";

import { invokeSafe } from "./appApi";
import { toNativeMenus } from "./nativeMenu";
import { IS_MAC } from "./shortcuts";
import type { MenuItemSpec } from "./ui/menu";

let lastBadge = -1;

/** Dock badge: the number of agents that are blocked or done and unseen. */
export function syncDockBadge(count: number): void {
  if (!IS_MAC || count === lastBadge) return;
  lastBadge = count;
  void invokeSafe("dock_badge", { count });
}

/** One Dock bounce (macOS ignores it while the app is in front). */
export function bounceDock(): void {
  if (IS_MAC) void invokeSafe("dock_bounce");
}

let handlers = new Map<string, () => void>();
let lastSignature = "";

/** Sends the menu bar to Rust when its content changed. The handlers are
 * refreshed on every call so a click always runs the latest action. */
export function syncNativeMenu(menus: readonly { name: string; title: string; items: readonly MenuItemSpec[] }[]): void {
  if (!IS_MAC) return;
  const built = toNativeMenus(menus);
  handlers = built.handlers;
  const signature = JSON.stringify(built.spec);
  if (signature === lastSignature) return;
  lastSignature = signature;
  void invokeSafe("set_native_menu", { menus: built.spec });
}

/** Runs the action behind a clicked native menu item. */
export async function wireNativeMenuClicks(): Promise<void> {
  if (!IS_MAC) return;
  await listen<string>("native-menu", (event) => handlers.get(event.payload)?.());
}
