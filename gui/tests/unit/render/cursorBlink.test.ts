// @vitest-environment jsdom
//
// A blinking cursor must restart in its "on" phase when it moves. Claude
// Code moves the real terminal cursor through its prompt and sets no
// DECSCUSR shape, so Cowbell blinks it. Before the fix, an arrow key that
// landed in the "off" phase left the caret hidden for up to 530ms.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Grid } from "../../../src/grid";
import { TerminalRenderer } from "../../../src/render/renderer";

const CURSOR_COLOR = "#00ff00";
const CELL_W = 8;

/** Records each `fillRect` with the `fillStyle` in effect at that call. */
function fakeContext(fills: { style: string; x: number; y: number; w: number; h: number }[]) {
  const ctx: Record<string, unknown> = {
    fillStyle: "",
    measureText: () => ({ width: CELL_W, fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3 }),
    fillRect: (x: number, y: number, w: number, h: number) => fills.push({ style: ctx.fillStyle as string, x, y, w, h }),
  };
  return new Proxy(ctx, {
    get: (target, key) => (key in target ? target[key as string] : () => undefined),
    set: (target, key, value) => {
      target[key as string] = value;
      return true;
    },
  });
}

function gridWithCursorAt(x: number): Grid {
  const width = 10;
  const height = 2;
  const cells = Array.from({ length: width * height }, () => ({ symbol: " ", fg: 0, bg: 0, modifier: 0, skip: false }));
  return { width, height, cells, cursor: { x, y: 0, visible: true, shape: "block", blink: true }, surfaceRevision: 0 };
}

describe("cursor blink restart", () => {
  let fills: { style: string; x: number; y: number; w: number; h: number }[];
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    vi.useFakeTimers();
    fills = [];
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return fakeContext([]);
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => fakeContext(fills) as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function flushFrames(): void {
    for (const cb of frames.splice(0)) cb(0);
  }

  function cursorFillAt(col: number): boolean {
    return fills.some((f) => f.style === CURSOR_COLOR && f.x === col * CELL_W && f.w === CELL_W);
  }

  function makeRenderer(): TerminalRenderer {
    const wrap = document.createElement("div");
    wrap.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect;
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    const theme = { ansi: Array(16).fill("#808080"), foreground: "#cccccc", background: "#000000", cursor: CURSOR_COLOR };
    const renderer = new TerminalRenderer(canvas, wrap, theme, () => undefined);
    renderer.measureAndResize();
    renderer.setFocused(true);
    return renderer;
  }

  it("paints a moved cursor even when the move lands in the off phase", () => {
    const renderer = makeRenderer();
    renderer.setGrid(gridWithCursorAt(0), "all");
    flushFrames();
    expect(cursorFillAt(0)).toBe(true);

    vi.advanceTimersByTime(530); // blink goes to its "off" phase
    flushFrames();
    fills.length = 0;
    vi.advanceTimersByTime(100);

    renderer.setGrid(gridWithCursorAt(1), [0]); // Right arrow
    flushFrames();
    expect(cursorFillAt(1)).toBe(true);
  });

  it("keeps the moved cursor on for a full phase, then blinks again", () => {
    const renderer = makeRenderer();
    renderer.setGrid(gridWithCursorAt(0), "all");
    vi.advanceTimersByTime(500); // 30ms before the old phase would flip
    renderer.setGrid(gridWithCursorAt(1), [0]);
    flushFrames();
    fills.length = 0;

    vi.advanceTimersByTime(100); // past the old flip point: still on
    renderer.markDirty([0]);
    flushFrames();
    expect(cursorFillAt(1)).toBe(true);

    fills.length = 0;
    vi.advanceTimersByTime(430); // a full 530ms after the move: off
    flushFrames();
    expect(cursorFillAt(1)).toBe(false);
  });

  it("does not restart the blink when the cursor stays put", () => {
    const renderer = makeRenderer();
    renderer.setGrid(gridWithCursorAt(3), "all");
    vi.advanceTimersByTime(530); // off phase
    flushFrames();
    fills.length = 0;

    renderer.setGrid(gridWithCursorAt(3), [0]); // output elsewhere, same cursor
    flushFrames();
    expect(cursorFillAt(3)).toBe(false);
  });
});
