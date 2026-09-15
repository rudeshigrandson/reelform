import fc from "fast-check";
import { defaultRegionBounds, toRegionSelection } from "./regionMath";

describe("toRegionSelection", () => {
  it("rounds to DIP and scales to device pixels", () => {
    expect(
      toRegionSelection(
        { x: 10.4, y: 20.6, width: 99.8, height: 50 },
        { width: 800, height: 600 },
        1.5,
      ),
    ).toEqual({
      region: { x: 10, y: 21, width: 100, height: 50 },
      pixelRegion: { x: 15, y: 32, width: 150, height: 75 },
      scaleFactor: 1.5,
    });
  });

  it("clamps into the display and rejects empty areas", () => {
    const vp = { width: 100, height: 100 };
    expect(toRegionSelection({ x: -20, y: 90, width: 50, height: 50 }, vp, 1)?.region).toEqual({
      x: 0,
      y: 90,
      width: 30,
      height: 10,
    });
    expect(toRegionSelection({ x: 200, y: 0, width: 10, height: 10 }, vp, 1)).toBeNull();
    expect(toRegionSelection({ x: 0, y: 0, width: 0.2, height: 10 }, vp, 1)).toBeNull();
    expect(toRegionSelection({ x: Number.NaN, y: 0, width: 10, height: 10 }, vp, 1)?.region.x).toBe(
      0,
    );
    expect(toRegionSelection({ x: 0, y: 0, width: 10, height: 10 }, vp, 0)?.scaleFactor).toBe(1);
  });

  it("property: result always lies inside the viewport with positive size", () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -500, max: 3000, noNaN: true }),
          y: fc.double({ min: -500, max: 3000, noNaN: true }),
          width: fc.double({ min: 0, max: 4000, noNaN: true }),
          height: fc.double({ min: 0, max: 4000, noNaN: true }),
        }),
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.constantFrom(1, 1.25, 2, 3),
        (b, w, h, scale) => {
          const r = toRegionSelection(b, { width: w, height: h }, scale);
          if (!r) return;
          expect(r.region.width).toBeGreaterThanOrEqual(1);
          expect(r.region.height).toBeGreaterThanOrEqual(1);
          expect(r.region.x + r.region.width).toBeLessThanOrEqual(w);
          expect(r.region.y + r.region.height).toBeLessThanOrEqual(h);
          expect(r.region.x).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(r.pixelRegion.width)).toBe(true);
        },
      ),
    );
  });
});

describe("defaultRegionBounds", () => {
  it("is a centered 16:9 rect inside the display", () => {
    expect(defaultRegionBounds({ width: 1000, height: 1000 })).toEqual({
      x: 200,
      y: 331,
      width: 600,
      height: 338,
    });
    const tall = defaultRegionBounds({ width: 3000, height: 500 });
    expect(tall.height).toBeLessThanOrEqual(400);
    expect(tall.x).toBeGreaterThanOrEqual(0);
  });
});
