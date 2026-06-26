// ─── Silence Trimming ───────────────────────────────
// PRD 8.4 FR-14: Trim leading/trailing silence from audio segments
// to remove awkward pauses at segment boundaries.
//
// Uses FFmpeg silenceremove filter:
//   - start: trim silence from the beginning until audio exceeds threshold
//   - stop: trim silence from the end once audio drops below threshold
//
// Reference: https://ffmpeg.org/ffmpeg-filters.html#silenceremove

import { execSync } from "child_process";
import { existsSync } from "fs";

export interface TrimOptions {
  inputPath: string;
  outputPath: string;
  /** Silence threshold in dB (default: -50) */
  threshold?: number;
  /** Minimum silence duration before trimming (seconds, default: 0.3) */
  minSilence?: number;
  /** Whether to trim leading silence (default: true) */
  trimStart?: boolean;
  /** Whether to trim trailing silence (default: true) */
  trimEnd?: boolean;
}

/**
 * Trim leading and trailing silence from an audio file.
 *
 * Uses FFmpeg silenceremove filter: silenceremove=start_periods=1:start_silence={min}:start_threshold={thresh}...
 *
 * @param options TrimOptions
 * @returns Path to the trimmed output file
 */
export function trimSilence(options: TrimOptions): string {
  const {
    inputPath,
    outputPath,
    threshold = -50,
    minSilence = 0.3,
    trimStart = true,
    trimEnd = true,
  } = options;

  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const filterParts: string[] = [];

  if (trimStart) {
    filterParts.push(
      `silenceremove=start_periods=1:start_silence=${minSilence}:start_threshold=${threshold}dB`,
    );
  }
  if (trimEnd) {
    filterParts.push(
      `silenceremove=stop_periods=-1:stop_silence=${minSilence}:stop_threshold=${threshold}dB`,
    );
  }

  if (filterParts.length === 0) {
    // Nothing to trim — just copy
    execSync(`cp "${inputPath}" "${outputPath}"`);
    return outputPath;
  }

  const af = filterParts.join(",");
  execSync(
    `ffmpeg -y -i "${inputPath}" -af "${af}" -ac 2 -ar 44100 -b:a 192k "${outputPath}" 2>/dev/null`,
    { timeout: 60_000 },
  );

  return outputPath;
}

/**
 * Generate a silence gap audio file (for manual padding between segments).
 *
 * Creates a short WAV/MP3 of pure silence at the given duration.
 * Useful when the caller wants explicit gap control rather than
 * the concat filter approach.
 *
 * @param outputPath Where to write the silence file
 * @param durationSeconds Duration in seconds
 */
export function generateSilence(
  outputPath: string,
  durationSeconds: number = 0.5,
): string {
  execSync(
    `ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo ` +
    `-t ${durationSeconds} -ac 2 -ar 44100 -b:a 192k "${outputPath}" 2>/dev/null`,
    { timeout: 15_000 },
  );
  return outputPath;
}
