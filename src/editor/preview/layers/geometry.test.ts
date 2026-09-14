import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_DASHES, arrowGeometry, dashSegments, luminance, parseColor } from "./geometry";

describe("parseColor", () => {
  it("parses #rgb, #rrggbb and #rrggbbaa", () => {
    expect(parseColor("#fff")).toEqual({ color: 0xffffff, alpha: 1 });
    expect(parseColor("#ff5a5f")).toEqual({ color: 0xff5a5f, alpha: 1 });
    expect(parseColor("#00000000")).toEqual({ color: 0, alpha: 0 });
    expect(parseColor("#11223380").alpha).toBeCloseTo(128 / 255, 12);
  });
  it("falls back on garbage", () => {
    expect(parseColor("red", 0x123456)).toEqual({ color: 0x123456, alpha: 1 });
    expect(parseColor("#12345")).toEqual({ color: 0, alpha: 1 });
  });
  it("luminance orders black < white", () => {
    expect(luminance(0x000000)).toBe(0);
    expect(luminance(0xffffff)).toBeCloseTo(1, 12);
  });
});

describe("dashSegments", () => {
  it("returns nothing for a zero-length line and one segment when undashed", () => {
    expect(dashSegments(1, 1, 1, 1, 4, 4)).toEqual([]);
    expect(dashSegments(0, 0, 10, 0, 0, 4)).toEqual([[0, 0, 10, 0]]);
  });
  it("dashes along the line", () => {
    expect(dashSegments(0, 0, 20, 0, 4, 6)).toEqual([
      [0, 0, 4, 0],
      [10, 0, 14, 0],
    ]);
  });
  it("property: segments stay on the line, bounded in count", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: 1e-6, max: 50, noNaN: true }),
        fc.double({ min: 1e-6, max: 50, noNaN: true }),
        (x2, y2, dash, gap) => {
          const segs = dashSegments(0, 0, x2, y2, dash, gap);
          expect(segs.length).toBeLessThanOrEqual(MAX_DASHES + 1);
          const len = Math.hypot(x2, y2);
          for (const [a, b, c, d] of segs) {
            expect(Math.hypot(a, b)).toBeLessThanOrEqual(len + 1e-6);
            expect(Math.hypot(c, d)).toBeLessThanOrEqual(len + 1e-6);
          }
        },
      ),
    );
  });
});

describe("arrowGeometry", () => {
  it("triangle head: tip at the end, shaft stops at the head base", () => {
    const g = arrowGeometry(0, 0, 100, 0, 4, "triangle");
    expect(g.head.kind).toBe("triangle");
    if (g.head.kind !== "triangle") return;
    expect(g.head.points.slice(2, 4)).toEqual([100, 0]);
    expect(g.shaft).toEqual([0, 0, 86, 0]);
  });
  it("head never exceeds half the arrow", () => {
    const g = arrowGeometry(0, 0, 10, 0, 40, "open");
    if (g.head.kind !== "open") throw new Error("expected open head");
    expect(g.head.points[0]).toBeCloseTo(5, 12);
  });
  it("none / zero length → shaft only", () => {
    expect(arrowGeometry(0, 0, 10, 10, 4, "none").head.kind).toBe("none");
    expect(arrowGeometry(5, 5, 5, 5, 4, "triangle").head.kind).toBe("none");
    const c = arrowGeometry(0, 0, 0, 100, 4, "circle");
    expect(c.head).toEqual({ kind: "circle", x: 0, y: 100, radius: 6 });
  });
});
