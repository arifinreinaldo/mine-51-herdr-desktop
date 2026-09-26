// Glyph atlas key + LRU cache (spec phase1.5 §8a.2): "Render each distinct
// `(symbol, fg, bold, italic)` once into an `OffscreenCanvas` atlas at the
// current cell size and DPR. Draw with `drawImage(...)`. Cap the atlas at
// 4096 entries with an LRU. Clear it on a font, DPR, or theme change."
//
// The actual `OffscreenCanvas` rendering lives in the renderer (it needs a
// real canvas context); this module is the pure, unit-testable key
// derivation and eviction policy.

export const GLYPH_ATLAS_CAPACITY = 4096;

/**
 * One glyph atlas cache key (finding #6c/#6b: extended from the spec's
 * literal `(symbol, fg, bold, italic)` tuple).
 *
 * `fg` is the *resolved* CSS colour (a concrete string, e.g. `"#cccccc"` or
 * `"rgb(1, 2, 3)"`), not a raw packed colour number: reverse video resolves
 * a cell's default-colour sentinels to concrete theme colours *before*
 * swapping fg/bg (see `TerminalRenderer`'s `resolvedColors`), so two cells
 * that both happen to carry the packed "default" sentinel but render in
 * different actual colours (one reversed, one not) must not collide on the
 * same cache key -- keying on the raw number let that happen.
 *
 * `dim` is included because it is baked into the cached bitmap's alpha
 * (`ctx.globalAlpha` at render time, not at draw time), so a dim and a
 * non-dim occurrence of the same glyph/colour must not share a slot.
 *
 * `widthCells` is included because a wide glyph (CJK, emoji) is rendered
 * into a wider slot (finding #6b: `cellW × (1 + following skip cells)`);
 * without it, a glyph first cached at width 1 could be redrawn clipped when
 * later encountered at width 2, or vice versa.
 */
export function atlasKey(
  symbol: string,
  fg: string,
  bold: boolean,
  italic: boolean,
  dim: boolean,
  widthCells: number,
): string {
  return `${symbol}\u0000${fg}\u0000${bold ? "1" : "0"}\u0000${italic ? "1" : "0"}\u0000${dim ? "1" : "0"}\u0000${widthCells}`;
}

export interface AtlasEvictResult<TSlot> {
  evictedKey: string | null;
  evictedSlot: TSlot | null;
}

/**
 * A least-recently-used cache keyed by `atlasKey()`, capped at `capacity`
 * entries. Built on `Map`'s insertion-order iteration: `get`/`set` re-insert
 * the key to mark it most-recently-used, so the first key in iteration
 * order is always the least-recently-used eviction candidate.
 */
export class GlyphAtlasLru<TSlot> {
  private readonly entries = new Map<string, TSlot>();

  constructor(private readonly capacity: number = GLYPH_ATLAS_CAPACITY) {}

  get(key: string): TSlot | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Inserts (or refreshes) `key`, evicting the least-recently-used entry
   * if this pushes the cache over capacity. */
  set(key: string, value: TSlot): AtlasEvictResult<TSlot> {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size <= this.capacity) {
      return { evictedKey: null, evictedSlot: null };
    }
    const oldestKey = this.entries.keys().next().value as string;
    const oldestSlot = this.entries.get(oldestKey) ?? null;
    this.entries.delete(oldestKey);
    return { evictedKey: oldestKey, evictedSlot: oldestSlot };
  }

  get size(): number {
    return this.entries.size;
  }

  /** Spec: "Clear it on a font, DPR, or theme change." */
  clear(): void {
    this.entries.clear();
  }

  /** Explicitly evicts the single least-recently-used entry, regardless of
   * whether the cache is at capacity. Used when a caller runs out of some
   * *other* bounded resource before the entry count itself reaches
   * `capacity` (finding #6a/#6b: `AtlasSlotAllocator` exhausting its fixed
   * backing-store space, e.g. from a burst of wide glyphs). Returns the
   * evicted value, or `null` when the cache is already empty. */
  evictOldest(): TSlot | null {
    const oldestKey = this.entries.keys().next().value as string | undefined;
    if (oldestKey === undefined) return null;
    const value = this.entries.get(oldestKey) ?? null;
    this.entries.delete(oldestKey);
    return value;
  }
}

/** One allocated atlas slot, in cell-size units (not pixels): `col`/`row`
 * are grid-cell offsets, and `widthCells` is how many cell-widths wide the
 * slot is (1 for an ordinary glyph, >1 for a wide one, finding #6b). */
export interface AtlasRect {
  col: number;
  row: number;
  widthCells: number;
}

