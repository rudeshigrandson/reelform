import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Clip } from "../../model/schema";
import {
  type MappedRange,
  clipsEndMs,
  deriveTranscribeRanges,
  effectiveClips,
  rangeOutputMs,
  removeSourceRanges,
  sourceRangesToTimeline,
  sourceToTimelineMs,
  timelineClips,
  toIpcRanges,
  wavToTimelineMs,
} from "./timeMap";

const clip = (id: string, s: number, e: number, t: number): Clip => ({
  id,
  sourceStartMs: s,
  sourceEndMs: e,
  timelineStartMs: t,
});

/** Contiguous clips from random source slices (a trimmed/split timeline). */
const clipsArb = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 50_000 }), fc.integer({ min: 1, max: 20_000 })), {
    minLength: 1,
    maxLength: 6,
  })
  .map((pairs) => {
    let t = 0;
    return pairs.map(([s, len], i) => {
      const c = clip(`c${i}`, s, s + len, t);
      t += len;
      return c;
    });
  });

const speedsArb = fc.array(
  fc.record({
    startMs: fc.integer({ min: 0, max: 100_000 }),
    len: fc.integer({ min: 1, max: 30_000 }),
    rate: fc.constantFrom(0.25, 0.5, 1.5, 2, 3, 8),
  }),
  { maxLength: 5 },
);

describe("effectiveClips", () => {
  it("defaults to one clip spanning the video", () => {
    const meta = { sources: { video: { durationMs: 5000 } } } as Parameters<
      typeof effectiveClips
    >[0];
    expect(effectiveClips(meta)).toEqual([clip("clip-1", 0, 5000, 0)]);
    expect(effectiveClips(null)).toEqual([]);
  });
});

describe("deriveTranscribeRanges", () => {
  it("splits a clip at speed-region edges and carries the rate", () => {
    const ranges = deriveTranscribeRanges(
      [clip("a", 1000, 11_000, 0)],
      [{ startMs: 2000, endMs: 4000, rate: 2 }],
    );
    expect(ranges).toEqual([
      { startMs: 1000, endMs: 3000, timelineStartMs: 0 },
      { startMs: 3000, endMs: 5000, timelineStartMs: 2000, rate: 2 },
      { startMs: 5000, endMs: 11_000, timelineStartMs: 4000 },
    ]);
    expect(toIpcRanges(ranges)[1]).toEqual({ startMs: 3000, endMs: 5000, rate: 2 });
  });

  it("orders by timeline, not array order, and skips empty clips", () => {
    const ranges = deriveTranscribeRanges(
      [clip("b", 0, 1000, 5000), clip("a", 7000, 9000, 0), clip("z", 10, 10, 100)],
      [],
    );
    expect(ranges.map((r) => r.startMs)).toEqual([7000, 0]);
  });

  it("ignores overlapping later speed regions (first wins) and invalid ones", () => {
    const ranges = deriveTranscribeRanges(
      [clip("a", 0, 10_000, 0)],
      [
        { startMs: 0, endMs: 5000, rate: 2 },
        { startMs: 1000, endMs: 3000, rate: 8 },
        { startMs: 6000, endMs: 6000, rate: 4 },
      ],
    );
    expect(ranges).toEqual([
      { startMs: 0, endMs: 5000, timelineStartMs: 0, rate: 2 },
      { startMs: 5000, endMs: 10_000, timelineStartMs: 5000 },
    ]);
  });

  it("property: ranges tile every clip exactly, positive, valid for IPC, timeline-monotonic", () => {
    fc.assert(
      fc.property(clipsArb, speedsArb, (clips, rawSpeeds) => {
        const speeds = rawSpeeds.map((s) => ({
          startMs: s.startMs,
          endMs: s.startMs + s.len,
          rate: s.rate,
        }));
        const ranges = deriveTranscribeRanges(clips, speeds);
        for (const r of ranges) {
          expect(r.endMs).toBeGreaterThan(r.startMs);
          if (r.rate !== undefined) expect(r.rate).toBeGreaterThan(0);
        }
        for (let i = 1; i < ranges.length; i++) {
          const prev = ranges[i - 1] as MappedRange;
          expect((ranges[i] as MappedRange).timelineStartMs).toBeCloseTo(
            prev.timelineStartMs + (prev.endMs - prev.startMs),
          );
        }
        const total = ranges.reduce((s, r) => s + (r.endMs - r.startMs), 0);
        expect(total).toBe(clipsEndMs(clips));
        // Every range maps inside a clip's source slice.
        for (const r of ranges) {
          expect(clips.some((c) => r.startMs >= c.sourceStartMs && r.endMs <= c.sourceEndMs)).toBe(
            true,
          );
        }
      }),
    );
  });

  it("property: wav → timeline is monotonic and hits range starts", () => {
    fc.assert(
      fc.property(
        clipsArb,
        speedsArb,
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 20 }),
        (clips, rawSpeeds, fracs) => {
          const speeds = rawSpeeds.map((s) => ({
            startMs: s.startMs,
            endMs: s.startMs + s.len,
            rate: s.rate,
          }));
          const ranges = deriveTranscribeRanges(clips, speeds);
          const wavTotal = ranges.reduce((s, r) => s + rangeOutputMs(r), 0);
          let acc = 0;
          for (const r of ranges) {
            expect(wavToTimelineMs(ranges, acc)).toBeCloseTo(r.timelineStartMs, 6);
            acc += rangeOutputMs(r);
          }
          const times = [...fracs]
            .sort((a, b) => a - b)
            .map((f) => wavToTimelineMs(ranges, f * wavTotal));
          for (let i = 1; i < times.length; i++)
            expect(times[i] as number).toBeGreaterThanOrEqual((times[i - 1] as number) - 1e-6);
          expect(wavToTimelineMs(ranges, wavTotal + 1000)).toBeCloseTo(clipsEndMs(clips));
        },
      ),
    );
  });
});

