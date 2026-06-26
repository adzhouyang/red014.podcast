// ─── Webpage Importer ──────────────────────────────
// PRD 8.1 FR-03: Import article from URL
// Uses @mozilla/readability + jsdom

import { TextImportResult } from "./plain-text";

export interface WebpageImportResult extends TextImportResult {
  url: string;
  siteName?: string;
  byline?: string;
}

/**
 * Fetch and extract article content from a URL.
 * This is a server-side operation.
 */
export async function importWebpage(url: string): Promise<WebpageImportResult> {
  const { JSDOM } = await import("jsdom");
  const { Readability } = await import("@mozilla/readability");

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; Red014.Podcast/1.0; +https://red014.local)",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`网页请求失败: HTTP ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent.trim()) {
    throw new Error("无法从该网页提取正文内容，请尝试手动粘贴文本");
  }

  const { importPlainText } = await import("./plain-text");
  const base = importPlainText(article.textContent);

  return {
    ...base,
    title: article.title || base.title,
    url,
    siteName: article.siteName || undefined,
    byline: article.byline || undefined,
  };
}
