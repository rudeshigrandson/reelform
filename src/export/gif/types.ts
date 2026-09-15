/**
 * Shared GIF export types (ENGINEERING_SPEC §10.6, design guide S21 GIF options).
 */

/** Dithering modes offered in the Export dialog (None / Bayer / Floyd). */
export type GifDither = "none" | "bayer4" | "bayer8" | "floyd-steinberg";

/** Allowed GIF frame rates. */
export type GifFps = 10 | 15 | 20 | 30;
export const GIF_FPS_OPTIONS: readonly GifFps[] = [10, 15, 20, 30];

/** Size presets by output height (Small / Medium / Large). */
export type GifSizePreset = 480 | 720 | 1080;
export const GIF_SIZE_PRESETS: readonly GifSizePreset[] = [480, 720, 1080];

export const GIF_MIN_COLORS = 32;
export const GIF_MAX_COLORS = 256;
/** GIF logical screen dimensions are u16. */
export const GIF_MAX_DIMENSION = 65_535;

/** Minimal RGBA frame (structurally compatible with `ImageData`). */
export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

/** Flat RGB palette: `rgb.length === count * 3`. */
export interface Palette {
  rgb: Uint8Array;
  count: number;
}

export interface GifEncoderOptions {
  width: number;
  height: number;
  fps: GifFps;
  /** Total color-table size, clamped to 32–256 (includes the reserved transparent slot). */
  colors: number;
  dither: GifDither;
  /** Loop forever (NETSCAPE2.0 extension). `false` plays once. */
  loop: boolean;
  /** Per-frame palette (local color tables) instead of one global median-cut palette. */
  adaptivePalette?: boolean | undefined;
  /** Transparent-pixel frame differencing with minimal sub-frames (default true). */
  frameDiff?: boolean | undefined;
  /**
   * Source has alpha (background "none"): pixels with alpha < 128 become the
   * transparent index; every frame is a full frame disposed to background
   * (frame differencing is disabled because it cannot express opaque→clear).
   */
  alpha?: boolean | undefined;
  /** Total frames expected; only used for progress/size estimate. */
  totalFrames?: number | undefined;
}
