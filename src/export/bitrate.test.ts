import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Codec, Quality } from "./bitrate.js";
import { exportBitrate } from "./bitrate.js";

const CODECS: Codec[] = ["h264", "hevc", "av1", "vp9"];

describe("exportBitrate — 1080p60 reference table", () => {
  it("1080p60 H.264 High = 16 Mbps", () => {
    expect(exportBitrate(1920, 1080, 60, "h264", "High")).toBe(16_000_000);
  });

  it("1080p60 H.264 Max = 28 Mbps", () => {
    expect(exportBitrate(1920, 1080, 60, "h264", "Max")).toBe(28_000_000);
  });

  it("HEVC is ×0.65 of H.264 at the same settings", () => {
    const h264 = exportBitrate(1920, 1080, 60, "h264", "High");
    const hevc = exportBitrate(1920, 1080, 60, "hevc", "High");
    expect(hevc).toBe(Math.round(h264 * 0.65));
  });

  it("AV1 is ×0.5 of H.264 at the same settings", () => {
    const h264 = exportBitrate(1920, 1080, 60, "h264", "Max");
    const av1 = exportBitrate(1920, 1080, 60, "av1", "Max");
    expect(av1).toBe(Math.round(h264 * 0.5));
  });

  it("HEVC/AV1 High exact values at 1080p60", () => {
    expect(exportBitrate(1920, 1080, 60, "hevc", "High")).toBe(Math.round(16_000_000 * 0.65));
    expect(exportBitrate(1920, 1080, 60, "av1", "High")).toBe(Math.round(16_000_000 * 0.5));
  });
});

describe("exportBitrate — resolution scaling", () => {
  it("4K has ~4× the pixel count of 1080p (same fps)", () => {
    const hd = exportBitrate(1920, 1080, 60, "h264", "High");
    const uhd = exportBitrate(3840, 2160, 60, "h264", "High");
    expect(uhd).toBe(hd * 4);
  });

  it("720p has fewer bits than 1080p", () => {
    expect(exportBitrate(1280, 720, 60, "h264", "High")).toBeLessThan(
      exportBitrate(1920, 1080, 60, "h264", "High"),
    );
  });
});

describe("exportBitrate — fps scaling", () => {
  it("60fps reference is exactly the table value", () => {
    expect(exportBitrate(1920, 1080, 60, "h264", "High")).toBe(16_000_000);
  });

  it("60fps is ×1.7 of 30fps", () => {
    const at30 = exportBitrate(1920, 1080, 30, "h264", "High");
    const at60 = exportBitrate(1920, 1080, 60, "h264", "High");
    // 60fps anchor is exact; 30fps = 60fps / 1.7 (within rounding).
    expect(at60 / at30).toBeCloseTo(1.7, 5);
  });

  it("45fps is the linear midpoint between 30 and 60fps factors", () => {
    const at30 = exportBitrate(1920, 1080, 30, "h264", "High");
    const at60 = exportBitrate(1920, 1080, 60, "h264", "High");
    const at45 = exportBitrate(1920, 1080, 45, "h264", "High");
    // Linear factor → midpoint bitrate, within rounding of the two endpoints.
    expect(Math.abs(at45 - (at30 + at60) / 2)).toBeLessThanOrEqual(1);
  });
});

describe("exportBitrate — monotonicity (property tests)", () => {
  const dim = fc.integer({ min: 16, max: 7680 });
  const fps = fc.integer({ min: 1, max: 240 });
  const codec = fc.constantFrom(...CODECS);
  const quality = fc.constantFrom<Quality>("High", "Max");

  it("higher resolution never decreases bitrate", () => {
    fc.assert(
      fc.property(
        dim,
        dim,
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        fps,
        codec,
        quality,
        (w, h, dw, dh, f, c, q) => {
          const lo = exportBitrate(w, h, f, c, q);
          const hi = exportBitrate(w + dw, h + dh, f, c, q);
          expect(hi).toBeGreaterThanOrEqual(lo);
        },
      ),
    );
  });

  it("higher fps never decreases bitrate", () => {
    fc.assert(
      fc.property(
        dim,
        dim,
        fps,
        fc.integer({ min: 0, max: 200 }),
        codec,
        quality,
        (w, h, f, df, c, q) => {
          const lo = exportBitrate(w, h, f, c, q);
          const hi = exportBitrate(w, h, f + df, c, q);
          expect(hi).toBeGreaterThanOrEqual(lo);
        },
      ),
    );
  });

  it("Max quality never below High at the same settings", () => {
    fc.assert(
      fc.property(dim, dim, fps, codec, (w, h, f, c) => {
        expect(exportBitrate(w, h, f, c, "Max")).toBeGreaterThanOrEqual(
          exportBitrate(w, h, f, c, "High"),
        );
      }),
    );
  });

  it("always a non-negative integer", () => {
    fc.assert(
      fc.property(dim, dim, fps, codec, quality, (w, h, f, c, q) => {
        const b = exportBitrate(w, h, f, c, q);
        expect(Number.isInteger(b)).toBe(true);
        expect(b).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
