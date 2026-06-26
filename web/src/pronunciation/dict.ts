// ─── Pronunciation Dictionary ───────────────────────
// PRD 9.4: Term → pronunciation replacement for TTS accuracy
//
// Apply longest-match-first term replacement before sending
// text to any TTS engine. Helps with acronyms, proper nouns,
// and terms that TTS engines frequently mispronounce.

export type PronunciationDict = Record<string, string>;

/** Built-in defaults for common terms */
export const DEFAULT_DICT: PronunciationDict = {
  AI: "人工智能",
  LLM: "大语言模型",
  API: "接口",
  SDK: "开发工具包",
  GPU: "图形处理器",
  CPU: "处理器",
  NLP: "自然语言处理",
  TTS: "语音合成",
  ASR: "语音识别",
  RAG: "检索增强生成",
  RLHF: "基于人类反馈的强化学习",
  ChatGPT: "ChatGPT",
  GPT: "GPT",
  DeepSeek: "DeepSeek",
  NotebookLM: "NotebookLM",
  Spotify: "Spotify",
  Apple: "苹果",
  OKR: "目标和关键成果",
  SaaS: "软件即服务",
  MVP: "最小可行产品",
  PRD: "产品需求文档",
  UI: "用户界面",
  UX: "用户体验",
};

/**
 * Apply pronunciation dictionary to text.
 * Uses longest-match-first strategy to avoid partial
 * replacements (e.g., "GPT-4" before "GPT").
 */
export function applyDict(
  text: string,
  dict: PronunciationDict,
): string {
  let result = text;

  // Sort terms by length descending for longest-match-first
  const terms = Object.keys(dict).sort((a, b) => b.length - a.length);

  for (const term of terms) {
    const replacement = dict[term];
    // Match whole word (not part of a longer word)
    // Use word boundary check: preceded by non-alphanumeric or start,
    // followed by non-alphanumeric or end
    const regex = new RegExp(
      `(?<![a-zA-Z0-9\\u4e00-\\u9fff])${escapeRegex(term)}(?![a-zA-Z0-9\\u4e00-\\u9fff])`,
      "g",
    );
    result = result.replace(regex, replacement);
  }

  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Merge user dictionary with defaults.
 * User entries override defaults.
 */
export function mergeDict(
  userDict: PronunciationDict,
): PronunciationDict {
  return { ...DEFAULT_DICT, ...userDict };
}
