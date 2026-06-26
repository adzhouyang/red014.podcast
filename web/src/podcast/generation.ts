// ─── Podcast Script Generation ─────────────────────────
// FR-07 / FR-08: Orchestrates script generation via providers

import type { PodcastScript, Segment } from "@/podcast/schema";
import type { ScriptGenerationInput, SegmentRegenerationInput } from "@/providers/scripts/interface";
import { getScriptProvider } from "@/providers/scripts";
import { PodcastScriptSchema } from "@/podcast/schema";

export interface GenerationResult {
  script: PodcastScript;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  elapsedMs: number;
}

/**
 * Generate a full podcast script from content.
 * Validates output against PodcastScriptSchema.
 */
export async function generateScript(
  input: ScriptGenerationInput,
  provider: string,
  _model?: string
): Promise<GenerationResult> {
  const p = getScriptProvider(provider);
  if (!p) throw new Error(`Unknown script provider: ${provider}`);

  const start = Date.now();
  const script = await p.generateScript(input);
  const elapsedMs = Date.now() - start;

  // Zod validation (strict parse)
  const validated = PodcastScriptSchema.parse(script);

  return {
    script: validated,
    provider: p.name,
    model: p.models[0],
    elapsedMs,
  };
}

/**
 * Regenerate a single segment via the chosen provider.
 * Falls back to error if provider does not support regeneration.
 */
export async function regenerateSegment(
  input: SegmentRegenerationInput,
  provider: string
): Promise<Segment> {
  const p = getScriptProvider(provider);
  if (!p) throw new Error(`Unknown script provider: ${provider}`);

  if (!p.regenerateSegment) {
    throw new Error(`Provider ${provider} does not support segment regeneration`);
  }

  return p.regenerateSegment(input);
}
