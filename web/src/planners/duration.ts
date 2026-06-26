// ─── Duration Planner ──────────────────────────────
// PRD 8.2 FR-05: Estimate podcast duration from text length
//
// Maintains a calibration cache (data/calibration.json) that tracks
// actual rendered durations. Uses a moving-average speech rate
// to improve estimation accuracy over time.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const CHINESE_CHARS_PER_MINUTE = 280; // fallback average Chinese speech rate
const MIN_TARGET_MINUTES = 8;
const MAX_TARGET_MINUTES = 15;
const CALIBRATION_PATH = join(process.cwd(), "data", "calibration.json");
const MOVING_AVERAGE_WINDOW = 5;

export interface DurationEstimate {
  estimatedMinutes: number;
  targetMinutes: number;
  recommendedMaxChars: number;
  /** Speech rate used for estimation (chars/min) */
  speechRate: number;
  /** Whether this estimate uses calibrated data */
  calibrated: boolean;
}

interface CalibrationSample {
  chars: number;
  actualSeconds: number;
  timestamp: string;
}

interface CalibrationCache {
  samples: CalibrationSample[];
}

// ─── Calibration Cache ──────────────────────────────

function loadCalibration(): CalibrationCache {
  try {
    if (existsSync(CALIBRATION_PATH)) {
      return JSON.parse(readFileSync(CALIBRATION_PATH, "utf-8"));
    }
  } catch { /* ignore corrupt file */ }
  return { samples: [] };
}

function saveCalibration(cache: CalibrationCache): void {
  const dir = join(process.cwd(), "data");
  try { mkdirSync(dir, { recursive: true }); } catch {}
  writeFileSync(CALIBRATION_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

/**
 * Compute calibrated speech rate from recent samples.
 * Returns the moving average of (chars / seconds * 60) over
 * the most recent N samples, or null if insufficient data.
 */
export function calibratedSpeechRate(): number | null {
  const cache = loadCalibration();
  const recent = cache.samples.slice(-MOVING_AVERAGE_WINDOW);
  if (recent.length < 3) return null;

  const totalRate = recent.reduce((sum, s) => {
    if (s.actualSeconds <= 0) return sum;
    return sum + (s.chars / s.actualSeconds) * 60;
  }, 0);

  return Math.round(totalRate / recent.length);
}

/**
 * Record a calibration sample after TTS rendering completes.
 */
export function recordCalibration(chars: number, actualSeconds: number): void {
  if (chars <= 0 || actualSeconds <= 0) return;
  const cache = loadCalibration();
  cache.samples.push({
    chars,
    actualSeconds: Math.round(actualSeconds * 10) / 10,
    timestamp: new Date().toISOString(),
  });
  // Keep only last 50 samples
  if (cache.samples.length > 50) {
    cache.samples = cache.samples.slice(-50);
  }
  saveCalibration(cache);
}

// ─── Estimation ─────────────────────────────────────

/**
 * Estimate podcast duration and suggest target.
 * Uses calibrated speech rate if available, falls back to 280 chars/min.
 */
export function estimateDuration(charCount: number): DurationEstimate {
  const calibrated = calibratedSpeechRate();
  const speechRate = calibrated || CHINESE_CHARS_PER_MINUTE;

  const estimatedMinutes = Math.max(1, Math.ceil(charCount / speechRate));
  const targetMinutes = Math.min(
    MAX_TARGET_MINUTES,
    Math.max(MIN_TARGET_MINUTES, estimatedMinutes),
  );
  const recommendedMaxChars = targetMinutes * speechRate;

  return {
    estimatedMinutes,
    targetMinutes,
    recommendedMaxChars,
    speechRate,
    calibrated: !!calibrated,
  };
}
