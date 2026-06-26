// ─── Prompt Resolver ────────────────────────────────
// PRD 9.3: Resolve prompt by version identifier
// Returns the correct prompt for a given version tag.

import { SYSTEM_PROMPT_V1 } from "./v1";
import { SYSTEM_PROMPT_V2 } from "./v2";

const PROMPTS: Record<string, string> = {
  v1: SYSTEM_PROMPT_V1,
  v2: SYSTEM_PROMPT_V2,
};

const DEFAULT_VERSION = "v1";

/** Get prompt text for a version. Falls back to default (v1) if version not found. */
export function getPrompt(version?: string): string {
  if (version && PROMPTS[version]) return PROMPTS[version];
  return PROMPTS[DEFAULT_VERSION];
}

/** List available prompt versions. */
export function listPrompts(): string[] {
  return Object.keys(PROMPTS);
}
