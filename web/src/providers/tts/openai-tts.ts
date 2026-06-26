// ─── OpenAI TTS Provider (stub) ───────────────────────
// PRD 6.4: Fallback TTS via OpenAI TTS API

import type { AudioArtifact, PodcastRenderInput, SpeakerPair, TtsProvider } from "./interface";

const SPEAKER_PAIRS: SpeakerPair[] = [
  { name: "Alloy × Echo", speakers: ["alloy", "echo"] },
  { name: "Nova × Fable", speakers: ["nova", "fable"] },
  { name: "Onyx × Shimmer", speakers: ["onyx", "shimmer"] },
];

export const openaiTtsProvider: TtsProvider = {
  name: "openai-tts",
  speakerPairs: SPEAKER_PAIRS,

  async listSpeakers(): Promise<SpeakerPair[]> {
    return SPEAKER_PAIRS;
  },

  async renderPodcast(_input: PodcastRenderInput): Promise<AudioArtifact> {
    // TODO: OpenAI TTS → per-turn synthesis → FFmpeg concatenation
    // Unlike volc-podcast, must split by speaker and stitch fragments
    throw new Error("OpenAI TTS not implemented");
  },
};
