import { describe, it, expect } from "vitest";
import {
  importTextFile,
  isAllowedFile,
  detectAndDecode,
} from "../src/importers/text-file";

function makeBuffer(text: string, encoding: BufferEncoding = "utf-8"): Buffer {
  return Buffer.from(text, encoding);
}

describe("isAllowedFile", () => {
  it("accepts .txt files with text/plain", () => {
    expect(isAllowedFile("notes.txt", "text/plain")).toBe(true);
  });

  it("accepts .md files with text/markdown", () => {
    expect(isAllowedFile("readme.md", "text/markdown")).toBe(true);
  });

  it("accepts .markdown extension", () => {
    expect(isAllowedFile("doc.markdown", "text/plain")).toBe(true);
  });

  it("accepts .md with octet-stream (browser fallback)", () => {
    expect(isAllowedFile("readme.md", "application/octet-stream")).toBe(true);
  });

  it("rejects .pdf files", () => {
    expect(isAllowedFile("doc.pdf", "application/pdf")).toBe(false);
  });

  it("rejects .docx files", () => {
    expect(isAllowedFile("doc.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
  });

  it("rejects files with no extension", () => {
    expect(isAllowedFile("Makefile", "text/plain")).toBe(false);
  });
});

describe("detectAndDecode", () => {
  it("decodes UTF-8 plain text", () => {
    const buf = makeBuffer("Hello 世界");
    const result = detectAndDecode(buf);
    expect(result.text).toBe("Hello 世界");
    expect(result.encoding).toBe("utf-8");
  });

  it("decodes UTF-8 with BOM", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), makeBuffer("标题")]);
    const result = detectAndDecode(buf);
    expect(result.text).toBe("标题");
    expect(result.encoding).toBe("utf-8-bom");
  });

  it("decodes multi-paragraph Chinese text", () => {
    const text = "第一段内容\n\n第二段内容\n\n第三段内容";
    const buf = makeBuffer(text);
    const result = detectAndDecode(buf);
    expect(result.text).toBe(text);
    expect(result.text).toContain("\n\n");
  });
});

describe("importTextFile", () => {
  it("imports a plain .txt file with Chinese content", () => {
    const text =
      "人工智能的发展历程\n\n人工智能从20世纪50年代起步，经历了多次起伏。近年来深度学习技术取得重大突破。";
    const buf = makeBuffer(text);
    const result = importTextFile(buf, "article.txt", "text/plain");

    expect(result.fileName).toBe("article.txt");
    expect(result.fileSizeBytes).toBe(buf.byteLength);
    expect(result.encoding).toBe("utf-8");
    expect(result.title).toBe("人工智能的发展历程");
    expect(result.charCount).toBe(text.length);
    expect(result.estimatedMinutes).toBeGreaterThan(0);
    expect(result.rawText).toBe(text);
  });

  it("imports a .md markdown file", () => {
    const md = `# 科技周报

## 本周要点

- AI 新突破
- 量子计算进展

详细分析见下文。`;
    const buf = makeBuffer(md);
    const result = importTextFile(buf, "weekly.md", "text/markdown");

    expect(result.fileName).toBe("weekly.md");
    expect(result.rawText).toContain("# 科技周报");
    expect(result.rawText).toContain("## 本周要点");
    expect(result.charCount).toBe(md.length);
  });

  it("extracts title from first non-empty line without heading marker", () => {
    const text = "# Markdown Title\n\nBody content here.";
    const buf = makeBuffer(text);
    const result = importTextFile(buf, "doc.md");

    // First non-empty line without '#' prefix should be "Body content here."
    expect(result.title).toBe("Body content here.");
  });

  it("rejects files that are too short", () => {
    const text = "短";
    const buf = makeBuffer(text);
    expect(() => importTextFile(buf, "short.txt")).toThrow(/过短/);
  });

  it("rejects non-txt/md files", () => {
    const buf = makeBuffer("fake pdf content");
    expect(() => importTextFile(buf, "doc.pdf", "application/pdf")).toThrow(
      /不支持的文件类型/,
    );
  });

  it("reports correct character count for mixed Chinese/English", () => {
    const text = "AI 人工智能 Machine Learning 机器学习";
    const buf = makeBuffer(text);
    const result = importTextFile(buf, "mix.txt");
    expect(result.charCount).toBe(text.length);
  });
});
