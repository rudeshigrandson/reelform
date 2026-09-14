import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createColorLookup } from "./colorLookup";
import { bayerSpread, quantizeRect } from "./dither";
import { buildPalette } from "./palette";
import { frameFromFn, gradientFrame, noiseFrame } from "./testing/frames";
import type { GifDither } from "./types";

const MODES: GifDither[] = ["none", "bayer4", "bayer8", "floyd-steinberg"];

describe("quantizeRect", () => {
  it("property: every mode keeps indices within the palette (or the skip index)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 64 }),
        fc.constantFrom(...MODES),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 20 }),
        (seed, colors, dither, w, h) => {
          const frame = noiseFrame(w, h, seed);
          const palette = buildPalette([frame], colors);
          const lookup = createColorLookup(palette);
          const skipIndex = palette.count;
          const include = new Uint8Array(w * h).map((_, i) => (i * seed) % 3);
          const out = quantizeRect({
            frame,
            rect: { x: 0, y: 0, width: w, height: h },
            lookup,
            dither,
            include,
            skipIndex,
          });
          expect(out.length).toBe(w * h);
          for (let i = 0; i < out.length; i++) {
            const v = out[i] ?? -1;
            if (include[i] === 0) expect(v).toBe(skipIndex);
            else expect(v >= 0 && v < palette.count).toBe(true);
          }
        },
      ),
      { numRuns: 120 },
    );
  });

  it("only reads the requested sub-rect", () => {
    const frame = frameFromFn(8, 8, (x, y) =>
      x >= 2 && x < 5 && y >= 3 && y < 7 ? [255, 0, 0] : [0, 0, 255],
    );
    const lookup = createColorLookup(buildPalette([frame], 32));
    const red = lookup.nearest(255, 0, 0);
    for (const dither of MODES) {
      const out = quantizeRect({
        frame,
        rect: { x: 2, y: 3, width: 3, height: 4 },
        lookup,
        dither,
      });
      expect(out.length).toBe(12);
      expect(Array.from(out).every((v) => v === red)).toBe(true);
    }
  });

  it("maps alpha < 128 to the skip index when alphaTransparent", () => {
    const frame = frameFromFn(4, 1, (x) => [200, 200, 200, x < 2 ? 0 : 255]);
    const lookup = createColorLookup(buildPalette([frame], 32));
    const out = quantizeRect({
      frame,
      rect: { x: 0, y: 0, width: 4, height: 1 },
      lookup,
      dither: "floyd-steinberg",
      skipIndex: 9,
      alphaTransparent: true,
    });
    expect(Array.from(out)).toEqual([9, 9, 0, 0]);
  });

  it("dithering spreads a gradient over more palette entries than nearest-only", () => {
    const frame = gradientFrame(64, 64);
    const lookup = createColorLookup(buildPalette([frame], 8));
    const rect = { x: 0, y: 0, width: 64, height: 64 };
    const mean = (d: GifDither): number => {
      const out = quantizeRect({ frame, rect, lookup, dither: d });
      // mean absolute error of red channel over the image, averaged in 8×8 blocks
      let err = 0;
      for (let by = 0; by < 64; by += 8)
        for (let bx = 0; bx < 64; bx += 8) {
          let src = 0;
          let dst = 0;
          for (let y = by; y < by + 8; y++)
            for (let x = bx; x < bx + 8; x++) {
              src += frame.data[(y * 64 + x) * 4] ?? 0;
              dst += lookup.palette.rgb[(out[y * 64 + x] ?? 0) * 3] ?? 0;
            }
          err += Math.abs(src - dst) / 64;
        }
      return err;
    };
    expect(mean("floyd-steinberg")).toBeLessThan(mean("none"));
    expect(mean("bayer8")).toBeLessThan(mean("none"));
  });

  it("is deterministic", () => {
    const frame = noiseFrame(16, 16, 42);
    const lookup = createColorLookup(buildPalette([frame], 32));
    const rect = { x: 0, y: 0, width: 16, height: 16 };
    for (const dither of MODES)
      expect(quantizeRect({ frame, rect, lookup, dither })).toEqual(
        quantizeRect({ frame, rect, lookup, dither }),
      );
  });
});

describe("bayerSpread", () => {
  it("stays in [8, 64] and shrinks with more colors", () => {
    expect(bayerSpread(2)).toBe(64);
    expect(bayerSpread(256)).toBeLessThan(bayerSpread(32));
    expect(bayerSpread(1e9)).toBe(8);
  });
});