describe("sourceToTimelineMs", () => {
  it("maps kept source time and returns null for trimmed time", () => {
    const clips = [clip("a", 1000, 2000, 0), clip("b", 5000, 6000, 1000)];
    expect(sourceToTimelineMs(clips, 1500)).toBe(500);
    expect(sourceToTimelineMs(clips, 5500)).toBe(1500);
    expect(sourceToTimelineMs(clips, 3000)).toBeNull();
    expect(sourceToTimelineMs(clips, 6000)).toBeNull();
  });
});

describe("removeSourceRanges (silence → ripple cuts)", () => {
  it("cuts gaps out of a clip and ripples the pieces", () => {
    const out = removeSourceRanges(
      [clip("a", 0, 10_000, 0)],
      [
        { startMs: 2000, endMs: 3000 },
        { startMs: 6000, endMs: 8000 },
      ],
    );
    expect(out).toEqual([
      clip("a", 0, 2000, 0),
      clip("a-1", 3000, 6000, 2000),
      clip("a-2", 8000, 10_000, 5000),
    ]);
    expect(clipsEndMs(out)).toBe(7000);
  });

  it("drops a clip entirely covered by a gap and keeps untouched clips", () => {
    const out = removeSourceRanges(
      [clip("a", 0, 1000, 0), clip("b", 4000, 5000, 1000), clip("c", 9000, 9500, 2000)],
      [{ startMs: 3500, endMs: 5500 }],
    );
    expect(out).toEqual([clip("a", 0, 1000, 0), clip("c", 9000, 9500, 1000)]);
  });

  it("handles gaps at clip edges, unsorted/invalid gaps, and no gaps", () => {
    const base = [clip("a", 1000, 5000, 250)];
    expect(removeSourceRanges(base, [])).toEqual(base);
    const out = removeSourceRanges(base, [
      { startMs: 4000, endMs: 9000 },
      { startMs: 0, endMs: 1500 },
      { startMs: 3000, endMs: 3000 },
      { startMs: Number.NaN, endMs: 10 },
    ]);
    expect(out).toEqual([clip("a", 1500, 4000, 250)]);
  });

  it("property: removed duration equals the covered source time", () => {
    fc.assert(
      fc.property(
        clipsArb,
        fc.array(
          fc.record({
            s: fc.integer({ min: 0, max: 80_000 }),
            len: fc.integer({ min: 1, max: 5000 }),
          }),
          { maxLength: 8 },
        ),
        (clips, gaps) => {
          const ranges = gaps.map((g) => ({ startMs: g.s, endMs: g.s + g.len }));
          const out = removeSourceRanges(clips, ranges);
          const covered = (s: number, e: number) => {
            // Length of [s,e) covered by the union of ranges.
            const pts = ranges
              .map((r) => [Math.max(s, r.startMs), Math.min(e, r.endMs)] as const)
              .filter(([a, b]) => b > a)
              .sort((a, b) => a[0] - b[0]);
            let tot = 0;
            let cur = s;
            for (const [a, b] of pts) {
              const from = Math.max(a, cur);
              if (b > from) {
                tot += b - from;
                cur = b;
              }
            }
            return tot;
          };
          const expected = clips.reduce(
            (sum, c) =>
              sum + (c.sourceEndMs - c.sourceStartMs) - covered(c.sourceStartMs, c.sourceEndMs),
            0,
          );
          expect(clipsEndMs(out)).toBe(expected);
          for (let i = 1; i < out.length; i++) {
            const p = out[i - 1] as Clip;
            expect((out[i] as Clip).timelineStartMs).toBe(
              p.timelineStartMs + p.sourceEndMs - p.sourceStartMs,
            );
          }
          expect(new Set(out.map((c) => c.id)).size).toBe(out.length);
        },
      ),
    );
  });
});

