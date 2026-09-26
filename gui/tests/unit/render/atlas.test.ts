import { describe, expect, it } from "vitest";
import { AtlasSlotAllocator, atlasKey, GLYPH_ATLAS_CAPACITY, GlyphAtlasLru } from "../../../src/render/atlas";

// Finding #6c: `fg` is the *resolved* CSS colour string, not a raw packed
// colour number -- see `atlasKey`'s doc comment for why (reverse video
// resolving default sentinels before the swap, so two different resolved
// colours can no longer collide on the same packed "default" number).
// Finding #6b/#6c: `dim` and `widthCells` are new key components.
describe("atlasKey", () => {
  it("is distinct per (symbol, fg, bold, italic, dim, widthCells)", () => {
    const keys = new Set([
      atlasKey("a", "#111111", false, false, false, 1),
      atlasKey("a", "#222222", false, false, false, 1),
      atlasKey("a", "#111111", true, false, false, 1),
      atlasKey("a", "#111111", false, true, false, 1),
      atlasKey("a", "#111111", false, false, true, 1),
      atlasKey("a", "#111111", false, false, false, 2),
      atlasKey("b", "#111111", false, false, false, 1),
    ]);
    expect(keys.size).toBe(7);
  });

  it("is stable for identical inputs", () => {
    expect(atlasKey("x", "#abcdef", true, false, false, 1)).toBe(
      atlasKey("x", "#abcdef", true, false, false, 1),
    );
  });

  it("distinguishes two resolved colours that could share the same raw packed sentinel (finding #6c)", () => {
    // Reverse video on a cell with both colours at their "default" sentinel
    // resolves to two different concrete colours (theme fg vs theme bg)
    // depending on whether it is reversed -- the key must tell them apart.
    const nonReversed = atlasKey("x", "#cccccc", false, false, false, 1);
    const reversed = atlasKey("x", "#1f1f1f", false, false, false, 1);
    expect(nonReversed).not.toBe(reversed);
  });
});

describe("GlyphAtlasLru", () => {
  it("stores and retrieves entries", () => {
    const lru = new GlyphAtlasLru<number>(4096);
    lru.set("a", 1);
    expect(lru.get("a")).toBe(1);
    expect(lru.has("a")).toBe(true);
    expect(lru.size).toBe(1);
  });

  it("evicts the least-recently-used entry once over capacity", () => {
    const lru = new GlyphAtlasLru<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    const result = lru.set("c", 3);
    expect(result.evictedKey).toBe("a");
    expect(lru.has("a")).toBe(false);
    expect(lru.has("b")).toBe(true);
    expect(lru.has("c")).toBe(true);
    expect(lru.size).toBe(2);
  });

  it("a get() refreshes recency, protecting the entry from eviction", () => {
    const lru = new GlyphAtlasLru<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.get("a"); // "a" is now more recently used than "b"
    const result = lru.set("c", 3);
    expect(result.evictedKey).toBe("b");
  });

  it("re-setting an existing key refreshes recency too", () => {
    const lru = new GlyphAtlasLru<number>(2);
    lru.set("a", 1);
    lru.set("b", 2);
    lru.set("a", 10);
    const result = lru.set("c", 3);
    expect(result.evictedKey).toBe("b");
    expect(lru.get("a")).toBe(10);
  });

  it("clear() empties the cache", () => {
    const lru = new GlyphAtlasLru<number>(4096);
    lru.set("a", 1);
    lru.clear();
    expect(lru.size).toBe(0);
    expect(lru.has("a")).toBe(false);
  });

  it("never exceeds capacity across many inserts", () => {
    const lru = new GlyphAtlasLru<number>(10);
    for (let i = 0; i < 100; i++) lru.set(`k${i}`, i);
    expect(lru.size).toBe(10);
  });

  it("defaults to the spec's 4096-entry cap", () => {
    const lru = new GlyphAtlasLru<number>();
    for (let i = 0; i < 4100; i++) lru.set(`k${i}`, i);
    expect(lru.size).toBe(4096);
  });

  it("evictOldest removes and returns the least-recently-used entry even under capacity", () => {
    const lru = new GlyphAtlasLru<number>(10);
    lru.set("a", 1);
    lru.set("b", 2);
    expect(lru.evictOldest()).toBe(1);
    expect(lru.has("a")).toBe(false);
    expect(lru.has("b")).toBe(true);
  });

  it("evictOldest returns null on an empty cache", () => {
    const lru = new GlyphAtlasLru<number>(10);
    expect(lru.evictOldest()).toBeNull();
  });
});

