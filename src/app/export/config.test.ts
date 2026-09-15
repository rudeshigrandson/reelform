import { describe, expect, it } from "vitest";
import { NO_CAPABILITIES } from "./capabilities";
import type { EncoderCapabilities } from "./capabilities";
import {
  type ValidationContext,
  defaultFlowConfig,
  estimateVideoBytes,
  formatBytes,
  formatDuration,
  gifDimensions,
  outputFileName,
  resolveRange,
  roughGifBytes,
  sidecarName,
  toEngineConfig,
  validateFlowConfig,
} from "./config";

const allCaps: EncoderCapabilities = {
  h264: { hardware: true, software: true },
  hevc: { hardware: true, software: false },
  av1: { hardware: false, software: false },
  vp9: { hardware: false, software: true },
};

const ctx = (patch: Partial<ValidationContext> = {}): ValidationContext => ({
  range: { durationMs: 10_000 },
  caps: allCaps,
  hasVideo: true,
  mediaOffline: false,
  captionCount: 3,
  ...patch,
});

describe("resolveRange", () => {
  it("entire / selection / in-out with clamping", () => {
    const src = {
      durationMs: 10_000,
      selection: { startMs: -50, endMs: 2000 },
      inOut: { startMs: 9000, endMs: 20_000 },
    };
    expect(resolveRange("entire", src)).toEqual({ startMs: 0, endMs: 10_000 });
    expect(resolveRange("selection", src)).toEqual({ startMs: 0, endMs: 2000 });
    expect(resolveRange("in-out", src)).toEqual({ startMs: 9000, endMs: 10_000 });
  });

  it("null for missing, empty, reversed or non-finite ranges", () => {
    expect(resolveRange("selection", { durationMs: 10_000 })).toBeNull();
    expect(
      resolveRange("in-out", { durationMs: 10_000, inOut: { startMs: 5, endMs: 5 } }),
    ).toBeNull();
    expect(
      resolveRange("selection", { durationMs: 10_000, selection: { startMs: 50, endMs: 10 } }),
    ).toBeNull();
    expect(
      resolveRange("selection", {
        durationMs: 10_000,
        selection: { startMs: Number.NaN, endMs: 10 },
      }),
    ).toBeNull();
    expect(resolveRange("entire", { durationMs: 0 })).toBeNull();
    expect(resolveRange("entire", { durationMs: Number.NaN })).toBeNull();
  });
});

describe("file names", () => {
  it("sanitizes, keeps spaces, and swaps extensions", () => {
    expect(outputFileName("My Demo", "mp4")).toBe("My Demo.mp4");
    expect(outputFileName("a/b:c?.mp4", "gif")).toBe("abc.gif");
    expect(outputFileName("  ...hidden ", "webm")).toBe("hidden.webm");
    expect(outputFileName("\u0001\u0002", "mp4")).toBe("Export.mp4");
    expect(outputFileName("x".repeat(400), "mp4")).toHaveLength(204);
  });

  it("derives sidecar names from the final (possibly renamed) output", () => {
    expect(sidecarName("/x/Demo (1).mp4", "srt")).toBe("Demo (1).srt");
    expect(sidecarName("C:\\out\\clip.webm", "vtt")).toBe("clip.vtt");
    expect(sidecarName("/x/noext", "wav")).toBe("noext.wav");
  });
});

describe("gifDimensions", () => {
  it("keeps aspect with even sizes and falls back to 16:9", () => {
    expect(gifDimensions(720, { width: 1920, height: 1080 })).toEqual({ width: 1280, height: 720 });
    const odd = gifDimensions(480, { width: 1000, height: 999 });
    expect(odd.width % 2).toBe(0);
    expect(gifDimensions(480, { width: 0, height: 0 })).toEqual({ width: 854, height: 480 });
  });
});

describe("validateFlowConfig", () => {
  it("accepts the defaults", () => {
    expect(validateFlowConfig(defaultFlowConfig("Demo"), ctx())).toEqual([]);
  });

  it("flags every invalid field", () => {
    const fields = (c: Parameters<typeof validateFlowConfig>[0], x = ctx()) =>
      validateFlowConfig(c, x).map((i) => i.field);
    const base = defaultFlowConfig("Demo");
    expect(fields({ ...base, fileName: " / " })).toEqual(["fileName"]);
    expect(fields(base, ctx({ mediaOffline: true }))).toEqual(["source"]);
    expect(fields({ ...base, range: "selection" })).toEqual(["range"]);
    expect(fields({ ...base, captions: "srt" }, ctx({ captionCount: 0 }))).toEqual(["captions"]);
    expect(fields({ ...base, width: 1921 })).toEqual(["size"]);
    expect(fields({ ...base, format: "webm", codec: "h264" })).toEqual(["codec"]);
    expect(fields({ ...base, codec: "av1" })).toEqual(["codec"]);
    expect(validateFlowConfig({ ...base, codec: "av1" }, ctx())[0]?.message).toBe(
      "Not supported on this device",
    );
    expect(fields({ ...base, codec: "av1" }, ctx({ caps: null }))).toEqual([]);
    expect(fields({ ...base, format: "gif", gif: { ...base.gif, colors: 8 } })).toEqual(["gif"]);
    // GIF ignores codec caps entirely.
    expect(
      fields({ ...base, format: "gif", codec: "av1" }, ctx({ caps: NO_CAPABILITIES })),
    ).toEqual([]);
  });
});

describe("estimates", () => {
  it("video bytes follow the bitrate table plus 192k audio", () => {
    const c = defaultFlowConfig();
    expect(estimateVideoBytes(c, 60_000)).toBe(((16_000_000 + 192_000) * 60) / 8);
    expect(estimateVideoBytes({ ...c, audio: "mute" }, 60_000)).toBe((16_000_000 * 60) / 8);
    expect(estimateVideoBytes(c, 0)).toBe(0);
    expect(toEngineConfig({ ...c, format: "webm", codec: "vp9" }).container).toBe("webm");
  });

  it("rough GIF size grows with duration, size and colors", () => {
    const a = roughGifBytes(1280, 720, 15, 256, 5000);
    expect(roughGifBytes(1280, 720, 15, 256, 10_000)).toBeGreaterThan(a);
    expect(roughGifBytes(640, 360, 15, 256, 5000)).toBeLessThan(a);
    expect(roughGifBytes(1280, 720, 15, 32, 5000)).toBeLessThan(a);
    expect(roughGifBytes(1280, 720, 15, 256, 0)).toBe(0);
  });

  it("formats sizes and durations", () => {
    expect(formatBytes(24_000_000)).toBe("24 MB");
    expect(formatBytes(1_500_000_000)).toBe("1.50 GB");
    expect(formatBytes(900)).toBe("1 KB");
    expect(formatBytes(Number.NaN)).toBe("0 KB");
    expect(formatDuration(72_000)).toBe("1:12");
    expect(formatDuration(null)).toBe("—");
  });
});
