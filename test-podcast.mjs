#!/usr/bin/env node
/**
 * P0-04: Volcano Engine Podcast TTS - debug mode
 * Test action=0 first to verify connectivity
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import WebSocket from 'ws';
import crypto from 'crypto';

const ACCESS_KEY = process.env.VOLC_API_KEY || process.env.VOLC_ACCESS_KEY;
if (!ACCESS_KEY) {
  console.error('ERROR: VOLC_API_KEY or VOLC_ACCESS_KEY not set.');
  process.exit(1);
}
const RESOURCE_ID = 'volc.service_type.10050';
const WS_URL = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';

const SPEAKERS = [
  'zh_female_mizaitongxue_v2_saturn_bigtts',
  'zh_male_dayixiansheng_v2_saturn_bigtts',
];

// ─── Test 1: Simple action=0 (text summary) ─────────────
function testAction0() {
  return new Promise((resolve, reject) => {
    const reqId = crypto.randomUUID();
    console.log(`\n🧪 Test: action=0, connect_id=${reqId.slice(0,8)}`);

    const ws = new WebSocket(WS_URL, {
      headers: {
        'X-Api-Key': ACCESS_KEY,
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-Connect-Id': reqId,
      },
    });

    ws.on('open', () => {
      console.log('✅ Connected');
      const req = {
        input_id: `test-${Date.now()}`,
        input_text: '你好，请简单介绍一下人工智能。',
        action: 0,
        use_head_music: false,
        use_tail_music: false,
        aigc_watermark: false,
        audio_config: { format: 'mp3', sample_rate: 24000 },
        speaker_info: { random_order: false, speakers: SPEAKERS },
      };
      ws.send(JSON.stringify(req));
      console.log('📤 Sent JSON text mode');
      setTimeout(() => {
        // Also try binary mode
        console.log('📤 Trying binary mode...');
        const payload = Buffer.from(JSON.stringify(req), 'utf-8');
        const frame = Buffer.alloc(8 + payload.length);
        frame[0] = 0x11; frame[1] = 0x10; frame[2] = 0x10; frame[3] = 0x00;
        frame.writeUInt32BE(payload.length, 4);
        payload.copy(frame, 8);
        ws.send(frame);
      }, 3000);
    });

    ws.on('message', (data) => {
      const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
      console.log(`📦 rx ${raw.length}B: ${raw.slice(0, Math.min(50, raw.length)).toString('hex')}`);
      if (raw.length < 500) console.log(`   text: ${raw.toString('utf-8').slice(0, 300)}`);
      resolve(raw);
      ws.close();
    });

    ws.on('error', (e) => { console.error(`❌ ${e.message}`); reject(e); });
    setTimeout(() => { console.log('⏰ 10s timeout'); ws.close(); reject(new Error('timeout')); }, 10000);
  });
}

// ─── Main ────────────────────────────────────────────────
testAction0()
  .then(raw => {
    console.log(`\n✅ Got response: ${raw.length}B`);
    // Try to save if it's audio
    const outPath = resolve(process.argv[3] || 'output/p0-04-test.mp3');
    writeFileSync(outPath, raw);
    console.log(`Saved: ${outPath}`);
  })
  .catch(err => {
    console.error(`\n❌ Failed: ${err.message}`);
  });
