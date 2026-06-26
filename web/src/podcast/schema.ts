// ─── Podcast Script Schema ────────────────────────────
// PRD 8.3 FR-08: Standardized double-host podcast script JSON
import { z } from "zod";

export const SourceClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
});
export type SourceClaim = z.infer<typeof SourceClaimSchema>;

export const TurnSchema = z.object({
  id: z.string(),
  speaker: z.enum(["A", "B"]),
  text: z.string().max(500),
  delivery: z.string().optional(),
  source_claim_ids: z.array(z.string()).optional(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const SegmentSchema = z.object({
  id: z.string(),
  topic: z.string().optional(),
  turns: z.array(TurnSchema).min(1),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const PodcastScriptSchema = z.object({
  title: z.string(),
  summary: z.string(),
  target_duration_minutes: z.number().positive(),
  source_claims: z.array(SourceClaimSchema),
  segments: z.array(SegmentSchema).min(1),
});
export type PodcastScript = z.infer<typeof PodcastScriptSchema>;

// Generation metadata (not in schema, carried alongside)
export interface ScriptGenerationMeta {
  provider: string;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  elapsed_seconds: number;
  cost_estimate?: number;
}
