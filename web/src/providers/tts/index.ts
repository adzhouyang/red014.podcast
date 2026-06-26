// ─── TTS Provider Registry ─────────────────────────────
import type { TtsProvider } from "./interface";
import { volcPodcastProvider } from "./volc-podcast";
import { openaiTtsProvider } from "./openai-tts";

const registry: Record<string, TtsProvider> = {
  "volc-podcast": volcPodcastProvider,
  "openai-tts": openaiTtsProvider,
};

export function getTtsProvider(name: string): TtsProvider | undefined {
  return registry[name];
}

export function listTtsProviders(): Array<{ name: string; speakerPairs: number }> {
  return Object.entries(registry).map(([name, p]) => ({
    name,
    speakerPairs: p.speakerPairs.length,
  }));
}