describe("timelineClips", () => {
  const meta = {
    sources: { video: { durationMs: 5000 } },
    clips: [clip("m", 0, 100, 0)],
  } as unknown as Parameters<typeof timelineClips>[1];

  it("prefers the editor store's clips over meta clips", () => {
    const store = [clip("s", 1000, 2000, 0)];
    expect(timelineClips(store, meta)).toEqual(store);
  });

  it("falls back to meta clips, then a whole-video clip, then nothing", () => {
    expect(timelineClips([], meta)).toEqual([clip("m", 0, 100, 0)]);
    const noClips = { sources: { video: { durationMs: 5000 } } } as unknown as Parameters<
      typeof timelineClips
    >[1];
    expect(timelineClips([], noClips)).toEqual([clip("clip-1", 0, 5000, 0)]);
    expect(timelineClips([], null)).toEqual([]);
  });
});

describe("sourceRangesToTimeline", () => {
  it("maps source gaps through trimmed and reordered clips and merges touching ranges", () => {
    const clips = [clip("b", 5000, 6000, 0), clip("a", 1000, 2000, 1000)];
    expect(
      sourceRangesToTimeline(clips, [
        { startMs: 1500, endMs: 5500 }, // covers the end of a and the start of b
        { startMs: 3000, endMs: 4000 }, // trimmed away: ignored
        { startMs: Number.NaN, endMs: 9 },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 500 },
      { startMs: 1500, endMs: 2000 },
    ]);
    // Adjacent clips: a gap spanning the boundary becomes one range.
    expect(
      sourceRangesToTimeline(
        [clip("x", 0, 1000, 0), clip("y", 1000, 2000, 1000)],
        [{ startMs: 800, endMs: 1200 }],
      ),
    ).toEqual([{ startMs: 800, endMs: 1200 }]);
  });

  it("property: timeline length removed equals removeSourceRanges' shrink", () => {
    fc.assert(
      fc.property(
        clipsArb,
        fc.array(
          fc.record({
            s: fc.integer({ min: 0, max: 80_000 }),
            len: fc.integer({ min: 1, max: 5000 }),
          }),
          { maxLength: 8 },
        ),
        (clips, gaps) => {
          const ranges = gaps.map((g) => ({ startMs: g.s, endMs: g.s + g.len }));
          const mapped = sourceRangesToTimeline(clips, ranges);
          const removed = mapped.reduce((sum, r) => sum + r.endMs - r.startMs, 0);
          expect(clipsEndMs(clips) - removed).toBe(clipsEndMs(removeSourceRanges(clips, ranges)));
          for (let i = 1; i < mapped.length; i++) {
            expect((mapped[i] as { startMs: number }).startMs).toBeGreaterThan(
              (mapped[i - 1] as { endMs: number }).endMs,
            );
          }
        },
      ),
    );
  });
});
