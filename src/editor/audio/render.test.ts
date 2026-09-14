import { createFakeContext } from "./fakeAudioContext";
import { framesFor, renderTimeline, renderTimelineBlocks } from "./render";
import type { OfflineContextFactory, RenderRange } from "./render";

/**
 * Fake offline contexts whose rendered sample value is the ABSOLUTE timeline
 * frame (derived from the range passed to `build`), so slicing away pre/post
 * roll and concatenation order are both checkable exactly.
 */
function recording(channels = 2) {
  const created: Array<{ length: number; sampleRate: number; numberOfChannels: number }> = [];
  const ranges: RenderRange[] = [];
  let startFrame = 0;
  let sr = 48_000;
  const createContext: OfflineContextFactory = (o) => {
    created.push(o);
    sr = o.sampleRate;
    return createFakeContext(o.sampleRate, {
      length: o.length,
      channels,
      fill: (i) => startFrame + i,
    });
  };
  const build = (_ctx: unknown, r: RenderRange) => {
    ranges.push(r);
    startFrame = Math.round((r.startMs * sr) / 1000);
  };
  return { createContext, build, created, ranges };
}

describe("renderTimeline", () => {
  it("renders 30s blocks (with pre/post roll) and concatenates to the exact total length", async () => {
    const { createContext, build, created, ranges } = recording();
    const progress: number[] = [];
    const out = await renderTimeline({
      durationMs: 75_000.5,
      createContext,
      build,
      onProgress: (done) => progress.push(done),
    });
    const total = framesFor(75_000.5, 48_000);
    expect(total).toBe(3_600_024);
    expect(out.length).toBe(total);
    expect(out.channels[0].length).toBe(total);
    expect(out.channels[1].length).toBe(total);
    // 500ms pre-roll (none on the first block) + 50ms post-roll.
    expect(created.map((c) => c.length)).toEqual([
      1_440_000 + 2_400,
      24_000 + 1_440_000 + 2_400,
      24_000 + 720_024 + 2_400,
    ]);
    expect(created.every((c) => c.numberOfChannels === 2 && c.sampleRate === 48_000)).toBe(true);
    expect(ranges[0]).toEqual({ startMs: 0, endMs: 30_050 });
    expect(ranges[1]).toEqual({ startMs: 29_500, endMs: 60_050 });
    expect(ranges[2]?.startMs).toBe(59_500);
    expect(ranges[2]?.endMs).toBeCloseTo(75_050.5, 6);
    expect(progress).toEqual([1_440_000, 2_880_000, total]);
    // Every output frame is the matching absolute frame: padding sliced away exactly.
    for (const i of [0, 1_439_999, 1_440_000, 1_440_001, 2_879_999, 2_880_000, total - 1]) {
      expect(out.channels[0][i]).toBe(i);
      expect(out.channels[1][i]).toBe(i + 1);
    }
  });

  it("without padding, block contexts are exactly the block length", async () => {
    const { createContext, build, created, ranges } = recording();
    const out = await renderTimeline({
      durationMs: 10,
      sampleRate: 1000,
      blockMs: 4,
      preRollMs: 0,
      postRollMs: 0,
      createContext,
      build,
    });
    expect(created.map((c) => c.length)).toEqual([4, 4, 2]);
    expect(ranges).toEqual([
      { startMs: 0, endMs: 4 },
      { startMs: 4, endMs: 8 },
      { startMs: 8, endMs: 10 },
    ]);
    expect(Array.from(out.channels[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("zero / invalid duration renders nothing", async () => {
    const { createContext, build, created } = recording();
    const out = await renderTimeline({ durationMs: 0, createContext, build });
    expect(out.length).toBe(0);
    expect(created).toHaveLength(0);
    expect(framesFor(Number.NaN, 48_000)).toBe(0);
    expect(framesFor(-5, 48_000)).toBe(0);
  });

  it("duplicates mono block output into both channels (pre-roll clamped at 0)", async () => {
    const { createContext, build } = recording(1);
    const out = await renderTimeline({
      durationMs: 10,
      sampleRate: 1000,
      blockMs: 4,
      createContext,
      build,
    });
    expect(Array.from(out.channels[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from(out.channels[1])).toEqual(Array.from(out.channels[0]));
  });

  it("zero-pads a short rendered buffer", async () => {
    const factory: OfflineContextFactory = (o) =>
      createFakeContext(o.sampleRate, { length: o.length - 1, fill: () => 1 });
    const out = await renderTimeline({
      durationMs: 5,
      sampleRate: 1000,
      postRollMs: 0,
      createContext: factory,
      build: () => {},
    });
    expect(Array.from(out.channels[0])).toEqual([1, 1, 1, 1, 0]);
  });

  it("a rendered buffer shorter than the pre-roll yields silence, not garbage", async () => {
    const factory: OfflineContextFactory = (o) =>
      createFakeContext(o.sampleRate, { length: Math.min(o.length, 3), fill: () => 1 });
    const out = await renderTimeline({
      durationMs: 20,
      sampleRate: 1000,
      blockMs: 10,
      preRollMs: 5,
      postRollMs: 0,
      createContext: factory,
      build: () => {},
    });
    // Block 0 (no lead): first 3 frames are 1. Block 1 (lead 5 > 3 rendered): all 0.
    expect(Array.from(out.channels[0].subarray(0, 4))).toEqual([1, 1, 1, 0]);
    expect(Array.from(out.channels[0].subarray(10))).toEqual(new Array(10).fill(0));
  });

  it("streams blocks and honours abort", async () => {
    const { createContext, build } = recording();
    const ac = new AbortController();
    const seen: number[] = [];
    const run = async () => {
      for await (const b of renderTimelineBlocks({
        durationMs: 10,
        sampleRate: 1000,
        blockMs: 3,
        createContext,
        build,
        signal: ac.signal,
      })) {
        seen.push(b.frameOffset);
        if (seen.length === 2) ac.abort();
      }
    };
    await expect(run()).rejects.toThrow(/aborted/);
    expect(seen).toEqual([0, 3]);
  });
});
