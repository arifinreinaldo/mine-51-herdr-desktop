# Spec: Cowbell UI/UX critique, the four deferred items

Source: Opus pipeline-planner, 2026-11-08. Keys approved by the user: Run = Ctrl+Shift+F5, Hot Reload = Ctrl+Shift+R, Hot Restart = Alt+Shift+R.

## Header

**goal**
1. The herdr theme's blocked colour (and the rename field) must stand out from the peach `#f4b183` active-tab fill.
2. `openModal` gets a Tab trap.
3. Menus get correct ARIA.
4. Run, Hot Reload and Hot Restart get table shortcuts that also show in the tooltips and the cheat sheet.

**Do not touch**
- `src/themes/build.ts`, `tokens.ts`, `dark-modern.ts` and the other four theme files
- `src/keyboard/routing.ts`, `src/keyboard/focusCapture.ts`, `src/ui/overlay.ts`, `src/input/keymap.ts`
- `isAllowedShortcutClass` and `MAC_ENTRIES` in `src/shortcuts.ts`
- the uncommitted working-tree changes already in style.css (focus rings), tabs.ts, sidebar.ts, statusbar.ts, runToolbar.ts (`retitle`). Build on them. Never revert them.
- `tests/unit/openLocalPath.test.ts` (already fails, unrelated)
- Keep each file's existing line endings (some files are CRLF). Do not commit.

**contracts**
- Theme: herdr palette `orange` changes from `#f4b183` to `#f0883e`. Invariant: in every built-in theme, `contrastRatio(herdr.status.blocked, tab.activeBackground) >= 1.3`.
- Modal: `.modal` gets `tabIndex = -1` and takes focus after `openOverlay(dispose)`. Plain Tab / Shift+Tab wrap at the first and last control. Tab with Ctrl, Alt or Meta is not trapped. Close still calls `focusKeyboardCapture()`.
- Menu ARIA: item with `checked !== undefined` gets `role="menuitemcheckbox"` + `aria-checked`. `disabled` adds `aria-disabled="true"`. `submenu` adds `aria-haspopup="menu"` (`swatchSubmenu` gets none). `#menubar` gets `role="menubar"`. Each `.menu-title` gets `role="menuitem"`, `aria-haspopup="menu"`, `aria-expanded`. Left/Right on a title move focus between titles with wrap.
- Shortcuts: `run.play` "Run" `Ctrl+Shift+F5` `combo(true, true, false, "F5")`; `run.hotReload` "Hot Reload" `Ctrl+Shift+R` `combo(true, true, false, "KeyR")`; `run.hotRestart` "Hot Restart" `Alt+Shift+R` `combo(false, true, true, "KeyR")`. `MenuName` gains `"Run"`. `CHEAT_SHEET_MENU_ORDER` becomes Workspace, Tab, Pane, Agents, View, Run, herdr, Help. No macOS binding.
- New API: `export type RunAction = "play" | "reload" | "restart"` and `RunToolbar.trigger(action)` in `runToolbar.ts`; `export function triggerRunAction(action: RunAction): void` in `appFlutterRun.ts`.
- Tooltip format: `` `${title} (${key})` ``; bare title when no key is bound.

**edge cases (verified by planner)**
- Blocked colour is not set in build.ts: `herdr.status.blocked` falls back to `charts.orange` = `p.orange`. Change only `herdr.ts`.
- The active-tab focus ring already works (`.tab.active:focus-visible`, uncommitted). Only the rename input needs the same treatment.
- Focus must move to the modal AFTER `openOverlay` (superseded overlays refocus the capture). Callers that focus a field via `setTimeout(...,0)` still win.
- Query focusables on every Tab keydown (bodies add controls late). A modal with no controls keeps focus on the dialog.
- Do not change focus-return-on-close to "restore previous activeElement".
- Add `.modal:focus-visible { outline: none; }` so the dialog shows no ring.
- Menu: the title handler skips when `event.defaultPrevented` (an open menu claims Left/Right first).
- `trigger()` presses the real button only when the toolbar and button are visible and enabled. Do NOT add guards inside `play()` / `sendRunKey()`.
- `appMenuBar.ts` importing `appFlutterRun` is safe (no cycle).
- Baseline: `npx tsc --noEmit` already reports one error: `tests/unit/openLocalPath.test.ts(58,41): error TS2554`.

