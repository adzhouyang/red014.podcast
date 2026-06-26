#!/usr/bin/env node
/**
 * P0-02: DeepSeek (via Anthropic-compatible API) Podcast Script Generator
 *
 * Usage: node generate-script.mjs <article.md> [output.json]
 *
 * Uses ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL from env.
 * Outputs a PodcastScript JSON matching PRD FR-08 schema.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, basename, dirname } from 'path';

const BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic';
const MODEL = process.env.ANTHROPIC_MODEL || 'DeepSeek-V4-pro';
const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;

if (!API_KEY) {
  console.error('ERROR: ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is not set');
  process.exit(1);
}

// ─── System Prompt ───────────────────────────────────────────
const SYSTEM_PROMPT = `你是一个专业的播客脚本写手。你的任务是将给定文章改编成一段 8–15 分钟的双人对谈播客脚本。

## 角色设定
- **主持人 A（小北）**：负责推进话题、提问、总结和控制节奏。性格干练、有好奇心。
- **主持人 B（阿深）**：负责解释、回应、举例和提出有限质疑。性格沉稳、有深度。

## 内容规则
1. 可以重排原文结构、压缩重复内容、增加自然过渡和对话性表达。
2. **禁止新增原文没有支持的关键事实。** 不要编造数据、人名、事件。
3. 保留原文的主要论点、关键例子、结论和必要限定条件。
4. 避免每段都用"是的""没错""非常有意思"等模板化回应。
5. 两个角色的句式、观点功能和语气必须有区分。
6. 加入简短开场和收束（各约30秒），不加入冗长片头。

## 输出格式（严格 JSON）
你必须输出一个符合以下结构的纯 JSON，不要包裹在 markdown 代码块中：

{
  "title": "播客标题",
  "summary": "20-40字的本期摘要",
  "target_duration_minutes": 10,
  "source_claims": [
    {"id": "claim-001", "text": "原文中的关键事实或观点"}
  ],
  "segments": [
    {
      "id": "seg-001",
      "topic": "开场",
      "turns": [
        {
          "id": "turn-001",
          "speaker": "A",
          "text": "台词内容（中文，自然口语化）",
          "delivery": "语气提示（如：自然、好奇、沉稳、惊讶）",
          "source_claim_ids": ["claim-001"]
        }
      ]
    }
  ]
}

## 要求
- 总台词字数控制在 1800-3500 字（对应 8-15 分钟中文播客）。
- 每个 turn 不超过 80 字，鼓励短回合穿插少量长解释。
- segments 不少于 3 个（开场、主体×1-3、收束）。
- 只输出 JSON，不要任何其他文字。`;

// ─── Load article ─────────────────────────────────────────────
const articlePath = process.argv[2];
if (!articlePath) {
  console.error('Usage: node generate-script.mjs <article.md> [output.json]');
  process.exit(1);
}

const articleRaw = readFileSync(resolve(articlePath), 'utf-8');
// Strip frontmatter if present
const articleContent = articleRaw.replace(/^---[\s\S]*?---\n?/, '').trim();
const outputPath = process.argv[3] || resolve(dirname(articlePath), '../output', `${basename(articlePath, '.md')}-script-v1.json`);

// ─── Call API ─────────────────────────────────────────────────
async function generateScript() {
  const startTime = Date.now();
  console.log(`Using model: ${MODEL}`);
  console.log(`Endpoint: ${BASE_URL}/v1/messages`);
  console.log(`Article: ${basename(articlePath)} (${articleContent.length} chars)`);
  console.log('Generating script...\n');

  const response = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `请将以下文章改编为双人对谈播客脚本：\n\n---\n${articleContent}\n---`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`API error ${response.status}: ${errText}`);
    process.exit(1);
  }

  const data = await response.json();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Extract token usage
  const usage = data.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  // DeepSeek returns content array with thinking + text blocks; extract all text blocks
  const textBlocks = (data.content || []).filter(c => c.type === 'text');
  const thinkingBlocks = (data.content || []).filter(c => c.type === 'thinking');
  const contentText = textBlocks.map(c => c.text).join('\n');

  // Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true });

  console.log(`✓ Completed in ${elapsed}s`);
  console.log(`  Input tokens:  ${inputTokens.toLocaleString()}`);
  console.log(`  Output tokens: ${outputTokens.toLocaleString()}`);
  console.log(`  Stop reason:   ${data.stop_reason || 'N/A'}\n`);

  // ─── Parse & Validate JSON ────────────────────────────────────
  // Save raw output for debugging
  const rawPath = outputPath.replace('.json', '-raw.txt');
  writeFileSync(rawPath, contentText, 'utf-8');

  let script;
  let jsonStr = contentText.trim();

  // Try extracting JSON: find first { and last }
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  // Strip possible markdown code fences
  jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```$/gm, '');

  try {
    script = JSON.parse(jsonStr);
  } catch (e) {
    console.error('Failed to parse JSON from model output:');
    console.error(`Raw output saved to: ${rawPath}`);
    console.error(`\nFirst 2000 chars of content:`);
    console.error(contentText.slice(0, 2000));
    console.error(`\n... Last 500 chars:`);
    console.error(contentText.slice(-500));
    process.exit(1);
  }

  // Quick validation
  const checks = [];
  if (!script.title) checks.push('  ✗ Missing title');
  else checks.push(`  ✓ Title: "${script.title}"`);
  if (!script.segments?.length) checks.push('  ✗ No segments');
  else checks.push(`  ✓ ${script.segments.length} segments, ${script.segments.reduce((s, seg) => s + (seg.turns?.length || 0), 0)} turns`);
  const totalChars = script.segments?.reduce((s, seg) => s + seg.turns?.reduce((t, turn) => t + (turn.text?.length || 0), 0), 0) || 0;
  checks.push(`  ✓ Total dialogue: ~${totalChars.toLocaleString()} chars (≈${Math.round(totalChars/250)} min)`);

  console.log('Validation:');
  console.log(checks.join('\n'));

  // ─── Write output ──────────────────────────────────────────────
  const output = {
    _meta: {
      generated_at: new Date().toISOString(),
      model: MODEL,
      endpoint: `${BASE_URL}/v1/messages`,
      article_source: basename(articlePath),
      article_chars: articleContent.length,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      elapsed_seconds: parseFloat(elapsed),
      stop_reason: data.stop_reason,
    },
    ...script,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✓ Script saved to: ${outputPath}`);

  return output;
}

generateScript().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
