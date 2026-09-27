// Provider table (Phase 1.6 spec §4.2.1): data only, no logic. Commands
// change often, so they live in exactly one place. Each row's `source` is a
// comment naming where the install/sign-in command came from; the wizard
// executor must never invent a command that isn't in this table.

/** The `herdr target` column, exactly as `IntegrationTarget` serializes
 * (`rename_all = "snake_case"`, `src/api/schema/integrations.rs`). `null`
 * for a card that isn't a herdr integration at all (Gemini): it has no
 * "Connect to herdr" action, and the GUI detects it itself. */
export type ProviderHerdrTarget =
  | "claude"
  | "codex"
  | "opencode"
  | "copilot"
  | "cursor"
  | null;

export interface ProviderRow {
  /** Stable id for this row, independent of the herdr target (Gemini has
   * none). */
  id: string;
  card: string;
  herdrTarget: ProviderHerdrTarget;
  /** The command the human-facing "Detect" column runs (`--version`).
   * `available` for a herdr target comes from herdr's own `integration.list`,
   * never from this column (spec §4.2) -- it's shown for humans, and it's
   * the actual detection method for Gemini, which has no herdr target. */
  detectCommand: string;
  installCommand: string;
  /** Node ≥ this version is required before `installCommand` will work
   * (spec §4.2 "Node prerequisite"). `null` when the installer is a native
   * (non-npm) script. */
  nodeMinimumMajor: number | null;
  signInCommand: string;
  /** The bare command that just launches this provider's CLI (finding
   * #11 "steps 4/5... must type the provider's launch command"), distinct
   * from `signInCommand`: e.g. Codex's sign-in is `codex login`, but
   * "Start Codex here" (step 4) should just run `codex`. */
  launchCommand: string;
  /** Where the install/sign-in commands came from (spec §4.2.1 "Each row
   * has a source URL comment"). */
  source: string;
}

export const PROVIDER_TABLE: readonly ProviderRow[] = [
  {
    id: "claude",
    card: "Claude Code",
    herdrTarget: "claude",
    detectCommand: "claude --version",
    installCommand: "irm https://claude.ai/install.ps1 | iex",
    nodeMinimumMajor: null,
    signInCommand: "claude", // then /login inside the session
    launchCommand: "claude",
    source: "code.claude.com/docs (native Windows installer, no Node needed)",
  },
  {
    id: "codex",
    card: "Codex",
    herdrTarget: "codex",
    detectCommand: "codex --version",
    installCommand: "npm install -g @openai/codex",
    nodeMinimumMajor: 22,
    signInCommand: "codex login",
    launchCommand: "codex",
    source: "github.com/openai/codex (npm package @openai/codex)",
  },
  {
    id: "opencode",
    card: "OpenCode",
    herdrTarget: "opencode",
    detectCommand: "opencode --version",
    installCommand: "npm install -g opencode-ai",
    nodeMinimumMajor: 18,
    signInCommand: "opencode auth login",
    launchCommand: "opencode",
    source: "opencode.ai/docs (npm package opencode-ai)",
  },
  {
    id: "copilot",
    card: "Copilot CLI",
    herdrTarget: "copilot",
    detectCommand: "copilot --version",
    installCommand: "npm install -g @github/copilot",
    nodeMinimumMajor: 22,
    signInCommand: "copilot", // then /login inside the session
    launchCommand: "copilot",
    source: "github.com/github/copilot-cli (npm package @github/copilot)",
  },
  {
    id: "cursor",
    card: "Cursor CLI",
    herdrTarget: "cursor",
    // herdr's own `available` check for the `cursor` target looks for the
    // `agent` binary (`src/integration/registry.rs:24`), not `cursor`.
    detectCommand: "agent --version",
    installCommand: "irm 'https://cursor.com/install?win32=true' | iex",
    nodeMinimumMajor: null,
    signInCommand: "agent login",
    launchCommand: "agent",
    source: "cursor.com/docs/cli (native Windows installer, no Node needed)",
  },
  {
    id: "gemini",
    card: "Gemini CLI",
    herdrTarget: null,
    detectCommand: "gemini --version",
    installCommand: "npm install -g @google/gemini-cli",
    nodeMinimumMajor: 20,
    signInCommand: "gemini",
    launchCommand: "gemini",
    source: "github.com/google-gemini/gemini-cli (npm package @google/gemini-cli)",
  },
] as const;

/** The order the top cards are expanded in (spec §4.2 "the top 6 are
 * expanded, in this order"). */
export const TOP_PROVIDER_IDS: readonly string[] = ["claude", "codex", "opencode", "copilot", "cursor", "gemini"];

export function providerById(id: string): ProviderRow | undefined {
  return PROVIDER_TABLE.find((row) => row.id === id);
}

export function providerByHerdrTarget(target: string): ProviderRow | undefined {
  return PROVIDER_TABLE.find((row) => row.herdrTarget === target);
}
