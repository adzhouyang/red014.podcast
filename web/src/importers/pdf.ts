// ─── PDF Importer ───────────────────────────────────
// PRD 8.1 FR-02: Upload text-based PDF, extract text locally
// Uses pdfjs-dist for server-side extraction

import { TextImportResult } from "./plain-text";

export interface PdfImportResult extends TextImportResult {
  pageCount: number;
  fileName: string;
  fileSizeBytes: number;
}

/**
 * Extract text from a PDF buffer.
 * This is a server-side operation - pdfjs-dist reads from Node.js fs.
 */
export async function importPdf(
  pdfBuffer: Buffer,
  fileName: string,
): Promise<PdfImportResult> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    useWorkerFetch: false,
    isEvalSupported: true,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;

  const textParts: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    textParts.push(pageText);
  }

  const rawText = textParts.join("\n\n").trim();

  if (rawText.length < 50) {
    throw new Error(
      "PDF 提取文本过短，该文件可能是扫描件或图片型 PDF，暂不支持",
    );
  }

  const { importPlainText } = await import("./plain-text");
  const base = importPlainText(rawText);

  return {
    ...base,
    pageCount,
    fileName,
    fileSizeBytes: pdfBuffer.byteLength,
  };
}
