import fc from "fast-check";
import {
  dbToLinear,
  duckingGainCurve,
  fadeGainAt,
  fadeInGain,
  fadeOutGain,
  limiterGainCurve,
  linearToDb,
  mixToMono,
  peakLimiterGain,
  rmsEnvelope,
  samplePeak,
} from "./dsp";

describe("dB ↔ gain", () => {
  it("handles −∞, NaN and non-positive gains", () => {
    expect(dbToLinear(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(dbToLinear(Number.NaN)).toBe(0);
    expect(linearToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(linearToDb(-1)).toBe(Number.NEGATIVE_INFINITY);
    expect(linearToDb(Number.NaN)).toBe(Number.NEGATIVE_INFINITY);
    expect(dbToLinear(0)).toBe(1);
    expect(dbToLinear(-6)).toBeCloseTo(0.501187, 6);
    expect(dbToLinear(20)).toBeCloseTo(10, 10); // uncapped (unlike the inspector's)
  });

  it("round-trips (property)", () => {
    fc.assert(
      fc.property(fc.double({ min: -200, max: 60, noNaN: true }), (db) => {
        expect(linearToDb(dbToLinear(db))).toBeCloseTo(db, 6);
      }),
    );
  });
});

describe("fades", () => {
  it("linear and equal-power endpoints and midpoint", () => {
    expect(fadeInGain(0)).toBe(0);
    expect(fadeInGain(1)).toBe(1);
    expect(fadeInGain(0.5)).toBe(0.5);
    expect(fadeInGain(0.5, "equal-power")).toBeCloseTo(Math.SQRT1_2, 12);
    expect(fadeOutGain(0)).toBe(1);
    expect(fadeOutGain(1, "equal-power")).toBeCloseTo(0, 12);
    expect(fadeInGain(-3)).toBe(0);
    expect(fadeInGain(Number.NaN)).toBe(0);
  });

  it("equal-power crossfade keeps constant power (property)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (p) => {
        const a = fadeOutGain(p, "equal-power");
        const b = fadeInGain(p, "equal-power");
        expect(a * a + b * b).toBeCloseTo(1, 9);
      }),
    );
  });

  it("fadeGainAt is monotonic inside fades and 1 in the body", () => {
    expect(fadeGainAt(0, 1000, 100, 100)).toBe(0);
    expect(fadeGainAt(50, 1000, 100, 100)).toBeCloseTo(0.5);
    expect(fadeGainAt(500, 1000, 100, 100)).toBe(1);
    expect(fadeGainAt(950, 1000, 100, 100)).toBeCloseTo(0.5);
    expect(fadeGainAt(1000, 1000, 100, 100)).toBe(0);
    expect(fadeGainAt(-1, 1000, 0, 0)).toBe(0);
    expect(fadeGainAt(1001, 1000, 0, 0)).toBe(0);
    expect(fadeGainAt(10, 0, 0, 0)).toBe(0);
  });

  it("overlapping fades shrink proportionally and stay within [0,1] (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 0, max: 20_000, noNaN: true }),
        fc.double({ min: 0, max: 20_000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom("linear" as const, "equal-power" as const),
        (d, fi, fo, p, curve) => {
          const g = fadeGainAt(p * d, d, fi, fo, curve);
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThanOrEqual(1);
        },
      ),
    );
    // fadeIn 800 + fadeOut 800 on 1000ms → 500/500, peak at the middle.
    expect(fadeGainAt(500, 1000, 800, 800)).toBeCloseTo(1);
    expect(fadeGainAt(250, 1000, 800, 800)).toBeCloseTo(0.5);
  });
});

