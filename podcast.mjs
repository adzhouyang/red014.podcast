#!/usr/bin/env node
/**
 * Phase 1: Podcast CLI — 一条命令：input → final.mp3
 *
 * Usage:
 *   node podcast.mjs <article.md>              Full pipeline: script + TTS
 *   node podcast.mjs <article.md> --skip-tts   Script + manifest only
 *   node podcast.mjs <script.json> --script    Use existing script, TTS only
 *   node podcast.mjs <article.md> --model <m>  Override ANTHROPIC_MODEL
 *   node podcast.mjs <article.md> --tts seed   Use per-turn Seed TTS (v3 HTTP)
 *
 * Env:
 *   ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN   Script generation
 *   ANTHROPIC_BASE_URL                          Default: https://api.deepseek.com/anthropic
 *   ANTHROPIC_MODEL                             Default: DeepSeek-V4-pro
 *   VOLC_API_KEY / VOLC_ACCESS_KEY              TTS
 *   VOLC_RESOURCE_ID                            Default: volc.service_type.10050
 *
 * Output:
 *   jobs/<job-id>/
 *     manifest.json       — full run record
 *     source/             — input.md, cleaned.txt
 *     scripts/v1.json     — generated podcast script
 *     audio/final.mp3     — final synthesized audio
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { resolve, basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import crypto from 'crypto';

// ─── Config ──────────────────────────────────────────────
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const SCRIPT_GEN = join(PROJECT_ROOT, 'generate-script.mjs');
const TTS_SEED = join(PROJECT_ROOT, 'tts-volcengine.mjs');
const TTS_PODCAST = join(PROJECT_ROOT, 'volc-podcast.mjs');
const JOBS_ROOT = join(PROJECT_ROOT, 'jobs');

// ─── Validate Podcast Script JSON Schema ─────────────────
function validateScript(script) {
  const errors = [];

  if (!script.title || typeof script.title !== 'string') errors.push('missing title');
  if (!script.summary || typeof script.summary !== 'string') errors.push('missing summary');
  if (!script.target_duration_minutes || typeof script.target_duration_minutes !== 'number')
    errors.push('missing target_duration_minutes');

  if (!Array.isArray(script.source_claims)) errors.push('source_claims must be array');
  else {
    script.source_claims.forEach((c, i) => {
      if (!c.id) errors.push(`claim[${i}]: missing id`);
      if (!c.text) errors.push(`claim[${i}]: missing text`);
    });
  }

  if (!Array.isArray(script.segments)) errors.push('segments must be array');
  else if (script.segments.length < 2) errors.push('need at least 2 segments');
  else {
    script.segments.forEach((seg, si) => {
      if (!seg.id) errors.push(`segment[${si}]: missing id`);
      if (!Array.isArray(seg.turns)) errors.push(`segment[${si}]: missing turns`);
      else {
        seg.turns.forEach((turn, ti) => {
          if (!turn.id) errors.push(`${seg.id}.turn[${ti}]: missing id`);
          if (!turn.speaker || !['A', 'B'].includes(turn.speaker))
            errors.push(`${seg.id}.turn[${ti}]: invalid speaker "${turn.speaker}"`);
          if (!turn.text || typeof turn.text !== 'string')
            errors.push(`${seg.id}.turn[${ti}]: missing text`);
          if (turn.text.length > 500)
            errors.push(`${seg.id}.turn[${ti}]: text too long (${turn.text.length} > 500)`);
        });
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

// ─── Cost estimation ─────────────────────────────────────
function estimateCost(script, ttsStats) {
  const inputTokens = script._meta?.input_tokens || 0;
  const outputTokens = script._meta?.output_tokens || 0;
  // DeepSeek pricing (approx RMB per 1M tokens)
  const scriptCost = +(inputTokens * 0.000001 + outputTokens * 0.000002).toFixed(4);
  // TTS: podcast action=3 approx ¥0.01/turn
  const ttsCost = +((ttsStats?.total_turns || 0) * 0.01).toFixed(4);
  return { script: scriptCost, tts: ttsCost, total: +(scriptCost + ttsCost).toFixed(4) };
}

// ─── Safe spawn ──────────────────────────────────────────
function runNode(scriptPath, args, label, timeoutMs = 600_000) {
  const proc = spawnSync('node', [scriptPath, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    stdio: ['inherit', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
  // Forward output
  if (proc.stdout) {
    const lines = proc.stdout.trim().split('\n');
    const tail = lines.slice(-20).join('\n');
    if (lines.length > 20) console.log('   ... (output truncated, showing last 20 lines)');
    console.log(tail);
  }
  if (proc.stderr) {
    const stderrLines = proc.stderr.trim().split('\n');
    stderrLines.slice(-10).forEach(l => console.error(`   [stderr] ${l}`));
  }
  if (proc.error || proc.status !== 0) {
    const detail = proc.stderr?.slice(-300) || proc.error?.message || `exit ${proc.status}`;
    throw new Error(`${label}: ${detail}`);
  }
  return proc;
}

// ─── Parse CLI args ──────────────────────────────────────
function parseArgs() {
  const args = { input: null, skipTts: false, existingScript: false, model: null, ttsMode: 'podcast' };

  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--skip-tts') args.skipTts = true;
    else if (a === '--script') args.existingScript = true;
    else if (a === '--model' && process.argv[i + 1]) { args.model = process.argv[++i]; }
    else if (a === '--tts' && process.argv[i + 1]) {
      const mode = process.argv[++i];
      if (mode !== 'podcast' && mode !== 'seed') {
        console.error(`Unknown TTS mode: ${mode}. Use "podcast" or "seed".`);
        process.exit(1);
      }
      args.ttsMode = mode;
    }
    else if (!a.startsWith('--') && !args.input) args.input = a;
  }
  return args;
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  const args = parseArgs();

  if (!args.input) {
    console.error('Usage: node podcast.mjs <article.md|script.json> [--skip-tts] [--script] [--model <name>] [--tts podcast|seed]');
    console.error('');
    console.error('  --skip-tts    Generate script only, skip TTS');
    console.error('  --script      Input is a pre-generated script JSON, skip generation');
    console.error('  --model <m>   Override ANTHROPIC_MODEL');
    console.error('  --tts <mode>  "podcast" (action=3, default) or "seed" (per-turn v3 HTTP)');
    process.exit(1);
  }

  const inputAbs = resolve(args.input);
  if (!existsSync(inputAbs)) {
    console.error(`File not found: ${inputAbs}`);
    process.exit(1);
  }

  // ─── Create job directory ───────────────────────────────
  const jobId = `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const jobDir = join(JOBS_ROOT, jobId);
  mkdirSync(jobDir, { recursive: true });
  mkdirSync(join(jobDir, 'source'), { recursive: true });
  mkdirSync(join(jobDir, 'scripts'), { recursive: true });
  mkdirSync(join(jobDir, 'audio'), { recursive: true });

  const scriptOutPath = join(jobDir, 'scripts', 'v1.json');

  console.log(`═══ Red014.Podcast · Phase 1 Pipeline ═══`);
  console.log(`Job:     ${jobId}`);
  console.log(`Input:   ${basename(args.input)}`);
  console.log(`TTS:     ${args.skipTts ? 'skipped' : args.ttsMode}`);
  console.log(`Output:  ${jobDir}`);

  const manifest = {
    job_id: jobId,
    started_at: new Date().toISOString(),
    completed_at: null,
    status: 'running',
    source_type: args.existingScript ? 'script_json' : 'article',
    source_path: basename(args.input),
    source_chars: 0,
    script_path: null,
    script_model: null,
    script_generation_meta: null,
    validation: null,
    tts_provider: null,
    speaker_a: null,
    speaker_b: null,
    audio_dir: null,
    final_audio: null,
    tts_stats: null,
    cost: null,
    errors: [],
  };

  // ─── Helper: persist manifest after each step ────────────
  function saveManifest() {
    manifest.updated_at = new Date().toISOString();
    writeFileSync(join(jobDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  }

  // ─── Step 1: Script Generation ─────────────────────────
  if (args.existingScript) {
    console.log(`\n▶ Step 1/3: Using existing script...`);
    // Copy existing script into job dir
    writeFileSync(scriptOutPath, readFileSync(inputAbs, 'utf-8'));
    manifest.source_chars = 0;
    manifest.script_path = 'scripts/v1.json';
    manifest.steps = { script_gen: { status: 'skipped_existing', source: basename(args.input) } };
    saveManifest();
  } else {
    // Copy source file
    const articleContent = readFileSync(inputAbs, 'utf-8');
    const cleaned = articleContent.replace(/^---[\s\S]*?---\n?/, '').trim();
    writeFileSync(join(jobDir, 'source', basename(args.input)), articleContent, 'utf-8');
    writeFileSync(join(jobDir, 'source', 'cleaned.txt'), cleaned, 'utf-8');
    manifest.source_chars = cleaned.length;

    console.log(`\n▶ Step 1/3: Generate script...`);
    console.log(`   Article: ${cleaned.length} chars`);

    // Build script gen args
    const genArgs = [inputAbs, scriptOutPath];
    // If model override, set env var for this spawn
    const genEnv = { ...process.env };
    if (args.model) genEnv.ANTHROPIC_MODEL = args.model;
    manifest.script_model = args.model || genEnv.ANTHROPIC_MODEL || 'DeepSeek-V4-pro';

    const startTime = Date.now();
    try {
      const proc = spawnSync('node', [SCRIPT_GEN, ...genArgs], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: ['inherit', 'pipe', 'pipe'],
        timeout: 300_000,
        env: genEnv,
      });
      if (proc.stdout) {
        const lines = proc.stdout.trim().split('\n');
        const tail = lines.slice(-20).join('\n');
        if (lines.length > 20) console.log('   ... (truncated)');
        console.log(tail);
      }
      if (proc.stderr) {
        proc.stderr.trim().split('\n').slice(-5).forEach(l => console.error(`   [stderr] ${l}`));
      }
      if (proc.error || proc.status !== 0) {
        throw new Error(proc.stderr?.slice(-300) || proc.error?.message || `exit ${proc.status}`);
      }
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      manifest.steps = {
        ...manifest.steps,
        script_gen: {
          status: 'ok',
          elapsed_seconds: parseFloat(elapsed),
          model: manifest.script_model,
          output: 'scripts/v1.json',
        },
      };
      manifest.script_path = 'scripts/v1.json';
      saveManifest();
    } catch (err) {
      manifest.status = 'failed';
      manifest.errors.push(`script_gen: ${err.message}`);
      manifest.steps = { ...manifest.steps, script_gen: { status: 'failed', error: err.message } };
      saveManifest();
      console.error(`\n❌ Script generation failed. Check ${jobDir}/manifest.json`);
      process.exit(1);
    }
  }

  // ─── Step 2: Validate script ────────────────────────────
  const scriptData = JSON.parse(readFileSync(scriptOutPath, 'utf-8'));
  const validation = validateScript(scriptData);
  manifest.validation = validation;
  console.log(`\n▶ Step 2/3: Validation: ${validation.valid ? '✅ PASS' : '❌ FAIL'}`);
  if (!validation.valid) {
    validation.errors.forEach(e => console.log(`   - ${e}`));
    manifest.errors.push(`validation: ${validation.errors.join('; ')}`);
    // Continue — allow manual fix
  }
  saveManifest();

  // ─── Extract script metadata ────────────────────────────
  manifest.script_generation_meta = scriptData._meta || null;
  if (scriptData._meta) {
    manifest.script_model = scriptData._meta.model || manifest.script_model;
  }

  // ─── Step 3: TTS Synthesis ──────────────────────────────
  if (args.skipTts) {
    console.log('\n⏭  TTS skipped (--skip-tts)');
    manifest.status = 'completed_script_only';
    manifest.tts_provider = 'skipped';
    saveManifest();
  } else {
    console.log(`\n▶ Step 3/3: Synthesize audio (${args.ttsMode})...`);

    const ttsEngine = args.ttsMode === 'seed' ? TTS_SEED : TTS_PODCAST;
    const ttsLabel = args.ttsMode === 'seed' ? 'Seed TTS v3 HTTP' : 'Podcast TTS action=3';
    const audioDir = join(jobDir, 'audio');
    manifest.audio_dir = 'audio';

    // Speakers
    manifest.speaker_a = args.ttsMode === 'seed'
      ? 'zh_male_xuanyijieshuo_uranus_bigtts'
      : (process.env.VOLC_SPEAKER_A || 'zh_female_mizaitongxue_v2_saturn_bigtts');
    manifest.speaker_b = args.ttsMode === 'seed'
      ? 'zh_female_mizai_uranus_bigtts'
      : (process.env.VOLC_SPEAKER_B || 'zh_male_dayixiansheng_v2_saturn_bigtts');
    manifest.tts_provider = `volc-${args.ttsMode}`;

    const startTime = Date.now();
    try {
      const ttsProc = spawnSync('node', [ttsEngine, scriptOutPath, audioDir], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        stdio: ['inherit', 'pipe', 'pipe'],
        timeout: 600_000,
      });
      if (ttsProc.stdout) {
        const lines = ttsProc.stdout.trim().split('\n');
        const tail = lines.slice(-20).join('\n');
        if (lines.length > 20) console.log('   ... (truncated)');
        console.log(tail);
      }
      if (ttsProc.stderr) {
        ttsProc.stderr.trim().split('\n').slice(-5).forEach(l => console.error(`   [stderr] ${l}`));
      }
      if (ttsProc.error || ttsProc.status !== 0) {
        throw new Error(ttsProc.stderr?.slice(-300) || ttsProc.error?.message || `exit ${ttsProc.status}`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // Try reading TTS meta.json
      const ttsMetaPath = join(audioDir, 'meta.json');
      let ttsStats = null;
      try {
        const ttsMeta = JSON.parse(readFileSync(ttsMetaPath, 'utf-8'));
        ttsStats = {
          total_turns: ttsMeta.input_turns || 0,
          success_turns: ttsMeta.input_turns || 0,
          fail_turns: 0,
          total_audio_bytes: ttsMeta.audio_bytes || 0,
          elapsed_seconds: ttsMeta.elapsed_seconds || parseFloat(elapsed),
          estimated_cost: ttsMeta.input_turns
            ? `¥${(ttsMeta.input_turns * 0.01).toFixed(4)}`
            : 'N/A',
        };
      } catch {
        ttsStats = {
          total_turns: 0,
          success_turns: 0,
          fail_turns: 0,
          total_audio_bytes: 0,
          elapsed_seconds: parseFloat(elapsed),
          estimated_cost: 'N/A',
        };
      }

      manifest.tts_stats = ttsStats;
      manifest.final_audio = 'audio/final.mp3';
      manifest.cost = estimateCost(scriptData, ttsStats);
      manifest.status = 'completed';
      saveManifest();
    } catch (err) {
      manifest.status = 'failed_tts';
      manifest.errors.push(`tts: ${err.message}`);
      saveManifest();
      console.error(`\n❌ TTS failed. Script saved at ${scriptOutPath}. Check manifest.`);
      process.exit(1);
    }
  }

  // ─── Finalize ──────────────────────────────────────────
  if (manifest.status === 'running') manifest.status = 'completed';
  manifest.completed_at = new Date().toISOString();
  saveManifest();

  const totalChars = scriptData.segments?.reduce(
    (s, seg) => s + (seg.turns || []).reduce((t, turn) => t + (turn.text?.length || 0), 0), 0
  ) || 0;
  const totalTurns = scriptData.segments?.reduce(
    (s, seg) => s + (seg.turns || []).length, 0
  ) || 0;

  console.log(`\n═══════════════════════════════════════`);
  console.log(`Job:      ${jobId}`);
  console.log(`Title:    ${scriptData.title || 'N/A'}`);
  console.log(`Status:   ${manifest.status}`);
  console.log(`Turns:    ${totalTurns}  |  Chars: ${totalChars.toLocaleString()}  |  ~${Math.round(totalChars / 250)} min`);
  if (manifest.final_audio) console.log(`Audio:    ${join(jobDir, manifest.final_audio)}`);
  if (manifest.cost?.total) console.log(`Cost:     ¥${manifest.cost.total}`);
  console.log(`Manifest: ${join(jobDir, 'manifest.json')}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
