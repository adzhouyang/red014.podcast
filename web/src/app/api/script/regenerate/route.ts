// ─── Segment Regeneration API ───────────────────────
// PRD 9.2 FR-11: Regenerate single segment via AI
// POST /api/script/regenerate
// Body: { script, segmentId, instruction?, provider }

import { NextRequest, NextResponse } from "next/server";
import { PodcastScriptSchema } from "@/podcast/schema";
import { regenerateSegment } from "@/podcast/generation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required fields
    if (!body.script || !body.segmentId || !body.provider) {
      return NextResponse.json(
        { error: "Missing required fields: script, segmentId, provider" },
        { status: 400 },
      );
    }

    // Validate the script
    const scriptResult = PodcastScriptSchema.safeParse(body.script);
    if (!scriptResult.success) {
      return NextResponse.json(
        { error: "Invalid script", details: scriptResult.error.issues },
        { status: 400 },
      );
    }

    // Check segment exists
    const script = scriptResult.data;
    const existingSegment = script.segments.find((s) => s.id === body.segmentId);
    if (!existingSegment) {
      return NextResponse.json(
        { error: `Segment ${body.segmentId} not found in script` },
        { status: 400 },
      );
    }

    const regenerated = await regenerateSegment(
      {
        originalScript: script,
        segmentId: body.segmentId,
        instruction: body.instruction,
        promptVersion: body.promptVersion || (script as unknown as Record<string, unknown>)._promptVersion as string | undefined,
      },
      body.provider,
    );

    return NextResponse.json({ segment: regenerated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
