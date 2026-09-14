import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  estimateGifSize,
  gifDelayCs,
  gifFrameCount,
  gifFrameTimeMs,
  gifOutputSize,
} from "./timing";
import { GIF_FPS_OPTIONS, GIF_SIZE_PRESETS } from "./types";

describe("gifOutputSize", () => {
  it("presets keep aspect ratio", () => {
    expect(GIF_SIZE_PRESETS).toEqual([480, 720, 1080]);
    expect(gifOutputSize(1920, 1080, 480)).toEqual({ width: 853, height: 480 });
    expect(gifOutputSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
    expect(gifOutputSize(2560, 1600, 1080)).toEqual({ width: 1728, height: 1080 });
    expect(gifOutputSize(1080, 1920, 480)).toEqual({ width: 270, height: 480 });
  });
  it("degenerate input stays within 1..65535", () => {
    expect(gifOutputSize(0, 0, 480)).toEqual({ width: 853, height: 480 });
    expect(gifOutputSize(100_000, 1, 1080)).toEqual({ width: 65_535, height: 1080 });
    expect(gifOutputSize(1, 100_000, 480)).toEqual({ width: 1, height: 480 });
    expect(gifOutputSize(16, 9, Number.NaN).height).toBe(1);
  });
});

describe("frame sampling", () => {
  it("counts frames at each fps", () => {
    expect(GIF_FPS_OPTIONS).toEqual([10, 15, 20, 30]);
    expect(gifFrameCount(1000, 30)).toBe(30);
    expect(gifFrameCount(1001, 30)).toBe(31);
    expect(gifFrameCount(10_000, 15)).toBe(150);
    expect(gifFrameCount(0, 10)).toBe(0);
    expect(gifFrameCount(-5, 10)).toBe(0);
    expect(gifFrameCount(1000, 0)).toBe(0);
    expect(gifFrameTimeMs(3, 20)).toBe(150);
  });

  it("15fps delays alternate without drift", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => gifDelayCs(i, 15))).toEqual([7, 6, 7, 7, 6, 7]);
    expect(gifDelayCs(0, 10)).toBe(10);
  });

  it("property: first n delays sum to round(n*100/fps), each ≥ 3cs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...GIF_FPS_OPTIONS),
        fc.integer({ min: 1, max: 5000 }),
        (fps, n) => {
          let sum = 0;
          for (let i = 0; i < n; i++) {
            const d = gifDelayCs(i, fps);
            expect(d).toBeGreaterThanOrEqual(3);
            sum += d;
          }
          expect(sum).toBe(Math.round((n * 100) / fps));
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("estimateGifSize", () => {
  const base = { headerBytes: 800, firstFrameBytes: 10_000, fps: 10 };
  it("null before two frames or unknown total", () => {
    expect(
      estimateGifSize({ ...base, encodedBytes: 10_800, framesEncoded: 1, totalFrames: 100 }),
    ).toBeNull();
    expect(
      estimateGifSize({ ...base, encodedBytes: 12_000, framesEncoded: 5, totalFrames: undefined }),
    ).toBeNull();
  });
  it("extrapolates delta frames and settles after 2s", () => {
    const e = estimateGifSize({
      ...base,
      encodedBytes: 800 + 10_000 + 9 * 500,
      framesEncoded: 10,
      totalFrames: 101,
    });
    expect(e).toEqual({ estimatedBytes: 800 + 10_000 + 100 * 500 + 1, settled: false });
    const s = estimateGifSize({
      ...base,
      encodedBytes: 800 + 10_000 + 19 * 500,
      framesEncoded: 20,
      totalFrames: 101,
    });
    expect(s?.settled).toBe(true);
    expect(s?.estimatedBytes).toBe(800 + 10_000 + 100 * 500 + 1);
  });
  it("exact once all frames are encoded", () => {
    expect(
      estimateGifSize({ ...base, encodedBytes: 5000, framesEncoded: 3, totalFrames: 3 }),
    ).toEqual({
      estimatedBytes: 5001,
      settled: true,
    });
  });
});
