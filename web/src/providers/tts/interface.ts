// ─── TTS Provider Interface ────────────────────────────
// PRD 11.4: Unified interface for all TTS engines

import type { Segment } from "@/podcast/schema";

export interface SpeakerPair {
  name: string;
  speakers: [string, string];
}

export interface PodcastRenderInput {
  segments: Segment[];
  speakers: [string, string];
  format: "mp3" | "ogg_opus";
  speechRate?: number;
  jobId?: string;
}

export interface AudioArtifact {
  /** Path to the final audio file */
  filePath: string;
  /** Duration in seconds */
  durationSeconds: number;
  /** Output format */
  format: string;
  /** Total characters rendered */
  totalChars: number;
  /** Base64-encoded audio data */
  audioBase64?: string;
  /** Stats about synthesis */
  stats?: {
    successTurns: number;
    totalTurns: number;
    elapsedSeconds: number;
    totalAudioBytes: number;
    estimatedCostRmb: number;
  };
  /** Per-segment artifacts (for fragment-level retry) */
  segments?: Array<{
    segmentId: string;
    filePath: string;
    durationSeconds: number;
    audioBase64?: string;
    turnCount?: number;
  }>;
}

export interface TtsProgress {
  completedTurns: number;
  totalTurns: number;
  currentTurn?: string;
  currentSpeaker?: string;
  failedTurns: number;
}

export interface TtsProvider {
  readonly name: string;
  readonly speakerPairs: SpeakerPair[];

  /** List available speaker pairings */
  listSpeakers(): Promise<SpeakerPair[]>;

  /** Render full podcast audio from script segments */
  renderPodcast(input: PodcastRenderInput): Promise<AudioArtifact>;
}
