import { NextRequest, NextResponse } from "next/server";
import { PodcastScriptSchema } from "@/podcast/schema";
import { getScriptProvider } from "@/providers/scripts";
import { verifyClaims } from "@/podcast/fact-check";
import { loadManifest, saveManifest } from "@/jobs/runner";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * POST /api/script/verify
 *
 * Body: {
 *   job_id: string,
 *   provider?: string   // "anthropic" (default)
 * }
 *
 * Reads the script from the job directory and verifies claims
 * against the source text.
 */
export async function POST(req: NextRequest) {
  let body: { job_id: string; provider?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.job_id) {
    return NextResponse.json(
      { error: "job_id is required" },
      { status: 400 },
    );
  }

  const manifest = loadManifest(body.job_id);
  if (!manifest) {
    return NextResponse.json(
      { error: `Job not found: ${body.job_id}` },
      { status: 404 },
    );
  }

  // Load script from job dir
  let script;
  try {
    const scriptPath = manifest.script_path
      ? join(manifest.script_path)
      : null;
    if (!scriptPath) {
      return NextResponse.json(
        { error: "No script found for this job" },
        { status: 400 },
      );
    }
    script = JSON.parse(readFileSync(scriptPath, "utf-8"));
  } catch {
    return NextResponse.json(
      { error: "Failed to load script from job directory" },
      { status: 500 },
    );
  }

  const validated = PodcastScriptSchema.safeParse(script);
  if (!validated.success) {
    return NextResponse.json(
      { error: "Invalid script", details: validated.error.flatten() },
      { status: 400 },
    );
  }

  // Load source text
  let sourceText = "";
  try {
    const jobsDir = join(process.cwd(), "data", "jobs", body.job_id, "source");
    sourceText = readFileSync(join(jobsDir, "cleaned.txt"), "utf-8");
  } catch {
    return NextResponse.json(
      { error: "Source text not found for this job" },
      { status: 400 },
    );
  }

  const providerName = body.provider || "anthropic";
  const scriptProvider = getScriptProvider(providerName);
  if (!scriptProvider) {
    return NextResponse.json(
      { error: `Unknown provider: ${providerName}` },
      { status: 400 },
    );
  }

  // Create a fact-check adapter from the script provider
  const checker = {
    name: scriptProvider.name,
    async check(prompt: string): Promise<string> {
      // Use generateScript with a system-like prompt to get a text response
      // We reuse the provider for the verification pass
      // Since generateScript expects PodcastScript output, we do a raw
      // prompt and extract the verdict from whatever the LLM returns
      const result = await (
        scriptProvider as unknown as {
          generateScript(input: {
            title: string;
            cleanedText: string;
            targetDurationMinutes: number;
          }): Promise<{
            _usage?: { inputTokens: number; outputTokens: number };
            segments?: Array<{
              turns: Array<{ text: string }>;
            }>;
          }>;
        }
      ).generateScript({
        title: "fact-check",
        cleanedText: prompt,
        targetDurationMinutes: 1,
      });

      // Extract the raw text from the generated "script" — it will be
      // the LLM's verdict in the first segment's first turn
      const text = result.segments?.[0]?.turns?.[0]?.text || "";
      return text;
    },
  };

  try {
    const result = await verifyClaims(validated.data, sourceText, checker);
    const { claims, summary } = result;

    // Write result to manifest
    saveManifest({
      ...manifest,
      fact_check: {
        verified_at: new Date().toISOString(),
        provider: providerName,
        claims,
        summary,
      },
    });

    return NextResponse.json({ claims, summary });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Fact check failed";
    console.error("Fact check error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
