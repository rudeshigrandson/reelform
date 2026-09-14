import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MIN_ITEM_MS,
  type OpContext,
  applySelection,
  clearSelection,
  moveItem,
  nudge,
  overlaps,
  resizeItemEnd,
  resizeItemStart,
  selectInRange,
} from "./trackOps";

const D = 10_000;
const ctx = (over: Partial<OpContext> = {}): OpContext => ({
  durationMs: D,
  allowOverlap: true,
  siblings: [],
  ...over,
});
const item = { id: "x", startMs: 2000, endMs: 3000 };

describe("moveItem", () => {
  it("moves by delta keeping length", () => {
    expect(moveItem(item, 500, ctx()).item).toMatchObject({ startMs: 2500, endMs: 3500 });
  });

  it("clamps to [0, duration]", () => {
    expect(moveItem(item, -5000, ctx()).item).toMatchObject({ startMs: 0, endMs: 1000 });
    expect(moveItem(item, 50_000, ctx()).item).toMatchObject({ startMs: 9000, endMs: 10_000 });
  });

  it("snaps whichever edge is closer", () => {
    const snapCfg = { targets: [4480, 5010], pxPerMs: 0.1, enabled: true };
    // start → 4500 (20ms from 4480), end → 5500 (490 from 5010): start wins.
    const r = moveItem(item, 2500, ctx({ snap: snapCfg }));
    expect(r.item).toMatchObject({ startMs: 4480, endMs: 5480 });
    expect(r.snappedTo).toBe(4480);
    // start → 3000, end → 4000; target 4010 is 10ms from end.
    const r2 = moveItem(item, 1000, ctx({ snap: { ...snapCfg, targets: [2950, 4010] } }));
    expect(r2.item).toMatchObject({ startMs: 3010, endMs: 4010 });
    expect(r2.snappedTo).toBe(4010);
  });

  it("alt bypass skips snapping", () => {
    const r = moveItem(
      item,
      1000,
      ctx({ snap: { targets: [3010], pxPerMs: 0.1, enabled: true, bypass: true } }),
    );
    expect(r.item.startMs).toBe(3000);
    expect(r.snappedTo).toBeNull();
  });
});

describe("resize", () => {
  it("resizes start/end and enforces min length", () => {
    expect(resizeItemStart(item, -500, ctx()).item).toMatchObject({ startMs: 1500, endMs: 3000 });
    expect(resizeItemStart(item, 5000, ctx()).item).toMatchObject({
      startMs: 3000 - MIN_ITEM_MS,
      endMs: 3000,
    });
    expect(resizeItemEnd(item, -5000, ctx()).item).toMatchObject({
      startMs: 2000,
      endMs: 2000 + MIN_ITEM_MS,
    });
    expect(resizeItemEnd(item, 50_000, ctx()).item.endMs).toBe(D);
    expect(resizeItemStart(item, -50_000, ctx()).item.startMs).toBe(0);
  });

  it("resize edges snap", () => {
    const snapCfg = { targets: [1540], pxPerMs: 0.1, enabled: true };
    expect(resizeItemStart(item, -500, ctx({ snap: snapCfg })).item.startMs).toBe(1540);
  });
});

describe("invariants (property)", () => {
  const span = fc
    .tuple(
      fc.double({ min: -2e4, max: 2e4, noNaN: true }),
      fc.double({ min: -2e4, max: 2e4, noNaN: true }),
    )
    .map(([a, b]) => ({ id: "p", startMs: Math.min(a, b), endMs: Math.max(a, b) }));

  it("never end ≤ start, never outside [0, duration]", () => {
    fc.assert(
      fc.property(
        span,
        fc.double({ min: -3e4, max: 3e4, noNaN: true }),
        fc.double({ min: 1, max: 2e4, noNaN: true }),
        fc.constantFrom("move", "start", "end"),
        fc.boolean(),
        (it, delta, duration, op, snapOn) => {
          const c = ctx({
            durationMs: duration,
            snap: { targets: [0, duration / 3, duration], pxPerMs: 0.1, enabled: snapOn },
          });
          const fn = op === "move" ? moveItem : op === "start" ? resizeItemStart : resizeItemEnd;
          const r = fn(it, delta, c).item;
          expect(r.endMs).toBeGreaterThan(r.startMs);
          expect(r.startMs).toBeGreaterThanOrEqual(0);
          expect(r.endMs).toBeLessThanOrEqual(duration);
          if (duration >= MIN_ITEM_MS) {
            expect(r.endMs - r.startMs).toBeGreaterThanOrEqual(MIN_ITEM_MS - 1e-6);
          }
        },
      ),
    );
  });
});

