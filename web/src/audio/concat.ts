// ─── Audio Concat ──────────────────────────────────
// PRD 8.4 FR-13: Concatenate segment audio files with FFmpeg
//
// Two strategies:
//   1. Simple concat (no crossfade): FFmpeg concat demuxer with -c copy — fast, lossless
//   2. Crossfade concat: filter_complex chain of acrossfade — smooth transitions
//
// Reference: https://trac.ffmpeg.org/wiki/Concatenate
import { execSync } from "child_process";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { join, dirname } from "path";

export interface ConcatOptions {
  inputFiles: string[];
  outputPath: string;
  /** Crossfade duration in seconds between segments (0 = no crossfade) */
  crossfadeSeconds?: number;
}

/**
 * Concatenate audio files using FFmpeg.
 * Requires FFmpeg 4.0+ installed on the system.
 */
export function concatAudio(options: ConcatOptions): void {
  const { inputFiles, outputPath, crossfadeSeconds = 0 } = options;

  if (inputFiles.length === 0) {
    throw new Error("No input files to concatenate");
  }

  if (inputFiles.length === 1) {
    // Single file: just copy
    execSync(`cp "${inputFiles[0]}" "${outputPath}"`);
    return;
  }

  if (crossfadeSeconds > 0) {
    concatWithCrossfade(inputFiles, outputPath, crossfadeSeconds);
  } else {
    concatLossless(inputFiles, outputPath);
  }
}

/**
 * Lossless concat using FFmpeg concat demuxer.
 * Fast and no re-encode — suitable for back-to-back MP3 segments.
 */
function concatLossless(inputFiles: string[], outputPath: string): void {
  const listPath = join(
    dirname(outputPath),
    `_concat_list_${Date.now()}.txt`,
  );

  const lines = inputFiles.map((f) => `file '${f}'`).join("\n");
  writeFileSync(listPath, lines, "utf-8");

  try {
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}" 2>/dev/null`,
      { timeout: 120_000 },
    );
  } finally {
    try {
      unlinkSync(listPath);
    } catch {}
  }
}

/**
 * Crossfade concat using filter_complex chain.
 * Chains acrossfade filters: [0][1]→[a1], [a1][2]→[a2], ...
 * Re-encodes to MP3 at 192kbps.
 */
function concatWithCrossfade(
  inputFiles: string[],
  outputPath: string,
  crossfadeSeconds: number,
): void {
  const inputs = inputFiles.map((f) => `-i "${f}"`).join(" ");

  // Build acrossfade chain: [0][1]acrossfade→[a1];[a1][2]acrossfade→[a2];...
  let prevLabel = "0";
  const filters: string[] = [];

  for (let i = 1; i < inputFiles.length; i++) {
    const nextLabel = i === inputFiles.length - 1 ? "out" : `a${i}`;
    filters.push(
      `[${prevLabel}][${i}]acrossfade=d=${crossfadeSeconds}:c1=tri:c2=tri[${nextLabel}]`,
    );
    prevLabel = nextLabel;
  }

  const filterComplex = filters.join(";");
  const cmd =
    `ffmpeg -y ${inputs} ` +
    `-filter_complex "${filterComplex}" ` +
    `-map "[out]" -ac 2 -ar 44100 -b:a 192k ` +
    `"${outputPath}" 2>/dev/null`;

  execSync(cmd, { timeout: 300_000 });
}

/**
 * Concatenate with silence gap between segments (no crossfade, just pause).
 * Uses aevalsrc to generate silence, then concat filter.
 * Useful for podcast segments where you want a natural pause between topics.
 */
export function concatWithGap(
  inputFiles: string[],
  outputPath: string,
  gapSeconds: number = 0.5,
): void {
  if (inputFiles.length === 0) {
    throw new Error("No input files to concatenate");
  }

  if (inputFiles.length === 1) {
    execSync(`cp "${inputFiles[0]}" "${outputPath}"`);
    return;
  }

  // Build: each file + silence pad between them
  // Approach: pad end of each segment with silence using apad, then concat
  const inputs = inputFiles.map((f) => `-i "${f}"`).join(" ");

  const filterParts: string[] = [];
  for (let i = 0; i < inputFiles.length; i++) {
    if (i < inputFiles.length - 1) {
      // Pad this segment with silence at end
      filterParts.push(
        `[${i}:a]apad=pad_len=${Math.round(gapSeconds * 44100)}[p${i}]`,
      );
    } else {
      filterParts.push(`[${i}:a]anull[p${i}]`);
    }
  }
  const concatInputs = inputFiles.map((_, i) => `[p${i}]`).join("");
  filterParts.push(`${concatInputs}concat=n=${inputFiles.length}:v=0:a=1[out]`);

  const filterComplex = filterParts.join(";");
  const cmd =
    `ffmpeg -y ${inputs} ` +
    `-filter_complex "${filterComplex}" ` +
    `-map "[out]" -ac 2 -ar 44100 -b:a 192k ` +
    `"${outputPath}" 2>/dev/null`;

  execSync(cmd, { timeout: 300_000 });
}

/**
 * Check if FFmpeg is available on the system.
 */
export function checkFfmpeg(): boolean {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
