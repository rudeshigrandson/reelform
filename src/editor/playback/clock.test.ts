import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ClockState,
  type RateFn,
  advance,
  clampTime,
  rateAtFromRegions,
  stepFrames,
  stepSeconds,
} from "./clock";

const playing = (patch: Partial<ClockState> = {}): ClockState => ({
  currentMs: 0,
  durationMs: 10_000,
  isPlaying: true,
  loop: false,
  ...patch,
});

describe("advance", () => {
  it("advances 1:1 with no regions", () => {
    expect(advance(playing({ currentMs: 1000 }), 16)).toEqual({ currentMs: 1016, isPlaying: true });
  });

  it("does nothing while paused", () => {
    expect(advance(playing({ currentMs: 500, isPlaying: false }), 100)).toEqual({
      currentMs: 500,
      isPlaying: false,
    });
  });

  it("doubles inside a 2× region", () => {
    const rate = rateAtFromRegions([{ startMs: 0, endMs: 5000, rate: 2 }]);
    expect(advance(playing({ currentMs: 1000 }), 100, rate).currentMs).toBe(1200);
  });

  it("crosses a region boundary mid-step exactly", () => {
    // 50 wall ms at 1× reaches 1000; remaining 50 wall ms at 2× adds 100.
    const rate = rateAtFromRegions([{ startMs: 1000, endMs: 3000, rate: 2 }]);
    expect(advance(playing({ currentMs: 950 }), 100, rate).currentMs).toBe(1100);
    // Leaving a 4× region: 10 wall ms consumes 40ms to 3000, remaining 90 at 1×.
    const fast = rateAtFromRegions([{ startMs: 1000, endMs: 3000, rate: 4 }]);
    expect(advance(playing({ currentMs: 2960 }), 100, fast).currentMs).toBe(3090);
  });

  it("is within 1ms across boundaries for rate functions without boundaries", () => {
    const regions = rateAtFromRegions([{ startMs: 1000, endMs: 3000, rate: 2 }]);
    const opaque: RateFn = (t) => regions(t);
    const exact = advance(playing({ currentMs: 950 }), 100, regions).currentMs;
    const approx = advance(playing({ currentMs: 950 }), 100, opaque).currentMs;
    expect(Math.abs(exact - approx)).toBeLessThanOrEqual(1);
  });

  it("stops at the end when not looping", () => {
    expect(advance(playing({ currentMs: 9990 }), 100)).toEqual({
      currentMs: 10_000,
      isPlaying: false,
    });
  });

  it("wraps to 0 carrying the remainder when looping", () => {
    const r = advance(playing({ currentMs: 9990, loop: true }), 100);
    expect(r.isPlaying).toBe(true);
    expect(r.currentMs).toBeCloseTo(90, 9);
  });

  it("handles multiple wraps in one step", () => {
    const r = advance(playing({ currentMs: 0, durationMs: 100, loop: true }), 250);
    expect(r.currentMs).toBeCloseTo(50, 9);
  });

  it("stops on zero duration", () => {
    expect(advance(playing({ durationMs: 0, loop: true }), 16)).toEqual({
      currentMs: 0,
      isPlaying: false,
    });
  });

  it("ignores negative and NaN elapsed", () => {
    const s = playing({ currentMs: 400 });
    expect(advance(s, -10)).toEqual({ currentMs: 400, isPlaying: true });
    expect(advance(s, Number.NaN)).toEqual({ currentMs: 400, isPlaying: true });
    expect(advance(s, Number.POSITIVE_INFINITY)).toEqual({ currentMs: 400, isPlaying: true });
  });

  it("treats invalid rates as 1×", () => {
    expect(advance(playing({ currentMs: 0 }), 10, () => Number.NaN).currentMs).toBe(10);
    expect(advance(playing({ currentMs: 0 }), 10, () => 0).currentMs).toBe(10);
  });

  it("clamps an out-of-range starting playhead", () => {
    expect(advance(playing({ currentMs: 20_000 }), 10)).toEqual({
      currentMs: 10_000,
      isPlaying: false,
    });
  });

  const regionsArb = fc.array(
    fc
      .record({
        startMs: fc.integer({ min: 0, max: 5000 }),
        len: fc.integer({ min: 1, max: 5000 }),
        rate: fc.constantFrom(0.25, 0.5, 1.5, 2, 4, 8),
      })
      .map(({ startMs, len, rate }) => ({ startMs, endMs: startMs + len, rate })),
    { maxLength: 4 },
  );

  it("property: currentMs stays in [0, duration] and never decreases when not looping", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 8000 }),
        fc.integer({ min: 0, max: 8000 }),
        fc.array(fc.double({ min: -50, max: 200, noNaN: true }), { maxLength: 30 }),
        regionsArb,
        fc.boolean(),
        (durationMs, start, steps, regions, loop) => {
          const rate = rateAtFromRegions(regions);
          let s: ClockState = {
            currentMs: Math.min(start, durationMs),
            durationMs,
            isPlaying: true,
            loop,
          };
          for (const dt of steps) {
            const next = advance(s, dt, rate);
            expect(next.currentMs).toBeGreaterThanOrEqual(0);
            expect(next.currentMs).toBeLessThanOrEqual(durationMs);
            if (!loop) expect(next.currentMs).toBeGreaterThanOrEqual(s.currentMs);
            s = { ...s, ...next };
          }
        },
      ),
    );
  });
});