---

## step 1: herdr blocked colour and rename field
- **files**: `src/themes/herdr.ts`, `src/style.css`, `tests/unit/themes/contrast.test.ts`
- **exec**: mechanical
- (a) `herdr.ts`: `  orange: "#f4b183",` → `  orange: "#f0883e", // Dark Modern's blocked: the peach is the active-tab fill`
- (b) `style.css`: directly after the existing block
```
.tab.active:focus-visible {
  outline: 2px solid var(--tab-activeForeground, #ffffff);
  outline-offset: -2px;
}
```
  insert
```

/* The rename field on the active tab sits on the same fill. */
.tab.active .tab-rename-input {
  border-color: var(--tab-activeForeground, #ffffff);
  outline-color: var(--tab-activeForeground, #ffffff);
}
```
- (c) append to `contrast.test.ts` (reuse its existing imports/helpers; add any missing import):
```ts

// UI/UX critique: in the herdr theme the blocked colour equalled the peach active-tab fill.
describe("blocked colour vs the active tab fill", () => {
  for (const theme of BUILT_IN_THEMES) {
    it(`${theme.label}: herdr.status.blocked differs from tab.activeBackground by at least 1.3:1`, () => {
      const blocked = resolveThemeColor("herdr.status.blocked", theme.colors, DARK_MODERN_COLORS)!;
      const fill = resolveThemeColor("tab.activeBackground", theme.colors, DARK_MODERN_COLORS)!;
      expect(contrastRatio(blocked, fill)).toBeGreaterThanOrEqual(1.3);
    });
  }
});
```
- **verify**: `npx vitest run tests/unit/themes/contrast.test.ts` → all pass (herdr case fails without edit (a)).

