import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Codec } from "./bitrate.js";
import type { EncoderCaps, ExportConfig, ProjectFlags } from "./route.js";
import { selectRoute } from "./route.js";

const ALL_HW: EncoderCaps = { h264: true, hevc: true, av1: true, vp9: true };
const NO_HW: EncoderCaps = { h264: false, hevc: false, av1: false, vp9: false };

const stylingOnly: ProjectFlags = {
  hasZooms: false,
  hasCursor: false,
  hasAnnotations: false,
  hasWebcam: false,
  hasCaptions: false,
  hasSpeeds: false,
};

const config = (over: Partial<ExportConfig> = {}): ExportConfig => ({
  codec: "h264",
  container: "mp4",
  width: 1920,
  height: 1080,
  fps: 60,
  quality: "High",
  ...over,
});

const FLAG_KEYS: (keyof ProjectFlags)[] = [
  "hasZooms",
  "hasCursor",
  "hasAnnotations",
  "hasWebcam",
  "hasCaptions",
  "hasSpeeds",
];

describe("selectRoute — native-static fast path", () => {
  it("chosen for a styling-only project when HW is available", () => {
    expect(selectRoute(config(), stylingOnly, ALL_HW)).toBe("native-static");
  });

  it("each individual feature flag disables the fast path", () => {
    for (const key of FLAG_KEYS) {
      const flags: ProjectFlags = { ...stylingOnly, [key]: true };
      expect(selectRoute(config(), flags, ALL_HW)).toBe("webcodecs");
    }
  });

  it("captions specifically force webcodecs", () => {
    const flags: ProjectFlags = { ...stylingOnly, hasCaptions: true };
    expect(selectRoute(config(), flags, ALL_HW)).toBe("webcodecs");
  });

  it("zooms specifically force webcodecs", () => {
    const flags: ProjectFlags = { ...stylingOnly, hasZooms: true };
    expect(selectRoute(config(), flags, ALL_HW)).toBe("webcodecs");
  });
});

describe("selectRoute — software fallback", () => {
  it("HW unavailable for the chosen codec forces software-fallback (feature-rich project)", () => {
    const flags: ProjectFlags = { ...stylingOnly, hasZooms: true };
    expect(selectRoute(config({ codec: "h264" }), flags, NO_HW)).toBe("software-fallback");
  });

  it("styling-only project without HW falls back to software (no fast path benefit)", () => {
    expect(selectRoute(config(), stylingOnly, NO_HW)).toBe("software-fallback");
  });

  it("only the chosen codec's HW status matters", () => {
    const caps: EncoderCaps = { h264: false, hevc: true, av1: true, vp9: true };
    const flags: ProjectFlags = { ...stylingOnly, hasCursor: true };
    // h264 has no HW → fallback
    expect(selectRoute(config({ codec: "h264" }), flags, caps)).toBe("software-fallback");
    // hevc has HW → webcodecs
    expect(selectRoute(config({ codec: "hevc" }), flags, caps)).toBe("webcodecs");
  });
});

describe("selectRoute — default webcodecs", () => {
  it("feature-rich project with HW available uses webcodecs", () => {
    const flags: ProjectFlags = {
      hasZooms: true,
      hasCursor: true,
      hasAnnotations: false,
      hasWebcam: false,
      hasCaptions: true,
      hasSpeeds: false,
    };
    expect(selectRoute(config(), flags, ALL_HW)).toBe("webcodecs");
  });
});

describe("selectRoute — properties", () => {
  const codec = fc.constantFrom<Codec>("h264", "hevc", "av1", "vp9");
  const boolRec = fc.record({
    hasZooms: fc.boolean(),
    hasCursor: fc.boolean(),
    hasAnnotations: fc.boolean(),
    hasWebcam: fc.boolean(),
    hasCaptions: fc.boolean(),
    hasSpeeds: fc.boolean(),
  });
  const caps = fc.record({
    h264: fc.boolean(),
    hevc: fc.boolean(),
    av1: fc.boolean(),
    vp9: fc.boolean(),
  });

  it("result is always one of the three known routes", () => {
    fc.assert(
      fc.property(codec, boolRec, caps, (c, flags, hw) => {
        const r = selectRoute(config({ codec: c }), flags, hw);
        expect(["webcodecs", "native-static", "software-fallback"]).toContain(r);
      }),
    );
  });

  it("native-static implies styling-only AND chosen-codec HW", () => {
    fc.assert(
      fc.property(codec, boolRec, caps, (c, flags, hw) => {
        const r = selectRoute(config({ codec: c }), flags, hw);
        if (r === "native-static") {
          const noFeatures = FLAG_KEYS.every((k) => !flags[k]);
          expect(noFeatures).toBe(true);
          expect(hw[c]).toBe(true);
        }
      }),
    );
  });

  it("no HW for the chosen codec is never webcodecs (always software-fallback)", () => {
    fc.assert(
      fc.property(codec, boolRec, caps, (c, flags, hw) => {
        if (!hw[c]) {
          expect(selectRoute(config({ codec: c }), flags, hw)).toBe("software-fallback");
        }
      }),
    );
  });
});
