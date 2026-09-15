import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SQUIRCLE_SEGMENTS, squirclePoints } from "./squircle";

describe("squirclePoints", () => {
  it("degenerates to a rect with no radius", () => {
    expect(squirclePoints(1, 2, 10, 20, 0)).toEqual([1, 2, 11, 2, 11, 22, 1, 22]);
  });

  it("emits 4 × (segments+1) points inside the box", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.double({ min: 0.1, max: 400, noNaN: true }),
        (w, h, r) => {
          const pts = squirclePoints(0, 0, w, h, r);
          expect(pts.length).toBe(4 * (SQUIRCLE_SEGMENTS + 1) * 2);
          for (let i = 0; i < pts.length; i += 2) {
            expect(pts[i]).toBeGreaterThanOrEqual(-1e-9);
            expect(pts[i]).toBeLessThanOrEqual(w + 1e-9);
            expect(pts[i + 1]).toBeGreaterThanOrEqual(-1e-9);
            expect(pts[i + 1]).toBeLessThanOrEqual(h + 1e-9);
          }
        },
      ),
    );
  });

  it("bulges past a circular corner at 45° (superellipse n=4)", () => {
    const r = 50;
    const pts = squirclePoints(0, 0, 200, 200, r, 2);
    // Top-left corner's middle sample (index 1 of 3) is at θ = 225°.
    const x = pts[2] as number;
    const circleX = r - r * Math.SQRT1_2;
    expect(x).toBeLessThan(circleX);
    // Arcs meet the edges: first point on the left edge, second corner starts on the top edge.
    expect(pts[0]).toBeCloseTo(0);
    expect(pts[7]).toBeCloseTo(0);
  });

  it("clamps the radius to half the short side", () => {
    const pts = squirclePoints(0, 0, 40, 10, 100, 1);
    expect(Math.max(...pts.filter((_, i) => i % 2 === 1))).toBeCloseTo(10);
  });
});
