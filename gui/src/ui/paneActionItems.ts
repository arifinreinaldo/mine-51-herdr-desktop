// One builder for the pane and tab actions that three menus share (the Pane
// menu, the tab context menu, the pane context menu), so one action has one
// label, icon and shortcut hint everywhere.

import { shortcutDisplay } from "../shortcuts";
import type { MenuItemSpec } from "./menu";

export interface PaneLayoutHandlers {
  onSplitRight(): void;
  onSplitDown(): void;
  onToggleZoom(): void;
}

export interface CloseHandlers {
  onClosePane?(): void;
  onCloseTab?(): void;
}

/** Split Right, Split Down, Toggle Zoom. The first item carries separatorBefore. */
export function paneLayoutItems(h: PaneLayoutHandlers): MenuItemSpec[] {
  return [
    {
      id: "pane.splitRight",
      label: "Split Right",
      icon: "split-horizontal",
      shortcut: shortcutDisplay("pane.splitRight"),
      separatorBefore: true,
      onSelect: h.onSplitRight,
    },
    {
      id: "pane.splitDown",
      label: "Split Down",
      icon: "split-vertical",
      shortcut: shortcutDisplay("pane.splitDown"),
      onSelect: h.onSplitDown,
    },
    {
      id: "pane.toggleZoom",
      label: "Toggle Zoom",
      icon: "screen-full",
      shortcut: shortcutDisplay("pane.toggleZoom"),
      onSelect: h.onToggleZoom,
    },
  ];
}

/** Close Pane (danger), then Close Tab. An item is left out when its handler is
 * missing. The first item carries separatorBefore. */
export function closeItems(h: CloseHandlers): MenuItemSpec[] {
  const items: MenuItemSpec[] = [];
  if (h.onClosePane) {
    items.push({
      id: "pane.close",
      label: "Close Pane",
      icon: "chrome-close",
      shortcut: shortcutDisplay("pane.close"),
      danger: true,
      onSelect: h.onClosePane,
    });
  }
  if (h.onCloseTab) {
    items.push({
      id: "tab.close",
      label: "Close Tab",
      icon: "close",
      shortcut: shortcutDisplay("tab.close"),
      onSelect: h.onCloseTab,
    });
  }
  if (items.length > 0) items[0] = { ...items[0], separatorBefore: true };
  return items;
}