describe("overlap rules", () => {
  const neighbour = { id: "n", startMs: 4000, endMs: 6000 };

  it("overlaps uses half-open intervals and ignores the item itself", () => {
    expect(overlaps([neighbour], { startMs: 3000, endMs: 4000 })).toBe(false);
    expect(overlaps([neighbour], { startMs: 3000, endMs: 4001 })).toBe(true);
    expect(overlaps([neighbour], { startMs: 4500, endMs: 5000 }, "n")).toBe(false);
  });

  it("rejects overlap on no-overlap tracks (zoom/speed)", () => {
    const r = moveItem(item, 1500, ctx({ allowOverlap: false, siblings: [item, neighbour] }));
    expect(r.valid).toBe(false);
    expect(r.item).toMatchObject({ startMs: 3500, endMs: 4500 });
    expect(
      resizeItemEnd(item, 1500, ctx({ allowOverlap: false, siblings: [neighbour] })).valid,
    ).toBe(false);
    expect(
      moveItem(item, 500, ctx({ allowOverlap: false, siblings: [item, neighbour] })).valid,
    ).toBe(true);
  });

  it("allows overlap on annotations/captions tracks", () => {
    expect(moveItem(item, 1500, ctx({ allowOverlap: true, siblings: [neighbour] })).valid).toBe(
      true,
    );
  });
});

describe("nudge", () => {
  it("moves by whole frames and clamps", () => {
    expect(nudge(item, 3, 30, D)).toMatchObject({ startMs: 2100, endMs: 3100 });
    expect(nudge(item, -1, 25, D)).toMatchObject({ startMs: 1960, endMs: 2960 });
    expect(nudge({ id: "e", startMs: 0, endMs: 500 }, -1, 30, D)).toMatchObject({ startMs: 0 });
    expect(nudge(item, 1, 0, D)).toMatchObject({ startMs: 2000 });
  });
});

describe("selection", () => {
  const order = ["a", "b", "c", "d"];

  it("click selects one", () => {
    expect([...applySelection(new Set(["a", "c"]), "b", {}, order)]).toEqual(["b"]);
  });

  it("⌘/ctrl toggles", () => {
    expect([...applySelection(new Set(["a"]), "b", { toggle: true }, order)]).toEqual(["a", "b"]);
    expect([...applySelection(new Set(["a", "b"]), "a", { toggle: true }, order)]).toEqual(["b"]);
  });

  it("shift extends a range within the track from the last selected item", () => {
    const next = applySelection(new Set(["a"]), "c", { shift: true }, order);
    expect(new Set(next)).toEqual(new Set(["a", "b", "c"]));
    const back = applySelection(new Set(["d"]), "b", { shift: true }, order);
    expect(new Set(back)).toEqual(new Set(["b", "c", "d"]));
  });

  it("shift with no anchor on this track just adds", () => {
    const next = applySelection(new Set(["other"]), "c", { shift: true }, order);
    expect(new Set(next)).toEqual(new Set(["other", "c"]));
  });

  it("clearSelection is empty and selectInRange finds intersecting items", () => {
    expect(clearSelection().size).toBe(0);
    const items = [
      { id: "a", startMs: 0, endMs: 1000 },
      { id: "b", startMs: 1500, endMs: 2500 },
      { id: "c", startMs: 3000, endMs: 4000 },
    ];
    expect(selectInRange(items, 2600, 900)).toEqual(["a", "b"]);
    expect(selectInRange(items, 1000, 1500)).toEqual([]);
  });
});
