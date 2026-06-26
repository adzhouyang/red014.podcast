// ─── Text Cleaner ──────────────────────────────────
// PRD 8.1 FR-04: Normalize text before entering model pipeline

export interface CleanResult {
  cleaned: string;
  originalChars: number;
  cleanedChars: number;
  changes: string[];
}

/**
 * Normalize text for LLM consumption:
 * - Collapse repeated newlines
 * - Strip common web artifacts
 * - Remove excessive whitespace
 */
export function normalizeText(raw: string): CleanResult {
  const changes: string[] = [];
  let text = raw;

  // Collapse 3+ newlines to 2
  const before = text.length;
  text = text.replace(/\n{3,}/g, "\n\n");
  if (text.length !== before) changes.push("合并多余空行");

  // Remove common page header/footer patterns (e.g. "第X页/共Y页")
  text = text.replace(/第\s*\d+\s*页\s*[\/／]\s*共\s*\d+\s*页/gi, "");
  text = text.replace(/^\d+\s*\/\s*\d+\s*$/gm, "");

  // Remove zero-width and invisible chars
  const invisibleCount = (text.match(/[\u200B-\u200D\uFEFF]/g) || []).length;
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (invisibleCount > 0) changes.push(`移除 ${invisibleCount} 个不可见字符`);

  // Normalize whitespace
  text = text.replace(/[ \t]+$/gm, ""); // trailing spaces
  text = text.replace(/^\s+|\s+$/g, ""); // leading/trailing

  // Preserve original single newlines (paragraph breaks)
  text = text.replace(/\n{2,}/g, "\n\n");

  return {
    cleaned: text,
    originalChars: raw.length,
    cleanedChars: text.length,
    changes,
  };
}
