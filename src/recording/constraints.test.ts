import fc from "fast-check";
import {
  UNSUPPORTED_SYSTEM_AUDIO_MAC,
  buildDesktopConstraints,
  buildMicConstraints,
  buildSystemAudioConstraints,
  buildWebcamConstraints,
  sourcePixelSize,
} from "./constraints";

describe("sourcePixelSize", () => {
  it("multiplies DIP by scaleFactor", () => {
    expect(sourcePixelSize({ width: 1440, height: 900 }, 2)).toEqual({ width: 2880, height: 1800 });
  });

  it("rounds fractional scale down to even pixels", () => {
    expect(sourcePixelSize({ width: 1707, height: 960 }, 1.25)).toEqual({
      width: 2132,
      height: 1200,
    });
  });

  it("treats missing / invalid scale as 1 and invalid sizes as the 2px minimum", () => {
    expect(sourcePixelSize({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
    expect(sourcePixelSize({ width: 100, height: 50 }, 0)).toEqual({ width: 100, height: 50 });
    expect(sourcePixelSize({ width: Number.NaN, height: -5 }, Number.NaN)).toEqual({
      width: 2,
      height: 2,
    });
  });

  it("property: always even, ≥ 2, and never exceeds dip × scale", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 8000, noNaN: true }),
        fc.double({ min: 1, max: 8000, noNaN: true }),
        fc.double({ min: 0.5, max: 4, noNaN: true }),
        (w, h, s) => {
          const px = sourcePixelSize({ width: w, height: h }, s);
          for (const [v, dip] of [
            [px.width, w],
            [px.height, h],
          ] as const) {
            expect(v % 2).toBe(0);
            expect(v).toBeGreaterThanOrEqual(2);
            expect(v).toBeLessThanOrEqual(Math.max(2, dip * s));
          }
        },
      ),
    );
  });
});

describe("buildDesktopConstraints", () => {
  it("targets 60fps at native pixel size by default", () => {
    const c = buildDesktopConstraints({
      sourceId: "screen:1:0",
      size: { width: 1512, height: 982 },
      scaleFactor: 2,
    });
    expect(c.audio).toBe(false);
    expect(c.video).toEqual({
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: "screen:1:0",
        minWidth: 3024,
        maxWidth: 3024,
        minHeight: 1964,
        maxHeight: 1964,
        minFrameRate: 60,
        maxFrameRate: 60,
      },
    });
  });

  it("omits size bounds when the source size is unknown and honours 30fps", () => {
    const c = buildDesktopConstraints({ sourceId: "window:42:0", fps: 30 });
    expect(c.video).toEqual({
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: "window:42:0",
        minFrameRate: 30,
        maxFrameRate: 30,
      },
    });
  });
});

describe("buildMicConstraints", () => {
  it("pins an explicit device and disables processing", () => {
    expect(buildMicConstraints("mic-1")).toEqual({
      audio: {
        deviceId: { exact: "mic-1" },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
      },
      video: false,
    });
  });

  it("uses the default device when none or 'default' is given", () => {
    for (const id of [undefined, "default", ""]) {
      const c = buildMicConstraints(id);
      expect(c.audio).not.toHaveProperty("deviceId");
    }
  });
});

describe("buildSystemAudioConstraints", () => {
  const desktop = { sourceId: "screen:0:0", size: { width: 1920, height: 1080 }, fps: 60 as const };

  it("returns an explicit unsupported reason on macOS", () => {
    expect(buildSystemAudioConstraints("darwin", desktop)).toEqual({
      ok: false,
      reason: UNSUPPORTED_SYSTEM_AUDIO_MAC,
    });
  });

  it.each(["win32", "linux"] as const)("requests desktop loopback + video on %s", (platform) => {
    const r = buildSystemAudioConstraints(platform, desktop);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.constraints.audio).toEqual({
      mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: "screen:0:0" },
    });
    expect(r.constraints.video).toEqual(buildDesktopConstraints(desktop).video);
  });
});

describe("buildWebcamConstraints", () => {
  it("defaults to 1280×720@30", () => {
    expect(buildWebcamConstraints()).toEqual({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
  });

  it("supports the 1080p option with a pinned device", () => {
    expect(buildWebcamConstraints("cam-2", "1080p").video).toEqual({
      deviceId: { exact: "cam-2" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    });
  });
});
