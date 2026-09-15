import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GifEncoder } from "./encoder";
import {
  concat,
  frameFromFn,
  gradientFrame,
  noiseFrame,
  rgbAt,
  solidFrame,
} from "./testing/frames";
import { type DecodedGif, decodeGif } from "./testing/gifDecoder";
import type { GifDither, GifEncoderOptions, RgbaFrame } from "./types";

const OPTS: GifEncoderOptions = {
  width: 16,
  height: 12,
  fps: 10,
  colors: 64,
  dither: "none",
  loop: true,
};

function encode(
  frames: RgbaFrame[],
  opts: Partial<GifEncoderOptions> = {},
  samples: RgbaFrame[] = [],
) {
  const first = frames[0] as RgbaFrame;
  const enc = new GifEncoder({ ...OPTS, width: first.width, height: first.height, ...opts });
  for (const s of samples) enc.addSample(s);
  const chunks: Uint8Array[] = [];
  for (const f of frames) chunks.push(...enc.addFrame(f));
  chunks.push(...enc.finish());
  const bytes = concat(chunks);
  expect(enc.bytesEmitted).toBe(bytes.length);
  return { enc, bytes, gif: decodeGif(bytes) };
}

/** Composite RGB must equal the source RGB for every pixel. */
function expectExact(gif: DecodedGif, frame: RgbaFrame, compositeIndex: number) {
  const comp = gif.composites[compositeIndex] as Uint8Array;
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++) {
      const o = (y * frame.width + x) * 4;
      expect(
        [comp[o], comp[o + 1], comp[o + 2]],
        `px ${x},${y} of composite ${compositeIndex}`,
      ).toEqual(rgbAt(frame, x, y));
    }
}

const PALETTE4: [number, number, number][] = [
  [0, 0, 0],
  [255, 255, 255],
  [220, 40, 60],
  [20, 120, 240],
];
/** Frame whose pixels are drawn from PALETTE4 (distinct 5-bit bins → exact palette). */
const paletteFrame = (w: number, h: number, pick: (x: number, y: number) => number) =>
  frameFromFn(w, h, (x, y) => PALETTE4[pick(x, y) % 4] ?? [0, 0, 0]);

