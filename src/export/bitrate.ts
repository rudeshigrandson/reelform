/**
 * Export bitrate table (ENGINEERING_SPEC §10.3).
 *
 * The reference point is 1080p60 H.264:
 *   - High quality → 16 Mbps
 *   - Max  quality → 28 Mbps
 *
 * Codec multipliers (relative to H.264, same visual quality at lower bitrate):
 *   - H.264 → ×1.00
 *   - HEVC  → ×0.65
 *   - AV1   → ×0.50
 *   - VP9   → ×0.80 (between HEVC and H.264; not spelled out in the spec table but
 *            §10.1 offers VP9/WebM, so we give it a documented, sane multiplier)
 *
 * Scaling formula (all factors multiply the reference bits/sec):
 *   bitrate = base(quality)
 *           × codecMultiplier(codec)
 *           × resolutionFactor(width, height)
 *           × fpsFactor(fps)
 *
 *   resolutionFactor = (width * height) / (1920 * 1080)
 *     — linear in pixel count relative to 1080p.
 *
 *   fpsFactor: the reference table is defined at 60fps, so fpsFactor(60) = 1.0.
 *     The spec relation is "×1.7 for 60 vs 30", i.e. 30fps is 1/1.7 of 60fps.
 *     We anchor the line through (30, 1/1.7) and (60, 1.0) and interpolate/
 *     extrapolate linearly for other fps:
 *       fpsFactor(fps) = R30 + (fps - 30) * ((1 - R30) / 30),  R30 = 1 / 1.7
 *     This is monotonic non-decreasing in fps and passes through both anchors,
 *     giving fpsFactor(60)/fpsFactor(30) = 1.7 exactly. Clamped to a small
 *     positive floor so pathological low fps never produces a negative factor.
 *
 * The result is rounded to the nearest bit/sec so the function is deterministic
 * and returns an integer.
 */

export type Codec = "h264" | "hevc" | "av1" | "vp9";
export type Quality = "High" | "Max";

/** Reference bits/sec for 1080p60 H.264 by quality. */
const BASE_1080P60: Record<Quality, number> = {
  High: 16_000_000,
  Max: 28_000_000,
};

/** Per-codec efficiency multipliers relative to H.264. */
const CODEC_MULTIPLIER: Record<Codec, number> = {
  h264: 1.0,
  hevc: 0.65,
  av1: 0.5,
  vp9: 0.8,
};

const REF_PIXELS = 1920 * 1080;
// The reference table is anchored at 60fps (fpsFactor(60) === 1). 30fps is
// 1/1.7 of that ("×1.7 for 60 vs 30"). The line runs through (30, R30)→(60, 1).
const R30 = 1 / 1.7;
const FPS_SLOPE = (1 - R30) / 30;

/** Pixel-count factor relative to 1080p. Linear in area. */
function resolutionFactor(width: number, height: number): number {
  return (width * height) / REF_PIXELS;
}

/**
 * Frame-rate factor relative to the 60fps reference. 60fps → 1.0, 30fps → 1/1.7,
 * linear in between and beyond. Clamped to a small positive floor so a
 * pathological low fps can never yield a non-positive factor.
 */
function fpsFactor(fps: number): number {
  return Math.max(0.01, R30 + (fps - 30) * FPS_SLOPE);
}

/**
 * Target video bitrate in bits/sec for the given output settings.
 * Deterministic; result is a non-negative integer.
 */
export function exportBitrate(
  width: number,
  height: number,
  fps: number,
  codec: Codec,
  quality: Quality,
): number {
  const base = BASE_1080P60[quality];
  const bits = base * CODEC_MULTIPLIER[codec] * resolutionFactor(width, height) * fpsFactor(fps);
  return Math.round(bits);
}