describe("rateAtFromRegions", () => {
  it("returns 1 outside regions and the rate inside (half-open)", () => {
    const rate = rateAtFromRegions([{ startMs: 100, endMs: 200, rate: 3 }]);
    expect(rate(99)).toBe(1);
    expect(rate(100)).toBe(3);
    expect(rate(199.9)).toBe(3);
    expect(rate(200)).toBe(1);
    expect(rate.nextBoundary?.(0)).toBe(100);
    expect(rate.nextBoundary?.(100)).toBe(200);
    expect(rate.nextBoundary?.(200)).toBe(Number.POSITIVE_INFINITY);
  });

  it("drops degenerate regions", () => {
    const rate = rateAtFromRegions([{ startMs: 200, endMs: 100, rate: 3 }]);
    expect(rate(150)).toBe(1);
  });
});

describe("frame and second stepping", () => {
  it("steps whole frames and lands on boundaries", () => {
    expect(stepFrames(0, 1, 30, 10_000)).toBeCloseTo(1000 / 30, 9);
    expect(stepFrames(1000, -1, 30, 10_000)).toBeCloseTo(1000 - 1000 / 30, 9);
  });

  it("from an off-frame time goes to the adjacent boundary", () => {
    expect(stepFrames(20, 1, 30, 10_000)).toBeCloseTo(1000 / 30, 9);
    expect(stepFrames(20, -1, 30, 10_000)).toBe(0);
  });

  it("clamps at both ends", () => {
    expect(stepFrames(0, -1, 60, 10_000)).toBe(0);
    expect(stepFrames(9995, 5, 60, 10_000)).toBe(10_000);
  });

  it("ignores invalid fps", () => {
    expect(stepFrames(500, 1, 0, 10_000)).toBe(500);
  });

  it("property: stepFrames result is a frame boundary within range", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 60_000, noNaN: true }),
        fc.integer({ min: -100, max: 100 }),
        fc.constantFrom(24, 25, 30, 60),
        (t, n, fps) => {
          const durationMs = 60_000; // a whole number of frames at every fps above
          const r = stepFrames(t, n, fps, durationMs);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(durationMs);
          const frame = (r / 1000) * fps;
          expect(Math.abs(frame - Math.round(frame))).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it("stepSeconds and clampTime clamp", () => {
    expect(stepSeconds(500, -1, 10_000)).toBe(0);
    expect(stepSeconds(9500, 1, 10_000)).toBe(10_000);
    expect(stepSeconds(2000, 3, 10_000)).toBe(5000);
    expect(clampTime(Number.NaN, 100)).toBe(0);
    expect(clampTime(150, 100)).toBe(100);
  });
});
