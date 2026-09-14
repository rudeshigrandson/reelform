import fc from "fast-check";
import {
  HIGH_FPS_MULTIPLIER,
  MBPS,
  TIMESLICE_MS,
  VIDEO_MIME_CANDIDATES,
  baseVideoBitrate,
  negotiateAudioMime,
  negotiateVideoMime,
  videoBitrate,
} from "./encoding";

const only =
  (...mimes: string[]) =>
  (m: string) =>
    mimes.includes(m);

describe("negotiateVideoMime", () => {
  it("prefers VP9 WebM when supported", () => {
    const all = () => true;
    expect(negotiateVideoMime(all)).toEqual({
      mimeType: "video/webm;codecs=vp9",
      codec: "vp9",
      container: "webm",
    });
  });

  it("falls back to H.264 when VP9 is unavailable", () => {
    expect(negotiateVideoMime(only("video/webm;codecs=h264", "video/webm"))?.codec).toBe("h264");
    expect(negotiateVideoMime(only("video/mp4;codecs=avc1"))).toEqual({
      mimeType: "video/mp4;codecs=avc1",
      codec: "h264",
      container: "mp4",
    });
  });

  it("then VP8, then bare WebM, else null", () => {
    expect(negotiateVideoMime(only("video/webm;codecs=vp8", "video/webm"))?.codec).toBe("vp8");
    expect(negotiateVideoMime(only("video/webm"))?.codec).toBe("webm");
    expect(negotiateVideoMime(() => false)).toBeNull();
  });

  it("treats a throwing isTypeSupported as unsupported", () => {
    const flaky = (m: string) => {
      if (m.includes("vp9")) throw new Error("boom");
      return m === "video/webm;codecs=h264";
    };
    expect(negotiateVideoMime(flaky)?.codec).toBe("h264");
  });

  it("property: result is always the first supported candidate", () => {
    fc.assert(
      fc.property(fc.subarray(VIDEO_MIME_CANDIDATES.map((c) => c.mimeType)), (supported) => {
        const r = negotiateVideoMime((m) => supported.includes(m));
        const expected = VIDEO_MIME_CANDIDATES.find((c) => supported.includes(c.mimeType));
        expect(r).toEqual(expected ?? null);
      }),
    );
  });
});

describe("negotiateAudioMime", () => {
  it("prefers opus webm", () => {
    expect(negotiateAudioMime(() => true)).toBe("audio/webm;codecs=opus");
    expect(negotiateAudioMime(only("audio/webm"))).toBe("audio/webm");
    expect(negotiateAudioMime(() => false)).toBeNull();
  });
});

describe("bitrate table", () => {
  it("matches the spec tiers at 30fps", () => {
    expect(baseVideoBitrate({ width: 1920, height: 1080 })).toBe(18 * MBPS);
    expect(baseVideoBitrate({ width: 1280, height: 720 })).toBe(18 * MBPS);
    expect(baseVideoBitrate({ width: 2560, height: 1440 })).toBe(28 * MBPS);
    expect(baseVideoBitrate({ width: 2560, height: 1600 })).toBe(45 * MBPS);
    expect(baseVideoBitrate({ width: 3840, height: 2160 })).toBe(45 * MBPS);
  });

  it("boundary: one pixel row above a tier moves up", () => {
    expect(baseVideoBitrate({ width: 1920, height: 1081 })).toBe(28 * MBPS);
    expect(baseVideoBitrate({ width: 2560, height: 1441 })).toBe(45 * MBPS);
  });

  it("applies ×1.7 at 60fps", () => {
    expect(videoBitrate({ width: 1920, height: 1080 }, 30)).toBe(18 * MBPS);
    expect(videoBitrate({ width: 1920, height: 1080 }, 60)).toBe(30_600_000);
    expect(videoBitrate({ width: 2560, height: 1440 }, 60)).toBe(47_600_000);
    expect(videoBitrate({ width: 3840, height: 2160 }, 60)).toBe(76_500_000);
  });

  it("degenerate sizes use the lowest tier", () => {
    expect(baseVideoBitrate({ width: 0, height: 0 })).toBe(18 * MBPS);
    expect(baseVideoBitrate({ width: -10, height: 500 })).toBe(18 * MBPS);
    expect(baseVideoBitrate({ width: Number.NaN, height: 1 })).toBe(18 * MBPS);
  });

  it("property: monotone in area and 60fps = round(30fps × 1.7)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8000 }),
        fc.integer({ min: 2, max: 8000 }),
        fc.integer({ min: 2, max: 8000 }),
        (w, h, extra) => {
          const a = baseVideoBitrate({ width: w, height: h });
          const b = baseVideoBitrate({ width: w + extra, height: h });
          expect(b).toBeGreaterThanOrEqual(a);
          expect(videoBitrate({ width: w, height: h }, 60)).toBe(
            Math.round(a * HIGH_FPS_MULTIPLIER),
          );
        },
      ),
    );
  });

  it("uses a 250ms timeslice", () => {
    expect(TIMESLICE_MS).toBe(250);
  });
});
