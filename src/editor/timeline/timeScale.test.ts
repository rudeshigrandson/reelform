import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MIN_VISIBLE_MS,
  clampScale,
  fitScale,
  formatClock,
  formatTickLabel,
  msToPx,
  pxToMs,
  rulerTicks,
  zoomAround,
} from "./timeScale";

describe("msToPx / pxToMs", () => {
  it("round-trips for any positive scale", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e7, noNaN: true }),
        fc.double({ min: 1e-5, max: 10, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (ms, pxPerMs, scrollMs) => {
          const s = { pxPerMs, scrollMs };
          expect(pxToMs(msToPx(ms, s), s)).toBeCloseTo(ms, 3);
        },
      ),
    );
  });

  it("maps scrollMs to x = 0", () => {
    expect(msToPx(2500, { pxPerMs: 0.1, scrollMs: 2500 })).toBe(0);
    expect(pxToMs(100, { pxPerMs: 0.1, scrollMs: 2500 })).toBe(3500);
  });

  it("pxToMs is safe at zero scale", () => {
    expect(pxToMs(100, { pxPerMs: 0, scrollMs: 7 })).toBe(7);
  });
});

describe("fitScale / clampScale", () => {
  it("fits the whole duration", () => {
    expect(fitScale(10_000, 1000)).toEqual({ pxPerMs: 0.1, scrollMs: 0 });
  });

  it("zero duration falls back to a 5s span, never NaN", () => {
    const s = fitScale(0, 1000);
    expect(s.pxPerMs).toBeCloseTo(1000 / MIN_VISIBLE_MS);
    const c = clampScale({ pxPerMs: 99, scrollMs: 50 }, 0, 1000);
    expect(Number.isFinite(c.pxPerMs)).toBe(true);
    expect(c.scrollMs).toBe(0);
  });

  it("limits visible span to 5s…full and scroll to [0, duration − span]", () => {
    const d = 60_000;
    const zoomedIn = clampScale({ pxPerMs: 100, scrollMs: 0 }, d, 1000);
    expect(1000 / zoomedIn.pxPerMs).toBeCloseTo(5000);
    const zoomedOut = clampScale({ pxPerMs: 1e-6, scrollMs: 0 }, d, 1000);
    expect(1000 / zoomedOut.pxPerMs).toBeCloseTo(d);
    expect(clampScale({ pxPerMs: 0.2, scrollMs: 1e9 }, d, 1000).scrollMs).toBeCloseTo(55_000);
    expect(clampScale({ pxPerMs: 0.2, scrollMs: -5 }, d, 1000).scrollMs).toBe(0);
  });

  it("short durations (< 5s) cannot zoom past full", () => {
    const c = clampScale({ pxPerMs: 100, scrollMs: 0 }, 2000, 1000);
    expect(c.pxPerMs).toBeCloseTo(0.5);
  });

  it("zero viewport is safe", () => {
    expect(clampScale({ pxPerMs: 1, scrollMs: 10 }, 1000, 0)).toEqual({ pxPerMs: 0, scrollMs: 0 });
  });
});

describe("zoomAround", () => {
  it("keeps the time under the anchor fixed", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-4, max: 5, noNaN: true }),
        fc.double({ min: 0, max: 1e5, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        (pxPerMs, scrollMs, anchor, factor) => {
          const s = { pxPerMs, scrollMs };
          const next = zoomAround(s, anchor, factor);
          expect(next.pxPerMs).toBeCloseTo(pxPerMs * factor, 8);
          const before = pxToMs(anchor, s);
          expect(pxToMs(anchor, next)).toBeCloseTo(before, Math.abs(before) > 1e4 ? 1 : 4);
        },
      ),
    );
  });

  it("ignores non-positive factors", () => {
    const s = { pxPerMs: 0.1, scrollMs: 0 };
    expect(zoomAround(s, 10, 0)).toEqual(s);
    expect(zoomAround(s, 10, Number.NaN)).toEqual(s);
  });
});

describe("rulerTicks", () => {
  const check = (pxPerMs: number, scrollMs: number, viewport: number, fps: number) => {
    const ticks = rulerTicks({ pxPerMs, scrollMs }, viewport, fps);
    expect(ticks.length).toBeGreaterThan(0);
    for (let i = 1; i < ticks.length; i++) {
      expect((ticks[i]?.ms ?? 0) > (ticks[i - 1]?.ms ?? 0)).toBe(true);
    }
    const labels = ticks.filter((t) => t.major).map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((l) => typeof l === "string" && l.length > 0)).toBe(true);
    return ticks;
  };

  it("is monotonic, non-empty, uniquely labelled across zooms", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-5, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 3.6e6, noNaN: true }),
        fc.constantFrom(24, 30, 60),
        (pxPerMs, scrollMs, fps) => {
          check(pxPerMs, scrollMs, 1200, fps);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("uses 1s majors with minors at fit-ish zoom and no frame ticks", () => {
    const ticks = check(0.1, 0, 1000, 30); // 100 px/s
    const majors = ticks.filter((t) => t.major);
    expect(majors[1]?.ms).toBe(1000);
    expect(majors[1]?.label).toBe("0:01");
    expect(ticks.filter((t) => !t.major).length).toBeGreaterThan(0);
  });

  it("switches to frame ticks at ≥ 200 px/s", () => {
    const ticks = check(0.2, 0, 1000, 30);
    const minors = ticks.filter((t) => !t.major);
    expect(minors[0]?.ms).toBeCloseTo(1000 / 30);
    const below = rulerTicks({ pxPerMs: 0.19, scrollMs: 0 }, 1000, 30).filter((t) => !t.major);
    expect(below.some((t) => Math.abs(t.ms - 1000 / 30) < 1e-6)).toBe(false);
  });

  it("labels sub-second majors with decimals", () => {
    expect(formatTickLabel(1500, 500)).toBe("0:01.5");
    expect(formatTickLabel(3_725_000, 5000)).toBe("1:02:05");
  });

  it("returns [] for zero viewport or zero scale", () => {
    expect(rulerTicks({ pxPerMs: 0.1, scrollMs: 0 }, 0, 30)).toEqual([]);
    expect(rulerTicks({ pxPerMs: 0, scrollMs: 0 }, 1000, 30)).toEqual([]);
  });
});

describe("formatClock", () => {
  it("formats mm:ss.mmm", () => {
    expect(formatClock(2000)).toBe("00:02.000");
    expect(formatClock(4500)).toBe("00:04.500");
    expect(formatClock(3_600_001)).toBe("1:00:00.001");
    expect(formatClock(Number.NaN)).toBe("00:00.000");
  });
});
