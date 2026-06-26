// ─── Text/Markdown File Importer ──────────────────
// PRD 8.1: Read .txt/.md files, decode, normalize, count chars

import { TextImportResult, importPlainText } from "./plain-text";

export interface TextFileImportResult extends TextImportResult {
  fileName: string;
  fileSizeBytes: number;
  encoding: string;
}

const ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
]);

const ALLOWED_EXTENSIONS = new Set([".txt", ".md", ".markdown"]);

function isAllowedFile(fileName: string, mimeType?: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;
  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType) && !mimeType.startsWith("text/")) {
    // Some systems report .md as application/octet-stream; be lenient
    if (mimeType !== "application/octet-stream") return false;
  }
  return true;
}

/**
 * Detect encoding from Buffer. Tries UTF-8 first, falls back to latin1.
 * For Chinese content, also tries GBK/GB2312.
 */
function detectAndDecode(buffer: Buffer): { text: string; encoding: string } {
  // Try UTF-8 with BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.toString("utf-8", 3), encoding: "utf-8-bom" };
  }
  // Try UTF-16 LE BOM
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.toString("utf-16le", 2), encoding: "utf-16le-bom" };
  }
  // Try UTF-16 BE BOM
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: buffer.toString("utf-16be" as BufferEncoding, 2), encoding: "utf-16be-bom" };
  }

  // Try UTF-8 (most common)
  try {
    const text = buffer.toString("utf-8");
    // Quick sanity: if decoded text has no replacement chars, it's likely valid UTF-8
    if (!text.includes("\ufffd")) {
      return { text, encoding: "utf-8" };
    }
  } catch {
    // fall through
  }

  // Fallback: latin1 preserves all bytes
  return { text: buffer.toString("latin1"), encoding: "latin1" };
}

/**
 * Read a text or markdown file from a Buffer.
 * For .md files: keeps content as-is (markdown syntax is valid podcast input).
 */
export function importTextFile(
  buffer: Buffer,
  fileName: string,
  mimeType?: string,
): TextFileImportResult {
  if (!isAllowedFile(fileName, mimeType)) {
    throw new Error(
      `不支持的文件类型。仅支持 .txt、.md、.markdown 文件，收到: ${fileName}`,
    );
  }

  const { text: raw, encoding } = detectAndDecode(buffer);

  if (raw.trim().length < 10) {
    throw new Error("文件内容过短，至少需要 10 个字符");
  }

  const base = importPlainText(raw);

  return {
    ...base,
    fileName,
    fileSizeBytes: buffer.byteLength,
    encoding,
  };
}

export { isAllowedFile, detectAndDecode, ALLOWED_EXTENSIONS };
