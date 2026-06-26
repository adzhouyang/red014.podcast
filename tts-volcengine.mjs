#!/usr/bin/env node
/**
 * P0-04: 火山引擎 TTS (v3 HTTP) — 双人播客语音合成
 *
 * Usage:
 *   node tts-volcengine.mjs <script.json> [output-dir]
 *
 * Env:
 *   VOLC_APP_ID       — 火山引擎应用 ID
 *   VOLC_API_KEY      — 火山引擎 API Key (v3 X-Api-Key header)
 *   VOLC_RESOURCE_ID  — 资源 ID, 默认 seed-tts-2.0
 *
 * Reference:
 *   https://www.volcengine.com/docs/6561/2528925
 */

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { execSync } from 'child_process';

const APP_ID = process.env.VOLC_APP_ID;
const API_KEY = process.env.VOLC_API_KEY || process.env.VOLC_ACCESS_KEY;
const RESOURCE_ID = process.env.VOLC_RESOURCE_ID || 'seed-tts-2.0';

if (!APP_ID || !API_KEY) {
  console.error('ERROR: VOLC_APP_ID and VOLC_API_KEY required.');
  process.exit(1);
}

// Speaker → Volcengine voice mapping
const VOICE_MAP = {
  A: 'zh_male_xuanyijieshuo_uranus_bigtts',   // 小北: 干练男声
  B: 'zh_female_mizai_uranus_bigtts',          // 阿深: 沉稳女声
};

const API_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';

