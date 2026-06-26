// ─── Audio Module Barrel ──────────────────────────
// PRD 8.4: Audio processing pipeline exports
//
// Re-exports concat, loudness, and render functions.
// Also re-exports FFmpeg availability check.

export { concatAudio, concatWithGap, checkFfmpeg } from "./concat";
export type { ConcatOptions } from "./concat";

export {
  normalizeLoudness,
  measureLoudness,
  getDuration,
  getFileSize,
} from "./loudness";

export { renderPodcast } from "./render";
export type {
  RenderOptions,
  RenderProgress,
  RenderResult,
} from "./render";

export { trimSilence, generateSilence } from "./trim";
export type { TrimOptions } from "./trim";
