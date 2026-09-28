// The terminal's right-click context menu (terminal-parity spec P0 #5,
// opened only when herdr's own TUI rule decides *not* to forward the
// right-click to the pane's app -- `mouse/rightClickRule.ts`). Item order
// per spec: "Copy (when there is a selection), Paste, Select All, Clear,
// then Split Right / Split Down, Zoom, then 'Send right-clicks to pane'
// (a toggle), then Close Pane." Pure menu-building glue over the existing
// `ui/menu.ts`; the actions themselves live in `paneActions.ts` and
// `appTerminalMouse.ts` (selection state).

import { keyboardCaptureReturnTarget } from "../keyboard/focusCapture";
import { openMenu, type MenuItemSpec, type MenuPosition } from "./menu";

export interface PaneContextMenuCallbacks {
  hasSelection: boolean;
  rightClickPassthrough: boolean;
  onCopy(): void;
  onPaste(): void;
  onSelectAll(): void;
  onClear(): void;
  onSplitRight(): void;
  onSplitDown(): void;
  onToggleZoom(): void;
  onTogglePassthrough(): void;
  onClosePane(): void;
}

function items(ctx: PaneContextMenuCallbacks): MenuItemSpec[] {
  const list: MenuItemSpec[] = [];
  if (ctx.hasSelection) {
    list.push({ id: "copy", label: "Copy", icon: "copy", onSelect: ctx.onCopy });
  }
  list.push(
    { id: "paste", label: "Paste", icon: "clippy", onSelect: ctx.onPaste },
    { id: "selectAll", label: "Select All", onSelect: ctx.onSelectAll },
    { id: "clear", label: "Clear", separatorBefore: true, onSelect: ctx.onClear },
    { id: "splitRight", label: "Split Right", icon: "split-horizontal", separatorBefore: true, onSelect: ctx.onSplitRight },
    { id: "splitDown", label: "Split Down", icon: "split-vertical", onSelect: ctx.onSplitDown },
    { id: "toggleZoom", label: "Toggle Zoom", onSelect: ctx.onToggleZoom },
    {
      id: "togglePassthrough",
      label: "Send Right-Clicks to Pane",
      checked: ctx.rightClickPassthrough,
      separatorBefore: true,
      onSelect: ctx.onTogglePassthrough,
    },
    { id: "closePane", label: "Close Pane", danger: true, separatorBefore: true, onSelect: ctx.onClosePane },
  );
  return list;
}

export function openPaneContextMenu(root: HTMLElement, position: MenuPosition, ctx: PaneContextMenuCallbacks): () => void {
  return openMenu(root, position, items(ctx), { returnFocusTo: keyboardCaptureReturnTarget() });
}
