// ─── Gemini Script Provider ────────────────────────
// PRD 6: Optional script model using Google Gemini API
//
// Env: GEMINI_API_KEY (required), GEMINI_MODEL (optional)

import type { PodcastScript, Segment } from "@/podcast/schema";
import { PodcastScriptSchema, SegmentSchema } from "@/podcast/schema";
import type { ScriptGenerationInput, ScriptProvider, SegmentRegenerationInput } from "./interface";
import { getPrompt } from "./prompts/resolver";
import { extractJson } from "./utils";

const API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_RETRIES = 2;
const TIMEOUT_MS = 90_000;

interface ApiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
}

// ─── Core API Call ──────────────────────────────────

async function callApi(
  systemPrompt: string,
  userMessage: string,
): Promise<{
  script: PodcastScript;
  inputTokens: number;
  outputTokens: number;
  elapsedSeconds: number;
}> {
  const startTime = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 6000,
        responseMimeType: "application/json",
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`API error ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data: ApiResponse = await response.json();
  const elapsedSeconds = (Date.now() - startTime) / 1000;

  const inputTokens = data.usageMetadata?.promptTokenCount || 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;

  const contentText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!contentText.trim()) {
    throw new Error("Empty response from API — no text in candidate parts");
  }

  const jsonStr = extractJson(contentText);
  let script: PodcastScript;

  try {
    script = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `Failed to parse JSON from model output. First 500 chars: ${contentText.slice(0, 500)}`,
    );
  }

  const result = PodcastScriptSchema.safeParse(script);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Schema validation failed:\n${issues}`);
  }

  return {
    script: result.data,
    inputTokens,
    outputTokens,
    elapsedSeconds: Math.round(elapsedSeconds * 10) / 10,
  };
}

// ─── Provider (plain object) ────────────────────────

export const geminiProvider: ScriptProvider = {
  name: "gemini",
  models: [MODEL],

  async generateScript(input: ScriptGenerationInput): Promise<PodcastScript> {
    if (!API_KEY) {
      throw new Error(
        "GEMINI_API_KEY not set. Set it in .env.local or environment.",
      );
    }

    const userMessage = `请将以下文章改编为双人对谈播客脚本：\n\n---\n${input.cleanedText}\n---`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await callApi(getPrompt(input.promptVersion), userMessage);

        return {
          ...result.script,
          title: result.script.title || input.title || "未命名播客",
          summary: result.script.summary || "",
          target_duration_minutes:
            result.script.target_duration_minutes ||
            input.targetDurationMinutes ||
            10,
          source_claims: result.script.source_claims || [],
          segments: result.script.segments || [],
          _usage: {
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          },
        } as PodcastScript;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, Math.pow(2, attempt) * 1000),
          );
        }
      }
    }

    throw lastError || new Error("Script generation failed after all retries");
  },

  async regenerateSegment(input: SegmentRegenerationInput): Promise<Segment> {
    if (!API_KEY) throw new Error("GEMINI_API_KEY not set.");

    const systemPrompt = getPrompt(input.promptVersion);
    const userMessage = `以下是一个播客脚本。请重新生成片段 ${input.segmentId}。

原始脚本摘要: ${input.originalScript.summary || input.originalScript.title}

当前片段内容:
${JSON.stringify(input.originalScript.segments.find(s => s.id === input.segmentId) || {}, null, 2)}

${input.instruction ? `修改要求: ${input.instruction}` : "请改进该片段的对话质量，使其更自然流畅。"}

请只返回该片段的新 JSON，格式为: {"id": "${input.segmentId}", "topic": "...", "turns": [...]}`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userMessage }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 2000,
              responseMimeType: "application/json",
            },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "Unknown");
          throw new Error(`API error ${response.status}: ${errText.slice(0, 300)}`);
        }

        const data: ApiResponse = await response.json();
        const contentText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!contentText.trim()) throw new Error("Empty regenerate response");

        const jsonStr = extractJson(contentText);
        const parsed = JSON.parse(jsonStr);
        const result = SegmentSchema.safeParse(parsed);
        if (!result.success) {
          throw new Error(`Regenerated segment validation failed: ${result.error.message}`);
        }
        return result.data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError || new Error("Segment regeneration failed");
  },
};
