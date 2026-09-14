import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  amplitudeToDb,
  clampRate,
  detectIdleSections,
  detectSilentGaps,
  formatMmSs,
  formatSilencePreview,
  normalizeSpeedRegion,
  suggestIdleSpeedRegions,
  summarizeGaps,
  updateSpeedRegion,
} from "./logic";
import { DEFAULT_EFFECTS_SETTINGS, effectsSettingsSchema, type SpeedRegionEdit, type TimeRange } from "./types";

const region = (over: Partial<SpeedRegionEdit> = {}): SpeedRegionEdit => ({
  id: "s1",
  startMs: 1000,
  endMs: 3000,
  rate: 2,
  keepPitch: true,
  rampInMs: 0,
  rampOutMs: 0,
  ...over,
});

const assertRangesValid = (ranges: TimeRange[], minLen: number) => {
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i] as TimeRange;
    expect(r.endMs).toBeGreaterThan(r.startMs);
    expect(r.endMs - r.startMs).toBeGreaterThanOrEqual(minLen - 1e-9);
    if (i > 0) expect(r.startMs).toBeGreaterThanOrEqual((ranges[i - 1] as TimeRange).endMs);
  }
};

describe("types", () => {
  it("defaults validate against the schema", () => {
    expect(effectsSettingsSchema.parse(DEFAULT_EFFECTS_SETTINGS)).toEqual(DEFAULT_EFFECTS_SETTINGS);
  });
});

describe("amplitudeToDb", () => {
  it("maps 1 → 0 dB, 0.1 → -20 dB, 0 → -Infinity", () => {
    expect(amplitudeToDb(1)).toBe(0);
    expect(amplitudeToDb(0.1)).toBeCloseTo(-20);
    expect(amplitudeToDb(0)).toBe(-Infinity);
  });
});

describe("detectSilentGaps", () => {
  const params = { thresholdDb: -40, minSilenceMs: 500 };

  it("finds runs below threshold that meet min length (10 windows/s)", () => {
    // 0–0.5s loud, 0.5–1.5s silent (1000ms), 1.5–1.8 loud, 1.8–2.1 silent (300ms, too short),
    // 2.1–2.2 loud, 2.2–end silent (900ms, digital silence)
    const env = [
      ...Array(5).fill(-10),
      ...Array(10).fill(-60),
      ...Array(3).fill(-10),
      ...Array(3).fill(-60),
      -10,
      ...Array(9).fill(-Infinity),
    ];
    const gaps = detectSilentGaps(env, 10, params);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toEqual({ startMs: 500, endMs: 1500 });
    expect(gaps[1]?.startMs).toBeCloseTo(2200);
    expect(gaps[1]?.endMs).toBeCloseTo(3100);
  });

  it("treats the threshold as inclusive and NaN as not silent", () => {
    expect(detectSilentGaps([-40, -40], 1, { thresholdDb: -40, minSilenceMs: 2000 })).toEqual([
      { startMs: 0, endMs: 2000 },
    ]);
    expect(detectSilentGaps([-60, Number.NaN, -60], 1, { thresholdDb: -40, minSilenceMs: 1500 })).toEqual([]);
  });

  it("returns [] for empty input or bad sample rate", () => {
    expect(detectSilentGaps([], 100, params)).toEqual([]);
    expect(detectSilentGaps([-90, -90], 0, params)).toEqual([]);
    expect(detectSilentGaps([-90, -90], Number.NaN, params)).toEqual([]);
  });

  it("property: gaps sorted, non-overlapping, each ≥ minSilenceMs, and fully silent", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.double({ min: -100, max: 0, noNaN: true }), fc.constant(-Infinity)), { maxLength: 300 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: -80, max: -10 }),
        fc.integer({ min: 0, max: 3000 }),
        (env, sr, thresholdDb, minSilenceMs) => {
          const gaps = detectSilentGaps(env, sr, { thresholdDb, minSilenceMs });
          assertRangesValid(gaps, minSilenceMs);
          const w = 1000 / sr;
          for (const g of gaps) {
            const a = Math.round(g.startMs / w);
            const b = Math.round(g.endMs / w);
            for (let i = a; i < b; i++) expect(env[i]).toBeLessThanOrEqual(thresholdDb);
            // maximal: neighbours are not silent
            if (a > 0) expect(env[a - 1]).toBeGreaterThan(thresholdDb);
            if (b < env.length) expect(env[b]).toBeGreaterThan(thresholdDb);
          }
        },
      ),
    );
  });

  it("property: raising minSilenceMs never adds gaps", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -90, max: 0 }), { maxLength: 200 }), fc.nat(2000), fc.nat(2000), (env, m1, m2) => {
        const lo = Math.min(m1, m2);
        const hi = Math.max(m1, m2);
        const p = (m: number) => detectSilentGaps(env, 50, { thresholdDb: -40, minSilenceMs: m }).length;
        expect(p(hi)).toBeLessThanOrEqual(p(lo));
      }),
    );
  });
});

