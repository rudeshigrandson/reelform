import { describe, expect, it } from "vitest";
import {
  SettingsPatchSchema,
  SettingsSchema,
  createDefaultSettings,
} from "../../../electron/settings/schema";
import { sampleSettings } from "../../settings/types";
import { applySettingsPatch, fromMainSettings, isSettingsKey, toMainPatch } from "./mapping";

const mainDefaults = createDefaultSettings({ recordingsFolder: "~/Movies/Reelform" });

const presets = [
  { id: "p1", name: "Launch", builtIn: false, settings: { radius: 30, squircle: true } },
];

describe("frameUserPresets mapping", () => {
  it("is a known settings key with an empty default on both sides", () => {
    expect(isSettingsKey("frameUserPresets")).toBe(true);
    expect(sampleSettings.frameUserPresets).toEqual([]);
    expect(fromMainSettings(mainDefaults).frameUserPresets).toEqual([]);
  });

  it("toMainPatch passes presets through and the result validates in main", () => {
    const patch = toMainPatch({ frameUserPresets: presets, bogus: 1 });
    expect(patch).toEqual({ frameUserPresets: presets });
    expect(SettingsPatchSchema.safeParse(patch).success).toBe(true);
    expect(SettingsSchema.parse({ ...mainDefaults, ...patch }).frameUserPresets).toEqual(presets);
  });

  it("applySettingsPatch replaces the list whole", () => {
    const state = applySettingsPatch(sampleSettings, { frameUserPresets: presets });
    expect(state.frameUserPresets).toEqual(presets);
    expect(applySettingsPatch(state, { frameUserPresets: [] }).frameUserPresets).toEqual([]);
  });

  it("fromMainSettings deep-copies presets", () => {
    const state = fromMainSettings({ ...mainDefaults, frameUserPresets: structuredClone(presets) });
    const first = state.frameUserPresets[0];
    if (first) first.name = "Changed";
    expect(presets[0]?.name).toBe("Launch");
  });
});
