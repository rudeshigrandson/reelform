import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Clip } from "../editor/model/schema";
import { snapToFrame, sourceToTimeline, timelineDurationMs, timelineToSource } from "./time";

const clip = (id: string, srcStart: number, srcEnd: number, tlStart: number): Clip => ({
  id,
  sourceStartMs: srcStart,
  sourceEndMs: srcEnd,
  timelineStartMs: tlStart,
});

describe("timelineToSource", () => {
  const clips: Clip[] = [
    clip("a", 1000, 3000, 0), // 2s of source, timeline [0, 2000)
    clip("b", 5000, 6000, 2000), // 1s of source, timeline [2000, 3000)
  ];

  it("maps the first clip", () => {
    expect(timelineToSource(clips, 0)).toEqual({ clipId: "a", sourceMs: 1000 });
    expect(timelineToSource(clips, 500)).toEqual({ clipId: "a", sourceMs: 1500 });
  });

  it("maps across the clip boundary (half-open)", () => {
    expect(timelineToSource(clips, 2000)).toEqual({ clipId: "b", sourceMs: 5000 });
    expect(timelineToSource(clips, 1999)).toEqual({ clipId: "a", sourceMs: 2999 });
  });

  it("returns null past the end and before the start", () => {
    expect(timelineToSource(clips, 3000)).toBeNull();
    expect(timelineToSource(clips, -1)).toBeNull();
  });
});

describe("sourceToTimeline", () => {
  it("is the inverse of timelineToSource within a clip", () => {
    const c = clip("a", 1000, 3000, 0);
    expect(sourceToTimeline(c, 1500)).toBe(500);
    expect(sourceToTimeline(c, 999)).toBeNull();
  });
});

describe("timelineDurationMs", () => {
  it("sums clip durations", () => {
    expect(timelineDurationMs([clip("a", 1000, 3000, 0), clip("b", 5000, 6000, 2000)])).toBe(3000);
  });
});

describe("round-trip property", () => {
  it("timeline→source→timeline is identity inside a clip", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (srcStart, dur) => {
          const c = clip("a", srcStart, srcStart + dur, 0);
          const offset = Math.floor(dur / 2);
          const src = timelineToSource([c], offset);
          expect(src).not.toBeNull();
          if (src) expect(sourceToTimeline(c, src.sourceMs)).toBe(offset);
        },
      ),
    );
  });
});

describe("snapToFrame", () => {
  it("snaps to frame boundaries at 30fps", () => {
    expect(snapToFrame(0, 30)).toBe(0);
    expect(snapToFrame(16, 30)).toBe(0); // 0.48 frames → rounds to frame 0
    expect(snapToFrame(20, 30)).toBeCloseTo(33.333, 2); // 0.6 frames → frame 1
    expect(snapToFrame(50, 30)).toBeCloseTo(66.667, 2); // 1.5 frames → frame 2
  });
});
