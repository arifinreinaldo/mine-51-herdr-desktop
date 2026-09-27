// Shared status-dot rendering (UX pass 1 spec §2 "Agent state in words, not
// colour alone"): every place a dot appears -- sidebar, tabs, agent list,
// status bar -- gets the same shape-per-status CSS classes (blocked reads
// as a filled square, done as a check, unknown as a dashed hollow circle;
// working/idle are unchanged) plus `role="img"` and `aria-label="<status>"`
// so the state reads without relying on colour alone.

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

const STATUS_WORDS: Readonly<Record<AgentStatus, string>> = {
  working: "working",
  blocked: "blocked",
  done: "done",
  idle: "idle",
  unknown: "unknown",
};

/** The human-readable status word (spec §2: "The status words are
 * 'working', 'blocked', 'done', 'idle', and 'unknown'"), also used as the
 * dot's `aria-label`. */
export function statusWord(status: AgentStatus): string {
  return STATUS_WORDS[status];
}

/** Builds one status dot `<span>`, styled by `status-dot--<status>` (shape
 * + colour, in `style.css`) and accessible via `role="img"` +
 * `aria-label="<status word>"`. */
export function createStatusDot(status: AgentStatus): HTMLElement {
  const dot = document.createElement("span");
  dot.className = `status-dot status-dot--${status}`;
  dot.setAttribute("role", "img");
  dot.setAttribute("aria-label", statusWord(status));
  return dot;
}
