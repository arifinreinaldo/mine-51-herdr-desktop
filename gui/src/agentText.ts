import type { RawAgent } from "./appTypes";

type AgentTextSource = Pick<RawAgent, "display_agent" | "agent" | "name" | "title" | "terminal_title_stripped">;

/** The agent's display name: `display_agent`, then `agent`, then `name`. */
export function agentDisplayName(a: AgentTextSource | undefined): string {
  return a?.display_agent ?? a?.agent ?? a?.name ?? "agent";
}

/** A short task title, or null. A terminal title that is only a program
 * path (for example `C:\...\powershell.exe`) says nothing about the task,
 * so it is dropped. */
export function agentTaskTitle(a: AgentTextSource | undefined): string | null {
  const raw = (a?.title ?? a?.terminal_title_stripped ?? "").trim();
  if (!raw) return null;
  if (/\.exe$/i.test(raw) || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\")) return null;
  return raw;
}