## step 2: modal Tab trap
- **files**: `src/ui/modal.ts`, `src/style.css`, new `tests/unit/ui/modal.test.ts`
- **exec**: judgment
- (a) `modal.ts`: `let modalCount = 0;` → that line plus
```ts

/** The tab stops a dialog body can hold. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
```
- (b) `modal.ts`: after `  modal.setAttribute("aria-labelledby", heading.id);` add `  modal.tabIndex = -1; // the trap's home when the body has no controls`
- (c) `modal.ts`: replace the `onKeydown` (Escape only) with:
```ts
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dispose();
    } else if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      trapTab(event);
    }
  };
  /** aria-modal focus trap: Tab and Shift+Tab wrap at the edges. Ctrl+Tab stays a shortcut. */
  function trapTab(event: KeyboardEvent): void {
    // Queried per key: some bodies add their controls after open (usage setup, licences).
    const items = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest("[hidden]"));
    const first = items[0] ?? modal;
    const last = items[items.length - 1] ?? modal;
    const active = document.activeElement;
    const inside = active !== modal && modal.contains(active);
    const back = event.shiftKey;
    if (inside && active !== (back ? first : last)) return; // not at an edge: the browser moves focus
    event.preventDefault();
    (back ? last : first).focus();
  }
```
- (d) `modal.ts`: replace `  openOverlay(dispose);\n  return dispose;\n}` with
```ts
  openOverlay(dispose);
  // After `openOverlay`: the overlay it supersedes can return focus to the terminal as it closes.
  // Callers that focus a field later (setTimeout 0) still win.
  modal.focus({ preventScroll: true });
  return dispose;
}
```
- (e) `style.css`: before `.modal h2 {` insert
```css
/* The dialog takes focus only to hold the Tab trap. Its controls keep their own rings. */
.modal:focus-visible {
  outline: none;
}

```
- (f) create `tests/unit/ui/modal.test.ts`:
```ts
// @vitest-environment jsdom
//
// `openModal`'s aria-modal focus trap. jsdom does not move focus on Tab, so
// these tests check the initial focus, the two wrap edges and the focus
// return. The Tab order between inner controls stays the browser's.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { focusKeyboardCapture, registerKeyboardCapture } from "../../../src/keyboard/focusCapture";
import { openModal } from "../../../src/ui/modal";
import { closeActiveOverlay, openOverlay } from "../../../src/ui/overlay";

let captureEl: HTMLTextAreaElement;

beforeEach(() => {
  document.body.innerHTML = "";
  captureEl = document.createElement("textarea");
  document.body.appendChild(captureEl);
  registerKeyboardCapture(captureEl);
  captureEl.focus();
});

afterEach(() => {
  closeActiveOverlay(); // never leak an open modal into the next test
});

/** Dispatches a keydown at the focused element, like a real key press. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

function openWithButtons(): { modal: HTMLElement; first: HTMLButtonElement; last: HTMLButtonElement } {
  const first = document.createElement("button");
  first.textContent = "Cancel";
  const last = document.createElement("button");
  last.textContent = "OK";
  openModal("Test", (body) => body.append(first, last));
  return { modal: document.querySelector<HTMLElement>(".modal")!, first, last };
}

describe("openModal focus trap", () => {
  it("moves focus from the terminal capture into the dialog on open", () => {
    const { modal } = openWithButtons();
    expect(document.activeElement).toBe(modal);
  });

  it("keeps the focus when the overlay it supersedes returns focus to the capture", () => {
    openOverlay(() => focusKeyboardCapture()); // like a popover's disposer (statusbar.ts)
    const { modal } = openWithButtons();
    expect(document.activeElement).toBe(modal);
  });

  it("Tab on the last control wraps to the first", () => {
    const { first, last } = openWithButtons();
    last.focus();
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab on the first control wraps to the last", () => {
    const { first, last } = openWithButtons();
    first.focus();
    expect(press("Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("Tab from the dialog itself goes to the first control, Shift+Tab to the last", () => {
    const { modal, first, last } = openWithButtons();
    press("Tab");
    expect(document.activeElement).toBe(first);
    modal.focus();
    press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("leaves Tab between two inner controls to the browser", () => {
    const { first } = openWithButtons();
    first.focus();
    expect(press("Tab").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(first);
  });

  it("skips a disabled control", () => {
    const { first, last } = openWithButtons();
    last.disabled = true;
    first.focus();
    expect(press("Tab").defaultPrevented).toBe(true); // first is also the last stop
    expect(document.activeElement).toBe(first);
  });

  it("keeps focus on a dialog with no controls", () => {
    openModal("About", (body) => body.append("text only"));
    const modal = document.querySelector<HTMLElement>(".modal")!;
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(modal);
  });

  it("leaves Ctrl+Tab alone: it is the Next Tab shortcut", () => {
    const { last } = openWithButtons();
    last.focus();
    expect(press("Tab", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it("Esc closes the dialog and returns focus to the terminal capture", () => {
    openWithButtons();
    press("Escape");
    expect(document.querySelector(".modal")).toBeNull();
    expect(document.activeElement).toBe(captureEl);
  });
});
```
  If a jsdom focus case misbehaves, adjust the test to jsdom reality without weakening the production code; report what you changed.
- **verify**: `npx vitest run tests/unit/ui/modal.test.ts tests/unit/ui/shortcutsModal.test.ts tests/unit/keyboard/routing.test.ts` → all pass (shortcutsModal may still show the old group list until step 4).

