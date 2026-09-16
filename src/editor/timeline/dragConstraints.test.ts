import { describe, expect, it } from "vitest";
import { collectSnapTargets } from "./snapping";
import { resolveOverlapByTrimming } from "./trackOps";

describe("resolveOverlapByTrimming", () => {
  const siblings = [
    { id: "a", startMs: 0, endMs: 2000 },
    { id: "b", startMs: 3000, endMs: 5000 },
    { id: "c", startMs: 6000, endMs: 7000 },
  ];

  it("trims the tail of an earlier neighbour and the head of a later one", () => {
    const trims = resolveOverlapByTrimming({ id: "x", startMs: 1500, endMs: 3500 }, siblings);
    expect(trims).toEqual([
      { id: "a", startMs: 0, endMs: 1500 },
      { id: "b", startMs: 3500, endMs: 5000 },
    ]);
  });

  it("returns no trims without overlap and ignores the item itself", () => {
    expect(resolveOverlapByTrimming({ id: "a", startMs: 100, endMs: 2500 }, siblings)).toEqual([]);
    expect(resolveOverlapByTrimming({ id: "x", startMs: 2000, endMs: 3000 }, siblings)).toEqual([]);
  });

  it("refuses when a neighbour would drop below the minimum length", () => {
    // `c` sits entirely inside the dropped item.
    expect(resolveOverlapByTrimming({ id: "x", startMs: 5500, endMs: 7500 }, siblings)).toBeNull();
    expect(
      resolveOverlapByTrimming({ id: "x", startMs: 4950, endMs: 5500 }, siblings, 100),
    ).toEqual([{ id: "b", startMs: 3000, endMs: 4950 }]);
    expect(resolveOverlapByTrimming({ id: "x", startMs: 50, endMs: 1000 }, siblings)).toBeNull();
  });
});

describe("collectSnapTargets word boundaries", () => {
  it("adds caption word boundaries alongside item edges", () => {
    const targets = collectSnapTargets({
      playheadMs: 0,
      items: [{ id: "c", startMs: 1000, endMs: 3000 }],
      wordBoundaries: [1000, 1400, 1450, 3000],
    });
    expect(targets).toEqual([0, 1000, 1400, 1450, 3000]);
  });
});
