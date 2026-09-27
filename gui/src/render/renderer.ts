// The terminal canvas renderer (spec phase1.5 §8 "Terminal renderer fixes"
// and §8a "Renderer performance"). Pure metric/box-drawing/atlas/run-merge
// maths lives in `metrics.ts`/`boxDrawing.ts`/`atlas.ts`/`runs.ts`
// (unit-tested); this module is the DOM/canvas glue that uses them.

import { cssColor } from "../colors";
import type { Grid } from "../grid";
import { AtlasSlotAllocator, GLYPH_ATLAS_CAPACITY, atlasKey } from "./atlas";
import { blockDescriptor, boxLineDescriptor, classifyGlyph } from "./boxDrawing";
import {
  backingSizeForAvailable,
  baselineYWithinRow,
  cellHeightForFontPx,
  cellWidthFromMeasuredWidth,
  fontPxForDpr,
  gridDimsForBacking,
  integralOriginShiftCssPx,
} from "./metrics";
import { mergeBackgroundRuns } from "./runs";

export const FONT_STACK = '"Cascadia Mono","Cascadia Code",Consolas,monospace';
export const MIN_FONT_SIZE_PX = 10;
export const MAX_FONT_SIZE_PX = 24;
export const DEFAULT_FONT_SIZE_PX = 14;

export interface RendererTheme {
  /** `terminal.ansiBlack` … `terminal.ansiBrightWhite`, in that order. */
  ansi: readonly string[];
  foreground: string;
  background: string;
  cursor: string;
}

export interface PerfSample {
  decodeMs: number;
  paintMs: number;
  dirtyRows: number;
  /** Rust decode+apply+encode µs for the frame this paint applied (spec
   * §8a.4), 0 when no surface frame has arrived yet or the trailer was
   * absent. */
  rustUs: number;
}

interface Percentiles {
  p50: number;
  p95: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

/** Rolling perf sample window for the HUD + the 5s debug log (spec §8a.4). */
class PerfLog {
  private paintSamples: number[] = [];
  private decodeSamples: number[] = [];
  private rustUsSamples: number[] = [];

  record(sample: PerfSample): void {
    this.paintSamples.push(sample.paintMs);
    this.decodeSamples.push(sample.decodeMs);
    this.rustUsSamples.push(sample.rustUs);
    if (this.paintSamples.length > 300) this.paintSamples.shift();
    if (this.decodeSamples.length > 300) this.decodeSamples.shift();
    if (this.rustUsSamples.length > 300) this.rustUsSamples.shift();
  }

  paintPercentiles(): Percentiles {
    const sorted = [...this.paintSamples].sort((a, b) => a - b);
    return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
  }

  decodePercentiles(): Percentiles {
    const sorted = [...this.decodeSamples].sort((a, b) => a - b);
    return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
  }

  rustUsPercentiles(): Percentiles {
    const sorted = [...this.rustUsSamples].sort((a, b) => a - b);
    return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
  }
}

/** A fixed-capacity glyph atlas (spec §8a.2): each distinct appearance
 * (`atlasKey`'s tuple) is rendered once into an `OffscreenCanvas`, then
 * drawn with `drawImage`. Slot bookkeeping (capacity, LRU eviction, and
 * finding #6b's variable slot width for wide glyphs) is the pure, tested
 * `AtlasSlotAllocator`; this class only owns the actual pixels.
 *
 * Finding #6a: the prior scheme deleted an evicted key from its map and
 * then looked that same (already-deleted) key back up for a slot to reuse,
 * always missing, so its slot counter grew without bound past this fixed
 * backing canvas. `AtlasSlotAllocator` never lets that happen. */
class GlyphAtlas {
  private readonly cols = 64;
  private readonly maxRows: number;
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private allocator: AtlasSlotAllocator;

  constructor(
    private cellWidthPx: number,
    private cellHeightPx: number,
  ) {
    this.maxRows = Math.ceil(GLYPH_ATLAS_CAPACITY / this.cols);
    this.allocator = new AtlasSlotAllocator(this.cols, this.maxRows, GLYPH_ATLAS_CAPACITY);
    this.canvas = new OffscreenCanvas(
      Math.max(1, this.cols * cellWidthPx),
      Math.max(1, this.maxRows * cellHeightPx),
    );
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
    this.ctx = ctx;
  }

