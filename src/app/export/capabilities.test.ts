import { describe, expect, it, vi } from "vitest";
import {
  NO_CAPABILITIES,
  createEncoderCapabilityCache,
  hardwareCaps,
  isCodecUsable,
  probeEncoderCapabilities,
  unsupportedCodecs,
} from "./capabilities";

/** h264 hw+sw, hevc hw only, av1 unsupported, vp9 probe throws for hw, sw ok. */
function fakeProbe() {
  return {
    isConfigSupported: vi.fn(async (config: VideoEncoderConfig) => {
      const hw = config.hardwareAcceleration === "prefer-hardware";
      const c = config.codec;
      if (c.startsWith("avc1")) return { supported: true, config };
      if (c.startsWith("hvc1") || c.startsWith("hev1")) return { supported: hw, config };
      if (c.startsWith("vp09")) {
        if (hw) throw new Error("boom");
        return { supported: true, config };
      }
      return { supported: false, config };
    }),
  };
}

describe("probeEncoderCapabilities", () => {
  it("probes hardware and software per codec, treating throws as unsupported", async () => {
    const probe = fakeProbe();
    const caps = await probeEncoderCapabilities(probe);
    expect(caps).toEqual({
      h264: { hardware: true, software: true },
      hevc: { hardware: true, software: false },
      av1: { hardware: false, software: false },
      vp9: { hardware: false, software: true },
    });
    expect(probe.isConfigSupported).toHaveBeenCalledTimes(8);
    const first = probe.isConfigSupported.mock.calls[0]?.[0];
    expect(first).toMatchObject({ width: 1920, height: 1080, framerate: 60 });
  });

  it("derives route caps, usability and greyed codecs", async () => {
    const caps = await probeEncoderCapabilities(fakeProbe());
    expect(hardwareCaps(caps)).toEqual({ h264: true, hevc: true, av1: false, vp9: false });
    expect(isCodecUsable(caps, "vp9")).toBe(true);
    expect(unsupportedCodecs(caps)).toEqual({ av1: "Not supported on this device" });
    expect(unsupportedCodecs(null)).toEqual({});
    expect(Object.keys(unsupportedCodecs(NO_CAPABILITIES))).toHaveLength(4);
  });
});

describe("createEncoderCapabilityCache", () => {
  it("probes once per session for concurrent and later calls", async () => {
    const probe = fakeProbe();
    const cache = createEncoderCapabilityCache(probe);
    expect(cache.peek()).toBeNull();
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect(a).toBe(b);
    await cache.get();
    expect(probe.isConfigSupported).toHaveBeenCalledTimes(8);
    expect(cache.peek()).toBe(a);
    cache.clear();
    await cache.get();
    expect(probe.isConfigSupported).toHaveBeenCalledTimes(16);
  });

  it("reports nothing supported without WebCodecs", async () => {
    await expect(createEncoderCapabilityCache(null).get()).resolves.toEqual(NO_CAPABILITIES);
  });

  it("a probe that rejects everything yields all-unsupported (never throws)", async () => {
    const cache = createEncoderCapabilityCache({
      isConfigSupported: () => Promise.reject(new Error("gpu process crashed")),
    });
    await expect(cache.get()).resolves.toEqual(NO_CAPABILITIES);
  });
});