## step 3: menu and menubar ARIA
- **files**: `src/ui/menu.ts`, `src/ui/menus.ts`, `index.html`, `tests/unit/ui/menu.test.ts`, `tests/unit/ui/menus.test.ts`
- **exec**: mechanical
- (a) `menu.ts` `buildItemEl`: replace
```ts
  el.setAttribute("role", "menuitem");
  el.tabIndex = -1;
  if (item.danger) el.classList.add("is-danger");
  if (item.disabled) el.classList.add("is-disabled");
```
  with
```ts
  // `checked: false` still marks a checkable item, so test presence, not truth.
  const checkable = item.checked !== undefined;
  el.setAttribute("role", checkable ? "menuitemcheckbox" : "menuitem");
  if (checkable) el.setAttribute("aria-checked", String(item.checked));
  el.tabIndex = -1;
  if (item.danger) el.classList.add("is-danger");
  if (item.disabled) {
    el.classList.add("is-disabled");
    el.setAttribute("aria-disabled", "true");
  }
  // A plain submenu only: the swatch grid has no menu role to announce.
  if (item.submenu) el.setAttribute("aria-haspopup", "menu");
```
- (b1) `menus.ts` `openFor`: replace
```ts
    for (const el of menuTitleEls) el.classList.remove("is-open");
    titleEl.classList.add("is-open");
```
  with
```ts
    for (const el of menuTitleEls) {
      el.classList.remove("is-open");
      el.setAttribute("aria-expanded", "false");
    }
    titleEl.classList.add("is-open");
    titleEl.setAttribute("aria-expanded", "true");
```
- (b2) `menus.ts`: in `onClose: () => {\n          titleEl.classList.remove("is-open");` add after the remove line `titleEl.setAttribute("aria-expanded", "false");` (same indentation).
- (b3) `menus.ts`: after `const name = titleEl.dataset.menu ?? "";` add
```ts
    // `#menubar` has role="menubar" (index.html). Each title opens a menu.
    titleEl.setAttribute("role", "menuitem");
    titleEl.setAttribute("aria-haspopup", "menu");
    titleEl.setAttribute("aria-expanded", "false");
```
- (b4) `menus.ts` title keydown: after the `if (Enter/" "/ArrowDown) {...openFor(name, titleEl);}` branch add
```ts
    } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.defaultPrevented) {
      // Menubar keys: Left and Right move focus between the titles, with wrap.
      // An open menu claims these keys first (`onSwitchTopLevel`) and calls preventDefault.
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      menuTitleEls[(menuTitleEls.indexOf(titleEl) + step + menuTitleEls.length) % menuTitleEls.length].focus();
    }
```
  (merge into the existing if-chain; keep braces valid).
- (c) `index.html`: `<nav id="menubar">` → `<nav id="menubar" role="menubar">`
- (d) append to `menu.test.ts` (reuse its existing `root` and imports):
```ts

describe("openMenu: ARIA roles and states", () => {
  it("marks checkable, disabled and submenu items for assistive tech", () => {
    const dispose = openMenu(root, { left: 0, top: 0 }, [
      { id: "on", label: "On", checked: true },
      { id: "off", label: "Off", checked: false },
      { id: "plain", label: "Plain" },
      { id: "nope", label: "Unavailable", disabled: true },
      { id: "more", label: "More", submenu: [{ id: "child", label: "Child" }] },
      { id: "color", label: "Color", swatchSubmenu: { colors: ["#111111"], currentIndex: 0, onPick: () => {} } },
    ]);
    const item = (id: string) => root.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
    expect(item("on").getAttribute("role")).toBe("menuitemcheckbox");
    expect(item("on").getAttribute("aria-checked")).toBe("true");
    expect(item("off").getAttribute("role")).toBe("menuitemcheckbox");
    expect(item("off").getAttribute("aria-checked")).toBe("false");
    expect(item("plain").getAttribute("role")).toBe("menuitem");
    expect(item("plain").hasAttribute("aria-checked")).toBe(false);
    expect(item("plain").hasAttribute("aria-disabled")).toBe(false);
    expect(item("nope").getAttribute("aria-disabled")).toBe("true");
    expect(item("more").getAttribute("aria-haspopup")).toBe("menu");
    expect(item("color").hasAttribute("aria-haspopup")).toBe(false);
    dispose();
  });
});
```
  Check the file's real helper names / item data attribute and adapt if they differ.
- (e) `menus.test.ts`: add `import { closeActiveOverlay } from "../../../src/ui/overlay";` after the `DARK_MODERN_COLORS` import, and append (reuse its existing `makeTitleEls`, `fakeContext`, `wireMenuBar` helpers; adapt names to the file):
```ts

