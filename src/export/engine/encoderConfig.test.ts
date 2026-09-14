import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exportBitrate } from "../bitrate";
import type { ExportConfig } from "../route";
import {
  BT709_LIMITED,
  EncoderUnsupportedError,
  ExportConfigError,
  buildVideoEncoderConfig,
  codecString,
  containerSupports,
  muxerVideoCodec,
  pickLevel,
  resolveVideoEncoderConfig,
  validateExportConfig,
} from "./encoderConfig";

const cfg = (over: Partial<ExportConfig> = {}): ExportConfig => ({
  codec: "h264",
  container: "mp4",
  width: 1920,
  height: 1080,
  fps: 60,
  quality: "High",
  ...over,
});

describe("codecString", () => {
  it("picks the lowest level that fits", () => {
    expect(codecString("h264", 1920, 1080, 30)).toBe("avc1.640028");
    expect(codecString("h264", 1920, 1080, 60)).toBe("avc1.64002a");
    expect(codecString("h264", 3840, 2160, 60)).toBe("avc1.640034");
    expect(codecString("h264", 1280, 720, 30)).toBe("avc1.64001f");
    expect(codecString("hevc", 1920, 1080, 60)).toBe("hvc1.1.6.L123.B0");
    expect(codecString("hevc", 3840, 2160, 60)).toBe("hvc1.1.6.L153.B0");
    expect(codecString("av1", 1920, 1080, 60)).toBe("av01.0.09M.08");
    expect(codecString("av1", 1280, 720, 30)).toBe("av01.0.05M.08");
    expect(codecString("vp9", 1920, 1080, 60)).toBe("vp09.00.41.08");
  });

  it("raises the level when the target bitrate exceeds the level maximum", () => {
    // Size/rate alone would allow 5.1 / 5.0 / 4.0, but their max bitrates are too low.
    expect(codecString("hevc", 3840, 2160, 60, exportBitrate(3840, 2160, 60, "hevc", "Max"))).toBe(
      "hvc1.1.6.L183.B0",
    );
    expect(codecString("av1", 3840, 2160, 30, exportBitrate(3840, 2160, 30, "av1", "Max"))).toBe(
      "av01.0.13M.08",
    );
    expect(codecString("h264", 1920, 1080, 30, 30_000_000)).toBe("avc1.640029");
    expect(codecString("vp9", 1920, 1080, 30, 20_000_000)).toBe("vp09.00.41.08");
    // Below the limit the level is unchanged.
    expect(codecString("h264", 1920, 1080, 30, 9_000_000)).toBe("avc1.640028");
  });

  it("buildVideoEncoderConfig picks a level that admits its own bitrate", () => {
    expect(
      buildVideoEncoderConfig(cfg({ codec: "hevc", width: 3840, height: 2160 }), "prefer-hardware")
        .codec,
    ).toBe("hvc1.1.6.L156.B0");
    fc.assert(
      fc.property(
        fc.constantFrom(...(["h264", "hevc", "av1", "vp9"] as const)),
        fc.integer({ min: 80, max: 1920 }),
        fc.integer({ min: 45, max: 1080 }),
        fc.constantFrom(24, 30, 60),
        fc.constantFrom(...(["High", "Max"] as const)),
        (codec, w, h, fps, quality) => {
          const c = buildVideoEncoderConfig(
            cfg({ codec, container: "mp4", width: w * 2, height: h * 2, fps, quality }),
            "prefer-software",
          );
          return c.codec === codecString(codec, w * 2, h * 2, fps, c.bitrate);
        },
      ),
    );
  });

  it("level choice is monotonic in bitrate", () => {
    const table = [
      [1, 10, 100, 5],
      [2, 10, 100, 50],
      [3, 10, 100, 500],
    ] as const;
    fc.assert(
      fc.property(fc.nat(600), fc.nat(600), (b1, b2) => {
        return (
          pickLevel(table, 5, 50, Math.min(b1, b2)) <= pickLevel(table, 5, 50, Math.max(b1, b2))
        );
      }),
    );
  });

  it("clamps absurd sizes to the top level", () => {
    expect(codecString("h264", 16000, 16000, 120)).toBe("avc1.64003e");
  });

  it("level choice is monotonic in size and rate", () => {
    const table = [
      [1, 10, 100],
      [2, 20, 200],
      [3, 40, 800],
    ] as const;
    fc.assert(
      fc.property(fc.nat(60), fc.nat(60), fc.nat(1000), fc.nat(1000), (s1, s2, r1, r2) => {
        const lo = pickLevel(table, Math.min(s1, s2), Math.min(r1, r2));
        const hi = pickLevel(table, Math.max(s1, s2), Math.max(r1, r2));
        return lo <= hi;
      }),
    );
  });
});

