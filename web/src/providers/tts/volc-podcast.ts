// ─── Volcano Engine TTS Provider ───────────────────
// PRD 7.3: Default TTS using 火山引擎 Seed-TTS 2.0
// Implements TtsProvider interface with v3 HTTP API.
//
// Architecture:
//   volcengine-v3-client.ts  → single-turn synthesis (HTTP)
//   concat.ts                 → FFmpeg audio concatenation
//   loudness.ts               → EBU R128 loudness normalization
//
// Env: VOLC_API_KEY, VOLC_RESOURCE_ID (default: seed-tts-2.0)
//
// Reference: https://www.volcengine.com/docs/6561/2528925

import { writeFileSync, mkdirSync, readFileSync, copyFileSync, unlinkSync, renameSync } from "fs";
import { join } from "path";
import type {
  TtsProvider,
  PodcastRenderInput,
  AudioArtifact,
  SpeakerPair,
} from "./interface";
import type { Segment, Turn } from "@/podcast/schema";
import {
  synthesizeWithRetry,
  isConfigured,
} from "./volcengine-v3-client";
import { concatAudio, checkFfmpeg } from "@/audio/concat";
import { normalizeLoudness } from "@/audio/loudness";

const VOICE_MAP: Record<string, string> = {
  zh_male_xuanyijieshuo_uranus_bigtts:
    "zh_male_xuanyijieshuo_uranus_bigtts",
  zh_female_mizai_uranus_bigtts:
    "zh_female_mizai_uranus_bigtts",
};

const SPEAKER_PAIRS: SpeakerPair[] = [
  {
    name: "小北 × 阿深",
    speakers: [
      "zh_male_xuanyijieshuo_uranus_bigtts",
      "zh_female_mizai_uranus_bigtts",
    ],
  },
];

const TURN_DELAY_MS = 200;
const MAX_RETRIES_PER_TURN = 3;

function resolveOutputDir(jobId?: string): string {
  const baseDir = process.env.RED014_DATA_DIR || "./data";
  if (jobId) {
    return join(baseDir, "jobs", jobId, "audio");
  }
  return join(baseDir, "tts", `tts-${Date.now()}`);
}

export class VolcPodcastTtsProvider implements TtsProvider {
  readonly name = "volc-podcast";
  readonly speakerPairs = SPEAKER_PAIRS;

  async listSpeakers(): Promise<SpeakerPair[]> {
    return this.speakerPairs;
  }

