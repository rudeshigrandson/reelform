import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Clip } from "../model/schema";
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  clampPlaybackRate,
  mapTimelineToSource,
  playbackRateAt,
  preservesPitchAt,
  sourceTimeAt,
  speedRegionAt,
} from "./timeMapping";

// Source 0–10s, trimmed to [1s,3s) and [6s,9s).
const clips: Clip[] = [
  { id: "a", sourceStartMs: 1000, sourceEndMs: 3000, timelineStartMs: 0 },
  { id: "b", sourceStartMs: 6000, sourceEndMs: 9000, timelineStartMs: 2000 },
];

describe("mapTimelineToSource", () => {
  it("is identity without clips", () => {
    expect(mapTimelineToSource([], 1234)).toEqual({ clipId: null, sourceMs: 1234 });
    expect(mapTimelineToSource(undefined, 0)).toEqual({ clipId: null, sourceMs: 0 });
  });

  it("maps through clips with half-open boundaries", () => {
    expect(mapTimelineToSource(clips, 0)).toEqual({ clipId: "a", sourceMs: 1000 });
    expect(mapTimelineToSource(clips, 1999)).toEqual({ clipId: "a", sourceMs: 2999 });
    expect(mapTimelineToSource(clips, 2000)).toEqual({ clipId: "b", sourceMs: 6000 });
    expect(mapTimelineToSource(clips, 5000)).toBeNull();
  });

  it("rejects negative and non-finite times", () => {
    expect(mapTimelineToSource(clips, -1)).toBeNull();
    expect(mapTimelineToSource([], Number.NaN)).toBeNull();
  });

  it("stays within its clip's source range (property)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 4999.999, noNaN: true }), (t) => {
        const m = mapTimelineToSource(clips, t);
        const c = clips.find((x) => x.id === m?.clipId);
        expect(c).toBeDefined();
        if (!m || !c) return;
        expect(m.sourceMs).toBeGreaterThanOrEqual(c.sourceStartMs);
        expect(m.sourceMs).toBeLessThan(c.sourceEndMs);
      }),
    );
  });
});

describe("sourceTimeAt", () => {
  it("clamps past the end to the last clip's end and is total", () => {
    expect(sourceTimeAt(clips, 99_000)).toBe(9000);
    expect(sourceTimeAt(clips, -5)).toBe(1000);
    expect(sourceTimeAt(clips, Number.NaN)).toBe(1000);
    expect(sourceTimeAt(null, 42)).toBe(42);
  });
});

describe("speed regions", () => {
  const speeds = [
    { id: "s1", startMs: 1000, endMs: 2000, rate: 2, keepPitch: false },
    { id: "s2", startMs: 3000, endMs: 4000, rate: 20 },
  ];

  it("finds the region with half-open ends", () => {
    expect(speedRegionAt(speeds, 1000)?.id).toBe("s1");
    expect(speedRegionAt(speeds, 2000)).toBeNull();
  });

  it("combines rate with shuttle and clamps to 0.25–8", () => {
    expect(playbackRateAt(speeds, 1500)).toBe(2);
    expect(playbackRateAt(speeds, 1500, 2)).toBe(4);
    expect(playbackRateAt(speeds, 3500)).toBe(MAX_PLAYBACK_RATE);
    expect(playbackRateAt([], 0, 0.01)).toBe(MIN_PLAYBACK_RATE);
    expect(playbackRateAt([], 0, Number.NaN)).toBe(1);
    expect(clampPlaybackRate(-3)).toBe(1);
  });

  it("preservesPitch follows keepPitch, default true", () => {
    expect(preservesPitchAt(speeds, 1500)).toBe(false);
    expect(preservesPitchAt(speeds, 3500)).toBe(true);
    expect(preservesPitchAt(speeds, 0)).toBe(true);
  });
});
