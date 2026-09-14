import { describe, expect, it } from "vitest";
import { GRID_MAX_PX_PER_MS, collectSnapTargets, snap } from "./snapping";

const scale = { pxPerMs: 0.1 }; // 6px = 60ms

describe("snap", () => {
  it("snaps within 6px and not beyond", () => {
    expect(snap(1060, [1000], scale, { enabled: true })).toEqual({ ms: 1000, snappedTo: 1000 });
    expect(snap(1061, [1000], scale, { enabled: true })).toEqual({ ms: 1061, snappedTo: null });
  });

  it("alt bypass and disabled leave the candidate alone", () => {
    expect(snap(1010, [1000], scale, { enabled: true, bypass: true }).snappedTo).toBeNull();
    expect(snap(1010, [1000], scale, { enabled: false }).ms).toBe(1010);
  });

  it("picks the nearest of many targets", () => {
    expect(snap(1030, [980, 1000, 1040, 1100], scale, { enabled: true }).snappedTo).toBe(1040);
  });

  it("honours a custom tolerance and a zero scale", () => {
    expect(snap(1015, [1000], scale, { enabled: true, tolerancePx: 1 }).snappedTo).toBeNull();
    expect(snap(1000, [1000], { pxPerMs: 0 }, { enabled: true }).snappedTo).toBeNull();
  });
});

describe("collectSnapTargets", () => {
  const items = [
    { id: "a", startMs: 1000, endMs: 2000 },
    { id: "b", startMs: 3000, endMs: 4000 },
  ];

  it("includes playhead, item edges and clip boundaries, sorted and unique", () => {
    const t = collectSnapTargets({ playheadMs: 2000, items, clipBoundaries: [0, 5000] });
    expect(t).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
  });

  it("excludes the dragged item's own edges", () => {
    const t = collectSnapTargets({ playheadMs: 500, items, excludeIds: new Set(["a"]) });
    expect(t).toEqual([500, 3000, 4000]);
  });

  it("adds the 1s grid only when zoomed out", () => {
    const out = collectSnapTargets({
      playheadMs: 0,
      items: [],
      pxPerMs: GRID_MAX_PX_PER_MS,
      durationMs: 3500,
    });
    expect(out).toEqual([0, 1000, 2000, 3000]);
    const inZoom = collectSnapTargets({
      playheadMs: 0,
      items: [],
      pxPerMs: GRID_MAX_PX_PER_MS * 2,
      durationMs: 3500,
    });
    expect(inZoom).toEqual([0]);
  });
});
