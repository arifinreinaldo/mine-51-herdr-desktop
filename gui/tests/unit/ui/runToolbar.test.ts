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