/**
 * Variable-width slot allocator for the glyph atlas (finding #6a "atlas
 * eviction bug ... nextSlot overflow" and #6b "atlas slot width must be
 * cellW×(1+following skip cells)").
 *
 * Slots are placed on fixed-height "shelves" `cols` cell-units wide; a slot
 * never spans two shelves. Capacity is *entries* (matching `GlyphAtlasLru`),
 * not units, so a burst of wide glyphs can in principle need more shelf
 * space than `capacity` single-width slots would have -- when fresh shelf
 * space runs out, the globally least-recently-used *entry* is force-evicted
 * to reclaim room, so the backing store this allocator addresses into never
 * grows and a slot request can never fail (the property the required test
 * below checks).
 *
 * This is the piece the pre-fix `GlyphAtlas` (in `renderer.ts`) got wrong:
 * it deleted the evicted key from its map and then looked the same
 * (already-deleted) key back up for a slot to reuse, always missing, so
 * `nextSlot` grew without bound past the fixed-size backing canvas.
 */
export class AtlasSlotAllocator {
  private readonly lru: GlyphAtlasLru<AtlasRect>;
  private freeRects: AtlasRect[] = [];
  private nextCol = 0;
  private nextRow = 0;

  constructor(
    private readonly cols: number,
    private readonly maxRows: number,
    capacity: number = GLYPH_ATLAS_CAPACITY,
  ) {
    this.lru = new GlyphAtlasLru<AtlasRect>(capacity);
  }

  get size(): number {
    return this.lru.size;
  }

  clear(): void {
    this.lru.clear();
    this.freeRects = [];
    this.nextCol = 0;
    this.nextRow = 0;
  }

  /** Returns `key`'s existing rect (refreshing its recency), or allocates
   * one at least `widthCells` wide. `isNew` tells the caller whether it
   * must actually render the glyph into the returned rect (`false` is a
   * cache hit: the bitmap already there is reused as-is). */
  acquire(key: string, widthCells: number): { rect: AtlasRect; isNew: boolean } {
    const cached = this.lru.get(key);
    if (cached && cached.widthCells >= widthCells) {
      return { rect: cached, isNew: false };
    }
    if (cached) {
      // A same-key cache hit that is now too narrow (should not happen in
      // practice -- `widthCells` is part of the key -- but handled rather
      // than assumed impossible): free it and allocate fresh.
      this.freeRects.push(cached);
    }
    const rect = this.allocate(widthCells);
    const { evictedSlot } = this.lru.set(key, rect);
    if (evictedSlot) this.freeRects.push(evictedSlot);
    return { rect, isNew: true };
  }

  private allocate(widthCells: number): AtlasRect {
    const capped = Math.max(1, Math.min(widthCells, this.cols));
    return this.takeFreeRect(capped) ?? this.bumpAllocate(capped);
  }

  /** First-fit-by-smallest-waste reuse of a previously freed rect, splitting
   * off any unused tail as a new, smaller free rect. */
  private takeFreeRect(widthCells: number): AtlasRect | null {
    let bestIndex = -1;
    for (let i = 0; i < this.freeRects.length; i++) {
      if (this.freeRects[i].widthCells < widthCells) continue;
      if (bestIndex === -1 || this.freeRects[i].widthCells < this.freeRects[bestIndex].widthCells) {
        bestIndex = i;
      }
    }
    if (bestIndex === -1) return null;
    const found = this.freeRects.splice(bestIndex, 1)[0];
    if (found.widthCells > widthCells) {
      this.freeRects.push({ row: found.row, col: found.col + widthCells, widthCells: found.widthCells - widthCells });
    }
    return { row: found.row, col: found.col, widthCells };
  }

  private bumpAllocate(widthCells: number): AtlasRect {
    if (this.nextCol + widthCells > this.cols) {
      if (this.nextCol < this.cols) {
        this.freeRects.push({ row: this.nextRow, col: this.nextCol, widthCells: this.cols - this.nextCol });
      }
      this.nextRow += 1;
      this.nextCol = 0;
    }
    if (this.nextRow >= this.maxRows) {
      // Out of fresh shelf space (finding #6a): force-evict the globally
      // least-recently-used entry to reclaim a rect instead of growing
      // `nextRow` past the fixed backing store.
      const evicted = this.lru.evictOldest();
      if (evicted) {
        this.freeRects.push(evicted);
        const fit = this.takeFreeRect(widthCells);
        if (fit) return fit;
      }
      // Unreachable in practice once `capacity` entries have each freed at
      // least 1 unit: a degenerate fallback that reuses shelf (0,0) rather
      // than ever growing past `maxRows`.
      return { row: 0, col: 0, widthCells };
    }
    const rect: AtlasRect = { row: this.nextRow, col: this.nextCol, widthCells };
    this.nextCol += widthCells;
    return rect;
  }
}
