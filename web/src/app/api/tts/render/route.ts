import { NextRequest, NextResponse } from "next/server";
import { volcPodcastProvider } from "@/providers/tts/volc-podcast";
import { PodcastScriptSchema } from "@/podcast/schema";
import { loadManifest, saveManifest } from "@/jobs/runner";
import { applyDict, mergeDict } from "@/pronunciation/dict";
import { recordCalibration } from "@/planners/duration";

/**
 * POST /api/tts/render
 *
 * Body: { script: PodcastScript, job_id?: string, speakers?: [string, string] }
 */
export async function POST(req: NextRequest) {
  if (!process.env.VOLC_API_KEY && !process.env.VOLC_ACCESS_KEY) {
    return NextResponse.json(
      { error: "VOLC_API_KEY not configured on server" },
      { status: 503 },
    );
  }

  let body: { script: unknown; job_id?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = PodcastScriptSchema.safeParse(body.script);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid script", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const script = parsed.data;

  // Apply pronunciation dictionary to all turn texts
  const dict = mergeDict({}); // user overrides via env later
  const dictApplied = {
    ...script,
    segments: script.segments.map((seg) => ({
      ...seg,
      turns: seg.turns.map((turn) => ({
        ...turn,
        text: applyDict(turn.text, dict),
      })),
    })),
  };

  const manifest = body.job_id ? loadManifest(body.job_id) : null;
  if (body.job_id && !manifest) {
    return NextResponse.json({ error: `Job not found: ${body.job_id}` }, { status: 404 });
  }

  if (manifest) {
    manifest.status = "audio_rendering";
    saveManifest(manifest);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(line));
      };

      try {
        const artifact = await volcPodcastProvider.renderPodcast(
          {
            segments: dictApplied.segments,
            speakers: ["zh_male_xuanyijieshuo_uranus_bigtts", "zh_female_mizai_uranus_bigtts"],
            format: "mp3",
            jobId: body.job_id,
          },
          (progress) => {
            send("progress", progress);
          },
        );

        if (manifest) {
          saveManifest({
            ...manifest,
            status: "completed",
            tts_provider: "volc-podcast",
            speaker_a: "zh_male_xuanyijieshuo_uranus_bigtts",
            speaker_b: "zh_female_mizai_uranus_bigtts",
            audio_dir: artifact.filePath,
            final_audio: artifact.filePath,
            total_duration_seconds: artifact.durationSeconds,
            tts_stats: artifact.stats
              ? {
                  total_turns: artifact.stats.totalTurns,
                  success_turns: artifact.stats.successTurns,
                  fail_turns: artifact.stats.totalTurns - artifact.stats.successTurns,
                  elapsed_seconds: artifact.stats.elapsedSeconds,
                }
              : undefined,
            cost: artifact.stats
              ? {
                  script: 0,
                  tts: artifact.stats.estimatedCostRmb,
                  total: artifact.stats.estimatedCostRmb,
                }
              : undefined,
          });
        }

        send("done", {
          audioBase64: artifact.audioBase64,
          format: artifact.format,
          stats: artifact.stats,
          segments: artifact.segments?.map((seg) => ({
            segmentId: seg.segmentId,
            turnCount: seg.turnCount,
            audioBase64: seg.audioBase64,
          })),
        });

        // Record calibration: compute chars from script
        const totalChars = dictApplied.segments.reduce(
          (sum, seg) => sum + seg.turns.reduce((s, t) => s + t.text.length, 0),
          0,
        );
        if (totalChars > 0 && artifact.stats) {
          // Use provided duration or estimate from turn count
          const estimatedSecs =
            (artifact.stats as Record<string, unknown>).totalDurationSeconds as number
            || (artifact.stats.totalTurns || 0) * 15; // ~15s per turn estimate
          if (estimatedSecs > 0) {
            recordCalibration(totalChars, estimatedSecs);
          }
        }
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "TTS synthesis failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