  /** `widthCells` (finding #6b, ≥1): the slot rendered/returned is at least
   * this many cell-widths wide, so a wide glyph's `drawImage` destination
   * is never clipped to a single cell. */
  getSlot(
    key: string,
    widthCells: number,
    render: (ctx: OffscreenCanvasRenderingContext2D, x: number, y: number) => void,
  ): { x: number; y: number; w: number; h: number } {
    const { rect, isNew } = this.allocator.acquire(key, widthCells);
    const x = rect.col * this.cellWidthPx;
    const y = rect.row * this.cellHeightPx;
    const w = rect.widthCells * this.cellWidthPx;
    const h = this.cellHeightPx;
    if (isNew) {
      this.ctx.clearRect(x, y, w, h);
      render(this.ctx, x, y);
    }
    return { x, y, w, h };
  }

  get image(): OffscreenCanvas {
    return this.canvas;
  }
}

const MODIFIER_BOLD = 0x0001;
const MODIFIER_DIM = 0x0002;
const MODIFIER_ITALIC = 0x0004;
const MODIFIER_UNDERLINED = 0x0008;
const MODIFIER_REVERSED = 0x0040;

export class TerminalRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = window.devicePixelRatio || 1;
  private fontSizePx = DEFAULT_FONT_SIZE_PX;
  private cellWidthPx = 8;
  private cellHeightPx = 17;
  private ascent = 11;
  private descent = 3;
  private cols = 0;
  private rows = 0;
  private grid: Grid | null = null;
  private focused = false;
  private theme: RendererTheme;
  private atlas: GlyphAtlas;
  private pendingDirty: Set<number> | "all" | null = null;
  private rafScheduled = false;
  /** Phase 1.6 spec §6.2 "No painting while minimized". */
  private paused = false;
  private perfLog = new PerfLog();
  private perfHudVisible = false;
  private lastLogAt = 0;
  private lastDecodeMs = 0;
  private lastRustUs = 0;
  private frameTimestamps: number[] = [];
  /** `cssColor`'s "named" palette shape: index 0 is an unused placeholder
   * (named colour 0 = Reset, handled separately), 1-16 are the theme's 16
   * ANSI colours (spec §2.1's `terminal.ansi*` keys, in wire order). */
  private namedPalette: string[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private wrapEl: HTMLElement,
    theme: RendererTheme,
    private onResize: (cols: number, rows: number, cellWidthPx: number, cellHeightPx: number) => void,
    private onPerfSample?: (perf: { paintMs: Percentiles; decodeMs: Percentiles; rustUs: Percentiles; fps: number }) => void,
    /** Spec §8a.4 "Perf HUD": per-frame instantaneous stats, fired on every
     * paint while the HUD is visible (distinct from `onPerfSample`'s 5s
     * rolling-percentile debug log). */
    private onFrameStats?: (stats: { decodeMs: number; paintMs: number; dirtyRows: number; rustUs: number; fps: number }) => void,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.theme = theme;
    this.namedPalette = ["transparent", ...theme.ansi];
    this.atlas = new GlyphAtlas(this.cellWidthPx, this.cellHeightPx);
  }

  getFontSizePx(): number {
    return this.fontSizePx;
  }

  /** Device-pixel cell size, for click-to-focus's canvas-pixel -> cell-grid
   * hit-testing (spec §8.2 draws in device pixels; `pane_at` expects cell
   * coordinates). */
  getCellSizeDevicePx(): { width: number; height: number } {
    return { width: this.cellWidthPx, height: this.cellHeightPx };
  }

  setTheme(theme: RendererTheme): void {
    this.theme = theme;
    this.namedPalette = ["transparent", ...theme.ansi];
    this.atlas = new GlyphAtlas(this.cellWidthPx, this.cellHeightPx);
    this.markDirty("all");
  }

  setFontSize(px: number): void {
    this.fontSizePx = Math.max(MIN_FONT_SIZE_PX, Math.min(MAX_FONT_SIZE_PX, px));
    this.measureAndResize();
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
    if (this.grid?.cursor) this.markDirty([this.grid.cursor.y]);
  }

  setPerfHudVisible(visible: boolean): void {
    this.perfHudVisible = visible;
  }

  isPerfHudVisible(): boolean {
    return this.perfHudVisible;
  }

