// ─── Claims Extractor ──────────────────────────────
// PRD 12.3: Extract key claims from source text for fact-tracking

export interface Claim {
  id: string;
  text: string;
  /** Character offset range in source text */
  range?: [number, number];
}

/**
 * Extract candidate claims from cleaned text.
 * This is a lightweight pre-processing step;
 * the real claim extraction happens in the LLM prompt.
 *
 * For now: split on sentences and return as claims.
 * Rich extraction (entity recognition, key facts) is Phase 3+.
 */
export function extractClaims(cleanedText: string): Claim[] {
  // Simple sentence splitting on Chinese/English punctuation
  const sentences = cleanedText
    .split(/(?<=[。！？.!?\n])\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  return sentences.map((text, i) => ({
    id: `claim-${String(i + 1).padStart(3, "0")}`,
    text: text.length > 200 ? text.slice(0, 197) + "…" : text,
  }));
}
