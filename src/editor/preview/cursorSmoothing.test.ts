import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CursorPoint } from "./cursorSmoothing.js";
import {
  buildSmoothedCursorTrack,
  knobToMinCutoff,
  RESAMPLE_PERIOD_MS,
  resampleAndSmooth,
  SmoothedCursorTrack,
} from "./cursorSmoothing.js";

/** Build a straight, constant-velocity line from (x0,y0) to (x1,y1). */
function line(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  durationMs: number,
  stepMs: number,
): CursorPoint[] {
  const out: CursorPoint[] = [];
  for (let t = 0; t <= durationMs; t += stepMs) {
    const u = t / durationMs;
    out.push({ tMs: t, x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u });
  }
  return out;
}

describe("knobToMinCutoff", () => {
  it("maps snappy (0) → 5 Hz and silky (1) → 0.5 Hz", () => {
    expect(knobToMinCutoff(0)).toBeCloseTo(5, 6);
    expect(knobToMinCutoff(1)).toBeCloseTo(0.5, 6);
  });

  it("is monotonically decreasing and clamps out-of-range knobs", () => {
    expect(knobToMinCutoff(0.5)).toBeCloseTo(2.75, 6);
    expect(knobToMinCutoff(-5)).toBeCloseTo(5, 6); // clamped to snappy
    expect(knobToMinCutoff(9)).toBeCloseTo(0.5, 6); // clamped to silky
    expect(knobToMinCutoff(0.25)).toBeGreaterThan(knobToMinCutoff(0.75));
  });
});

describe("resampling", () => {
  it("produces a ~240 Hz track (samples spaced ~4.1667 ms apart)", () => {
    const pts = line(0.1, 0.1, 0.9, 0.9, 1000, 50);
    const samples = resampleAndSmooth(pts, { smoothing: 0 });

    // ~240 samples over 1000ms (plus the final endpoint sample).
    expect(samples.length).toBeGreaterThanOrEqual(240);
    expect(samples.length).toBeLessThanOrEqual(242);

    // Interior spacing should match the 240 Hz period.
    for (let i = 1; i < samples.length - 1; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a && b) {
        expect(b.tMs - a.tMs).toBeCloseTo(RESAMPLE_PERIOD_MS, 3);
      }
    }
  });

  it("covers the full input time range", () => {
    const pts = line(0, 0, 1, 1, 800, 40);
    const track = buildSmoothedCursorTrack(pts);
    expect(track.startTimeMs).toBeCloseTo(0, 6);
    expect(track.endTimeMs).toBeCloseTo(800, 6);
  });
});

describe("straight-line fidelity", () => {
  it("keeps a straight-line input on the line after smoothing (within tolerance)", () => {
    // Diagonal line: for every sample, x should ≈ y.
    const pts = line(0.05, 0.05, 0.95, 0.95, 1200, 25);
    const samples = resampleAndSmooth(pts, { smoothing: 0.5 });

    // Skip a short warm-up region while the filter converges.
    const warmup = 60;
    for (let i = warmup; i < samples.length; i++) {
      const s = samples[i];
      expect(s).toBeDefined();
      if (s) {
        // The point must lie on the y = x line within a small tolerance.
        expect(Math.abs(s.x - s.y)).toBeLessThan(0.01);
      }
    }
  });

  it("tracks a horizontal line's constant y closely", () => {
    const pts = line(0.1, 0.4, 0.9, 0.4, 1000, 30);
    const samples = resampleAndSmooth(pts, { smoothing: 0 });
    const warmup = 60;
    for (let i = warmup; i < samples.length; i++) {
      const s = samples[i];
      if (s) expect(Math.abs(s.y - 0.4)).toBeLessThan(0.01);
    }
  });
});

describe("smoothing knob behaviour", () => {
  it("silky lags/rounds a sharp step more than snappy", () => {
    // Sharp step in x at t=500ms: 0.2 → 0.8.
    const pts: CursorPoint[] = [];
    for (let t = 0; t <= 1000; t += 20) {
      pts.push({ tMs: t, x: t < 500 ? 0.2 : 0.8, y: 0.5 });
    }

    const snappy = buildSmoothedCursorTrack(pts, { smoothing: 0 });
    const silky = buildSmoothedCursorTrack(pts, { smoothing: 1 });

    // Just after the step, silky should still be further from the target 0.8
    // (more lag) than snappy.
    const probeMs = 540;
    const snappyX = snappy.positionAt(probeMs).x;
    const silkyX = silky.positionAt(probeMs).x;

    const snappyErr = Math.abs(0.8 - snappyX);
    const silkyErr = Math.abs(0.8 - silkyX);

    expect(silkyErr).toBeGreaterThan(snappyErr);
    // Snappy should have made meaningful progress toward the new value.
    expect(snappyX).toBeGreaterThan(silkyX);
  });

  it("snappy converges to the post-step value faster over time", () => {
    const pts: CursorPoint[] = [];
    for (let t = 0; t <= 1500; t += 20) {
      pts.push({ tMs: t, x: 0.5, y: t < 700 ? 0.2 : 0.8 });
    }
    const snappy = buildSmoothedCursorTrack(pts, { smoothing: 0 });
    const silky = buildSmoothedCursorTrack(pts, { smoothing: 1 });

    // Well after the step, snappy should be at least as close to 0.8 as silky.
    const probeMs = 900;
    const snappyErr = Math.abs(0.8 - snappy.positionAt(probeMs).y);
    const silkyErr = Math.abs(0.8 - silky.positionAt(probeMs).y);
    expect(snappyErr).toBeLessThanOrEqual(silkyErr + 1e-9);
  });
});

