import fc from "fast-check";
import { defaultRegionBounds, snapRect, toRegionSelection, windowSnapTargets } from "./regionMath";
import { SOURCES } from "./testFakes";

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

describe("snapRect", () => {
  const win = { x: 100, y: 100, width: 400, height: 300 };

  it("moves the rect onto the nearest window edge within 8px, keeping its size", () => {
    expect(snapRect({ x: 106, y: 95, width: 200, height: 100 }, [win])).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });
    // Right edge 497 → 500; the closer of left / right wins.
    expect(snapRect({ x: 297, y: 150, width: 200, height: 100 }, [win])).toEqual({
      x: 300,
      y: 150,
      width: 200,
      height: 100,
    });
    // Outer edges snap too: the rect's left meets the window's right.
    expect(snapRect({ x: 505, y: 150, width: 50, height: 50 }, [win]).x).toBe(500);
  });

  it("leaves edges beyond the threshold alone and honours a custom threshold", () => {
    const far = { x: 120, y: 150, width: 100, height: 100 };
    expect(snapRect(far, [win])).toEqual(far);
    expect(snapRect(far, [win], 20).x).toBe(100);
    expect(snapRect(far, [win], 0)).toEqual(far);
    expect(snapRect(far, [])).toEqual(far);
  });

  it("ignores windows that don't overlap on the other axis", () => {
    const below = { x: 104, y: 900, width: 50, height: 50 };
    expect(snapRect(below, [win])).toEqual(below);
  });

  it("resizing snaps only the dragged edges", () => {
    expect(
      snapRect({ x: 150, y: 150, width: 346, height: 100 }, [win], 8, { right: true }),
    ).toEqual({ x: 150, y: 150, width: 350, height: 100 });
    expect(
      snapRect({ x: 104, y: 150, width: 200, height: 146 }, [win], 8, { top: true, left: true }),
    ).toEqual({ x: 100, y: 150, width: 204, height: 146 });
    expect(
      snapRect({ x: 104, y: 150, width: 200, height: 246 }, [win], 8, { bottom: true }),
    ).toEqual({ x: 104, y: 150, width: 200, height: 250 });
  });

  it("never collapses a rect and ignores invalid targets", () => {
    const thin = { x: 497, y: 150, width: 2, height: 50 };
    expect(snapRect(thin, [win], 8, { left: true, right: true }).width).toBeGreaterThanOrEqual(1);
    const bad = { x: Number.NaN, y: 0, width: 10, height: 10 };
    expect(snapRect({ x: 3, y: 3, width: 10, height: 10 }, [bad])).toEqual({
      x: 3,
      y: 3,
      width: 10,
      height: 10,
    });
  });

  it("property: moving never changes the size and moves at most the threshold", () => {
    const r = fc.record({
      x: fc.integer({ min: -2000, max: 2000 }),
      y: fc.integer({ min: -2000, max: 2000 }),
      width: fc.integer({ min: 1, max: 2000 }),
      height: fc.integer({ min: 1, max: 2000 }),
    });
    fc.assert(
      fc.property(r, fc.array(r, { maxLength: 6 }), (rect, targets) => {
        const out = snapRect(rect, targets);
        expect(out.width).toBe(rect.width);
        expect(out.height).toBe(rect.height);
        expect(Math.abs(out.x - rect.x)).toBeLessThanOrEqual(8);
        expect(Math.abs(out.y - rect.y)).toBeLessThanOrEqual(8);
      }),
    );
  });
});

describe("windowSnapTargets", () => {
  it("keeps windows with bounds on the display, converted to display-local DIP", () => {
    expect(windowSnapTargets(SOURCES, "d1")).toEqual([
      { x: 100, y: 100, width: 1280, height: 720 },
    ]);
    expect(windowSnapTargets(SOURCES, "d2")).toEqual([]);
    expect(windowSnapTargets(SOURCES, "nope")).toEqual([]);
    expect(windowSnapTargets(null, "d1")).toEqual([]);
  });

  it("uses bounds overlap when a window has no displayId and skips windows without bounds", () => {
    const sources = {
      ...SOURCES,
      windows: [
        { id: "w1", title: "Terminal", bounds: { x: 1600, y: 40, width: 800, height: 500 } },
        { id: "w2", title: "desktopCapturer window" },
      ],
    };
    expect(windowSnapTargets(sources, "d2")).toEqual([{ x: 88, y: 40, width: 800, height: 500 }]);
    expect(windowSnapTargets(sources, "d1")).toEqual([]);
  });
});
