// ─── Loudness Normalization ────────────────────────
// PRD 8.4 FR-13: Apply EBU R128 loudness normalization to reduce volume jumps
//
// Two-pass approach for accuracy:
//   Pass 1: Analyze integrated loudness (dry run, no output file)
//   Pass 2: Apply correction with measured values
//
// Target: -16 LUFS (podcast standard), TP -1.5 dB, LRA 11 LU
// Reference: https://ffmpeg.org/ffmpeg-filters.html#loudnorm
// EBU R128: https://tech.ebu.ch/docs/r/r128.pdf
import { execSync } from "child_process";
import { existsSync, statSync } from "fs";

const TARGET_LUFS = -16;
const TRUE_PEAK = -1.5;
const LRA = 11;

interface LoudnormStats {
  input_i: number;    // input integrated loudness (LUFS)
  input_tp: number;   // input true peak (dBTP)
  input_lra: number;  // input loudness range (LU)
  input_thresh: number;
  output_i: number;
  output_tp: number;
  output_lra: number;
  output_thresh: number;
  normalization_type: string;
  target_offset: number;
}

/**
 * Apply EBU R128 loudness normalization to an audio file.
 *
 * Uses two-pass approach:
 *   1. First pass measures current loudness
 *   2. Second pass applies correction with precise offset
 *
 * Falls back to single-pass if two-pass fails.
 *
 * @param inputPath  Source audio file
 * @param outputPath Destination audio file
 * @param targetLUFS Target loudness in LUFS (default: -16)
 */
export function normalizeLoudness(
  inputPath: string,
  outputPath: string,
  targetLUFS: number = TARGET_LUFS,
): void {
  // First pass: analyze
  const stats = measureLoudness(inputPath);

  if (stats) {
    // Two-pass: apply with measured input loudness for precision
    const measuredI = stats.input_i;
    const cmd =
      `ffmpeg -y -i "${inputPath}" ` +
      `-af loudnorm=I=${targetLUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:measured_I=${measuredI}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true:print_format=summary ` +
      `-ac 2 -ar 44100 -b:a 192k "${outputPath}" 2>/dev/null`;

    execSync(cmd, { timeout: 120_000 });
  } else {
    // Fallback: single-pass
    const cmd =
      `ffmpeg -y -i "${inputPath}" ` +
      `-af loudnorm=I=${targetLUFS}:TP=${TRUE_PEAK}:LRA=${LRA} ` +
      `-ac 2 -ar 44100 -b:a 192k "${outputPath}" 2>/dev/null`;

    execSync(cmd, { timeout: 120_000 });
  }
}

/**
 * Measure EBU R128 loudness statistics without re-encoding.
 *
 * Runs FFmpeg in null muxer mode — analyzes audio but outputs nothing.
 * Returns parsed loudnorm JSON stats, or null on failure.
 */
export function measureLoudness(filePath: string): LoudnormStats | null {
  if (!existsSync(filePath)) return null;

  try {
    const output = execSync(
      `ffmpeg -i "${filePath}" -af loudnorm=I=${TARGET_LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:print_format=json -f null /dev/null 2>&1`,
      { timeout: 60_000, encoding: "utf-8" },
    );
    return parseLoudnormJson(output);
  } catch {
    return null;
  }
}

/**
 * Parse loudnorm JSON output from FFmpeg stderr.
 * FFmpeg outputs JSON between the loudnorm filter lines.
 */
function parseLoudnormJson(output: string): LoudnormStats | null {
  // Find the JSON block in FFmpeg output
  // loudnorm prints: { "input_i" : "-23.45", ... }
  const match = output.match(
    /\{\s*"input_i"\s*:\s*"[^"]*"\s*,\s*"input_tp"[^}]*\}/,
  );
  if (!match) return null;

  try {
    const raw = JSON.parse(match[0]);
    return {
      input_i: parseFloat(raw.input_i) || 0,
      input_tp: parseFloat(raw.input_tp) || 0,
      input_lra: parseFloat(raw.input_lra) || 0,
      input_thresh: parseFloat(raw.input_thresh) || 0,
      output_i: parseFloat(raw.output_i) || 0,
      output_tp: parseFloat(raw.output_tp) || 0,
      output_lra: parseFloat(raw.output_lra) || 0,
      output_thresh: parseFloat(raw.output_thresh) || 0,
      normalization_type: raw.normalization_type || "dynamic",
      target_offset: parseFloat(raw.target_offset) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Get audio duration in seconds via ffprobe.
 * Returns 0 on failure.
 */
export function getDuration(filePath: string): number {
  if (!existsSync(filePath)) return 0;

  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { timeout: 15_000, encoding: "utf-8" },
    );
    return parseFloat(output.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Get file size in bytes (0 on failure).
 */
export function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}
