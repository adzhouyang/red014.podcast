// ─── Shared Provider Utilities ─────────────────────
// PRD 7.2: JSON extraction logic shared across all script providers

/**
 * Extract a JSON object from model output that may contain
 * markdown code fences or surrounding text.
 */
export function extractJson(text: string): string {
  let json = text.trim();

  // Strip markdown code fences
  json = json.replace(/^```(?:json)?\s*\n?/gm, "").replace(/\n?```$/gm, "");

  // Find JSON boundaries
  const firstBrace = json.indexOf("{");
  const lastBrace = json.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    json = json.slice(firstBrace, lastBrace + 1);
  }

  return json;
}
