// A generic trailing-edge debounce (finding #7 "in TS debounce (150ms)"):
// coalesces calls within `delayMs` of each other into a single call to
// `fn`, `delayMs` after the *last* one. Uses the global `setTimeout`/
// `clearTimeout` (not `window`'s), so it works the same in a plain Node
// (Vitest) environment as in the browser.

export function debounce<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number,
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: TArgs) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delayMs);
  };
}
