import { describe, expect, it } from "vitest";
import {
  type ClipPlacement,
  nearestThumbIndex,
  visibleFilmstrip,
  visibleWaveform,
} from "./filmstrip";

const thumbs = [0, 2000, 4000, 6000, 8000].map((sourceMs) => ({ sourceMs, url: `t${sourceMs}` }));

const place = (over: Partial<ClipPlacement> = {}): ClipPlacement => ({
  itemStartMs: 0,
  itemEndMs: 10_000,
  sourceStartMs: 0,
  pxPerMs: 0.1,
  visibleStartMs: 0,
  visibleEndMs: 10_000,
  ...over,
});

describe("nearestThumbIndex", () => {
  it("finds the closest thumb, ties going to the earlier one", () => {
    expect(nearestThumbIndex(thumbs, -50)).toBe(0);
    expect(nearestThumbIndex(thumbs, 2900)).toBe(1);
    expect(nearestThumbIndex(thumbs, 3000)).toBe(1);
    expect(nearestThumbIndex(thumbs, 3100)).toBe(2);
    expect(nearestThumbIndex(thumbs, 99_000)).toBe(4);
    expect(nearestThumbIndex([], 0)).toBe(-1);
  });
});

describe("visibleFilmstrip", () => {
  it("tiles the item edge to edge with the thumb nearest each tile centre", () => {
    // 1000px item, 200px tiles → 5 tiles, centres at 1s, 3s, 5s, 7s, 9s of source.
    const tiles = visibleFilmstrip(thumbs, place(), 200);
    expect(tiles.map((t) => t.leftPx)).toEqual([0, 200, 400, 600, 800]);
    expect(tiles.map((t) => t.sourceMs)).toEqual([0, 2000, 4000, 6000, 8000]);
    expect(tiles.every((t) => t.widthPx === 200)).toBe(true);
  });

  it("offsets by the clip's source start and speed", () => {
    const tiles = visibleFilmstrip(thumbs, place({ itemEndMs: 2000, sourceStartMs: 6000 }), 200);
    expect(tiles.map((t) => t.sourceMs)).toEqual([6000]);
    const fast = visibleFilmstrip(thumbs, place({ itemEndMs: 2000, speed: 4 }), 100);
    // Centres at 500ms and 1500ms of timeline → 2s and 6s of source.
    expect(fast.map((t) => t.sourceMs)).toEqual([2000, 6000]);
  });

  it("only returns tiles intersecting the visible range and trims the last tile", () => {
    const tiles = visibleFilmstrip(
      thumbs,
      place({ itemEndMs: 9500, visibleStartMs: 4100, visibleEndMs: 6000 }),
      200,
    );
    expect(tiles.map((t) => t.leftPx)).toEqual([400]);
    const tail = visibleFilmstrip(thumbs, place({ itemEndMs: 9500, visibleStartMs: 9000 }), 200);
    expect(tail).toEqual([{ url: "t8000", sourceMs: 8000, leftPx: 800, widthPx: 150 }]);
  });

  it("is empty off-screen, without thumbs or with a bad scale", () => {
    expect(
      visibleFilmstrip(thumbs, place({ visibleStartMs: 20_000, visibleEndMs: 30_000 }), 200),
    ).toEqual([]);
    expect(visibleFilmstrip([], place(), 200)).toEqual([]);
    expect(visibleFilmstrip(thumbs, place({ pxPerMs: 0 }), 200)).toEqual([]);
    expect(visibleFilmstrip(thumbs, place(), 0)).toEqual([]);
  });
});

describe("visibleWaveform", () => {
  const peaks = Float32Array.from([0.1, 0.9, 0.2, 0.4]);

  it("one bar per barPx over the visible part, max of the covered buckets", () => {
    // 4 buckets over 10s; 500px bars at 0.1px/ms → each bar covers 5s = 2 buckets.
    const bars = visibleWaveform(peaks, 10_000, place(), 500);
    expect(bars.map((b) => b.leftPx)).toEqual([0, 500]);
    expect(bars[0]?.peak).toBeCloseTo(0.9);
    expect(bars[1]?.peak).toBeCloseTo(0.4);
  });

  it("respects the source start and the visible range", () => {
    const bars = visibleWaveform(
      peaks,
      10_000,
      place({ itemEndMs: 5000, sourceStartMs: 5000, visibleStartMs: 2600 }),
      250,
    );
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ leftPx: 250 });
    expect(bars[0]?.peak).toBeCloseTo(0.4);
  });

  it("is empty without peaks or a source duration", () => {
    expect(visibleWaveform(undefined, 10_000, place(), 2)).toEqual([]);
    expect(visibleWaveform(peaks, undefined, place(), 2)).toEqual([]);
    expect(visibleWaveform(new Float32Array(), 10_000, place(), 2)).toEqual([]);
  });
});