  async renderPodcast(
    input: PodcastRenderInput & { jobId?: string },
    onProgress?: (progress: {
      completedTurns: number;
      totalTurns: number;
      currentTurn: string;
      currentSpeaker: string;
      failedTurns: number;
    }) => void,
  ): Promise<AudioArtifact> {
    if (!isConfigured()) {
      throw new Error(
        "VOLC_API_KEY not set. Set it in .env.local or environment.",
      );
    }

    if (!checkFfmpeg()) {
      throw new Error(
        "FFmpeg is not installed. Please install FFmpeg 4.0+ to generate audio.",
      );
    }

    const { segments, speakers, format } = input;
    const speakerA = speakers[0];
    const speakerB = speakers[1];

    if (!VOICE_MAP[speakerA]) {
      throw new Error(`Unknown speaker voice: ${speakerA}`);
    }
    if (!VOICE_MAP[speakerB]) {
      throw new Error(`Unknown speaker voice: ${speakerB}`);
    }

    const outputDir = resolveOutputDir(input.jobId);
    mkdirSync(outputDir, { recursive: true });

    // ── Collect all turns ──────────────────────────────────
    const allTurns: Array<{
      turnId: string;
      speaker: string;
      text: string;
      voice: string;
      segmentId: string;
    }> = [];
    for (const segment of segments) {
      for (const turn of segment.turns || []) {
        allTurns.push({
          turnId: turn.id,
          speaker: turn.speaker,
          text: turn.text || "",
          voice:
            turn.speaker === "A"
              ? VOICE_MAP[speakerA]
              : VOICE_MAP[speakerB],
          segmentId: segment.id,
        });
      }
    }

    const totalTurns = allTurns.length;
    let completedTurns = 0;
    let failedTurns = 0;
    let totalAudioBytes = 0;
    const startTime = Date.now();
    const segAudioFiles: string[] = [];

    // ── Synthesize segment by segment ──────────────────────
    for (const segment of segments) {
      const segTurns = allTurns.filter(
        (t) => t.segmentId === segment.id,
      );
      const segChunks: Buffer[] = [];
      const chunkPaths: string[] = [];

      for (const { turnId, speaker, text, voice } of segTurns) {
        try {
          const result = await synthesizeWithRetry(
            { text, voice, format: "mp3", sampleRate: 24000 },
            MAX_RETRIES_PER_TURN,
          );

          segChunks.push(result.audio);
          totalAudioBytes += result.size;
          completedTurns++;

          // Save individual turn file for debugging / fragment-level retry
          const fname = join(outputDir, `${turnId}-${speaker}.mp3`);
          writeFileSync(fname, result.audio);
        } catch {
          failedTurns++;
        }

        if (onProgress) {
          onProgress({
            completedTurns: completedTurns + failedTurns,
            totalTurns,
            currentTurn: turnId,
            currentSpeaker: speaker,
            failedTurns,
          });
        }

        // API rate limit
        await new Promise((r) => setTimeout(r, TURN_DELAY_MS));
      }

      // ── Write segment audio via FFmpeg concat ────────────
      if (segChunks.length > 0) {
        // Write individual chunk files for FFmpeg
        for (let i = 0; i < segChunks.length; i++) {
          const chunkPath = join(
            outputDir,
            `${segment.id}-chunk${i}.mp3`,
          );
          writeFileSync(chunkPath, segChunks[i]);
          chunkPaths.push(chunkPath);
        }

        const segFile = join(outputDir, `${segment.id}.mp3`);
        try {
          concatAudio({
            inputFiles: chunkPaths,
            outputPath: segFile,
            crossfadeSeconds: 0,
          });
        } catch {
          // Fallback: raw buffer concat
          const combined = Buffer.concat(segChunks);
          writeFileSync(segFile, combined);
        }
        segAudioFiles.push(segFile);

        // Cleanup chunk files
        for (const p of chunkPaths) {
          try {
            unlinkSync(p);
          } catch {}
        }
      }
    }

    // ── Final merge: all segments → final.mp3 ──────────────
    const finalPath = join(outputDir, "final.mp3");
    if (segAudioFiles.length > 0) {
      if (segAudioFiles.length === 1) {
        copyFileSync(segAudioFiles[0], finalPath);
      } else {
        concatAudio({
          inputFiles: segAudioFiles,
          outputPath: finalPath,
          crossfadeSeconds: 0.3,
        });
      }

      // Apply loudness normalization (EBU R128, target -16 LUFS)
      try {
        const normalizedPath = join(outputDir, "final-norm.mp3");
        normalizeLoudness(finalPath, normalizedPath);
        renameSync(normalizedPath, finalPath);
      } catch {
        // Normalization failed, keep original — not fatal
      }
    }

    // ── Build AudioArtifact ────────────────────────────────
    const finalAudio = readFileSync(finalPath);
    const segmentArtifacts = segments.map((seg) => {
      const segFile = join(outputDir, `${seg.id}.mp3`);
      let audioBase64: string | undefined;
      try {
        audioBase64 = readFileSync(segFile).toString("base64");
      } catch {
        audioBase64 = undefined;
      }
      return {
        segmentId: seg.id,
        filePath: segFile,
        durationSeconds: 0,
        audioBase64,
        turnCount: seg.turns?.length || 0,
      };
    });

    const elapsedSeconds = (Date.now() - startTime) / 1000;

    return {
      filePath: finalPath,
      durationSeconds: 0,
      format,
      totalChars: allTurns.reduce(
        (sum, t) => sum + t.text.length,
        0,
      ),
      audioBase64: finalAudio.toString("base64"),
      stats: {
        successTurns: completedTurns,
        totalTurns,
        elapsedSeconds: Math.round(elapsedSeconds * 10) / 10,
        totalAudioBytes,
        estimatedCostRmb: +(totalTurns * 0.002).toFixed(4),
      },
      segments: segmentArtifacts,
    };
  }
}

export const volcPodcastProvider = new VolcPodcastTtsProvider();