describe("GifEncoder round-trip", () => {
  it("writes a valid GIF89a with global palette, loop and delays", () => {
    const f0 = paletteFrame(16, 12, (x, y) => x + y);
    const f1 = paletteFrame(16, 12, (x, y) => (x >= 4 && x < 9 && y >= 2 && y < 5 ? 3 : x + y));
    const f2 = paletteFrame(16, 12, (x, y) => (y === 11 ? 2 : x + y));
    const { gif } = encode([f0, f1, f2]);

    expect(gif.width).toBe(16);
    expect(gif.height).toBe(12);
    expect(gif.loopCount).toBe(0);
    expect(gif.globalPalette).not.toBeNull();
    const table = gif.globalPalette as Uint8Array;
    const entries = new Set<string>();
    for (let i = 0; i < table.length / 3; i++)
      entries.add(Array.from(table.subarray(i * 3, i * 3 + 3)).join(","));
    for (const c of PALETTE4) expect(entries.has(c.join(","))).toBe(true);

    expect(gif.frames.map((f) => f.delayCs)).toEqual([10, 10, 10]);
    expect(gif.frames.every((f) => !f.hasLocalPalette && f.disposal === 1)).toBe(true);
    expect(gif.frames[0]).toMatchObject({ left: 0, top: 0, width: 16, height: 12 });
    expectExact(gif, f0, 0);
    expectExact(gif, f1, 1);
    expectExact(gif, f2, 2);
  });

  it("omits the NETSCAPE loop extension when loop is off", () => {
    const { gif } = encode([solidFrame(4, 4, [10, 20, 30])], { loop: false });
    expect(gif.loopCount).toBeNull();
    expect(gif.frames).toHaveLength(1);
  });

  it("uses cumulative delays at 15fps and merges unchanged frames into the previous delay", () => {
    const a = solidFrame(8, 8, [255, 0, 0]);
    const b = solidFrame(8, 8, [0, 0, 255]);
    const { gif } = encode([a, a, a, b, b], { fps: 15 }, [a, b]);
    expect(gif.frames).toHaveLength(2);
    expect(gif.frames.map((f) => f.delayCs)).toEqual([7 + 6 + 7, 7 + 6]);
    expect(gif.frames.reduce((s, f) => s + f.delayCs, 0)).toBe(Math.round((5 * 100) / 15));
  });

  it("emits every frame full-size when frame differencing is off", () => {
    const a = solidFrame(8, 8, [255, 0, 0]);
    const { gif } = encode([a, a, a], { frameDiff: false });
    expect(gif.frames).toHaveLength(3);
    for (const f of gif.frames)
      expect(f).toMatchObject({ width: 8, height: 8, transparentIndex: null });
  });

  it("builds the global palette from sample frames", () => {
    const first = solidFrame(6, 6, [0, 0, 0]);
    const later = solidFrame(6, 6, [250, 250, 0]);
    const { gif } = encode([first, later], {}, [first, later]);
    expectExact(gif, later, 1);
  });

  it("adaptive palette writes local color tables per frame", () => {
    const a = gradientFrame(20, 10);
    const b = frameFromFn(20, 10, (x) => (x < 10 ? [0, 200, 100] : [90, 10, 250]));
    const { gif } = encode([a, b], { adaptivePalette: true, colors: 32 });
    expect(gif.globalPalette).toBeNull();
    expect(gif.frames.every((f) => f.hasLocalPalette)).toBe(true);
    for (const f of gif.frames) expect(f.palette.length / 3).toBeLessThanOrEqual(32);
    expectExact(gif, b, 1);
  });

  it("alpha mode: clear pixels are transparent, frames dispose to background", () => {
    const a = frameFromFn(6, 4, (x) => (x < 3 ? [0, 0, 0, 0] : [255, 0, 0, 255]));
    const b = frameFromFn(6, 4, (x) => (x >= 3 ? [0, 0, 0, 0] : [0, 255, 0, 255]));
    const { gif } = encode([a, b], { alpha: true }, [a, b]);
    expect(gif.frames).toHaveLength(2);
    for (const f of gif.frames) {
      expect(f.disposal).toBe(2);
      expect(f.transparentIndex).not.toBeNull();
      expect(f).toMatchObject({ width: 6, height: 4 });
    }
    const comp = gif.composites[1] as Uint8Array;
    expect(comp[3]).toBe(255); // x=0 green
    expect(comp[1]).toBe(255);
    expect(comp[5 * 4 + 3]).toBe(0); // x=5 cleared
  });

  it("splits LZW data into ≤255-byte sub-blocks and survives table clears", () => {
    const a = noiseFrame(160, 120, 7);
    const b = noiseFrame(160, 120, 8);
    const { gif } = encode([a, b], { colors: 256 });
    for (const f of gif.frames) expect(f.maxSubBlockLength).toBeLessThanOrEqual(255);
    expect(gif.frames[0]?.maxSubBlockLength).toBe(255);
    expect(gif.frames[0]?.indices.length).toBe(160 * 120);
  });
});

describe("palette size bounds in output", () => {
  it.each([32, 64, 128, 256])("colors=%i → table ≤ colors and indices < table", (colors) => {
    const { gif } = encode([gradientFrame(64, 64), noiseFrame(64, 64, 3)], {
      colors,
      dither: "floyd-steinberg",
    });
    const size = (gif.globalPalette as Uint8Array).length / 3;
    expect(size).toBeLessThanOrEqual(colors);
    for (const f of gif.frames) for (const i of f.indices) expect(i).toBeLessThan(size);
  });

  it.each<GifDither>(["none", "bayer4", "bayer8", "floyd-steinberg"])(
    "dither %s decodes and approximates the source",
    (dither) => {
      const src = gradientFrame(48, 32);
      const { gif } = encode([src], { dither, colors: 64 });
      const comp = gif.composites[0] as Uint8Array;
      let err = 0;
      for (let i = 0; i < 48 * 32; i++)
        for (let c = 0; c < 3; c++)
          err += Math.abs((comp[i * 4 + c] ?? 0) - (src.data[i * 4 + c] ?? 0));
      expect(err / (48 * 32 * 3)).toBeLessThan(24);
    },
  );
});