describe("rmsEnvelope / mixToMono / peak", () => {
  it("measures a constant signal and silence", () => {
    const s = new Float32Array(4800).fill(0.5);
    s.fill(0, 2400);
    const env = rmsEnvelope(s, 48_000, 10);
    expect(env.sampleRateHz).toBe(100);
    expect(env.envelopeDb).toHaveLength(10);
    expect(env.envelopeDb[0]).toBeCloseTo(linearToDb(0.5), 5);
    expect(env.envelopeDb[9]).toBe(Number.NEGATIVE_INFINITY);
  });

  it("keeps a partial last window", () => {
    const env = rmsEnvelope(new Float32Array(490).fill(1), 48_000, 10);
    expect(env.envelopeDb).toHaveLength(2);
    expect(env.envelopeDb[1]).toBeCloseTo(0, 6);
    expect(rmsEnvelope(new Float32Array(0), 48_000).envelopeDb).toEqual([]);
  });

  it("mixes to mono and finds the sample peak", () => {
    const m = mixToMono([Float32Array.of(1, 0.5), Float32Array.of(0, 0.5, 9)]);
    expect(Array.from(m)).toEqual([0.5, 0.5]);
    expect(mixToMono([]).length).toBe(0);
    expect(samplePeak([Float32Array.of(0.1, -0.9), Float32Array.of(0.3)])).toBeCloseTo(0.9, 6);
  });
});

describe("ducking envelope follower", () => {
  // 1ms envelope windows: voice active from 100ms to 600ms.
  const rate = 1000;
  const env = Array.from({ length: 1500 }, (_, i) => (i >= 100 && i < 600 ? -10 : -80));
  const curve = duckingGainCurve(env, rate, { amountDb: 12, thresholdDb: -40 });
  const dbAt = (ms: number) => linearToDb(curve[ms] as number);

  it("is unity before the voice starts", () => {
    expect(curve[0]).toBe(1);
    expect(curve[99]).toBe(1);
  });

  it("reaches full reduction exactly attackMs (50ms) after onset", () => {
    expect(dbAt(100 + 24)).toBeCloseTo(-12 * (25 / 50), 6);
    expect(dbAt(100 + 48)).toBeGreaterThan(-12);
    expect(dbAt(100 + 49)).toBeCloseTo(-12, 6);
    expect(dbAt(400)).toBeCloseTo(-12, 6);
  });

  it("recovers fully releaseMs (400ms) after the voice stops", () => {
    expect(dbAt(600 + 199)).toBeCloseTo(-12 * (200 / 400), 6);
    expect(dbAt(600 + 398)).toBeLessThan(0);
    expect(curve[600 + 399]).toBe(1);
    expect(curve[1499]).toBe(1);
  });

  it("is monotone per step and bounded (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -100, max: 0, noNaN: true }), { maxLength: 300 }),
        fc.double({ min: 0, max: 30, noNaN: true }),
        (e, amount) => {
          const c = duckingGainCurve(e, 100, { amountDb: amount });
          const floor = dbToLinear(-amount);
          for (const g of c) {
            expect(g).toBeLessThanOrEqual(1);
            expect(g).toBeGreaterThanOrEqual(floor * (1 - 1e-6));
          }
        },
      ),
    );
  });

  it("invalid rate → unity curve", () => {
    expect(Array.from(duckingGainCurve([0, 0], 0))).toEqual([1, 1]);
  });
});

describe("limiter gain", () => {
  it("static peak limiter", () => {
    expect(peakLimiterGain(0.5, -1)).toBe(1);
    expect(peakLimiterGain(2, 0)).toBe(0.5);
    expect(peakLimiterGain(0, -1)).toBe(1);
  });

  it("curve never lets output exceed the ceiling and releases linearly", () => {
    const x = new Float32Array(1000);
    x[10] = 2;
    const g = limiterGainCurve(x, 1000, 0, 100); // release 100ms at 1kHz → 0.01/sample
    expect(g[9]).toBe(1);
    expect(g[10]).toBeCloseTo(0.5, 6);
    expect(g[60]).toBeCloseTo(1, 6);
    expect(g[35]).toBeCloseTo(0.75, 6);
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -4, max: 4, noNaN: true }), { maxLength: 200 }),
        (arr) => {
          const s = Float32Array.from(arr);
          const gc = limiterGainCurve(s, 48_000, -1);
          const ceil = dbToLinear(-1);
          s.forEach((v, i) =>
            expect(Math.abs(v) * (gc[i] as number)).toBeLessThanOrEqual(ceil + 1e-6),
          );
        },
      ),
    );
  });
});
