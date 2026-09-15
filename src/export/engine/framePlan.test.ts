import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Clip } from "../../editor/model/schema";
import { createFramePlan, keyFrameInterval } from "./framePlan";

const clip = (
  id: string,
  sourceStartMs: number,
  sourceEndMs: number,
  timelineStartMs: number,
): Clip => ({
  id,
  sourceStartMs,
  sourceEndMs,
  timelineStartMs,
});

describe("createFramePlan — no speed regions", () => {
  it("maps output frame i to tMs = i*1000/fps with µs timestamps", () => {
    const plan = createFramePlan({ clips: [clip("a", 500, 2500, 0)], fps: 30 });
    expect(plan.totalFrames).toBe(60);
    expect(plan.outputDurationMs).toBe(2000);
    const f = plan.frameAt(7);
    expect(f.outputMs).toBeCloseTo(233.3333, 3);
    expect(f.timelineMs).toBeCloseTo(233.3333, 3);
    expect(f.timestampUs).toBe(233333);
    expect(f.durationUs).toBe(33333);
    expect(f.sourceMs).toBeCloseTo(733.3333, 3);
    expect(f.clipId).toBe("a");
  });

  it("keyframes every 2 s", () => {
    const plan = createFramePlan({ clips: [clip("a", 0, 5000, 0)], fps: 60 });
    const keys = [...plan.frames()].filter((f) => f.keyFrame).map((f) => f.index);
    expect(keys).toEqual([0, 120, 240]);
    expect(keyFrameInterval(29.97)).toBe(60);
    expect(keyFrameInterval(0.1)).toBe(1);
  });

  it("follows clip order across a cut", () => {
    const plan = createFramePlan({
      clips: [clip("a", 0, 1000, 0), clip("b", 3000, 4000, 1000)],
      fps: 10,
    });
    expect(plan.totalFrames).toBe(20);
    expect(plan.frameAt(9).sourceMs).toBeCloseTo(900);
    expect(plan.frameAt(10)).toMatchObject({ clipId: "b", sourceMs: 3000 });
  });

  it("exports a sub-range", () => {
    const plan = createFramePlan({
      clips: [clip("a", 0, 10_000, 0)],
      fps: 30,
      range: { startMs: 2000, endMs: 3000 },
    });
    expect(plan.totalFrames).toBe(30);
    expect(plan.frameAt(0)).toMatchObject({
      timelineMs: 2000,
      sourceMs: 2000,
      outputMs: 0,
      timestampUs: 0,
    });
  });

  it("frames in a timeline gap have no source", () => {
    const plan = createFramePlan({
      clips: [clip("a", 0, 500, 0)],
      fps: 10,
      range: { startMs: 0, endMs: 1000 },
    });
    expect(plan.frameAt(4).sourceMs).toBe(400);
    expect(plan.frameAt(5)).toMatchObject({ sourceMs: null, clipId: null, sourceFrameMs: null });
  });

  it("empty and invalid inputs", () => {
    expect(createFramePlan({ clips: [], fps: 30 }).totalFrames).toBe(0);
    expect(() => createFramePlan({ clips: [], fps: 0 })).toThrow(RangeError);
    expect(() => createFramePlan({ clips: [], fps: Number.NaN })).toThrow(RangeError);
    const plan = createFramePlan({ clips: [clip("a", 0, 1000, 0)], fps: 30 });
    expect(() => plan.frameAt(30)).toThrow(RangeError);
    expect(() => plan.frameAt(-1)).toThrow(RangeError);
    expect(() => plan.frameAt(1.5)).toThrow(RangeError);
  });

  it("a duration that is an exact frame multiple does not gain a float-noise frame", () => {
    const plan = createFramePlan({ clips: [clip("a", 0, 100, 0)], fps: 30 });
    expect(plan.totalFrames).toBe(3);
    expect(createFramePlan({ clips: [clip("a", 0, 1000 / 3, 0)], fps: 30 }).totalFrames).toBe(10);
  });
});