describe("frame differencing", () => {
  it("property: transparent pixels only where unchanged; sub-frame is the minimal bbox of changes", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: 0, max: 11 }),
            y: fc.integer({ min: 0, max: 9 }),
            w: fc.integer({ min: 0, max: 6 }),
            h: fc.integer({ min: 0, max: 6 }),
            c: fc.integer({ min: 0, max: 3 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (edits) => {
          const W = 12;
          const H = 10;
          let cur = paletteFrame(W, H, (x, y) => (x * 3 + y) >> 2);
          const frames = [cur];
          for (const e of edits) {
            const prev = cur;
            cur = frameFromFn(W, H, (x, y) =>
              x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h
                ? (PALETTE4[e.c] ?? [0, 0, 0])
                : ([...rgbAt(prev, x, y)] as [number, number, number]),
            );
            frames.push(cur);
          }
          const { gif } = encode(frames);

          // Walk source frames; decoded frames skip sources with no change.
          let decoded = 0;
          for (let k = 0; k < frames.length; k++) {
            const src = frames[k] as RgbaFrame;
            if (k > 0) {
              const prev = frames[k - 1] as RgbaFrame;
              let minX = W;
              let minY = H;
              let maxX = -1;
              let maxY = -1;
              for (let y = 0; y < H; y++)
                for (let x = 0; x < W; x++)
                  if (rgbAt(src, x, y).join() !== rgbAt(prev, x, y).join()) {
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                  }
              if (maxX < 0) continue; // merged into previous delay
              const f = gif.frames[decoded];
              if (!f) throw new Error("missing decoded frame");
              expect({ left: f.left, top: f.top, width: f.width, height: f.height }).toEqual({
                left: minX,
                top: minY,
                width: maxX - minX + 1,
                height: maxY - minY + 1,
              });
              for (let y = 0; y < f.height; y++)
                for (let x = 0; x < f.width; x++) {
                  const sx = f.left + x;
                  const sy = f.top + y;
                  const changed = rgbAt(src, sx, sy).join() !== rgbAt(prev, sx, sy).join();
                  const transparent = f.indices[y * f.width + x] === f.transparentIndex;
                  expect(transparent).toBe(!changed);
                }
            }
            expectExact(gif, src, decoded);
            decoded++;
          }
          expect(decoded).toBe(gif.frames.length);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("with dithering, the composite never drifts on unchanged regions", () => {
    const a = gradientFrame(40, 30);
    const b = frameFromFn(40, 30, (x, y) =>
      x < 5 && y < 5 ? [255, 255, 255] : ([...rgbAt(a, x, y)] as [number, number, number]),
    );
    const { gif } = encode([a, b, b, a], { dither: "floyd-steinberg", colors: 32 });
    const c0 = gif.composites[0] as Uint8Array;
    const last = gif.composites[gif.composites.length - 1] as Uint8Array;
    // Pixels outside the 5×5 edit are identical on screen in the first and last composite.
    for (let y = 0; y < 30; y++)
      for (let x = 5; x < 40; x++) {
        const o = (y * 40 + x) * 4;
        expect(last[o]).toBe(c0[o]);
      }
    expect(gif.frames[1]?.width).toBeLessThanOrEqual(5);
  });
});

describe("GifEncoder errors and estimate", () => {
  it("rejects bad dimensions, mismatched frames, empty and double finish", () => {
    expect(() => new GifEncoder({ ...OPTS, width: 0 })).toThrow(RangeError);
    expect(() => new GifEncoder({ ...OPTS, height: 70_000 })).toThrow(RangeError);
    const enc = new GifEncoder(OPTS);
    expect(() => enc.addFrame(solidFrame(4, 4, [0, 0, 0]))).toThrow(RangeError);
    expect(() => enc.finish()).toThrow(/no frames/);
    enc.addFrame(solidFrame(16, 12, [0, 0, 0]));
    enc.finish();
    expect(() => enc.finish()).toThrow(/finished/);
    expect(() => enc.addFrame(solidFrame(16, 12, [0, 0, 0]))).toThrow(/finished/);
  });

  it("reserves a transparent slot within the color budget", () => {
    expect(new GifEncoder({ ...OPTS, colors: 256 }).paletteColors).toBe(255);
    expect(new GifEncoder({ ...OPTS, colors: 256, frameDiff: false }).paletteColors).toBe(256);
    expect(new GifEncoder({ ...OPTS, colors: 4 }).paletteColors).toBe(31);
  });

  it("live estimate settles after 2s of frames and lands close to the real size", () => {
    const total = 40;
    const enc = new GifEncoder({ ...OPTS, width: 32, height: 24, totalFrames: total });
    const chunks: Uint8Array[] = [];
    let settledAt = -1;
    let settledEstimate = 0;
    for (let i = 0; i < total; i++) {
      const f = frameFromFn(32, 24, (x, y) => ((x + i) % 8 < 4 ? [255, 255, 255] : [y * 8, 0, 0]));
      chunks.push(...enc.addFrame(f));
      const e = enc.estimate();
      if (i === 0) expect(e).toBeNull();
      if (e?.settled && settledAt < 0) {
        settledAt = i + 1;
        settledEstimate = e.estimatedBytes;
      }
    }
    chunks.push(...enc.finish());
    const size = concat(chunks).length;
    expect(settledAt).toBe(20);
    expect(settledEstimate).toBeGreaterThan(0);
    expect(Math.abs(settledEstimate - size) / size).toBeLessThan(0.1);
    expect(enc.estimate()?.estimatedBytes).toBe(size);
  });
});

describe("edge cases found in verification", () => {
  it("adaptive palette keeps sparse changed colors on frames above the histogram budget", () => {
    const W = 1000;
    const H = 600; // 600k px > 500k histogram budget
    const bg = solidFrame(W, H, [20, 20, 20]);
    const next = solidFrame(W, H, [20, 20, 20]);
    const set = (x: number, y: number, c: [number, number, number]) => {
      const o = (y * W + x) * 4;
      next.data.set(c, o);
    };
    // Far-apart changes make the sub-frame span the whole frame; odd coordinates
    // used to fall between a spatial stride and vanish from the local palette.
    set(0, 0, [20, 20, 250]);
    set(W - 1, H - 1, [20, 20, 250]);
    set(501, 301, [250, 10, 10]);
    const { gif } = encode([bg, next], { adaptivePalette: true, colors: 64 });
    const comp = gif.composites[1] as Uint8Array;
    const at = (x: number, y: number) => {
      const o = (y * W + x) * 4;
      return [comp[o], comp[o + 1], comp[o + 2]];
    };
    expect(at(501, 301)).toEqual([250, 10, 10]);
    expect(at(0, 0)).toEqual([20, 20, 250]);
    expect(at(W - 1, H - 1)).toEqual([20, 20, 250]);
    expect(at(500, 300)).toEqual([20, 20, 20]);
  });

  it.each([false, true])(
    "long static stretches split at the u16 delay cap without drift (adaptive=%s)",
    (adaptivePalette) => {
      const n = 7000; // 70,000cs > 65,535cs
      const frames = Array.from({ length: n }, () => solidFrame(1, 1, [9, 9, 9]));
      const { gif } = encode(frames, { adaptivePalette, colors: 32 });
      expect(gif.frames.length).toBe(2);
      expect(gif.frames.every((f) => f.delayCs <= 0xffff)).toBe(true);
      expect(gif.frames.reduce((s, f) => s + f.delayCs, 0)).toBe(n * 10);
      const last = gif.composites.at(-1) as Uint8Array;
      expect([last[0], last[1], last[2]]).toEqual([9, 9, 9]);
    },
  );
});
