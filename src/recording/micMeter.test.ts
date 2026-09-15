import fc from "fast-check";
import { ANALYSER_FFT_SIZE, computeRms, createMicMeter, rmsToLevel, smoothLevel } from "./micMeter";
import { FakeAudioContext, FakeStream, FakeTrack, ManualScheduler } from "./testFakes";

describe("computeRms", () => {
  it("handles silence, DC and a full-scale square wave", () => {
    expect(computeRms(new Float32Array(0))).toBe(0);
    expect(computeRms(new Float32Array(16))).toBe(0);
    expect(computeRms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
    expect(computeRms([1, -1, 1, -1])).toBe(1);
  });

  it("ignores non-finite samples and clamps above 1", () => {
    expect(computeRms([Number.NaN, 0, Number.POSITIVE_INFINITY, 0])).toBe(0);
    expect(computeRms([3, -3])).toBe(1);
  });

  it("property: result always within [0, 1]", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -10, max: 10 })), (xs) => {
        const r = computeRms(xs);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe("rmsToLevel", () => {
  it("maps 0 dBFS → 1, -60 dBFS and below → 0, -30 dBFS → 0.5", () => {
    expect(rmsToLevel(1)).toBe(1);
    expect(rmsToLevel(0.001)).toBeCloseTo(0);
    expect(rmsToLevel(0.00001)).toBe(0);
    expect(rmsToLevel(10 ** (-30 / 20))).toBeCloseTo(0.5);
    expect(rmsToLevel(0)).toBe(0);
    expect(rmsToLevel(Number.NaN)).toBe(0);
  });

  it("property: monotone non-decreasing and within [0,1]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(rmsToLevel(lo)).toBeLessThanOrEqual(rmsToLevel(hi));
          expect(rmsToLevel(hi)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe("smoothLevel", () => {
  it("rises with attack and falls with release", () => {
    expect(smoothLevel(0, 1, 0.5, 0.1)).toBe(0.5);
    expect(smoothLevel(1, 0, 0.5, 0.1)).toBeCloseTo(0.9);
  });

  it("sanitises out-of-range inputs", () => {
    expect(smoothLevel(Number.NaN, 2, 1, 1)).toBe(1);
    expect(smoothLevel(5, -1, 1, 1)).toBe(0);
  });

  it("property: stays between prev and target", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (p, t) => {
          const n = smoothLevel(p, t);
          expect(n).toBeGreaterThanOrEqual(Math.min(p, t) - 1e-12);
          expect(n).toBeLessThanOrEqual(Math.max(p, t) + 1e-12);
        },
      ),
    );
  });
});

describe("createMicMeter", () => {
  it("reads the analyser every frame and reports smoothed levels", async () => {
    const ctx = new FakeAudioContext();
    const sched = new ManualScheduler();
    const levels: number[] = [];
    const meter = createMicMeter({
      stream: new FakeStream([new FakeTrack("audio")]),
      createAudioContext: () => ctx,
      schedule: sched.schedule,
      onLevel: (l) => levels.push(l),
      attack: 0.5,
      release: 0.5,
    });
    expect(ctx.connected).toBe(true);
    expect(ctx.analyser.fftSize).toBe(ANALYSER_FFT_SIZE);
    expect(levels).toEqual([]);

    ctx.analyser.value = 1;
    sched.run();
    expect(levels).toEqual([0.5]);
    sched.run();
    expect(levels).toEqual([0.5, 0.75]);

    meter.setPaused(true);
    sched.run();
    expect(meter.level).toBeCloseTo(0.375);

    await meter.stop();
    expect(ctx.closed).toBe(true);
    expect(ctx.disconnected).toBe(true);
    expect(sched.size).toBe(0);
    sched.run(3);
    expect(levels).toHaveLength(3);
    await meter.stop(); // idempotent
  });

  it("does not emit when the level is unchanged (silence)", () => {
    const sched = new ManualScheduler();
    const onLevel = vi.fn();
    createMicMeter({
      stream: new FakeStream([]),
      createAudioContext: () => new FakeAudioContext(),
      schedule: sched.schedule,
      onLevel,
    });
    sched.run(5);
    expect(onLevel).not.toHaveBeenCalled();
  });
});

describe("createMicMeter setup failure", () => {
  it("closes the AudioContext when the analyser graph cannot be built", async () => {
    const ctx = new FakeAudioContext();
    ctx.createMediaStreamSource = () => {
      throw new Error("no source");
    };
    const sched = new ManualScheduler();
    expect(() =>
      createMicMeter({
        stream: new FakeStream([new FakeTrack("audio")]),
        createAudioContext: () => ctx,
        schedule: sched.schedule,
        onLevel: () => {},
      }),
    ).toThrow("no source");
    await Promise.resolve();
    expect(ctx.closed).toBe(true);
    expect(sched.size).toBe(0);
  });
});
