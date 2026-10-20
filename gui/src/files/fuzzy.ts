// File viewer spec §7.3: ranks paths for Find File. Pure. The query matches the
// file name, not the folders, as a case-insensitive subsequence.
export const MAX_RESULTS = 50;
export interface FuzzyResult { path: string; score: number; /** Indexes into the file name. */ positions: number[] }
function isBoundary(name: string, k: number): boolean {
  if (k === 0) return true;
  const prev = name[k - 1];
  return !/[A-Za-z0-9]/.test(prev) || (/[A-Z]/.test(name[k]) && /[a-z]/.test(prev));
}
/** Whether `q.slice(from)` is a subsequence of `lower.slice(start)`. */
function fits(q: string, from: number, lower: string, start: number): boolean {
  let j = start;
  for (let i = from; i < q.length; i++) { j = lower.indexOf(q[i], j); if (j < 0) return false; j++; }
  return true;
}
export function fuzzyMatch(query: string, path: string): FuzzyResult | null {
  const q = query.trim().toLowerCase();
  const name = path.slice(path.lastIndexOf("/") + 1);
  const lower = name.toLowerCase();
  if (q === "" || !fits(q, 0, lower, 0)) return null;
  const positions: number[] = [];
  let j = 0;
  for (let i = 0; i < q.length; i++) {
    let pick = lower.indexOf(q[i], j);
    // Keep a consecutive hit; else prefer a later word/camel boundary that still lets the rest match.
    if (!(i > 0 && pick === j)) {
      for (let k = pick; k >= 0; k = lower.indexOf(q[i], k + 1)) {
        if (isBoundary(name, k) && fits(q, i + 1, lower, k + 1)) { pick = k; break; }
      }
    }
    positions.push(pick);
    j = pick + 1;
  }
  let score = 0;
  positions.forEach((k, i) => {
    score += 1;
    if (k === 0) score += 8; else if (isBoundary(name, k)) score += 6;
    if (i > 0 && k === positions[i - 1] + 1) score += 4;
  });
  return { path, score, positions };
}
// shortcut: ranks every path on each keystroke; debounce if typing lags at 50,000 files.
export function rankPaths(query: string, paths: readonly string[], limit = MAX_RESULTS): FuzzyResult[] {
  const results: FuzzyResult[] = [];
  for (const path of paths) { const m = fuzzyMatch(query, path); if (m) results.push(m); }
  results.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return results.slice(0, limit);
}