describe("wireMenuBar: menubar ARIA", () => {
  beforeEach(() => {
    closeActiveOverlay(); // an earlier test leaves a menu open, and its key listener would claim the arrows
  });

  it("titles are menu items whose aria-expanded follows the open menu", () => {
    const [workspaceTitle, tabTitle] = makeTitleEls(["workspace", "tab"]);
    wireMenuBar([workspaceTitle, tabTitle], fakeContext());
    for (const el of [workspaceTitle, tabTitle]) {
      expect(el.getAttribute("role")).toBe("menuitem");
      expect(el.getAttribute("aria-haspopup")).toBe("menu");
      expect(el.getAttribute("aria-expanded")).toBe("false");
    }
    workspaceTitle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(workspaceTitle.getAttribute("aria-expanded")).toBe("true");
    tabTitle.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(workspaceTitle.getAttribute("aria-expanded")).toBe("false");
    expect(tabTitle.getAttribute("aria-expanded")).toBe("true");
    tabTitle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(tabTitle.getAttribute("aria-expanded")).toBe("false");
  });

  it("Left and Right on a focused title move focus between titles, with wrap, and open nothing", () => {
    const ctx = fakeContext();
    const titles = makeTitleEls(["workspace", "tab", "help"]);
    for (const el of titles) el.tabIndex = 0;
    wireMenuBar(titles, ctx);
    titles[0].focus();
    titles[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(titles[2]);
    titles[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(titles[0]);
    expect(ctx.overlayRoot.querySelector(".menu")).toBeNull();
  });
});
```
- **verify**: `npx vitest run tests/unit/ui/menu.test.ts tests/unit/ui/menus.test.ts tests/unit/ui/sidebar.test.ts` → all pass.

## step 4: Run / Hot Reload / Hot Restart shortcuts
- **files**: `src/shortcuts.ts`, `src/ui/runToolbar.ts`, `src/appFlutterRun.ts`, `src/appMenuBar.ts`, `tests/unit/shortcuts.test.ts`, `tests/unit/ui/shortcutsModal.test.ts`, new `tests/unit/ui/runToolbar.test.ts`
- **exec**: judgment
- (a1) `shortcuts.ts`: `MenuName` union gains `"Run"` between `"View"` and `"herdr"`.
- (a2) `shortcuts.ts`: append to `NAMED_SHORTCUTS` (after the Shift+End entry, before `];`):
```ts
  // Flutter run toolbar (`ui/runToolbar.ts`). There is no menu-bar menu: "Run" groups them in the cheat sheet.
  // Ctrl+Shift+F5 keeps bare F5 for terminal programs. R and Shift+R match `flutter run`'s own r and R keys.
  {
    id: "run.play",
    menu: "Run",
    label: "Run",
    display: "Ctrl+Shift+F5",
    combo: combo(true, true, false, "F5"),
  },
  {
    id: "run.hotReload",
    menu: "Run",
    label: "Hot Reload",
    display: "Ctrl+Shift+R",
    combo: combo(true, true, false, "KeyR"),
  },
  {
    id: "run.hotRestart",
    menu: "Run",
    label: "Hot Restart",
    display: "Alt+Shift+R",
    combo: combo(false, true, true, "KeyR"),
  },
```
- (a3) `shortcuts.ts` `CHEAT_SHEET_MENU_ORDER`: insert `"Run",` between `"View",` and `"herdr",`.
- (b1) `shortcuts.test.ts`: expected menu-name list becomes `["Workspace","Tab","Pane","Agents","View","Run","herdr"]`.
- (b2) `shortcuts.test.ts`: add before the `describe("cheatSheetEntries / filterCheatSheetEntries / groupCheatSheetEntriesByMenu", ...` block (adapt to the file's real `findShortcut` signature and `KeyCombo` type):
```ts
describe("findShortcut: run toolbar", () => {
  it("resolves Run, Hot Reload and Hot Restart", () => {
    const cases: Array<[KeyCombo, string]> = [
      [{ ctrl: true, shift: true, alt: false, code: "F5" }, "run.play"],
      [{ ctrl: true, shift: true, alt: false, code: "KeyR" }, "run.hotReload"],
      [{ ctrl: false, shift: true, alt: true, code: "KeyR" }, "run.hotRestart"],
    ];
    for (const [c, id] of cases) {
      expect(findShortcut({ ctrlKey: c.ctrl, shiftKey: c.shift, altKey: c.alt, code: c.code }, false)?.id).toBe(id);
    }
  });

  it("leaves bare F5 and plain Ctrl+R to the terminal", () => {
    expect(findShortcut({ ctrlKey: false, shiftKey: false, altKey: false, code: "F5" }, false)).toBeUndefined();
    expect(findShortcut({ ctrlKey: true, shiftKey: false, altKey: false, code: "KeyR" }, false)).toBeUndefined();
  });

  it("groups them under Run in the cheat sheet", () => {
    const run = cheatSheetEntries().filter((e) => e.menu === "Run").map((e) => e.id);
    expect(run).toEqual(["run.play", "run.hotReload", "run.hotRestart"]);
  });
});

```
- (c) `shortcutsModal.test.ts`: expected headings list becomes `["Workspace","Tab","Pane","Agents","View","Run","Cowbell"]`.
- (d1) `runToolbar.ts`: after `import type { RunStatus } from "../flutter/runState";` add `import { shortcutDisplay } from "../shortcuts";`
- (d2) `runToolbar.ts`: replace the `RunToolbar` interface with
```ts
/** The toolbar actions the `run.*` shortcuts press. */
export type RunAction = "play" | "reload" | "restart";

export interface RunToolbar {
  render: (view: RunToolbarView) => void;
  /** Presses the action's button only while it shows and is enabled: a key obeys the same state as a click. */
  trigger: (action: RunAction) => void;
}
```
- (d3) `runToolbar.ts`: before `export function createRunToolbar(` add
```ts
/** "Hot Reload (Ctrl+Shift+R)". The bare title where the action has no key (macOS). */
function withKey(title: string, id: string): string {
  const key = shortcutDisplay(id);
  return key ? `${title} (${key})` : title;
}

```
- (d4) `runToolbar.ts`: `"Hot Reload", handlers.onReload` → `withKey("Hot Reload", "run.hotReload"), handlers.onReload`; `"Hot Restart", handlers.onRestart` → `withKey("Hot Restart", "run.hotRestart"), handlers.onRestart`.
- (d5) `runToolbar.ts`: `retitle(play, view.playTitle);` → `retitle(play, view.playDisabled ? view.playTitle : withKey(view.playTitle, "run.play"));`
- (d6) `runToolbar.ts`: the returned object gains, after `render(view) {...},`:
```ts
    trigger(action) {
      const btn = { play, reload, restart }[action];
      if (!root.hidden && !btn.hidden && !btn.disabled) btn.click();
    },
```
- (e1) `appFlutterRun.ts`: `import { createRunToolbar } from "./ui/runToolbar";` → `import { createRunToolbar, type RunAction } from "./ui/runToolbar";`
- (e2) `appFlutterRun.ts`: after the `createRunToolbar(...)` call that ends with `onStop: () => void sendRunKey("q", true),\n});` add
```ts

/** The `run.*` keyboard shortcuts (`shortcuts.ts`). They press the toolbar button, so a key obeys its hidden and disabled state. */
export function triggerRunAction(action: RunAction): void {
  toolbar.trigger(action);
}
```
  (use the real variable name holding the created toolbar).
- (f1) `appMenuBar.ts`: after `import { findInFileViewer } from "./appFiles";` add `import { triggerRunAction } from "./appFlutterRun";`
- (f2) `appMenuBar.ts`: after `"pane.scrollToBottom": () => void scrollFocusedPaneToEdge("bottom"),` add
```ts
  "run.play": () => triggerRunAction("play"),
  "run.hotReload": () => triggerRunAction("reload"),
  "run.hotRestart": () => triggerRunAction("restart"),
```
- (g) create `tests/unit/ui/runToolbar.test.ts`:
```ts
// @vitest-environment jsdom
//
// The run toolbar's keyboard path: `trigger` presses a button only while the
// button shows and is enabled, and the tooltips name the `run.*` keys.

import { describe, expect, it, vi } from "vitest";
import { shortcutDisplay } from "../../../src/shortcuts";
import { createRunToolbar, type RunToolbarHandlers, type RunToolbarView } from "../../../src/ui/runToolbar";

function view(overrides: Partial<RunToolbarView> = {}): RunToolbarView {
  return {
    visible: true,
    label: "Pixel 7",
    labelTitle: "Pixel 7 — emulator-5554",
    loading: false,
    status: "idle",
    starting: false,
    playDisabled: false,
    playTitle: "Run on Pixel 7",
    flavor: null,
    actionsDisabled: false,
    mirrorBusy: false,
    mirrorDisabled: false,
    mirrorTitle: "Mirror",
    dbDisabled: false,
    dbTitle: "Inspect",
    explorerTitle: "Browse",
    playVisible: true,
    ...overrides,
  };
}

const RUNNING = { status: "running", playDisabled: true, playTitle: "Running. Press Stop to end it" } as const;

function setup() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const handlers: RunToolbarHandlers = {
    onDeviceClick: vi.fn(),
    onFlavorClick: vi.fn(),
    onMirror: vi.fn(),
    onDatabase: vi.fn(),
    onExplorer: vi.fn(),
    onPlay: vi.fn(),
    onReload: vi.fn(),
    onRestart: vi.fn(),
    onStop: vi.fn(),
  };
  const toolbar = createRunToolbar(root, handlers);
  const title = (cls: string) => root.querySelector(`.${cls}`)!.getAttribute("title");
  return { handlers, toolbar, title };
}

