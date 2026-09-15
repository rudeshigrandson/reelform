import { describe, expect, it } from "vitest";
import { sampleSettings } from "../../settings/types";
import { launcherDefaultsFromSettings, launcherDefaultsKey } from "./settingsDefaults";

describe("launcherDefaultsFromSettings", () => {
  it("maps the settings defaults (60 fps, display, no devices)", () => {
    expect(launcherDefaultsFromSettings(sampleSettings)).toEqual({
      mode: "screen",
      fps: 60,
      countdown: 3,
      mic: false,
      webcam: false,
      systemAudio: false,
      hideCursor: false,
    });
  });

  it("turns chosen devices on with their ids and maps every source", () => {
    const d = launcherDefaultsFromSettings({
      ...sampleSettings,
      defaultSource: "window",
      defaultFps: 30,
      defaultCountdown: 10,
      defaultMicId: "mic-2",
      defaultCameraId: "cam-1",
      defaultSystemAudio: true,
      hideCursorByDefault: true,
    });
    expect(d).toEqual({
      mode: "window",
      fps: 30,
      countdown: 10,
      mic: true,
      micDeviceId: "mic-2",
      webcam: true,
      webcamDeviceId: "cam-1",
      systemAudio: true,
      hideCursor: true,
    });
    expect(launcherDefaultsFromSettings({ defaultSource: "region" }).mode).toBe("region");
  });

  it("drops invalid values and tolerates partial or missing settings", () => {
    expect(launcherDefaultsFromSettings(null)).toEqual({});
    expect(launcherDefaultsFromSettings({})).toEqual({});
    const bogus = {
      defaultSource: "tab",
      defaultFps: 24,
      defaultCountdown: 7,
      defaultMicId: "   ",
    } as unknown as Parameters<typeof launcherDefaultsFromSettings>[0];
    expect(launcherDefaultsFromSettings(bogus)).toEqual({ mic: false });
  });
});

describe("launcherDefaultsKey", () => {
  it("is stable across key order and changes with a value", () => {
    expect(launcherDefaultsKey({ fps: 60, mic: true })).toBe(
      launcherDefaultsKey({ mic: true, fps: 60 }),
    );
    expect(launcherDefaultsKey({ fps: 60 })).not.toBe(launcherDefaultsKey({ fps: 30 }));
    expect(launcherDefaultsKey(undefined)).toBe("");
  });
});
