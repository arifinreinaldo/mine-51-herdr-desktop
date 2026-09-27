// Most-recently-used tab tracking (keyboard shortcut Alt+`: "toggle to the
// previously focused tab"). Fed from every snapshot's `focused_tab_id`
// (across all workspaces, not just the current one -- the toggle can jump
// workspaces), so it stays a plain MRU of the last two *distinct* tab ids,
// with no notion of "current workspace" of its own.
//
// A pure, dependency-free class (no snapshot/DOM types) so it is testable
// on its own; `appState.ts` holds the one live instance, fed by `main.ts`'s
// snapshot listener, and read by `appMenuBar.ts`'s Alt+` handler.

export class TabMruTracker {
  /** `[mostRecent, secondMostRecent]`, at most 2 entries, most-recent first. */
  private stack: string[] = [];

  /** Records a new `focused_tab_id`. A repeat of the current head (the
   * focused tab didn't actually change) is ignored -- it must not push
   * itself back to the front and erase what "previous" means. `null`
   * (nothing focused, e.g. no workspace yet) is also ignored. */
  record(tabId: string | null): void {
    if (!tabId || this.stack[0] === tabId) return;
    this.stack = [tabId, ...this.stack.filter((id) => id !== tabId)].slice(0, 2);
  }

  /** The tab to jump to on Alt+` -- the second-most-recently-focused
   * distinct tab, or `undefined` before there's been one. Whether it still
   * exists is the caller's job (it holds the current snapshot); this
   * tracker only ever sees the ids it was `record`ed with. */
  previousTabId(): string | undefined {
    return this.stack[1];
  }
}
