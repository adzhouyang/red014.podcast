import { describe, it, expect } from "vitest";
import { PodcastScriptSchema } from "../src/podcast/schema";

describe("PodcastScriptSchema", () => {
  it("validates a minimal valid script", () => {
    const valid = {
      title: "测试播客",
      summary: "本期摘要",
      target_duration_minutes: 10,
      source_claims: [],
      segments: [
        {
          id: "seg-001",
          topic: "开场",
          turns: [
            { id: "turn-001", speaker: "A" as const, text: "大家好。" },
            { id: "turn-002", speaker: "B" as const, text: "今天聊聊。" },
          ],
        },
      ],
    };
    const result = PodcastScriptSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects script with no segments", () => {
    const invalid = {
      title: "空脚本",
      summary: "无片段",
      target_duration_minutes: 5,
      source_claims: [],
      segments: [],
    };
    const result = PodcastScriptSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects turn with text > 500 chars", () => {
    const invalid = {
      title: "超长",
      summary: "测试",
      target_duration_minutes: 5,
      source_claims: [],
      segments: [
        {
          id: "seg-001",
          turns: [{ id: "turn-001", speaker: "A" as const, text: "X".repeat(501) }],
        },
      ],
    };
    const result = PodcastScriptSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid speaker", () => {
    const invalid = {
      title: "错误",
      summary: "测试",
      target_duration_minutes: 5,
      source_claims: [],
      segments: [
        {
          id: "seg-001",
          turns: [{ id: "turn-001", speaker: "C", text: "Hello" }],
        },
      ],
    };
    const result = PodcastScriptSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects missing source_claims", () => {
    const invalid = {
      title: "无claims",
      summary: "测试",
      target_duration_minutes: 5,
      segments: [
        {
          id: "seg-001",
          turns: [{ id: "turn-001", speaker: "A" as const, text: "Hello" }],
        },
      ],
    };
    const result = PodcastScriptSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
