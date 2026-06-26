// ─── Anthropic Script Provider ─────────────────────
// PRD 7.2: Default script model using Claude/DeepSeek API
// Implements ScriptProvider interface with real API calls.
//
// Supports Anthropic-compatible endpoints (including DeepSeek).
// Env: ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL (optional), ANTHROPIC_MODEL (optional)

import type { PodcastScript, Segment } from "@/podcast/schema";
import { PodcastScriptSchema, SegmentSchema } from "@/podcast/schema";
import type { ScriptProvider, ScriptGenerationInput, SegmentRegenerationInput } from "./interface";
import { getPrompt } from "./prompts/resolver";

const BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || "";
const MAX_RETRIES = 2;
const TIMEOUT_MS = 90_000;

interface ApiResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

function extractJson(text: string): string {
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

  const response = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        { role: "user", content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`API error ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data: ApiResponse = await response.json();
  const elapsedSeconds = (Date.now() - startTime) / 1000;

  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  // DeepSeek returns mixed thinking + text blocks; extract text blocks only
  const textBlocks = (data.content || []).filter((c) => c.type === "text");
  const contentText = textBlocks.map((c) => c.text || "").join("\n");

  if (!contentText.trim()) {
    throw new Error("Empty response from API — no text content blocks found");
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

  // Zod validation
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

export class AnthropicScriptProvider implements ScriptProvider {
  readonly name = "anthropic";
  readonly models = [MODEL];

  async generateScript(input: ScriptGenerationInput): Promise<PodcastScript> {
    if (!API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY not set. Set it in .env.local or environment.",
      );
    }

    const userMessage = `请将以下文章改编为双人对谈播客脚本：\n\n---\n${input.cleanedText}\n---`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await callApi(getPrompt(input.promptVersion), userMessage);

        // Attach generation metadata (non-schema fields go on a separate path)
        // The caller can access this via the returned object
        return {
          ...result.script,
          title:
            result.script.title ||
            input.title ||
            "未命名播客",
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
          // Exponential backoff: 1s, 3s
          await new Promise((r) =>
            setTimeout(r, Math.pow(2, attempt) * 1000),
          );
        }
      }
    }

    throw lastError || new Error("Script generation failed after all retries");
  }

  async regenerateSegment(input: SegmentRegenerationInput): Promise<Segment> {
    if (!API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not set.");
    }

    const systemPrompt = getPrompt(input.promptVersion);
    const userMessage = `以下是一个播客脚本。请重新生成片段 ${input.segmentId}。

原始脚本摘要: ${input.originalScript.summary || input.originalScript.title}

当前片段内容:
${JSON.stringify(input.originalScript.segments.find(s => s.id === input.segmentId) || {}, null, 2)}

${input.instruction ? `修改要求: ${input.instruction}` : "请改进该片段的对话质量，使其更自然流畅。"}

请只返回该片段的新 JSON，格式为: {"id": "${input.segmentId}", "topic": "...", "turns": [...]}
不要包含外层脚本结构，只返回这一个 segment。`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${BASE_URL}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 2000,
            temperature: 0.7,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "Unknown");
          throw new Error(`API error ${response.status}: ${errText.slice(0, 300)}`);
        }

        const data: ApiResponse = await response.json();
        const textBlocks = (data.content || []).filter((c) => c.type === "text");
        const contentText = textBlocks.map((c) => c.text || "").join("\n");

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
  }
}
