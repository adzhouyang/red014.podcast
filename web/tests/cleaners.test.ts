import { describe, it, expect } from "vitest";
import { normalizeText } from "../src/cleaners/normalize";

describe("normalizeText", () => {
  it("preserves single newlines between lines", () => {
    const input = "第一行\n第二行\n第三行";
    const result = normalizeText(input);
    expect(result.cleaned).toContain("第一行");
    expect(result.cleaned).toContain("第三行");
    expect(result.cleanedChars).toBeGreaterThan(0);
  });

  it("preserves paragraph breaks (double newline)", () => {
    const input = "段落一\n\n段落二";
    const result = normalizeText(input);
    expect(result.cleaned).toContain("\n\n");
  });

  it("collapses 3+ blank lines into double newline", () => {
    const input = "段落一\n\n\n\n\n\n段落二";
    const result = normalizeText(input);
    expect(result.cleaned).toBe("段落一\n\n段落二");
    expect(result.changes).toContain("合并多余空行");
  });

  it("trims whitespace", () => {
    const input = "  \n  内容  \n  ";
    const result = normalizeText(input);
    expect(result.cleaned).toBe("内容");
  });

  it("returns clean result with stats", () => {
    const result = normalizeText("abc\n\n\n\ndef");
    expect(result.originalChars).toBe(10);
    expect(result.cleanedChars).toBeLessThan(result.originalChars);
  });
});
