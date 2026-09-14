import type { ColorLookup } from "./colorLookup";
import type { GifDither, RgbaFrame } from "./types";

/**
 * Map RGBA pixels of a rect to palette indices with optional dithering
 * (none / Bayer 4×4 / Bayer 8×8 / Floyd–Steinberg). Pure and deterministic.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QuantizeOptions {
  frame: RgbaFrame;
  rect: Rect;
  lookup: ColorLookup;
  dither: GifDither;
  /** Full-frame mask; pixels with 0 are skipped and written as `skipIndex`. */
  include?: Uint8Array | undefined;
  /** Index for skipped (and, with `alphaTransparent`, clear) pixels. */
  skipIndex?: number | undefined;
  /** Pixels with alpha < 128 become `skipIndex`. */
  alphaTransparent?: boolean | undefined;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function bayerMatrix(n: 4 | 8): Float32Array {
  const size = n * n;
  const m = new Float32Array(size);
  if (n === 4) {
    for (let i = 0; i < size; i++) m[i] = ((BAYER4[i] ?? 0) + 0.5) / size - 0.5;
    return m;
  }
  // 8×8 from 4×4: M8 = [[4M, 4M+2], [4M+3, 4M+1]]
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const base = BAYER4[(y >> 1) * 4 + (x >> 1)] ?? 0;
      const q = (y & 1) * 2 + (x & 1); // 0:TL 1:TR 2:BL 3:BR
      const add = q === 0 ? 0 : q === 1 ? 2 : q === 2 ? 3 : 1;
      m[y * 8 + x] = (base * 4 + add + 0.5) / size - 0.5;
    }
  return m;
}

const BAYER_4 = bayerMatrix(4);
const BAYER_8 = bayerMatrix(8);

/** Ordered-dither amplitude: roughly one palette "step" per channel. */
export function bayerSpread(paletteCount: number): number {
  return Math.min(64, Math.max(8, 255 / Math.cbrt(Math.max(1, paletteCount))));
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

export function quantizeRect(opts: QuantizeOptions): Uint8Array {
  const { frame, rect, lookup, dither, include, alphaTransparent } = opts;
  const skipIndex = opts.skipIndex ?? 0;
  const { data, width: fw } = frame;
  const out = new Uint8Array(rect.width * rect.height);
  const skip = (p: number): boolean =>
    (include !== undefined && include[p] === 0) ||
    (alphaTransparent === true && (data[p * 4 + 3] ?? 255) < 128);

  if (dither === "none" || dither === "bayer4" || dither === "bayer8") {
    const n = dither === "bayer8" ? 8 : 4;
    const matrix = dither === "bayer8" ? BAYER_8 : BAYER_4;
    const spread = dither === "none" ? 0 : bayerSpread(lookup.palette.count);
    for (let y = 0; y < rect.height; y++) {
      const fy = rect.y + y;
      for (let x = 0; x < rect.width; x++) {
        const fx = rect.x + x;
        const p = fy * fw + fx;
        const i = y * rect.width + x;
        if (skip(p)) {
          out[i] = skipIndex;
          continue;
        }
        const o = p * 4;
        if (spread === 0) {
          out[i] = lookup.nearest(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
        } else {
          const t = (matrix[(fy % n) * n + (fx % n)] ?? 0) * spread;
          out[i] = lookup.nearest(
            clamp255((data[o] ?? 0) + t),
            clamp255((data[o + 1] ?? 0) + t),
            clamp255((data[o + 2] ?? 0) + t),
          );
        }
      }
    }
    return out;
  }

  // Floyd–Steinberg: error rows over rect width + 2 (1px padding each side).
  const { rgb } = lookup.palette;
  const w2 = rect.width + 2;
  let cur = new Float32Array(w2 * 3);
  let nxt = new Float32Array(w2 * 3);
  for (let y = 0; y < rect.height; y++) {
    const fy = rect.y + y;
    for (let x = 0; x < rect.width; x++) {
      const p = fy * fw + rect.x + x;
      const i = y * rect.width + x;
      if (skip(p)) {
        out[i] = skipIndex;
        continue;
      }
      const o = p * 4;
      const e = (x + 1) * 3;
      const r = clamp255((data[o] ?? 0) + (cur[e] ?? 0));
      const g = clamp255((data[o + 1] ?? 0) + (cur[e + 1] ?? 0));
      const b = clamp255((data[o + 2] ?? 0) + (cur[e + 2] ?? 0));
      const idx = lookup.nearest(r, g, b);
      out[i] = idx;
      const errs = [
        r - (rgb[idx * 3] ?? 0),
        g - (rgb[idx * 3 + 1] ?? 0),
        b - (rgb[idx * 3 + 2] ?? 0),
      ];
      for (let c = 0; c < 3; c++) {
        const err = errs[c] ?? 0;
        cur[e + 3 + c] = (cur[e + 3 + c] ?? 0) + (err * 7) / 16;
        nxt[e - 3 + c] = (nxt[e - 3 + c] ?? 0) + (err * 3) / 16;
        nxt[e + c] = (nxt[e + c] ?? 0) + (err * 5) / 16;
        nxt[e + 3 + c] = (nxt[e + 3 + c] ?? 0) + err / 16;
      }
    }
    const tmp = cur;
    cur = nxt;
    nxt = tmp;
    nxt.fill(0);
  }
  return out;
}
