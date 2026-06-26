// ─── Volcano Engine V3 HTTP TTS Client ───────────────────
// PRD 7.3: Single-turn TTS synthesis via V3 HTTP unidirectional API.
//
// This is the low-level HTTP client. It handles:
//   1. Request construction (speaker, text, audio params)
//   2. Chunked JSON-line response parsing (base64 → Buffer)
//   3. Retry with exponential backoff
//
// Reference: https://www.volcengine.com/docs/6561/2528925
//
// Env: VOLC_API_KEY, VOLC_RESOURCE_ID (default: seed-tts-2.0)

const API_KEY =
  process.env.VOLC_API_KEY || process.env.VOLC_ACCESS_KEY || "";
const RESOURCE_ID = process.env.VOLC_RESOURCE_ID || "seed-tts-2.0";
const API_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";

export interface V3SynthesisRequest {
  /** The text to synthesize (max ~500 chars per turn per PRD) */
  text: string;
  /** Volcengine voice ID (e.g. zh_male_xuanyijieshuo_uranus_bigtts) */
  voice: string;
  /** Output audio format */
  format?: "mp3" | "wav" | "ogg_opus";
  /** Sample rate (default 24000) */
  sampleRate?: 8000 | 16000 | 24000;
}

export interface V3SynthesisResult {
  /** The synthesized audio buffer */
  audio: Buffer;
  /** Size in bytes */
  size: number;
  /** Elapsed seconds */
  elapsedSeconds: number;
}

export class VolcengineV3Error extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "VolcengineV3Error";
  }
}

/**
 * Synthesize a single turn via V3 HTTP API.
 *
 * Returns the audio buffer. Throws VolcengineV3Error on failure.
 */
export async function synthesize(
  request: V3SynthesisRequest,
): Promise<V3SynthesisResult> {
  if (!API_KEY) {
    throw new VolcengineV3Error(
      "VOLC_API_KEY not set. Set it in .env.local or environment.",
    );
  }

  const { text, voice, format = "mp3", sampleRate = 24000 } = request;

  if (!text || text.trim().length === 0) {
    throw new VolcengineV3Error("Text must not be empty");
  }

  const start = Date.now();

  const body = {
    req_params: {
      text,
      speaker: voice,
      audio_params: {
        format,
        sample_rate: sampleRate,
      },
    },
  };

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "X-Api-Key": API_KEY,
      "X-Api-Resource-Id": RESOURCE_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "Unknown error");
    throw new VolcengineV3Error(
      `Volc TTS HTTP ${resp.status}: ${errText.slice(0, 200)}`,
      resp.status,
    );
  }

  const raw = await resp.text();
  const parts: Buffer[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const chunk = JSON.parse(trimmed);
      if (chunk.code === 0 && chunk.data) {
        parts.push(Buffer.from(chunk.data, "base64"));
      }
    } catch {
      // Skip unparseable lines
    }
  }

  if (parts.length === 0) {
    throw new VolcengineV3Error(
      `No audio data in V3 response (text: "${text.slice(0, 50)}...")`,
    );
  }

  const audio = Buffer.concat(parts);
  const elapsed = (Date.now() - start) / 1000;

  return {
    audio,
    size: audio.length,
    elapsedSeconds: Math.round(elapsed * 10) / 10,
  };
}

/**
 * Synthesize with retry and exponential backoff.
 */
export async function synthesizeWithRetry(
  request: V3SynthesisRequest,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
): Promise<V3SynthesisResult> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await synthesize(request);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new VolcengineV3Error("Synthesis failed after retries");
}

/** Check if Volcengine API credentials are configured */
export function isConfigured(): boolean {
  return !!API_KEY;
}

/** Get the configured resource ID */
export function getResourceId(): string {
  return RESOURCE_ID;
}