// Finding #6a "atlas eviction bug ... nextSlot overflow" and #6b "wide
// chars clipped": the pre-fix `GlyphAtlas` deleted an evicted key from its
// map and then looked that same (already-deleted) key back up for a slot
// to reuse, always missing, so `nextSlot` grew without bound past the
// fixed-size backing canvas. `AtlasSlotAllocator` replaces that scheme.
describe("AtlasSlotAllocator", () => {
  it("allocates distinct, in-bounds rects for distinct keys", () => {
    const cols = 8;
    const maxRows = 4;
    const allocator = new AtlasSlotAllocator(cols, maxRows, 100);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { rect, isNew } = allocator.acquire(`k${i}`, 1);
      expect(isNew).toBe(true);
      expect(rect.col + rect.widthCells).toBeLessThanOrEqual(cols);
      expect(rect.row).toBeLessThan(maxRows);
      seen.add(`${rect.row},${rect.col}`);
    }
    expect(seen.size).toBe(20);
  });

  it("a repeated key is a cache hit (isNew: false) at the same rect", () => {
    const allocator = new AtlasSlotAllocator(8, 4, 100);
    const first = allocator.acquire("k", 1);
    const second = allocator.acquire("k", 1);
    expect(second.isNew).toBe(false);
    expect(second.rect).toEqual(first.rect);
  });

  it("a wide glyph gets a slot at least widthCells wide, never clipped (finding #6b)", () => {
    const allocator = new AtlasSlotAllocator(8, 4, 100);
    const { rect } = allocator.acquire("wide", 2);
    expect(rect.widthCells).toBeGreaterThanOrEqual(2);
    expect(rect.col + rect.widthCells).toBeLessThanOrEqual(8);
  });

  it("never exceeds capacity entries, and every allocated rect stays within atlas bounds even with more than capacity distinct glyphs (finding #6a)", () => {
    const cols = 16;
    const maxRows = 4; // a deliberately small shelf: forces eviction well before unit space would "naturally" run out
    const capacity = 20;
    const allocator = new AtlasSlotAllocator(cols, maxRows, capacity);
    for (let i = 0; i < capacity * 5; i++) {
      const { rect } = allocator.acquire(`glyph-${i}`, 1);
      expect(rect.row).toBeGreaterThanOrEqual(0);
      expect(rect.row).toBeLessThan(maxRows);
      expect(rect.col).toBeGreaterThanOrEqual(0);
      expect(rect.col + rect.widthCells).toBeLessThanOrEqual(cols);
      expect(allocator.size).toBeLessThanOrEqual(capacity);
    }
    expect(allocator.size).toBe(capacity);
  });

  it("never exceeds atlas bounds even when every glyph is double-width (finding #6a/#6b combined)", () => {
    const cols = 10;
    const maxRows = 3;
    const capacity = 15;
    const allocator = new AtlasSlotAllocator(cols, maxRows, capacity);
    for (let i = 0; i < capacity * 4; i++) {
      const { rect } = allocator.acquire(`wide-${i}`, 2);
      expect(rect.row).toBeLessThan(maxRows);
      expect(rect.col + rect.widthCells).toBeLessThanOrEqual(cols);
    }
  });

  it("clear() resets bookkeeping so previously-seen keys are treated as new again", () => {
    const allocator = new AtlasSlotAllocator(8, 4, 100);
    allocator.acquire("k", 1);
    allocator.clear();
    expect(allocator.size).toBe(0);
    const { isNew } = allocator.acquire("k", 1);
    expect(isNew).toBe(true);
  });

  it("defaults capacity to the spec's 4096-entry cap", () => {
    const allocator = new AtlasSlotAllocator(64, 64);
    for (let i = 0; i < 4100; i++) allocator.acquire(`k${i}`, 1);
    expect(allocator.size).toBe(GLYPH_ATLAS_CAPACITY);
  });
});
