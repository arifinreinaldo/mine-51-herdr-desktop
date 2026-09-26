// Background-run merging (spec phase1.5 §8a.1): "in each dirty row, merge
// consecutive cells with the same bg into one `fillRect`." Extracted as a
// pure function over a row's per-cell bg values so it's unit-testable
// without a canvas.

export interface BgRun<T = number> {
  startX: number;
  count: number;
  bg: T;
}

/**
 * Merges consecutive equal `bg` values in `bgPerCell` (one row, left to
 * right) into runs, each paintable as a single `fillRect`.
 *
 * Generic over the value type (originally always a packed colour number):
 * finding #6c has the renderer pass the *resolved* CSS colour string per
 * cell instead (reverse video must resolve each cell's default-colour
 * sentinel to a concrete theme colour before the fg/bg swap, which a raw
 * packed-number run key can't represent -- see `TerminalRenderer.
 * resolvedColors`). Equality is a plain `===`, so this works unchanged for
 * either.
 */
export function mergeBackgroundRuns<T>(bgPerCell: readonly T[]): BgRun<T>[] {
  const runs: BgRun<T>[] = [];
  for (let x = 0; x < bgPerCell.length; x++) {
    const bg = bgPerCell[x];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.bg === bg) {
      last.count += 1;
    } else {
      runs.push({ startX: x, count: 1, bg });
    }
  }
  return runs;
}