describe("createFramePlan — speed regions", () => {
  it("a 2× region halves its output duration and skips source frames", () => {
    const plan = createFramePlan({
      clips: [clip("a", 0, 3000, 0)],
      speeds: [{ startMs: 1000, endMs: 2000, rate: 2 }],
      fps: 30,
      sourceFps: 30,
    });
    expect(plan.outputDurationMs).toBeCloseTo(2500);
    expect(plan.totalFrames).toBe(75);
    // Output 1000..1500 ms covers timeline 1000..2000 ms.
    const inRegion = [...plan.frames()].filter((f) => f.timelineMs >= 1000 && f.timelineMs < 2000);
    expect(inRegion).toHaveLength(15);
    const srcFrames = inRegion.map((f) => Math.round(((f.sourceFrameMs as number) * 30) / 1000));
    for (let k = 1; k < srcFrames.length; k++)
      expect((srcFrames[k] as number) - (srcFrames[k - 1] as number)).toBe(2);
    expect(plan.frameAt(60).timelineMs).toBeCloseTo(2500);
  });

  it("rates < 1 repeat source frames", () => {
    const plan = createFramePlan({
      clips: [clip("a", 0, 1000, 0)],
      speeds: [{ startMs: 0, endMs: 1000, rate: 0.5 }],
      fps: 30,
      sourceFps: 30,
    });
    expect(plan.totalFrames).toBe(60);
    const src = [...plan.frames()].map((f) => f.sourceFrameMs);
    const unique = new Set(src.map((s) => Math.round((s as number) * 1000)));
    expect(unique.size).toBe(30);
    const counts = new Map<number | null, number>();
    for (const s of src) counts.set(s, (counts.get(s) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
  });

  it("sourceFrameMs never leaves the clip", () => {
    const plan = createFramePlan({ clips: [clip("a", 10, 45, 0)], fps: 60, sourceFps: 30 });
    for (const f of plan.frames()) {
      expect(f.sourceFrameMs as number).toBeGreaterThanOrEqual(10);
      expect(f.sourceFrameMs as number).toBeLessThan(45);
    }
  });
});

const arbPlanInput = fc
  .record({
    lengths: fc.array(fc.integer({ min: 1, max: 4000 }), { minLength: 1, maxLength: 4 }),
    fps: fc.constantFrom(24, 25, 29.97, 30, 60),
    speeds: fc.array(
      fc.record({
        startMs: fc.integer({ min: 0, max: 16000 }),
        len: fc.integer({ min: 1, max: 3000 }),
        rate: fc.double({ min: 0.25, max: 8, noNaN: true }),
      }),
      { maxLength: 3 },
    ),
  })
  .map(({ lengths, fps, speeds }) => {
    let t = 0;
    const clips = lengths.map((len, i) => {
      const c = clip(`c${i}`, 1000 * i, 1000 * i + len, t);
      t += len;
      return c;
    });
    return {
      clips,
      fps,
      speeds: speeds.map((s) => ({ startMs: s.startMs, endMs: s.startMs + s.len, rate: s.rate })),
    };
  });

describe("createFramePlan — properties", () => {
  it("timeline time is monotonic, in range, and maps into its clip", () => {
    fc.assert(
      fc.property(arbPlanInput, (input) => {
        const plan = createFramePlan(input);
        let prevTimeline = -1;
        let prevTs = -1;
        for (const f of plan.frames()) {
          if (f.timelineMs < prevTimeline) return false;
          if (f.timestampUs <= prevTs) return false;
          if (f.timelineMs < plan.rangeStartMs || f.timelineMs >= plan.rangeEndMs) return false;
          const c = input.clips.find((x) => x.id === f.clipId);
          if (!c || f.sourceMs === null) return false;
          if (f.sourceMs < c.sourceStartMs || f.sourceMs >= c.sourceEndMs) return false;
          prevTimeline = f.timelineMs;
          prevTs = f.timestampUs;
        }
        return true;
      }),
    );
  });

  it("output duration integrates 1/rate and frame count is ceil(duration·fps)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20_000 }),
        fc.double({ min: 0.25, max: 8, noNaN: true }),
        fc.constantFrom(30, 60),
        (len, rate, fps) => {
          const plan = createFramePlan({
            clips: [clip("a", 0, len, 0)],
            speeds: [{ startMs: 0, endMs: len, rate }],
            fps,
          });
          const expected = len / rate;
          return (
            Math.abs(plan.outputDurationMs - expected) < 1e-6 &&
            plan.totalFrames === Math.ceil((expected * fps) / 1000 - 1e-6)
          );
        },
      ),
    );
  });

  it("without speeds the timeline time equals the output time", () => {
    fc.assert(
      fc.property(arbPlanInput, (input) => {
        const plan = createFramePlan({ ...input, speeds: [] });
        for (const f of plan.frames()) {
          if (Math.abs(f.timelineMs - Math.min(f.outputMs, plan.rangeEndMs - 1e-6)) > 1e-6)
            return false;
        }
        return true;
      }),
    );
  });
});
