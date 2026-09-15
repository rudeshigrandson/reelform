import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AUTO_MAX_LONG_EDGE,
  MIN_RESOLUTION,
  canvasViewSize,
  canvasZoomLabel,
  previewResolution,
} from "./quality";

describe("previewResolution", () => {
  const view = { width: 1200, height: 675 };
  const src = { width: 2880, height: 1800 };

  it("full = dpr, half = dpr/2", () => {
    expect(previewResolution("full", 2, view, src)).toBe(2);
    expect(previewResolution("half", 2, view, src)).toBe(1);
    expect(previewResolution("half", 0.4, view, src)).toBe(MIN_RESOLUTION);
  });

  it("auto keeps dpr for normal canvases and caps huge ones", () => {
    expect(previewResolution("auto", 2, view, src)).toBe(2);
    const big = { width: 3000, height: 1700 };
    expect(previewResolution("auto", 2, big, src)).toBeCloseTo(AUTO_MAX_LONG_EDGE / 3000);
    // A 720p source doesn't need more than 1280 device px.
    expect(previewResolution("auto", 2, view, { width: 1280, height: 720 })).toBeCloseTo(
      1280 / 1200,
    );
  });

  it("is bounded for any input", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("auto" as const, "full" as const, "half" as const),
        fc.double({ min: -2, max: 4 }),
        fc.double({ min: -10, max: 8000 }),
        fc.double({ min: -10, max: 8000 }),
        (q, dpr, w, h) => {
          const r = previewResolution(q, dpr, { width: w, height: h }, null);
          expect(r).toBeGreaterThanOrEqual(MIN_RESOLUTION);
          expect(r).toBeLessThanOrEqual(
            Math.max(1, Number.isFinite(dpr) && dpr > 0 ? dpr : 1, MIN_RESOLUTION),
          );
        },
      ),
    );
  });
});

describe("canvasViewSize", () => {
  it("fit uses the well; 50/100% use the output size", () => {
    const well = { width: 900, height: 500 };
    const out = { width: 1920, height: 1080 };
    expect(canvasViewSize("fit", well, out)).toEqual(well);
    expect(canvasViewSize("100", well, out)).toEqual(out);
    expect(canvasViewSize("50", well, out)).toEqual({ width: 960, height: 540 });
    expect(canvasZoomLabel("50")).toBe("50%");
    expect(canvasZoomLabel("fit")).toBe("Fit");
  });
});