describe("RunToolbar.trigger", () => {
  it("Run while a run is going does nothing: Play is disabled", () => {
    const { handlers, toolbar } = setup();
    toolbar.render(view(RUNNING));
    toolbar.trigger("play");
    expect(handlers.onPlay).not.toHaveBeenCalled();
  });

  it("Hot Reload and Hot Restart press their buttons during a run", () => {
    const { handlers, toolbar } = setup();
    toolbar.render(view(RUNNING));
    toolbar.trigger("reload");
    toolbar.trigger("restart");
    expect(handlers.onReload).toHaveBeenCalledTimes(1);
    expect(handlers.onRestart).toHaveBeenCalledTimes(1);
  });

  it("Hot Reload and Hot Restart do nothing after Stop (the buttons hide)", () => {
    const { handlers, toolbar } = setup();
    toolbar.render(view({ status: "stopped" }));
    toolbar.trigger("reload");
    toolbar.trigger("restart");
    expect(handlers.onReload).not.toHaveBeenCalled();
    expect(handlers.onRestart).not.toHaveBeenCalled();
  });

  it("Hot Reload does nothing inside the 300 ms button guard", () => {
    const { handlers, toolbar } = setup();
    toolbar.render(view({ ...RUNNING, actionsDisabled: true }));
    toolbar.trigger("reload");
    expect(handlers.onReload).not.toHaveBeenCalled();
  });

  it("Run presses an enabled Play, and does nothing when Play or the toolbar hides", () => {
    const { handlers, toolbar } = setup();
    toolbar.render(view());
    toolbar.trigger("play");
    expect(handlers.onPlay).toHaveBeenCalledTimes(1);
    toolbar.render(view({ playVisible: false })); // a native Android project
    toolbar.trigger("play");
    toolbar.render(view({ visible: false })); // not a Flutter workspace
    toolbar.trigger("play");
    expect(handlers.onPlay).toHaveBeenCalledTimes(1);
  });
});