describe("silence preview", () => {
  it("summarizes and formats like the spec copy", () => {
    const gaps = Array.from({ length: 12 }, (_, i) => ({ startMs: i * 5000, endMs: i * 5000 + 1500 }));
    const s = summarizeGaps(gaps);
    expect(s).toEqual({ count: 12, totalMs: 18000 });
    expect(formatSilencePreview(s)).toBe("Would remove 12 gaps (00:18 total)");
  });

  it("singular, empty, and long totals", () => {
    expect(formatSilencePreview({ count: 1, totalMs: 900 })).toBe("Would remove 1 gap (00:01 total)");
    expect(formatSilencePreview({ count: 0, totalMs: 0 })).toBe("No silent gaps found");
    expect(formatMmSs(125_400)).toBe("02:05");
    expect(formatMmSs(-5)).toBe("00:00");
    expect(formatMmSs(6_000_000)).toBe("100:00");
  });
});

describe("detectIdleSections", () => {
  const params = { minIdleMs: 3000, epsilon: 0.002 };
  const still = (from: number, to: number, x: number, step = 100) =>
    Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => ({ tMs: from + i * step, x, y: 0.5 }));

  it("finds stillness ≥ minIdleMs and ignores shorter pauses", () => {
    const samples = [...still(0, 4000, 0.1), ...still(4100, 5000, 0.3), ...still(5100, 9000, 0.6)];
    expect(detectIdleSections(samples, params)).toEqual([
      { startMs: 0, endMs: 4000 },
      { startMs: 5100, endMs: 9000 },
    ]);
  });

  it("clicks break idleness; jitter within epsilon does not", () => {
    const samples = still(0, 6000, 0.2).map((s, i) => ({ ...s, x: s.x + (i % 2) * 0.001 }));
    expect(detectIdleSections(samples, params)).toEqual([{ startMs: 0, endMs: 6000 }]);
    const clicked = samples.map((s) => (s.tMs === 3000 ? { ...s, click: true } : s));
    expect(detectIdleSections(clicked, params)).toEqual([{ startMs: 3000, endMs: 6000 }]);
  });

  it("handles unsorted input and too few samples", () => {
    expect(detectIdleSections([], params)).toEqual([]);
    expect(detectIdleSections([{ tMs: 0, x: 0, y: 0 }], params)).toEqual([]);
    const rev = [...still(0, 3500, 0.4)].reverse();
    expect(detectIdleSections(rev, params)).toEqual([{ startMs: 0, endMs: 3500 }]);
  });

  it("property: sections sorted, non-overlapping, each ≥ minIdleMs", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            tMs: fc.integer({ min: 0, max: 60_000 }),
            x: fc.constantFrom(0, 0.001, 0.5, 0.9),
            y: fc.constantFrom(0, 0.5),
            click: fc.boolean(),
          }),
          { maxLength: 200 },
        ),
        fc.integer({ min: 1, max: 10_000 }),
        (samples, minIdleMs) => {
          assertRangesValid(detectIdleSections(samples, { minIdleMs, epsilon: 0.002 }), minIdleMs);
        },
      ),
    );
  });
});

describe("suggestIdleSpeedRegions", () => {
  it("produces 3× regions with 300ms ramps and stable ids", () => {
    const regions = suggestIdleSpeedRegions([{ startMs: 1000, endMs: 5000 }]);
    expect(regions).toEqual([
      { id: "idle-0-1000", startMs: 1000, endMs: 5000, rate: 3, keepPitch: true, rampInMs: 300, rampOutMs: 300 },
    ]);
  });

  it("shrinks ramps for short sections", () => {
    const [r] = suggestIdleSpeedRegions([{ startMs: 0, endMs: 400 }], {
      minIdleMs: 0,
      epsilon: 0,
      rate: 3,
      rampMs: 300,
    });
    expect(r?.rampInMs).toBe(200);
    expect(r?.rampOutMs).toBe(200);
  });
});

describe("speed region edits", () => {
  it("clamps rate to 0.25–8 and falls back to 1× for non-finite", () => {
    expect(clampRate(0.1)).toBe(0.25);
    expect(clampRate(20)).toBe(8);
    expect(clampRate(1.5)).toBe(1.5);
    expect(clampRate(Number.NaN)).toBe(1);
    expect(clampRate(Infinity)).toBe(1);
  });

  it("ramps are capped at half the region and non-negative", () => {
    expect(updateSpeedRegion(region(), { rampInMs: 5000 }).rampInMs).toBe(1000);
    expect(updateSpeedRegion(region(), { rampOutMs: -20 }).rampOutMs).toBe(0);
    expect(updateSpeedRegion(region(), { rampInMs: Number.NaN }).rampInMs).toBe(0);
    expect(updateSpeedRegion(region(), { keepPitch: false })).toEqual(region({ keepPitch: false }));
  });

  it("property: normalized region always satisfies invariants", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.double({ noNaN: false }),
        fc.double(),
        fc.double(),
        (start, len, rate, rin, rout) => {
          const r = normalizeSpeedRegion(region({ startMs: start, endMs: start + len, rate, rampInMs: rin, rampOutMs: rout }));
          expect(r.rate).toBeGreaterThanOrEqual(0.25);
          expect(r.rate).toBeLessThanOrEqual(8);
          for (const ramp of [r.rampInMs, r.rampOutMs]) {
            expect(ramp).toBeGreaterThanOrEqual(0);
            expect(ramp).toBeLessThanOrEqual(len / 2);
          }
          expect(r.rampInMs + r.rampOutMs).toBeLessThanOrEqual(len);
        },
      ),
    );
  });
});
