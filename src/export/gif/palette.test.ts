import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createColorLookup } from "./colorLookup";
import {
  ColorHistogram,
  buildPalette,
  clampColors,
  colorTableBits,
  medianCut,
  sampleFrameIndices,
  toColorTable,
} from "./palette";
import { frameFromFn, gradientFrame, noiseFrame } from "./testing/frames";

describe("clampColors", () => {
  it("clamps to 32–256", () => {
    expect(clampColors(8)).toBe(32);
    expect(clampColors(300)).toBe(256);
    expect(clampColors(100.4)).toBe(100);
    expect(clampColors(Number.NaN)).toBe(256);
  });
});

describe("sampleFrameIndices", () => {
  it("takes ~10% evenly spaced, in range, sorted, unique", () => {
    const idx = sampleFrameIndices(300);
    expect(idx).toHaveLength(30);
    expect(idx[0]).toBe(5);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1] ?? -1);
  });
  it("edge cases: empty, tiny, bad fraction", () => {
    expect(sampleFrameIndices(0)).toEqual([]);
    expect(sampleFrameIndices(3)).toEqual([1]);
    expect(sampleFrameIndices(Number.NaN)).toEqual([]);
    expect(sampleFrameIndices(4, 5)).toEqual([0, 1, 2, 3]);
  });
  it("property: indices within [0,total) and count ≥ 1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (n, f) => {
          const idx = sampleFrameIndices(n, f);
          expect(idx.length).toBeGreaterThanOrEqual(1);
          expect(new Set(idx).size).toBe(idx.length);
          for (const i of idx) expect(i >= 0 && i < n).toBe(true);
        },
      ),
    );
  });
});

describe("medianCut", () => {
  it("returns black for an empty histogram", () => {
    const p = medianCut(new ColorHistogram(), 64);
    expect(p.count).toBe(1);
    expect(Array.from(p.rgb)).toEqual([0, 0, 0]);
  });

  it("reproduces few distinct colors exactly", () => {
    const colors: [number, number, number][] = [
      [0, 0, 0],
      [255, 255, 255],
      [200, 30, 60],
      [12, 140, 250],
    ];
    const f = frameFromFn(20, 20, (x, y) => colors[(x + y) % 4] ?? [0, 0, 0]);
    const p = buildPalette([f], 32);
    expect(p.count).toBe(4);
    const got = new Set<string>();
    for (let i = 0; i < p.count; i++)
      got.add(Array.from(p.rgb.subarray(i * 3, i * 3 + 3)).join(","));
    for (const c of colors) expect(got.has(c.join(","))).toBe(true);
  });

  it("skips transparent pixels when asked", () => {
    const f = frameFromFn(4, 4, (x) => (x < 2 ? [255, 0, 0, 0] : [0, 0, 255, 255]));
    const p = buildPalette([f], 32, true);
    expect(p.count).toBe(1);
    expect(Array.from(p.rgb)).toEqual([0, 0, 255]);
  });

  it("property: palette size is within [1, maxColors] and ≤ distinct bins", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 256 }),
        (seed, max) => {
          const f = noiseFrame(24, 24, seed);
          const p = medianCut(histOf(f), max);
          expect(p.count).toBeGreaterThanOrEqual(1);
          expect(p.count).toBeLessThanOrEqual(max);
          expect(p.rgb.length).toBe(p.count * 3);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("uses the full budget on rich images and is deterministic", () => {
    const f = gradientFrame(128, 128);
    const a = buildPalette([f], 256);
    const b = buildPalette([f], 256);
    expect(a.count).toBe(256);
    expect(a.rgb).toEqual(b.rgb);
  });
});

function histOf(f: ReturnType<typeof noiseFrame>): ColorHistogram {
  const h = new ColorHistogram();
  h.addFrame(f);
  return h;
}

describe("color tables", () => {
  it("pads to a power of two ≥ 2", () => {
    expect(colorTableBits(1)).toBe(1);
    expect(colorTableBits(2)).toBe(1);
    expect(colorTableBits(3)).toBe(2);
    expect(colorTableBits(256)).toBe(8);
    expect(toColorTable({ rgb: new Uint8Array([1, 2, 3]), count: 1 }).length).toBe(6);
    expect(toColorTable({ rgb: new Uint8Array(3 * 5), count: 5 }, 6).length).toBe(24);
  });
});

describe("createColorLookup", () => {
  it("maps exact palette colors to themselves even when they share a 5-bit bucket", () => {
    const rgb = new Uint8Array([10, 10, 10, 12, 12, 12, 13, 10, 11, 250, 0, 0]);
    const lookup = createColorLookup({ rgb, count: 4 });
    expect(lookup.nearest(10, 10, 10)).toBe(0);
    expect(lookup.nearest(12, 12, 12)).toBe(1);
    expect(lookup.nearest(13, 10, 11)).toBe(2);
    expect(lookup.nearest(250, 0, 0)).toBe(3);
  });

  it("throws for an empty palette", () => {
    expect(() => createColorLookup({ rgb: new Uint8Array(0), count: 0 })).toThrow(RangeError);
  });

  it("property: result is in range and within one bucket of the true nearest", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 3, maxLength: 3 * 64 }).filter((a) => a.length % 3 === 0),
        fc.tuple(
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
        ),
        (rgb, [r, g, b]) => {
          const count = rgb.length / 3;
          const lookup = createColorLookup({ rgb, count });
          const idx = lookup.nearest(r, g, b);
          expect(idx >= 0 && idx < count).toBe(true);
          const d = (i: number) =>
            Math.sqrt(
              ((rgb[i * 3] ?? 0) - r) ** 2 +
                ((rgb[i * 3 + 1] ?? 0) - g) ** 2 +
                ((rgb[i * 3 + 2] ?? 0) - b) ** 2,
            );
          let best = Number.POSITIVE_INFINITY;
          for (let i = 0; i < count; i++) best = Math.min(best, d(i));
          // bucket quantization error ≤ 2 × half-diagonal of an 8-wide cube
          expect(d(idx)).toBeLessThanOrEqual(best + 2 * Math.sqrt(3 * 4 * 4) + 1e-9);
        },
      ),
    );
  });
});

describe("ColorHistogram sampling", () => {
  it("masked sampling counts every masked pixel while under budget, regardless of rect size", () => {
    const W = 1000;
    const H = 600;
    const frame = frameFromFn(W, H, () => [7, 7, 7]);
    const mask = new Uint8Array(W * H);
    for (const p of [0, 1, 501 + 301 * W, W * H - 1]) mask[p] = 1;
    const h = new ColorHistogram();
    h.addFrame(frame, { mask });
    expect(h.total).toBe(4);
  });

  it("unmasked sampling reads at most ~500k pixels but at least a quarter of that on large frames", () => {
    const W = 2000;
    const H = 1200; // 2.4M px
    const frame = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    const h = new ColorHistogram();
    h.addFrame(frame);
    expect(h.total).toBeLessThanOrEqual(500_000);
    expect(h.total).toBeGreaterThan(125_000);
  });
});
