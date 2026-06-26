#!/usr/bin/env node
/**
 * P1: Volcano Engine Podcast TTS (action=3 WebSocket)
 *
 * Usage:
 *   node volc-podcast.mjs <script.json> <output-dir>
 *
 * Env:
 *   VOLC_API_KEY / VOLC_ACCESS_KEY  — API key
 *   VOLC_RESOURCE_ID                 — default: volc.service_type.10050
 *   VOLC_SPEAKER_A                   — default: zh_female_mizaitongxue_v2_saturn_bigtts
 *   VOLC_SPEAKER_B                   — default: zh_male_dayixiansheng_v2_saturn_bigtts
 *
 * Reference:
 *   https://www.volcengine.com/docs/6561/1361353
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import WebSocket from 'ws';

const API_KEY = process.env.VOLC_API_KEY || process.env.VOLC_ACCESS_KEY;
const RESOURCE_ID = process.env.VOLC_RESOURCE_ID || 'volc.service_type.10050';
const WS_URL = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';
const SPEAKER_A = process.env.VOLC_SPEAKER_A || 'zh_female_mizaitongxue_v2_saturn_bigtts';
const SPEAKER_B = process.env.VOLC_SPEAKER_B || 'zh_male_dayixiansheng_v2_saturn_bigtts';

// ── Build 16B-header frame ────────────────────────────────
function buildFrame(jsonObj) {
  const payload = Buffer.from(JSON.stringify(jsonObj), 'utf-8');
  const header = Buffer.alloc(16);
  header[0] = 0x14;  // Protocol v1 (0b0001) | header_size 4 (0b0100) → 16 bytes
  header[1] = 0x10;  // Message type 1 (normal) | flags 0 (sendText)
  header[2] = 0x10;  // JSON | no compression
  header[3] = 0x00;  // Reserved
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

// ── Parse incoming frame ──────────────────────────────────
function parse(raw) {
  if (raw.length < 16) return { type: 'short', data: raw };
  const msgType = (raw[1] >> 4) & 0x0f;
  const payloadSize = raw.readUInt32BE(4);
  const payload = raw.slice(16, 16 + Math.min(payloadSize, raw.length - 16));
  if (msgType === 9) {
    try { return { type: 'json', data: JSON.parse(payload.toString()) }; }
    catch { return { type: 'text', data: payload.toString() }; }
  }
  if (msgType === 11) return { type: 'audio', data: raw.slice(16) };
  if (msgType === 15) return { type: 'error', data: payload.toString() };
  return { type: 'unknown', raw };
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  const scriptPath = process.argv[2];
  const outputDir = resolve(process.argv[3] || 'tts-output');

  if (!scriptPath) {
    console.error('Usage: node volc-podcast.mjs <script.json> <output-dir>');
    process.exit(1);
  }
  if (!API_KEY) {
    console.error('ERROR: VOLC_API_KEY or VOLC_ACCESS_KEY not set.');
    process.exit(1);
  }

  const script = JSON.parse(readFileSync(resolve(scriptPath), 'utf-8'));
  const SPEAKERS = [SPEAKER_A, SPEAKER_B];

  // Collect all turns (no 25-turn limit)
  const nlpTexts = [];
  for (const seg of script.segments || []) {
    for (const turn of seg.turns || []) {
      const speaker = SPEAKERS[turn.speaker === 'A' ? 0 : 1];
      const text = (turn.text || '').trim().slice(0, 300);
      if (text) nlpTexts.push({ text, speaker });
    }
  }

  const title = script.title || 'Untitled';
  console.log(`═══ Volcano Podcast TTS (action=3) ═══`);
  console.log(`Title:   ${title}`);
  console.log(`Turns:   ${nlpTexts.length}`);
  console.log(`SpeakerA: ${SPEAKER_A}`);
  console.log(`SpeakerB: ${SPEAKER_B}`);
  console.log(`Output:  ${outputDir}\n`);

  mkdirSync(outputDir, { recursive: true });

  return new Promise((resolveMain, rejectMain) => {
    const chunks = [];
    let audioCount = 0;
    let errorMsg = null;
    const startTime = Date.now();

    console.log('Connecting WebSocket...');
    const ws = new WebSocket(WS_URL, {
      headers: {
        'X-Api-Key': API_KEY,
        'X-Api-Resource-Id': RESOURCE_ID,
      },
    });

    ws.on('open', () => {
      console.log('✓ Connected');
      const req = {
        input_id: `r14-${Date.now()}`,
        action: 3,
        nlp_texts: nlpTexts,
        use_head_music: false,
        use_tail_music: false,
        aigc_watermark: false,
        audio_config: {
          format: 'mp3',
          sample_rate: 24000,
          speech_rate: 0,
        },
        speaker_info: {
          random_order: false,
          speakers: SPEAKERS,
        },
      };
      ws.send(buildFrame(req));
      console.log(`📤 Request sent (${nlpTexts.length} turns, ${JSON.stringify(req).length}B)`);
    });

    ws.on('message', (d) => {
      const raw = Buffer.isBuffer(d) ? d : Buffer.from(d);
      const r = parse(raw);
      if (r.type === 'json') {
        const evt = r.data.event || 'resp';
        if (evt === 'PodcastEnd') {
          console.log(`📨 PodcastEnd — closing`);
          ws.close();
        } else {
          console.log(`📨 ${evt}: ${JSON.stringify(r.data).slice(0, 200)}`);
        }
      } else if (r.type === 'audio') {
        chunks.push(r.data);
        audioCount++;
        if (audioCount % 10 === 0) process.stdout.write(`🎵${audioCount} `);
      } else if (r.type === 'error') {
        errorMsg = r.data.slice(0, 500);
        console.error(`\n❌ ${errorMsg}`);
      }
    });

    ws.on('close', (code) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n🔌 Closed (code=${code}) | ${audioCount} audio chunks | ${elapsed}s`);

      if (chunks.length === 0) {
        const err = errorMsg || 'No audio received';
        console.error(`❌ ${err}`);
        rejectMain(new Error(err));
        return;
      }

      const audio = Buffer.concat(chunks);
      const finalPath = join(outputDir, 'final.mp3');
      writeFileSync(finalPath, audio);
      console.log(`✅ ${finalPath} (${(audio.length / 1024).toFixed(1)}KB)`);

      // Write meta.json
      const meta = {
        generated_at: new Date().toISOString(),
        provider: 'volc-podcast-action3',
        resource_id: RESOURCE_ID,
        speaker_a: SPEAKER_A,
        speaker_b: SPEAKER_B,
        title,
        input_turns: nlpTexts.length,
        audio_chunks: audioCount,
        audio_bytes: audio.length,
        elapsed_seconds: parseFloat(elapsed),
        final_path: finalPath,
      };
      writeFileSync(join(outputDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
      console.log(`📋 meta.json written`);

      resolveMain({ meta, finalPath });
    });

    ws.on('error', (e) => {
      console.error(`❌ WebSocket error: ${e.message}`);
      rejectMain(e);
    });

    // 5-minute timeout
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        console.error('\n⏰ Timeout (5min)');
        ws.close();
        rejectMain(new Error('TTS timeout after 5 minutes'));
      }
    }, 300_000);
  });
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