describe("buildVideoEncoderConfig", () => {
  it("carries bitrate, rate, latency and bt709 limited colour", () => {
    const c = buildVideoEncoderConfig(cfg({ quality: "Max" }), "prefer-hardware");
    expect(c).toMatchObject({
      codec: "avc1.64002a",
      width: 1920,
      height: 1080,
      framerate: 60,
      bitrate: exportBitrate(1920, 1080, 60, "h264", "Max"),
      latencyMode: "quality",
      hardwareAcceleration: "prefer-hardware",
      avc: { format: "avc" },
    });
    expect(c.colorSpace).toEqual({
      primaries: "bt709",
      transfer: "bt709",
      matrix: "bt709",
      fullRange: false,
    });
    expect(c.colorSpace).not.toBe(BT709_LIMITED);
  });

  it("only H.264 gets avc options", () => {
    const c = buildVideoEncoderConfig(cfg({ codec: "vp9", container: "webm" }), "prefer-software");
    expect(c.avc).toBeUndefined();
    expect(c.hardwareAcceleration).toBe("prefer-software");
    expect(c.bitrate).toBe(exportBitrate(1920, 1080, 60, "vp9", "High"));
  });
});

describe("validateExportConfig", () => {
  it("accepts sane configs and rejects odd/invalid ones", () => {
    expect(() => validateExportConfig(cfg())).not.toThrow();
    expect(() => validateExportConfig(cfg({ width: 1921 }))).toThrow(ExportConfigError);
    expect(() => validateExportConfig(cfg({ height: 0 }))).toThrow(ExportConfigError);
    expect(() => validateExportConfig(cfg({ fps: 0 }))).toThrow(ExportConfigError);
    expect(() => validateExportConfig(cfg({ container: "webm" }))).toThrow(ExportConfigError);
    expect(() => validateExportConfig(cfg({ container: "webm", codec: "av1" }))).not.toThrow();
  });

  it("container/codec matrix and mediabunny ids", () => {
    expect(containerSupports("mp4", "hevc")).toBe(true);
    expect(containerSupports("webm", "hevc")).toBe(false);
    expect(muxerVideoCodec("h264")).toBe("avc");
    expect(muxerVideoCodec("av1")).toBe("av1");
  });
});

describe("resolveVideoEncoderConfig", () => {
  const probe = (hw: boolean | "throw", sw: boolean) => {
    const seen: string[] = [];
    return {
      seen,
      isConfigSupported: async (c: VideoEncoderConfig) => {
        seen.push(c.hardwareAcceleration ?? "");
        const accel = c.hardwareAcceleration === "prefer-hardware" ? hw : sw;
        if (accel === "throw") throw new TypeError("bad config");
        return { supported: accel, config: c };
      },
    };
  };

  it("uses hardware when accepted", async () => {
    const p = probe(true, true);
    const c = await resolveVideoEncoderConfig(cfg(), p, true);
    expect(c.hardwareAcceleration).toBe("prefer-hardware");
    expect(p.seen).toEqual(["prefer-hardware"]);
  });

  it("falls back to software when hardware is rejected or the probe throws", async () => {
    expect(
      (await resolveVideoEncoderConfig(cfg(), probe(false, true), true)).hardwareAcceleration,
    ).toBe("prefer-software");
    expect(
      (await resolveVideoEncoderConfig(cfg(), probe("throw", true), true)).hardwareAcceleration,
    ).toBe("prefer-software");
  });

  it("never probes hardware on the software route", async () => {
    const p = probe(true, true);
    await resolveVideoEncoderConfig(cfg(), p, false);
    expect(p.seen).toEqual(["prefer-software"]);
  });

  it("throws when nothing accepts the config", async () => {
    await expect(
      resolveVideoEncoderConfig(cfg(), probe(false, false), true),
    ).rejects.toBeInstanceOf(EncoderUnsupportedError);
  });
});
