// ─── Script Provider Interface ─────────────────────
// PRD 11.3: Unified interface for all script generation models
import type { PodcastScript, Segment } from "@/podcast/schema";

export interface ScriptGenerationInput {
  title: string;
  cleanedText: string;
  targetDurationMinutes: number;
  providerOptions?: Record<string, unknown>;
  /** Prompt version to use (v1, v2, ...). Falls back to v1. */
  promptVersion?: string;
}

export interface SegmentRegenerationInput {
  originalScript: PodcastScript;
  segmentId: string;
  instruction?: string; // user edit instruction
  /** Prompt version inherited from the original script generation */
  promptVersion?: string;
}

export interface ScriptProvider {
  readonly name: string;
  readonly models: string[];

  /** Generate full podcast script from article text */
  generateScript(input: ScriptGenerationInput): Promise<PodcastScript>;

  /** Regenerate a single segment */
  regenerateSegment?(input: SegmentRegenerationInput): Promise<Segment>;
}
