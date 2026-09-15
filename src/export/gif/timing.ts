import { GIF_MAX_DIMENSION } from "./types";

/**
 * GIF size presets, fps frame sampling, delays and the live size estimate
 * (ENGINEERING_SPEC §10.3 / §10.6). Pure.
 */

/** Seconds of encoded frames after which the size estimate is considered settled. */
export const ESTIMATE_WINDOW_MS = 2000;

/** Output size for a target height keeping the source aspect ratio (≥ 1, ≤ 65535). */
export function gifOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  targetHeight: number,
): { width: number; height: number } {
  const clampDim = (v: number): number => Math.min(GIF_MAX_DIMENSION, Math.max(1, Math.round(v)));
  const height = clampDim(Number.isFinite(targetHeight) ? targetHeight : 1);
  const ok =
    Number.isFinite(sourceWidth) &&
    Number.isFinite(sourceHeight) &&
    sourceWidth > 0 &&
    sourceHeight > 0;
  const aspect = ok ? sourceWidth / sourceHeight : 16 / 9;
  return { width: clampDim(height * aspect), height };
}

/** Number of output frames for a duration: frame `i` sits at `i * 1000 / fps`. */
export function gifFrameCount(durationMs: number, fps: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(fps) || fps <= 0)
    return 0;
  // Tolerate float noise so 1000ms @ 30fps is exactly 30 frames.
  return Math.ceil((durationMs * fps) / 1000 - 1e-9);
}

/** Timeline time of output frame `i`. */
export function gifFrameTimeMs(index: number, fps: number): number {
  return (index * 1000) / fps;
}

/**
 * Delay of frame `i` in centiseconds using cumulative rounding, so the sum of
 * the first `n` delays is `round(n * 100 / fps)` — no drift (15fps → 7,7,6,…).
 */
export function gifDelayCs(index: number, fps: number): number {
  const at = (i: number): number => Math.round((i * 100) / fps);
  return at(index + 1) - at(index);
}

export interface SizeEstimateInput {
  headerBytes: number;
  firstFrameBytes: number;
  /** Header + all encoded frames so far (including any not yet flushed). */
  encodedBytes: number;
  framesEncoded: number;
  totalFrames: number | undefined;
  fps: number;
}

export interface SizeEstimate {
  estimatedBytes: number;
  /** True once ≥ 2s of frames (or all frames) have been encoded. */
  settled: boolean;
}

/**
 * Extrapolate the final file size: header + first (full) frame + the mean
 * size of subsequent frames × remaining frames + trailer. Null until two
 * frames are encoded or when the total is unknown.
 */
export function estimateGifSize(input: SizeEstimateInput): SizeEstimate | null {
  const { headerBytes, firstFrameBytes, encodedBytes, framesEncoded, totalFrames, fps } = input;
  if (totalFrames === undefined || !Number.isFinite(totalFrames) || totalFrames < 1) return null;
  if (framesEncoded >= totalFrames) return { estimatedBytes: encodedBytes + 1, settled: true };
  if (framesEncoded < 2) return null;
  const perFrame = Math.max(0, encodedBytes - headerBytes - firstFrameBytes) / (framesEncoded - 1);
  const estimatedBytes = Math.round(
    headerBytes + firstFrameBytes + perFrame * (totalFrames - 1) + 1,
  );
  return { estimatedBytes, settled: (framesEncoded * 1000) / fps >= ESTIMATE_WINDOW_MS };
}
