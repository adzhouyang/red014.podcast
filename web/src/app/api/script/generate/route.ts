import { NextRequest, NextResponse } from "next/server";
import { getScriptProvider } from "@/providers/scripts";
import { PodcastScriptSchema } from "@/podcast/schema";
import { loadManifest, saveManifest } from "@/jobs/runner";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * POST /api/script/generate
 *
 * Body: {
 *   job_id?: string,
 *   title?: string,
 *   cleanedText: string,
 *   targetDurationMinutes?: number,
 *   provider?: string   // "anthropic" (default) | "openai" | "hermes" | "gemini"
 * }
 */
export async function POST(req: NextRequest) {
  let body: {
    job_id?: string;
    title?: string;
    cleanedText: string;
    targetDurationMinutes?: number;
    provider?: string;
    promptVersion?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.cleanedText || body.cleanedText.trim().length < 50) {
    return NextResponse.json(
      { error: "cleanedText is required and must be at least 50 characters" },
      { status: 400 },
    );
  }

  const providerName = body.provider || "anthropic";
  const provider = getScriptProvider(providerName);

  if (!provider) {
    return NextResponse.json(
      { error: `Unknown script provider: ${providerName}` },
      { status: 400 },
    );
  }

  const manifest = body.job_id ? loadManifest(body.job_id) : null;
  if (body.job_id && !manifest) {
    return NextResponse.json({ error: `Job not found: ${body.job_id}` }, { status: 404 });
  }

  try {
    if (manifest) {
      manifest.status = "script_generating";
      manifest.script_model = provider.models[0] || provider.name;
      saveManifest(manifest);
    }

    const startTime = Date.now();

    const script = await provider.generateScript({
      title: body.title || manifest?.source_title || "未命名",
      cleanedText: body.cleanedText,
      targetDurationMinutes: body.targetDurationMinutes || 10,
      promptVersion: body.promptVersion,
    });

    // Read token usage before Zod strips non-schema properties
    const usage = (script as Record<string, unknown>)?._usage as
      | { inputTokens?: number; outputTokens?: number }
      | undefined;

    const validated = PodcastScriptSchema.parse(script);
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    const meta = {
      provider: provider.name,
      model: provider.models[0] || "unknown",
      elapsed_seconds: parseFloat(elapsedSeconds),
    };

    if (manifest) {
      const jobDir = saveManifest({
        ...manifest,
        status: "script_ready",
        script_model: meta.model,
        script_generation_meta: {
          provider: meta.provider,
          model: meta.model,
          input_tokens: usage?.inputTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0,
          elapsed_seconds: meta.elapsed_seconds,
          cost_estimate: 0,
        },
      });
      const scriptsDir = join(jobDir, "scripts");
      mkdirSync(scriptsDir, { recursive: true });
      const scriptPath = join(scriptsDir, `v${manifest.script_version ?? 1}.json`);
      writeFileSync(scriptPath, JSON.stringify(validated, null, 2));
      saveManifest({
        ...manifest,
        status: "script_ready",
        script_model: meta.model,
        script_path: scriptPath,
        script_version: (manifest.script_version ?? 0) + 1,
        script_generation_meta: {
          provider: meta.provider,
          model: meta.model,
          input_tokens: usage?.inputTokens ?? 0,
          output_tokens: usage?.outputTokens ?? 0,
          elapsed_seconds: meta.elapsed_seconds,
          cost_estimate: 0,
        },
      });
    }

    return NextResponse.json({
      script: validated,
      meta,
      job_id: body.job_id,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Script generation failed";
    console.error("Script generation error:", message);
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