describe("positionAt clamping", () => {
  it("clamps requests outside the sampled range to the endpoints", () => {
    const pts = line(0.2, 0.3, 0.8, 0.7, 600, 30);
    const track = buildSmoothedCursorTrack(pts);

    const before = track.positionAt(-1000);
    const start = track.positionAt(track.startTimeMs);
    expect(before.x).toBeCloseTo(start.x, 9);
    expect(before.y).toBeCloseTo(start.y, 9);

    const after = track.positionAt(999999);
    const end = track.positionAt(track.endTimeMs);
    expect(after.x).toBeCloseTo(end.x, 9);
    expect(after.y).toBeCloseTo(end.y, 9);
  });

  it("interpolates between grid samples for in-range times", () => {
    const pts = line(0, 0, 1, 1, 500, 25);
    const track = buildSmoothedCursorTrack(pts);
    const mid = track.positionAt(250);
    // Interpolated value must sit within the sampled bounds.
    expect(mid.x).toBeGreaterThanOrEqual(0);
    expect(mid.x).toBeLessThanOrEqual(1);
    expect(mid.y).toBeGreaterThanOrEqual(0);
    expect(mid.y).toBeLessThanOrEqual(1);
  });
});

describe("edge cases", () => {
  it("returns an empty track for empty input", () => {
    const track = buildSmoothedCursorTrack([]);
    expect(track.samples.length).toBe(0);
    // positionAt on empty track is defined (returns origin, no throw).
    expect(track.positionAt(0)).toEqual({ x: 0, y: 0 });
  });

  it("returns a single sample for single-point input", () => {
    const track = buildSmoothedCursorTrack([{ tMs: 10, x: 0.3, y: 0.7 }]);
    expect(track.samples.length).toBe(1);
    expect(track.positionAt(0).x).toBeCloseTo(0.3, 9);
    expect(track.positionAt(5000).y).toBeCloseTo(0.7, 9);
  });

  it("carries cursorType onto samples", () => {
    const pts: CursorPoint[] = [
      { tMs: 0, x: 0.1, y: 0.1, cursorType: "arrow" },
      { tMs: 500, x: 0.9, y: 0.9, cursorType: "hand" },
    ];
    const samples = resampleAndSmooth(pts);
    const s0 = samples[0];
    const sLast = samples[samples.length - 1];
    expect(s0?.cursorType).toBe("arrow");
    expect(sLast?.cursorType).toBe("hand");
  });

  it("SmoothedCursorTrack can be constructed directly and clamps", () => {
    const track = new SmoothedCursorTrack([
      { tMs: 0, x: 0.1, y: 0.1 },
      { tMs: RESAMPLE_PERIOD_MS, x: 0.2, y: 0.2 },
    ]);
    expect(track.positionAt(-100).x).toBeCloseTo(0.1, 9);
    expect(track.positionAt(100).x).toBeCloseTo(0.2, 9);
  });
});

describe("property: outputs stay in [0,1] for in-range inputs", () => {
  it("never emits x,y outside [0,1] when all inputs are in [0,1]", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dt: fc.integer({ min: 1, max: 120 }),
            x: fc.double({ min: 0, max: 1, noNaN: true }),
            y: fc.double({ min: 0, max: 1, noNaN: true }),
          }),
          { minLength: 2, maxLength: 60 },
        ),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (steps, smoothing) => {
          // Build strictly increasing timestamps from the dt deltas.
          let t = 0;
          const pts: CursorPoint[] = steps.map((s) => {
            t += s.dt;
            return { tMs: t, x: s.x, y: s.y };
          });

          const track = buildSmoothedCursorTrack(pts, { smoothing });
          for (const sample of track.samples) {
            expect(sample.x).toBeGreaterThanOrEqual(0);
            expect(sample.x).toBeLessThanOrEqual(1);
            expect(sample.y).toBeGreaterThanOrEqual(0);
            expect(sample.y).toBeLessThanOrEqual(1);
          }

          // positionAt within range also stays in bounds.
          const midT = (track.startTimeMs + track.endTimeMs) / 2;
          const p = track.positionAt(midT);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(1);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("property: resampled interior spacing is ~240 Hz", () => {
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 3000 }), (durationMs) => {
        const pts = line(0.1, 0.2, 0.8, 0.6, durationMs, Math.max(10, durationMs / 8));
        const samples = resampleAndSmooth(pts);
        for (let i = 2; i < samples.length - 1; i++) {
          const a = samples[i - 1];
          const b = samples[i];
          if (a && b) {
            expect(b.tMs - a.tMs).toBeCloseTo(RESAMPLE_PERIOD_MS, 3);
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});