describe("run toolbar tooltips", () => {
  it("name the key on Hot Reload, Hot Restart and an enabled Play", () => {
    const { toolbar, title } = setup();
    toolbar.render(view());
    expect(title("run-btn--reload")).toBe(`Hot Reload (${shortcutDisplay("run.hotReload")})`);
    expect(title("run-btn--restart")).toBe(`Hot Restart (${shortcutDisplay("run.hotRestart")})`);
    expect(title("run-btn--play")).toBe(`Run on Pixel 7 (${shortcutDisplay("run.play")})`);
  });

  it("a disabled Play keeps its reason without a key", () => {
    const { toolbar, title } = setup();
    toolbar.render(view({ playDisabled: true, playTitle: "No devices. Connect a device, then Refresh devices" }));
    expect(title("run-btn--play")).toBe("No devices. Connect a device, then Refresh devices");
  });
});
```
  Match the real `RunToolbarView` / `RunToolbarHandlers` field names in `runToolbar.ts`; fix the test data, not the types.
- **verify**: `npx vitest run tests/unit/shortcuts.test.ts tests/unit/ui/shortcutsModal.test.ts tests/unit/ui/runToolbar.test.ts && npx tsc --noEmit` → tests pass; tsc prints only the `openLocalPath.test.ts(58,41)` error.

## step 5: sync llm_wiki
- **files**: `llm_wiki/CHANGELOG.md`, `llm_wiki/areas/render-themes.md`, `keyboard.md`, `workspace-ui.md`, `flutter-android.md`, `llm_wiki/doc-mismatches.md`
- **exec**: judgment
- `CHANGELOG.md`: in the `## 2026-11-08 - UI/UX critique fixes` entry, replace the `- Not done: ...` line with four bullets, one per step 1-4. Name `herdr.ts` `orange`, `modal.ts` `trapTab`, `menu.ts`/`menus.ts` roles, `RunToolbar.trigger`/`triggerRunAction`.
- `render-themes.md` Edges: herdr blocked colour is `#f0883e` (`herdr.ts` `orange`). `contrast.test.ts` keeps blocked at 1.3:1 or more against `tab.activeBackground`.
- `keyboard.md`: `run.*` shortcuts (keys, Windows only, unbound on macOS) press the toolbar buttons through `triggerRunAction`; the modal Tab trap lives in `src/ui/modal.ts`, focus moves after `openOverlay`.
- `workspace-ui.md`: `#menubar` has `role="menubar"`; `wireMenuBar` sets title roles and `aria-expanded`; Left/Right move between titles.
- `flutter-android.md`: one line on the shortcuts and `RunToolbar.trigger`.
- `doc-mismatches.md`: new row. `docs/mock/index.html` has herdr `block:'#f4b183'`; code uses `#f0883e`.
- Use symbol names, not line numbers. STE: max 20 words per sentence, active voice, no `-ing` verb forms.
- **verify**: `grep -c "Not done: herdr theme accent" llm_wiki/CHANGELOG.md` → `0`

## Overall verify
`cd C:/Users/Reinaldo/Backend/herdr/gui && npx tsc --noEmit; npx vitest run`
Expected: tsc prints only the `openLocalPath.test.ts(58,41)` error; vitest fails only `openLocalPath.test.ts` and the known fileViewer timeout.
