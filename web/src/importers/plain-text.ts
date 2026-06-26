// ─── Plain Text Importer ────────────────────────────
// PRD 8.1 FR-01: Paste text input
export interface TextImportResult {
  title: string;
  rawText: string;
  charCount: number;
  estimatedMinutes: number;
}

export function importPlainText(rawText: string): TextImportResult {
  const trimmed = rawText.trim();
  // Extract first non-empty line as title
  const lines = trimmed.split("\n");
  let title = "未命名";
  for (const line of lines) {
    const clean = line.trim();
    if (clean.length > 2 && !clean.startsWith("#")) {
      title = clean.slice(0, 80);
      break;
    }
  }

  const charCount = trimmed.length;
  // ~300 chars/min for Chinese speech
  const estimatedMinutes = Math.max(1, Math.round(charCount / 300));

  return {
    title,
    rawText: trimmed,
    charCount,
    estimatedMinutes,
  };
}
