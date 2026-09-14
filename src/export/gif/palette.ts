import { GIF_MAX_COLORS, GIF_MIN_COLORS, type Palette, type RgbaFrame } from "./types";

/**
 * Median-cut palette quantization (ENGINEERING_SPEC §10.6).
 *
 * Pixels are accumulated into a 5-bit-per-channel histogram (32,768 bins, each
 * keeping a pixel count and channel sums). Median cut then repeatedly splits
 * the box with the highest `pixelCount × longestRange` at the pixel-weighted
 * median of its longest axis. Each box's color is the exact mean of its
 * pixels, so an image with ≤ N colors in distinct bins reproduces them exactly.
 * Fully deterministic: ties are broken by bin order.
 */

const BINS = 1 << 15;
/** Upper bound on pixels read per frame when building the histogram. */
export const MAX_HISTOGRAM_PIXELS_PER_FRAME = 500_000;

/** Clamp a requested color count to the 32–256 range (non-finite → 256). */
export function clampColors(colors: number): number {
  if (!Number.isFinite(colors)) return GIF_MAX_COLORS;
  return Math.min(GIF_MAX_COLORS, Math.max(GIF_MIN_COLORS, Math.round(colors)));
}

/** Evenly spaced frame indices covering `fraction` of `totalFrames` (≥ 1 when any frames). */
export function sampleFrameIndices(totalFrames: number, fraction = 0.1): number[] {
  const total = Math.max(0, Math.floor(Number.isFinite(totalFrames) ? totalFrames : 0));
  if (total === 0) return [];
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0.1;
  const count = Math.max(1, Math.min(total, Math.round(total * f)));
  const step = total / count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.min(total - 1, Math.floor(i * step + step / 2)));
  return out;
}

export const binOf = (r: number, g: number, b: number): number =>
  ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

export class ColorHistogram {
  readonly counts = new Float64Array(BINS);
  readonly sumR = new Float64Array(BINS);
  readonly sumG = new Float64Array(BINS);
  readonly sumB = new Float64Array(BINS);
  total = 0;

  /**
   * Add pixels of `frame` (optionally only the rect). With `skipTransparent`,
   * pixels with alpha < 128 are ignored; with `mask`, only pixels whose mask
   * byte is non-zero (mask indexed over the full frame).
   */
  addFrame(
    frame: RgbaFrame,
    opts: {
      skipTransparent?: boolean | undefined;
      mask?: Uint8Array | undefined;
      rect?: { x: number; y: number; width: number; height: number } | undefined;
    } = {},
  ): void {
    const rect = opts.rect ?? { x: 0, y: 0, width: frame.width, height: frame.height };
    const { data } = frame;
    const { mask } = opts;
    const addPixel = (p: number): void => {
      const o = p * 4;
      if (opts.skipTransparent && (data[o + 3] ?? 255) < 128) return;
      this.add(data[o] ?? 0, data[o + 1] ?? 0, data[o + 2] ?? 0);
    };
    if (mask) {
      // Subsample over the *masked* pixels, so sparse changes (e.g. a cursor on
      // a 1080p frame) are never skipped by a spatial stride.
      let included = 0;
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        const row = y * frame.width;
        for (let x = rect.x; x < rect.x + rect.width; x++) if (mask[row + x] !== 0) included++;
      }
      const every = Math.max(1, Math.ceil(included / MAX_HISTOGRAM_PIXELS_PER_FRAME));
      let seen = 0;
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        const row = y * frame.width;
        for (let x = rect.x; x < rect.x + rect.width; x++) {
          const p = row + x;
          if (mask[p] === 0) continue;
          if (seen++ % every === 0) addPixel(p);
        }
      }
      return;
    }
    // Per-axis stride so at most ~MAX pixels are read (stride² ≥ area / MAX).
    const area = rect.width * rect.height;
    const stride = Math.max(1, Math.ceil(Math.sqrt(area / MAX_HISTOGRAM_PIXELS_PER_FRAME)));
    for (let y = rect.y; y < rect.y + rect.height; y += stride) {
      const row = y * frame.width;
      for (let x = rect.x; x < rect.x + rect.width; x += stride) addPixel(row + x);
    }
  }

  add(r: number, g: number, b: number, weight = 1): void {
    const bin = binOf(r, g, b);
    this.counts[bin] = (this.counts[bin] ?? 0) + weight;
    this.sumR[bin] = (this.sumR[bin] ?? 0) + r * weight;
    this.sumG[bin] = (this.sumG[bin] ?? 0) + g * weight;
    this.sumB[bin] = (this.sumB[bin] ?? 0) + b * weight;
    this.total += weight;
  }
}