  /** Records the TS-side decode time for the most recently applied surface
   * frame (spec §8a.4 "the TS decode ms"), fed from `main.ts`'s surface
   * channel handler right after `decodeSurfaceFrame`/`applyDecodedFrame`. */
  recordDecodeMs(ms: number): void {
    this.lastDecodeMs = ms;
  }

  /** Records the Rust-side decode+apply+encode µs for the most recently
   * applied surface frame (spec §8a.4), read from the decoded frame's
   * `rustUs` (0 when the trailer was absent). */
  recordRustUs(us: number): void {
    this.lastRustUs = us;
  }

  setGrid(grid: Grid, dirtyRows: number[] | "all"): void {
    // Finding #15 "clear stale rows when grid height shrinks": `flush()`
    // only ever paints rows `< min(grid.height, this.rows)`, so a shrink
    // in `grid.height` alone (the frame's own dimensions changing without
    // the canvas's device-pixel metrics changing) left whatever the
    // *previously* taller grid had painted in the now-unused rows on
    // screen -- nothing ever repainted (or even cleared) them, since they
    // are simply skipped by that `min(...)`, not visited at all.
    const dimensionsChanged =
      this.grid !== null && (grid.width !== this.grid.width || grid.height !== this.grid.height);
    const previousCursor = this.grid?.cursor ?? null;
    this.grid = grid;
    if (dimensionsChanged) {
      this.markDirty("all");
      return;
    }
    const rows = new Set(dirtyRows === "all" ? [] : dirtyRows);
    if (previousCursor) rows.add(previousCursor.y);
    if (grid.cursor) rows.add(grid.cursor.y);
    this.markDirty(dirtyRows === "all" ? "all" : [...rows]);
  }

  markDirty(rows: number[] | "all"): void {
    if (rows === "all" || this.pendingDirty === "all") {
      this.pendingDirty = "all";
    } else {
      if (!this.pendingDirty) this.pendingDirty = new Set();
      for (const y of rows) this.pendingDirty.add(y);
    }
    // Phase 1.6 spec §6.2: never schedule a paint while paused (minimized
    // or `document.hidden`) -- `pendingDirty` still accumulates, so
    // `setPaused(false)` can catch up with one full repaint.
    if (!this.rafScheduled && !this.paused) {
      this.rafScheduled = true;
      requestAnimationFrame(() => this.flush());
    }
  }

  /** Phase 1.6 spec §6.2 "No painting while minimized": stop scheduling
   * rAF paints while `paused`. Frames keep being applied to the grid as
   * usual either way (spec: "Keep applying frames to the mirror"); only
   * the paint itself is skipped. Un-pausing does one full repaint of
   * whatever accumulated while paused. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.markDirty("all");
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Spec §8.2: recompute cell size/backing store on font size, DPR, or
   * container resize. Never read layout inside the paint loop -- this is
   * always called from a resize-triggered path, not from `flush()`. */
  measureAndResize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const fontPx = fontPxForDpr(this.fontSizePx, this.dpr);
    this.ctx.font = `${fontPx}px ${FONT_STACK}`;
    const metrics = this.ctx.measureText("M");
    this.cellWidthPx = cellWidthFromMeasuredWidth(metrics.width);
    this.cellHeightPx = cellHeightForFontPx(fontPx);
    this.ascent = metrics.fontBoundingBoxAscent ?? fontPx * 0.8;
    this.descent = metrics.fontBoundingBoxDescent ?? fontPx * 0.2;

    // The wrap element's `getBoundingClientRect()` is its border-box, which
    // includes its own 8px inset padding (spec §8.6 "Inset"); the canvas
    // must fill only the *content* box, so the padding is subtracted here
    // rather than baked into a magic number duplicated from the CSS.
    const rect = this.wrapEl.getBoundingClientRect();
    const wrapStyle = window.getComputedStyle(this.wrapEl);
    const paddingX = parseFloat(wrapStyle.paddingLeft || "0") + parseFloat(wrapStyle.paddingRight || "0");
    const paddingY = parseFloat(wrapStyle.paddingTop || "0") + parseFloat(wrapStyle.paddingBottom || "0");
    const backing = backingSizeForAvailable(rect.width - paddingX, rect.height - paddingY, this.dpr);
    if (this.canvas.width !== backing.width || this.canvas.height !== backing.height) {
      this.canvas.width = backing.width;
      this.canvas.height = backing.height;
      this.canvas.style.width = `${backing.width / this.dpr}px`;
      this.canvas.style.height = `${backing.height / this.dpr}px`;
    }