// ─── Single turn TTS ──────────────────────────────────────────
async function synthesizeTurn(speaker, text, turnId) {
  const voice = VOICE_MAP[speaker];
  if (!voice) throw new Error(`Unknown speaker: ${speaker}`);

  const start = Date.now();
  const body = {
    req_params: {
      text,
      speaker: voice,
      audio_params: {
        format: 'mp3',
        sample_rate: 24000,
      },
    },
  };

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'X-Api-Key': API_KEY,
      'X-Api-Resource-Id': RESOURCE_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  // Response is chunked JSON lines: each line = {"code":0,"data":"<base64 mp3>"}
  const raw = await resp.text();
  const parts = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const chunk = JSON.parse(line);
      if (chunk.code === 0 && chunk.data) {
        parts.push(Buffer.from(chunk.data, 'base64'));
      }
    } catch { /* skip parse errors */ }
  }

  const audio = Buffer.concat(parts);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  return { speaker, voice, text, audio, size: audio.length, elapsed: parseFloat(elapsed) };
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  const scriptPath = process.argv[2];
  if (!scriptPath) {
    console.error('Usage: node tts-volcengine.mjs <script.json> [output-dir]');
    process.exit(1);
  }

  const scriptData = JSON.parse(readFileSync(resolve(scriptPath), 'utf-8'));
  const scriptName = basename(scriptPath, '.json');
  const outputDir = resolve(process.argv[3] || `tts-output/${scriptName}`);
  mkdirSync(outputDir, { recursive: true });

  console.log(`═══ 火山引擎 TTS v3 · 双人播客语音合成 ═══`);
  console.log(`脚本: ${scriptName}`);
  console.log(`标题: ${scriptData.title}`);
  console.log(`音色A: ${VOICE_MAP.A}`);
  console.log(`音色B: ${VOICE_MAP.B}`);
  console.log(`输出: ${outputDir}\n`);

  let totalTurns = 0, successTurns = 0, failTurns = 0;
  let totalAudioSize = 0;
  const startTime = Date.now();
  const segAudioFiles = [];

  for (const segment of scriptData.segments || []) {
    const segNum = (scriptData.segments.indexOf(segment) + 1);
    const segId = segment.id || `seg-${String(segNum).padStart(3, '0')}`;
    console.log(`\n─── [${segId}] ${segment.topic} ───`);

    const segChunks = [];

    for (const turn of segment.turns || []) {
      totalTurns++;
      const prefix = turn.id || `t${totalTurns}`;
      process.stdout.write(`  ${prefix} ${turn.speaker}: ${turn.text.slice(0, 30)}... `);

      try {
        const result = await synthesizeTurn(turn.speaker, turn.text, turn.id);
        successTurns++;
        totalAudioSize += result.size;

        const fname = `${prefix}-${turn.speaker}.mp3`;
        writeFileSync(resolve(outputDir, fname), result.audio);
        segChunks.push(result.audio);

        console.log(`✓ ${result.size}B ${result.elapsed}s`);
      } catch (err) {
        failTurns++;
        console.log(`✗ ${err.message}`);
      }

      // API rate limit: small delay between turns
      await new Promise(r => setTimeout(r, 200));
    }

    // Merge segment audio
    if (segChunks.length > 0) {
      // Write concat list for ffmpeg
      const listPath = resolve(outputDir, `${segId}-list.txt`);
      const concatLines = segChunks.map((_, i) => {
        const fname = resolve(outputDir, `${segId}-chunk${i}.mp3`);
        writeFileSync(fname, segChunks[i]);
        return `file '${fname}'`;
      });
      writeFileSync(listPath, concatLines.join('\n'));

      const segFile = resolve(outputDir, `${segId}.mp3`);
      try {
        execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${segFile}" 2>/dev/null`);
        segAudioFiles.push(segFile);
        console.log(`  ▶ ${segId}.mp3 (${segChunks.length} turns)`);
      } catch {
        // Fallback: raw concat
        const combined = Buffer.concat(segChunks);
        writeFileSync(segFile, combined);
        segAudioFiles.push(segFile);
        console.log(`  ▶ ${segId}.mp3 (raw concat, ${segChunks.length} turns)`);
      }

      // Clean up chunks
      for (let i = 0; i < segChunks.length; i++) {
        try { execSync(`rm "${resolve(outputDir, `${segId}-chunk${i}.mp3`)}"`); } catch {}
      }
      try { execSync(`rm "${listPath}"`); } catch {}
    }
  }

  // ─── Final merge: all segments → full podcast ────────────────
  let finalPath = '';
  if (segAudioFiles.length > 0) {
    finalPath = resolve(outputDir, 'final.mp3');
    const finalList = resolve(outputDir, 'final-list.txt');
    const lines = segAudioFiles.map(f => `file '${f}'`).join('\n');
    writeFileSync(finalList, lines);
    try {
      execSync(`ffmpeg -y -f concat -safe 0 -i "${finalList}" -c copy "${finalPath}" 2>/dev/null`);
      console.log(`\n✅ final.mp3 ready`);
    } catch {
      const allAudio = Buffer.concat(segAudioFiles.map(f => readFileSync(f)));
      writeFileSync(finalPath, allAudio);
      console.log(`\n✅ final.mp3 ready (raw)`);
    }
    execSync(`rm "${finalList}"`, () => {});
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ─── Metadata ─────────────────────────────────────────────
  const meta = {
    generated_at: new Date().toISOString(),
    script_source: scriptName,
    title: scriptData.title,
    api: { url: API_URL, resource_id: RESOURCE_ID, voice_map: VOICE_MAP },
    stats: {
      total_turns: totalTurns,
      success_turns: successTurns,
      fail_turns: failTurns,
      total_audio_bytes: totalAudioSize,
      elapsed_seconds: parseFloat(elapsed),
      estimated_cost: (totalTurns * 0.002).toFixed(4) + ' RMB (est.)',
    },
    files: {
      individual_turns: `${outputDir}/`,
      segments: segAudioFiles.map(f => basename(f)),
      final: finalPath ? basename(finalPath) : null,
    },
  };
  writeFileSync(resolve(outputDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

  console.log(`\n═══════════════════════════════════════`);
  console.log(`总turns: ${totalTurns}  |  成功: ${successTurns}  |  失败: ${failTurns}`);
  console.log(`总耗时: ${elapsed}s  |  音频: ${(totalAudioSize / 1024).toFixed(1)} KB`);
  console.log(`输出目录: ${outputDir}`);
  if (finalPath) console.log(`最终文件: ${finalPath}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