interface Box {
  bins: number[];
  count: number;
  score: number;
  axis: 0 | 1 | 2;
}

const channel = (bin: number, axis: 0 | 1 | 2): number =>
  axis === 0 ? (bin >> 10) & 31 : axis === 1 ? (bin >> 5) & 31 : bin & 31;

function makeBox(bins: number[], counts: Float64Array): Box {
  let count = 0;
  const min = [31, 31, 31];
  const max = [0, 0, 0];
  for (const bin of bins) {
    count += counts[bin] ?? 0;
    for (const a of [0, 1, 2] as const) {
      const v = channel(bin, a);
      if (v < (min[a] ?? 0)) min[a] = v;
      if (v > (max[a] ?? 0)) max[a] = v;
    }
  }
  const ranges = [0, 1, 2].map((a) => (max[a] ?? 0) - (min[a] ?? 0));
  const r0 = ranges[0] ?? 0;
  const r1 = ranges[1] ?? 0;
  const r2 = ranges[2] ?? 0;
  // Prefer green on ties (eye is most sensitive to it), then red.
  const axis: 0 | 1 | 2 = r1 >= r0 && r1 >= r2 ? 1 : r0 >= r2 ? 0 : 2;
  const longest = Math.max(r0, r1, r2);
  return { bins, count, axis, score: bins.length > 1 ? count * (longest + 1) : -1 };
}

/** Median-cut the histogram into at most `maxColors` (1–256) colors. */
export function medianCut(hist: ColorHistogram, maxColors: number): Palette {
  const limit = Math.max(1, Math.min(256, Math.floor(maxColors)));
  const used: number[] = [];
  for (let bin = 0; bin < BINS; bin++) if ((hist.counts[bin] ?? 0) > 0) used.push(bin);
  if (used.length === 0) return { rgb: new Uint8Array(3), count: 1 }; // black

  const boxes: Box[] = [makeBox(used, hist.counts)];
  while (boxes.length < limit) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const s = boxes[i]?.score ?? -1;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) break;
    const box = boxes[best] as Box;
    const axis = box.axis;
    const sorted = box.bins.slice().sort((a, b) => channel(a, axis) - channel(b, axis) || a - b);
    const half = box.count / 2;
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += hist.counts[sorted[i] ?? 0] ?? 0;
      cut = i + 1;
      if (acc >= half) break;
    }
    boxes.splice(
      best,
      1,
      makeBox(sorted.slice(0, cut), hist.counts),
      makeBox(sorted.slice(cut), hist.counts),
    );
  }

  const rgb = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, i) => {
    let n = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const bin of box.bins) {
      n += hist.counts[bin] ?? 0;
      r += hist.sumR[bin] ?? 0;
      g += hist.sumG[bin] ?? 0;
      b += hist.sumB[bin] ?? 0;
    }
    rgb[i * 3] = Math.round(r / n);
    rgb[i * 3 + 1] = Math.round(g / n);
    rgb[i * 3 + 2] = Math.round(b / n);
  });
  return { rgb, count: boxes.length };
}

/** Palette from a set of RGBA frames (convenience over `ColorHistogram` + `medianCut`). */
export function buildPalette(
  frames: readonly RgbaFrame[],
  maxColors: number,
  skipTransparent = false,
): Palette {
  const hist = new ColorHistogram();
  for (const f of frames) hist.addFrame(f, { skipTransparent });
  return medianCut(hist, maxColors);
}

/** Bits for a GIF color table holding `entries` colors (1–8). */
export function colorTableBits(entries: number): number {
  let bits = 1;
  while (1 << bits < entries) bits++;
  return bits;
}

/** Palette padded with black to a power-of-two table (≥ 2 entries). */
export function toColorTable(palette: Palette, entries: number = palette.count): Uint8Array {
  const size = 1 << colorTableBits(Math.max(entries, palette.count));
  const table = new Uint8Array(size * 3);
  table.set(palette.rgb.subarray(0, palette.count * 3));
  return table;
}
