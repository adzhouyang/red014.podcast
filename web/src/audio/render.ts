// ─── Audio Render Pipeline ─────────────────────────
// PRD 8.4: Orchestrate segment-level audio generation
//
// Pipeline:
//   TTS provider → per-turn audio buffers
//     → segment concat (turns within a segment)
//     → final concat (all segments → one file)
//     → loudness normalization (EBU R128, target -16 LUFS)
//     → final MP3 artifact with duration metadata
//
// Uses src/audio/concat.ts and src/audio/loudness.ts.
import { mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import type { Segment } from "@/podcast/schema";
import { concatAudio, checkFfmpeg } from "./concat";
import { normalizeLoudness, getDuration } from "./loudness";

export interface RenderOptions {
  segments: Segment[];
  speakers: [string, string];
  format: "mp3" | "ogg_opus";
  speechRate?: number;
  /** Output directory for per-segment files */
  outputDir: string;
  /** Callback for per-turn progress updates */
  onTurnProgress?: (progress: {
    completedTurns: number;
    totalTurns: number;
    currentTurn?: string;
    currentSpeaker?: string;
    failedTurns: number;
  }) => void;
}

export interface RenderProgress {
  segmentId: string;
  status: "pending" | "rendering" | "done" | "error";
  filePath?: string;
  error?: string;
}

export interface RenderResult {
  segments: RenderProgress[];
  finalPath: string;
  totalDurationSeconds: number;
  totalChars: number;
}

/**
 * Render podcast audio segment-by-segment via an injected renderTurn function.
 *
 * The caller provides a renderTurn function that knows how to
 * synthesize a single turn. This keeps the render pipeline
 * provider-agnostic — the pipeline only handles FFmpeg concat
 * and loudness.
 */
export async function renderPodcast(
  options: RenderOptions,
  renderTurn: (
    speaker: "A" | "B",
    text: string,
    turnId: string,
    segmentId: string,
  ) => Promise<Buffer>,
): Promise<RenderResult> {
  const { segments, outputDir, onTurnProgress } = options;

  if (!checkFfmpeg()) {
    throw new Error(
      "FFmpeg is not installed. Please install FFmpeg 4.0+ to generate audio.",
    );
  }

  mkdirSync(outputDir, { recursive: true });

  // Count total turns
  const totalTurns = segments.reduce(
    (sum, seg) => sum + (seg.turns?.length || 0),
    0,
  );
  let completedTurns = 0;
  let failedTurns = 0;
  let totalChars = 0;

  const progressList: RenderProgress[] = [];
  const segAudioFiles: string[] = [];

  // Process each segment
  for (const segment of segments) {
    const segProgress: RenderProgress = {
      segmentId: segment.id,
      status: "rendering",
    };
    progressList.push(segProgress);

    const segChunks: Buffer[] = [];
    const chunkPaths: string[] = [];

    for (const turn of segment.turns || []) {
      try {
        const audio = await renderTurn(
          turn.speaker as "A" | "B",
          turn.text || "",
          turn.id,
          segment.id,
        );
        segChunks.push(audio);
        totalChars += (turn.text || "").length;
        completedTurns++;

        // Save individual turn file
        const chunkPath = join(
          outputDir,
          `${segment.id}-chunk${chunkPaths.length}.mp3`,
        );
        writeFileSync(chunkPath, audio);
        chunkPaths.push(chunkPath);
      } catch {
        failedTurns++;
      }

      if (onTurnProgress) {
        onTurnProgress({
          completedTurns: completedTurns + failedTurns,
          totalTurns,
          currentTurn: turn.id,
          currentSpeaker: turn.speaker,
          failedTurns,
        });
      }
    }

    // Concat turns within this segment
    if (chunkPaths.length > 0) {
      const segFile = join(outputDir, `${segment.id}.mp3`);

      try {
        concatAudio({
          inputFiles: chunkPaths,
          outputPath: segFile,
          crossfadeSeconds: 0,
        });
        segProgress.status = "done";
        segProgress.filePath = segFile;
        segAudioFiles.push(segFile);
      } catch {
        // Fallback: raw buffer concat
        const combined = Buffer.concat(segChunks);
        writeFileSync(segFile, combined);
        segProgress.status = "done";
        segProgress.filePath = segFile;
        segAudioFiles.push(segFile);
      }

      // Cleanup per-turn chunk files
      for (const p of chunkPaths) {
        try {
          unlinkSync(p);
        } catch {}
      }
    } else {
      segProgress.status = "error";
      segProgress.error = "No audio generated for this segment";
    }
  }

  // Final merge: all segments → final.mp3
  const finalPath = join(outputDir, "final.mp3");
  if (segAudioFiles.length > 0) {
    concatAudio({
      inputFiles: segAudioFiles,
      outputPath: finalPath,
      crossfadeSeconds: 0.3,
    });

    // Apply loudness normalization (two-pass EBU R128)
    const normalizedPath = join(outputDir, "final-norm.mp3");
    try {
      normalizeLoudness(finalPath, normalizedPath, -16);
      // Replace original with normalized
      unlinkSync(finalPath);
      const { renameSync } = await import("fs");
      renameSync(normalizedPath, finalPath);
    } catch {
      // Normalization failed, keep original
      try {
        unlinkSync(normalizedPath);
      } catch {}
    }
  }

  // Measure final duration
  const totalDurationSeconds = getDuration(finalPath);

  return {
    segments: progressList,
    finalPath,
    totalDurationSeconds,
    totalChars,
  };
}
