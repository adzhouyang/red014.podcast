// ─── Script Provider Registry ──────────────────────────
import type { ScriptProvider } from "./interface";
import { AnthropicScriptProvider } from "./anthropic";
import { OpenAIScriptProvider } from "./openai";
import { hermesProvider } from "./hermes";
import { geminiProvider } from "./gemini";

const anthropicProvider = new AnthropicScriptProvider();
const openaiProvider = new OpenAIScriptProvider();

const registry: Record<string, ScriptProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  hermes: hermesProvider,
  gemini: geminiProvider,
};

export function getScriptProvider(name: string): ScriptProvider | undefined {
  return registry[name];
}

export function listScriptProviders(): Array<{ name: string; models: string[] }> {
  return Object.entries(registry).map(([name, p]) => ({
    name,
    models: p.models,
  }));
}

// Re-export prompt utilities for convenience
export { getPrompt, listPrompts } from "./prompts/resolver";