    // Integral origin (spec §8.2, finding #6d): the previous run's shift
    // is still applied to the canvas at this point, so its layout position
    // must be reset to unshifted *before* measuring -- measuring with an
    // already-applied transform in effect would compute the next shift
    // from an already-shifted position instead of the element's true,
    // un-shifted layout position, compounding on every subsequent resize
    // (font change, DPR change, container resize) instead of landing on a
    // whole device pixel each time.
    this.canvas.style.transform = "";
    const canvasRect = this.canvas.getBoundingClientRect();
    const shiftX = integralOriginShiftCssPx(canvasRect.left * this.dpr, this.dpr);
    const shiftY = integralOriginShiftCssPx(canvasRect.top * this.dpr, this.dpr);
    this.canvas.style.transform = `translate(${shiftX}px, ${shiftY}px)`;

    const dims = gridDimsForBacking(backing, this.cellWidthPx, this.cellHeightPx);
    this.cols = dims.cols;
    this.rows = dims.rows;
    this.atlas = new GlyphAtlas(this.cellWidthPx, this.cellHeightPx);
    this.onResize(this.cols, this.rows, this.cellWidthPx, this.cellHeightPx);
    this.markDirty("all");
  }

  private flush(): void {
    this.rafScheduled = false;
    const dirty = this.pendingDirty;
    this.pendingDirty = null;
    if (!dirty || !this.grid) return;

    const start = performance.now();
    const paintHeight = Math.min(this.grid.height, this.rows);
    const paintWidth = Math.min(this.grid.width, this.cols);

    if (dirty === "all") {
      this.ctx.fillStyle = this.theme.background;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      for (let y = 0; y < paintHeight; y++) this.paintRow(y, paintWidth);
    } else {
      for (const y of dirty) {
        if (y >= 0 && y < paintHeight) this.paintRow(y, paintWidth);
      }
    }
    this.paintCursor(paintWidth, paintHeight);

    const paintMs = performance.now() - start;
    const dirtyRowCount = dirty === "all" ? paintHeight : dirty.size;
    this.perfLog.record({ decodeMs: this.lastDecodeMs, paintMs, dirtyRows: dirtyRowCount, rustUs: this.lastRustUs });
    this.reportPerfIfDue();

    if (this.perfHudVisible) {
      const now = performance.now();
      this.frameTimestamps.push(now);
      while (this.frameTimestamps.length > 0 && now - this.frameTimestamps[0] > 1000) {
        this.frameTimestamps.shift();
      }
      const fps = this.frameTimestamps.length;
      this.onFrameStats?.({ decodeMs: this.lastDecodeMs, paintMs, dirtyRows: dirtyRowCount, rustUs: this.lastRustUs, fps });
    }
  }

  private reportPerfIfDue(): void {
    const now = performance.now();
    if (now - this.lastLogAt < 5000) return;
    this.lastLogAt = now;
    const paint = this.perfLog.paintPercentiles();
    const decode = this.perfLog.decodePercentiles();
    const rustUs = this.perfLog.rustUsPercentiles();
    // eslint-disable-next-line no-console
    console.debug(
      `[herdr-gui] paint p50=${paint.p50.toFixed(2)}ms p95=${paint.p95.toFixed(2)}ms ` +
        `rust p50=${rustUs.p50.toFixed(0)}us p95=${rustUs.p95.toFixed(0)}us`,
    );
    this.onPerfSample?.({ paintMs: paint, decodeMs: decode, rustUs, fps: 0 });
  }

  private paintRow(y: number, paintWidth: number): void {
    if (!this.grid) return;
    const rowTop = y * this.cellHeightPx;
    // The whole row is cleared to background first (spec §8.5 "Clear and
    // clip"): the leftover strip past `paintWidth`/`paintHeight` is
    // background only, since nothing below ever draws into it.
    this.ctx.fillStyle = this.theme.background;
    this.ctx.fillRect(0, rowTop, this.canvas.width, this.cellHeightPx);

    const bgValues: string[] = [];
    for (let x = 0; x < paintWidth; x++) {
      const cell = this.grid.cells[y * this.grid.width + x];
      bgValues.push(cell ? this.resolvedColors(cell).bg : this.theme.background);
    }
    for (const run of mergeBackgroundRuns(bgValues)) {
      // Spec §8a "Skip spaces entirely: the bg already painted them"
      // generalizes to any run whose *resolved* colour equals the row
      // background already painted above -- checked post-resolution (see
      // `resolvedColors`), not against a raw packed "default" sentinel
      // (finding #6c: that raw check is what made reverse video on a
      // default-coloured cell invisible, since a reversed default background
      // resolves to the theme *foreground*, not the background, and must
      // still be painted).
      if (run.bg === this.theme.background) continue;
      this.ctx.fillStyle = run.bg;
      this.ctx.fillRect(run.startX * this.cellWidthPx, rowTop, run.count * this.cellWidthPx, this.cellHeightPx);
    }

    this.ctx.textBaseline = "alphabetic";
    for (let x = 0; x < paintWidth; x++) {
      const cell = this.grid.cells[y * this.grid.width + x];
      if (!cell || cell.skip || !cell.symbol || cell.symbol === " ") continue;
      const codePoint = cell.symbol.codePointAt(0) ?? 0;
      const kind = classifyGlyph(codePoint);
      const cellX = x * this.cellWidthPx;
      const { fg } = this.resolvedColors(cell);

      if (kind === "box-line") {
        const descriptor = boxLineDescriptor(codePoint);
        if (descriptor) {
          this.drawBoxLine(cellX, rowTop, descriptor, fg);
          continue;
        }
      }
      if (kind === "block") {
        const descriptor = blockDescriptor(codePoint);
        if (descriptor) {
          this.drawBlock(cellX, rowTop, descriptor, fg);
          continue;
        }
      }

      const bold = (cell.modifier & MODIFIER_BOLD) !== 0;
      const italic = (cell.modifier & MODIFIER_ITALIC) !== 0;
      const dim = (cell.modifier & MODIFIER_DIM) !== 0;
      const underlined = (cell.modifier & MODIFIER_UNDERLINED) !== 0;
      // Finding #6b: a wide glyph's slot (and drawn width) spans its own
      // cell plus every "skip" continuation cell that follows it in this
      // row, so CJK/emoji are never clipped to one cell.
      let widthCells = 1;
      while (
        x + widthCells < paintWidth &&
        this.grid.cells[y * this.grid.width + x + widthCells]?.skip
      ) {
        widthCells++;
      }
      const key = atlasKey(cell.symbol, fg, bold, italic, dim, widthCells);
      const slot = this.atlas.getSlot(key, widthCells, (ctx, sx, sy) => {
        ctx.font = `${bold ? "700 " : ""}${italic ? "italic " : ""}${fontPxForDpr(this.fontSizePx, this.dpr)}px ${FONT_STACK}`;
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = fg;
        ctx.globalAlpha = dim ? 0.65 : 1;
        ctx.fillText(cell.symbol, sx, sy + baselineYWithinRow(this.cellHeightPx, this.ascent, this.descent));
        ctx.globalAlpha = 1;
      });
      this.ctx.drawImage(
        this.atlas.image,
        slot.x,
        slot.y,
        slot.w,
        slot.h,
        cellX,
        rowTop,
        slot.w,
        slot.h,
      );
      if (underlined) {
        this.ctx.strokeStyle = fg;
        this.ctx.beginPath();
        const lineY = rowTop + this.cellHeightPx - 1;
        this.ctx.moveTo(cellX, lineY);
        this.ctx.lineTo(cellX + this.cellWidthPx, lineY);
        this.ctx.stroke();
      }
    }
  }

  /**
   * Resolves a cell's fg/bg to concrete CSS colours, applying reverse video
   * *after* resolving each side's own "default" sentinel (finding #6c).
   *
   * The packed wire value `0` always means "default", but which concrete
   * colour that is depends on which channel it came from -- default fg is
   * `theme.foreground`, default bg is `theme.background` -- so swapping the
   * two *raw* packed values under reverse (as the pre-fix code did) loses
   * that distinction: a reversed cell with both colours at their sentinel
   * ends up with the same raw value (`0`) on both sides no matter which
   * channel it "really" came from, so it can't tell "reversed default
   * background" (must render as `theme.foreground`, a real fillRect) apart
   * from "non-reversed default background" (already the row's background,
   * safely skipped) -- that conflation is exactly what made reverse video on
   * default-coloured text invisible.
   */
  private resolvedColors(cell: Grid["cells"][number]): { fg: string; bg: string } {
    const concreteFg = cell.fg === 0 ? this.theme.foreground : cssColor(cell.fg, this.namedPalette);
    const concreteBg = cell.bg === 0 ? this.theme.background : cssColor(cell.bg, this.namedPalette);
    const reversed = (cell.modifier & MODIFIER_REVERSED) !== 0;
    return reversed ? { fg: concreteBg, bg: concreteFg } : { fg: concreteFg, bg: concreteBg };
  }

  private drawBoxLine(
    cellX: number,
    rowTop: number,
    descriptor: { up: boolean; down: boolean; left: boolean; right: boolean; heavy: boolean },
    color: string,
  ): void {
    // Finding #15 "box-drawing vertical strokes on integral device px":
    // with an odd `cellWidthPx`/`cellHeightPx` (routine at DPRs like 1.25
    // or 1.5), the un-rounded center and the un-rounded half-thickness
    // used below were both fractional, so a stroke's edges landed *between*
    // device pixels -- the canvas then anti-aliases it across two of them
    // (a soft, blurry line) instead of filling exactly one crisply. Every
    // coordinate/size passed to `fillRect` here is now an integer.
    const cx = Math.round(cellX + this.cellWidthPx / 2);
    const cy = Math.round(rowTop + this.cellHeightPx / 2);
    const thickness = descriptor.heavy ? Math.max(2, Math.round(this.cellWidthPx / 5)) : Math.max(1, Math.round(this.cellWidthPx / 9));
    const half = Math.floor(thickness / 2);
    this.ctx.fillStyle = color;
    if (descriptor.left) this.ctx.fillRect(cellX, cy - half, cx - cellX + half, thickness);
    if (descriptor.right) this.ctx.fillRect(cx - half, cy - half, cellX + this.cellWidthPx - cx + half, thickness);
    if (descriptor.up) this.ctx.fillRect(cx - half, rowTop, thickness, cy - rowTop + half);
    if (descriptor.down) this.ctx.fillRect(cx - half, cy - half, thickness, rowTop + this.cellHeightPx - cy + half);
  }

  private drawBlock(
    cellX: number,
    rowTop: number,
    descriptor: { rects: readonly { x: number; y: number; width: number; height: number }[]; alpha?: number },
    color: string,
  ): void {
    this.ctx.fillStyle = color;
    this.ctx.globalAlpha = descriptor.alpha ?? 1;
    for (const rect of descriptor.rects) {
      this.ctx.fillRect(
        cellX + rect.x * this.cellWidthPx,
        rowTop + rect.y * this.cellHeightPx,
        rect.width * this.cellWidthPx,
        rect.height * this.cellHeightPx,
      );
    }
    this.ctx.globalAlpha = 1;
  }

  private paintCursor(paintWidth: number, paintHeight: number): void {
    if (!this.grid?.cursor || !this.grid.cursor.visible) return;
    const { x, y } = this.grid.cursor;
    if (x < 0 || y < 0 || x >= paintWidth || y >= paintHeight) return;
    const cellX = x * this.cellWidthPx;
    const cellY = y * this.cellHeightPx;
    if (this.focused) {
      this.ctx.fillStyle = this.theme.cursor;
      this.ctx.fillRect(cellX, cellY, this.cellWidthPx, this.cellHeightPx);
      const cell = this.grid.cells[y * this.grid.width + x];
      if (cell && !cell.skip && cell.symbol && cell.symbol !== " ") {
        this.ctx.fillStyle = this.theme.background;
        this.ctx.textBaseline = "alphabetic";
        this.ctx.font = `${fontPxForDpr(this.fontSizePx, this.dpr)}px ${FONT_STACK}`;
        this.ctx.fillText(
          cell.symbol,
          cellX,
          cellY + baselineYWithinRow(this.cellHeightPx, this.ascent, this.descent),
        );
      }
    } else {
      this.ctx.strokeStyle = this.theme.cursor;
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(cellX + 0.5, cellY + 0.5, this.cellWidthPx - 1, this.cellHeightPx - 1);
    }
  }
}
