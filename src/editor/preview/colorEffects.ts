import type { EffectsSettings } from "../inspector/effects/types";

/**
 * Color effects (ENGINEERING_SPEC §9.8): brightness / contrast / saturation as
 * a ColorMatrixFilter matrix, a vignette overlay strength and seeded grain.
 * Grain is seeded by frame index so the same `tMs` + fps is the same noise in
 * preview and export.
 */

export type ColorAdjust = Pick<EffectsSettings["color"], "brightness" | "contrast" | "saturation">;

/** 5×4 row-major RGBA matrix; the 5th column is an offset in 0..1 units. */
export type ColorMatrix20 = number[];

export const GRAIN_NOISE = 0.08;
export const VIGNETTE_MAX_ALPHA = 0.75;

const IDENTITY: ColorMatrix20 = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const LUMA = [0.2126, 0.7152, 0.0722] as const;
const unit = (v: number): number =>
  Number.isFinite(v) ? Math.min(100, Math.max(-100, v)) / 100 : 0;

/** a·b for 5×4 matrices (treated as 5×5 with an implicit [0 0 0 0 1] row). */
function multiply(a: ColorMatrix20, b: ColorMatrix20): ColorMatrix20 {
  const at = (m: ColorMatrix20, r: number, c: number): number => m[r * 5 + c] ?? 0;
  const out: number[] = new Array<number>(20).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      let v = c === 4 ? at(a, r, 4) : 0;
      for (let k = 0; k < 4; k++) v += at(a, r, k) * at(b, k, c);
      out[r * 5 + c] = v;
    }
  }
  return out;
}

export function isIdentityColor(adj: ColorAdjust): boolean {
  return unit(adj.brightness) === 0 && unit(adj.contrast) === 0 && unit(adj.saturation) === 0;
}

/** Brightness (scale), contrast (around mid-gray), saturation (Rec.709 luma). */
export function colorMatrix(adj: ColorAdjust): ColorMatrix20 {
  const b = 1 + unit(adj.brightness);
  const c = 1 + unit(adj.contrast);
  const s = 1 + unit(adj.saturation);
  const bright: ColorMatrix20 = [b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
  const o = (1 - c) / 2;
  const contrast: ColorMatrix20 = [c, 0, 0, 0, o, 0, c, 0, 0, o, 0, 0, c, 0, o, 0, 0, 0, 1, 0];
  const [lr, lg, lb] = LUMA;
  const sr = (1 - s) * lr;
  const sg = (1 - s) * lg;
  const sb = (1 - s) * lb;
  const sat: ColorMatrix20 = [
    sr + s,
    sg,
    sb,
    0,
    0,
    sr,
    sg + s,
    sb,
    0,
    0,
    sr,
    sg,
    sb + s,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
  return multiply(bright, multiply(contrast, sat));
}

/** Apply a matrix to an RGB(A) color in 0..1 (for tests / thumbnails). */
export function applyColorMatrix(
  m: ColorMatrix20,
  rgba: readonly [number, number, number, number],
): [number, number, number, number] {
  const row = (r: number): number =>
    (m[r * 5] ?? 0) * rgba[0] +
    (m[r * 5 + 1] ?? 0) * rgba[1] +
    (m[r * 5 + 2] ?? 0) * rgba[2] +
    (m[r * 5 + 3] ?? 0) * rgba[3] +
    (m[r * 5 + 4] ?? 0);
  return [row(0), row(1), row(2), row(3)];
}

/** Frame index for `tMs` at `fps` (robust to float noise). */
export function frameIndex(tMs: number, fps: number): number {
  const f = Number.isFinite(fps) && fps > 0 ? fps : 30;
  return Math.max(0, Math.floor(((Number.isFinite(tMs) ? tMs : 0) * f) / 1000 + 1e-6));
}

/** Grain seed in [0, 1) derived from the frame index (FNV-style hash). */
export function grainSeed(tMs: number, fps: number): number {
  let h = Math.imul(frameIndex(tMs, fps) + 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}

export interface ColorFxState {
  /** null → no color filter. */
  matrix: ColorMatrix20 | null;
  /** Vignette overlay edge alpha, 0 = off. */
  vignette: number;
  grain: { noise: number; seed: number } | null;
}

export const NO_COLOR_FX: Readonly<ColorFxState> = { matrix: null, vignette: 0, grain: null };

export function evaluateColorFx(
  color: EffectsSettings["color"],
  tMs: number,
  fps: number,
): ColorFxState {
  const v = Number.isFinite(color.vignette) ? Math.min(100, Math.max(0, color.vignette)) : 0;
  return {
    matrix: isIdentityColor(color) ? null : colorMatrix(color),
    vignette: (v / 100) * VIGNETTE_MAX_ALPHA,
    grain: color.grain ? { noise: GRAIN_NOISE, seed: grainSeed(tMs, fps) } : null,
  };
}

export { IDENTITY as IDENTITY_COLOR_MATRIX };
