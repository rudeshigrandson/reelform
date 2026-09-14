import fc from "fast-check";
import type { Clip } from "../model/schema";
import { SpeedMap, sourceSegments } from "./speedMap";

describe("SpeedMap", () => {
  it("identity without regions", () => {
    const m = new SpeedMap([]);
    expect(m.timelineToOutput(1234)).toBe(1234);
    expect(m.outputToTimeline(1234)).toBe(1234);
    expect(m.rateAt(5)).toBe(1);
  });

  it("constant 2× region halves its output length", () => {
    const m = new SpeedMap([{ startMs: 1000, endMs: 3000, rate: 2 }]);
    expect(m.timelineToOutput(1000)).toBe(1000);
    expect(m.timelineToOutput(2000)).toBe(1500);
    expect(m.timelineToOutput(3000)).toBe(2000);
    expect(m.timelineToOutput(4000)).toBe(3000);
    expect(m.outputToTimeline(1500)).toBe(2000);
    expect(m.rateAt(1500)).toBe(2);
    expect(m.rateAt(3000)).toBe(1); // half-open
  });

  it("slow-motion 0.5× doubles output length", () => {
    const m = new SpeedMap([{ startMs: 0, endMs: 1000, rate: 0.5 }]);
    expect(m.timelineToOutput(1000)).toBe(2000);
  });

  it("linear ramps integrate in closed form", () => {
    // Ramp 1→3 over 1000ms: ∫ dt/(1+0.002t) = ln(3)/0.002.
    const m = new SpeedMap([{ startMs: 0, endMs: 1000, rate: 3, rampInMs: 1000 }]);
    expect(m.timelineToOutput(1000)).toBeCloseTo(Math.log(3) / 0.002, 9);
    expect(m.rateAt(500)).toBeCloseTo(2, 9);
  });

  it("ramps longer than the region are scaled down to fit", () => {
    const m = new SpeedMap([{ startMs: 0, endMs: 600, rate: 2, rampInMs: 600, rampOutMs: 600 }]);
    expect(m.pieces).toHaveLength(2);
    expect(m.pieces[0]?.t1).toBeCloseTo(300);
  });

  it("overlapping regions: earlier wins, later is trimmed", () => {
    const m = new SpeedMap([
      { startMs: 500, endMs: 1500, rate: 4 },
      { startMs: 0, endMs: 1000, rate: 2 },
    ]);
    expect(m.rateAt(900)).toBe(2);
    expect(m.rateAt(1200)).toBe(4);
    expect(m.timelineToOutput(1500)).toBe(500 + 125);
  });

  it("ignores invalid regions and non-positive rates", () => {
    const m = new SpeedMap([
      { startMs: 10, endMs: 10, rate: 2 },
      { startMs: Number.NaN, endMs: 5, rate: 2 },
      { startMs: 0, endMs: 100, rate: 0 },
    ]);
    expect(m.timelineToOutput(100)).toBe(100);
  });

  it("inverse and monotonicity (property)", () => {
    const region = fc
      .record({
        start: fc.integer({ min: 0, max: 20_000 }),
        len: fc.integer({ min: 1, max: 5_000 }),
        rate: fc.double({ min: 0.25, max: 8, noNaN: true }),
        ri: fc.integer({ min: 0, max: 1000 }),
        ro: fc.integer({ min: 0, max: 1000 }),
      })
      .map((r) => ({
        startMs: r.start,
        endMs: r.start + r.len,
        rate: r.rate,
        rampInMs: r.ri,
        rampOutMs: r.ro,
      }));
    fc.assert(
      fc.property(
        fc.array(region, { maxLength: 5 }),
        fc.double({ min: 0, max: 30_000, noNaN: true }),
        fc.double({ min: 0, max: 30_000, noNaN: true }),
        (regions, a, b) => {
          const m = new SpeedMap(regions);
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(m.timelineToOutput(lo)).toBeLessThanOrEqual(m.timelineToOutput(hi) + 1e-9);
          expect(m.outputToTimeline(m.timelineToOutput(a))).toBeCloseTo(a, 5);
        },
      ),
    );
  });
});

describe("sourceSegments", () => {
  const clips: Clip[] = [
    { id: "a", sourceStartMs: 0, sourceEndMs: 2000, timelineStartMs: 0 },
    { id: "b", sourceStartMs: 5000, sourceEndMs: 7000, timelineStartMs: 2000 },
  ];

  it("splits at clip and region boundaries with rates", () => {
    const segs = sourceSegments(clips, new SpeedMap([{ startMs: 1000, endMs: 3000, rate: 2 }]));
    expect(segs).toEqual([
      {
        clipId: "a",
        outputStartMs: 0,
        outputEndMs: 1000,
        sourceStartMs: 0,
        sourceEndMs: 1000,
        rate: 1,
      },
      {
        clipId: "a",
        outputStartMs: 1000,
        outputEndMs: 1500,
        sourceStartMs: 1000,
        sourceEndMs: 2000,
        rate: 2,
      },
      {
        clipId: "b",
        outputStartMs: 1500,
        outputEndMs: 2000,
        sourceStartMs: 5000,
        sourceEndMs: 6000,
        rate: 2,
      },
      {
        clipId: "b",
        outputStartMs: 2000,
        outputEndMs: 3000,
        sourceStartMs: 6000,
        sourceEndMs: 7000,
        rate: 1,
      },
    ]);
  });

  it("segments are contiguous and cover all source ms (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 1, max: 3000 }),
        fc.double({ min: 0.25, max: 8, noNaN: true }),
        fc.integer({ min: 0, max: 500 }),
        (start, len, rate, ramp) => {
          const segs = sourceSegments(
            clips,
            new SpeedMap([
              { startMs: start, endMs: start + len, rate, rampInMs: ramp, rampOutMs: ramp },
            ]),
          );
          let src = 0;
          for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            if (!s) continue;
            src += s.sourceEndMs - s.sourceStartMs;
            expect((s.outputEndMs - s.outputStartMs) * s.rate).toBeCloseTo(
              s.sourceEndMs - s.sourceStartMs,
              6,
            );
            const next = segs[i + 1];
            if (next) expect(next.outputStartMs).toBeCloseTo(s.outputEndMs, 9);
          }
          expect(src).toBeCloseTo(4000, 6);
        },
      ),
    );
  });

  it("subdivides ramps into ≤ step pieces", () => {
    const segs = sourceSegments(
      [{ id: "a", sourceStartMs: 0, sourceEndMs: 1000, timelineStartMs: 0 }],
      new SpeedMap([{ startMs: 0, endMs: 1000, rate: 2, rampInMs: 100 }]),
      20,
    );
    expect(segs).toHaveLength(5 + 1);
    expect(segs[0]?.rate).toBeGreaterThan(1);
    expect(segs[0]?.rate).toBeLessThan(segs[4]?.rate ?? 0);
  });
});
