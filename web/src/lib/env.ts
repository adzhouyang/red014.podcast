// ─── Environment Config ────────────────────────────────
// PRD 9.1: API keys from env vars only, never in source or logs

export function getEnv(): {
  anthropicKey?: string;
  openaiKey?: string;
  volcAppId?: string;
  volcApiKey?: string;
  dataDir: string;
} {
  return {
    anthropicKey: process.env.ANTHROPIC_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    volcAppId: process.env.VOLC_APP_ID,
    volcApiKey: process.env.VOLC_API_KEY,
    dataDir: process.env.RED014_DATA_DIR || "./data",
  };
}

/** Check which providers are available based on configured keys */
export function availableProviders(): {
  scripts: string[];
  tts: string[];
} {
  const env = getEnv();
  return {
    scripts: [
      ...(env.anthropicKey ? ["anthropic"] : []),
      ...(env.openaiKey ? ["openai"] : []),
      // Hermes: check if compatible endpoint is configured
      ...(process.env.HERMES_API_KEY ? ["hermes"] : []),
      // Gemini: check if API key is configured
      ...(process.env.GEMINI_API_KEY ? ["gemini"] : []),
    ],
    tts: [
      ...(env.volcAppId && env.volcApiKey ? ["volc-podcast"] : []),
      ...(env.openaiKey ? ["openai"] : []),
    ],
  };
}
