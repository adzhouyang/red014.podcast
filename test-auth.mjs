#!/usr/bin/env node
/**
 * P0-04: Try with X-Api-App-Key header + different combos
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import WebSocket from 'ws';

const ACCESS_KEY = process.env.VOLC_API_KEY || process.env.VOLC_ACCESS_KEY;
const APP_ID = process.env.VOLC_APP_ID || '';
const RESOURCE_ID = process.env.VOLC_RESOURCE_ID || 'volc.service_type.10050';
const APP_KEY = process.env.VOLC_APP_KEY || '';

if (!ACCESS_KEY) {
  console.error('ERROR: VOLC_API_KEY or VOLC_ACCESS_KEY not set.');
  process.exit(1);
}
const WS_URL = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';

// Test different header combinations
const HEADER_COMBOS = [
  // Combo 1: Old console style (all 4 headers)
  { 'X-Api-App-Id': APP_ID, 'X-Api-Access-Key': ACCESS_KEY, 'X-Api-Resource-Id': RESOURCE_ID, 'X-Api-App-Key': APP_KEY },
  // Combo 2: New console style + app key
  { 'X-Api-Key': ACCESS_KEY, 'X-Api-Resource-Id': RESOURCE_ID, 'X-Api-App-Key': APP_KEY },
];

async function testCombo(headers, label) {
  return new Promise((resolve) => {
    console.log(`\n🧪 ${label}`);
    const ws = new WebSocket(WS_URL, { headers });
    ws.on('open', () => {
      console.log('  ✅ connected');
      // Try sending simple JSON first to see auth response
      const body = JSON.stringify({ input_id: 't1', action: 0, input_text: '你好', use_head_music: false, use_tail_music: false, audio_config: { format: 'mp3', sample_rate: 24000 }, speaker_info: { random_order: true, speakers: ['zh_female_mizaitongxue_v2_saturn_bigtts', 'zh_male_dayixiansheng_v2_saturn_bigtts'] } });
      ws.send(body);
    });
    ws.on('message', (d) => {
      const s = d.toString('utf-8');
      console.log(`  📨 ${s.slice(0, 200)}`);
      resolve(s);
      ws.close();
    });
    ws.on('error', (e) => { console.log(`  ❌ ${e.message}`); resolve(null); });
    setTimeout(() => { console.log('  ⏰ timeout'); resolve(null); ws.close(); }, 8000);
  });
}

async function main() {
  // Test combo 1
  let result = await testCombo(HEADER_COMBOS[0], 'Combo1: Old console (all 4 headers)');
  if (result && !result.includes('error')) {
    console.log('\n✅ Combo1 works! Auth is correct.');
    return;
  }
  
  // Test combo 2
  result = await testCombo(HEADER_COMBOS[1], 'Combo2: New console (X-Api-Key + App-Key)');
  
  console.log('\nDone.');
}

main();
