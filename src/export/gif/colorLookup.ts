import { binOf } from "./palette";
import type { Palette } from "./types";

/**
 * Nearest-palette-color lookup with a cached 5-bit-per-channel inverse map.
 *
 * Each of the 32,768 buckets lazily caches the palette entry nearest to the
 * bucket centre. Palette colors that fall inside a bucket are kept as extra
 * candidates, so exact palette colors always map to themselves and nearby
 * colors pick the best of (bucket-centre nearest ∪ in-bucket entries).
 * Deterministic: the cache depends only on the palette, not on pixel order.
 */
export interface ColorLookup {
  readonly palette: Palette;
  nearest(r: number, g: number, b: number): number;
}

const dist2 = (rgb: Uint8Array, i: number, r: number, g: number, b: number): number => {
  const dr = (rgb[i * 3] ?? 0) - r;
  const dg = (rgb[i * 3 + 1] ?? 0) - g;
  const db = (rgb[i * 3 + 2] ?? 0) - b;
  return dr * dr + dg * dg + db * db;
};

export function createColorLookup(palette: Palette): ColorLookup {
  const { rgb, count } = palette;
  if (count < 1) throw new RangeError("palette must have at least one color");
  const cache = new Int16Array(1 << 15).fill(-1);
  // In-bucket candidates: linked list via head/next arrays.
  const head = new Int16Array(1 << 15).fill(-1);
  const next = new Int16Array(count).fill(-1);
  for (let i = count - 1; i >= 0; i--) {
    const bin = binOf(rgb[i * 3] ?? 0, rgb[i * 3 + 1] ?? 0, rgb[i * 3 + 2] ?? 0);
    next[i] = head[bin] ?? -1;
    head[bin] = i;
  }

  const fullSearch = (r: number, g: number, b: number): number => {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      const d = dist2(rgb, i, r, g, b);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  return {
    palette,
    nearest(r, g, b) {
      const bin = binOf(r, g, b);
      let idx = cache[bin] ?? -1;
      if (idx < 0) {
        idx = fullSearch((r & 0xf8) | 4, (g & 0xf8) | 4, (b & 0xf8) | 4);
        cache[bin] = idx;
      }
      let cand = head[bin] ?? -1;
      if (cand < 0) return idx;
      let bestD = dist2(rgb, idx, r, g, b);
      while (cand >= 0) {
        const d = dist2(rgb, cand, r, g, b);
        if (d < bestD) {
          bestD = d;
          idx = cand;
        }
        cand = next[cand] ?? -1;
      }
      return idx;
    },
  };
}
