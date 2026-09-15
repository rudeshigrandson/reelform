import { describe, expect, it } from "vitest";
import { migrateSettings } from "./migrations";
import {
  FRAME_USER_PRESETS_MAX,
  SETTINGS_SCHEMA_VERSION,
  SettingsPatchSchema,
  SettingsSchema,
  changedKeys,
  createDefaultSettings,
} from "./schema";

const defaults = createDefaultSettings({ recordingsFolder: "/home/me/Videos/Reelform" });

const preset = (id: string, settings: Record<string, unknown> = { radius: 12 }) => ({
  id,
  name: `Preset ${id}`,
  builtIn: false,
  settings,
});

describe("frameUserPresets setting", () => {
  it("defaults to an empty list that validates", () => {
    expect(defaults.frameUserPresets).toEqual([]);
    expect(SettingsSchema.parse(defaults)).toEqual(defaults);
  });

  it("accepts presets with arbitrary frame settings objects in a patch", () => {
    const patch = {
      frameUserPresets: [preset("a", { radius: 30, background: { kind: "color" } })],
    };
    expect(SettingsPatchSchema.parse(patch)).toEqual(patch);
  });

  it("rejects malformed presets, extra fields, and lists over the cap", () => {
    const bad = [
      [{ id: "a", name: "No settings", builtIn: false }],
      [{ ...preset("a"), name: "" }],
      [{ ...preset("a"), settings: [] }],
      [{ ...preset("a"), extra: true }],
      Array.from({ length: FRAME_USER_PRESETS_MAX + 1 }, (_, i) => preset(String(i))),
    ];
    for (const frameUserPresets of bad) {
      expect(SettingsPatchSchema.safeParse({ frameUserPresets }).success).toBe(false);
    }
    const full = Array.from({ length: FRAME_USER_PRESETS_MAX }, (_, i) => preset(String(i)));
    expect(SettingsPatchSchema.safeParse({ frameUserPresets: full }).success).toBe(true);
  });

  it("changedKeys notices preset list edits", () => {
    const next = { ...defaults, frameUserPresets: [preset("a")] };
    expect(changedKeys(defaults, next)).toEqual(["frameUserPresets"]);
  });

  it("files saved before the key existed load with the default, without a repair", () => {
    const { frameUserPresets: _added, ...older } = defaults;
    const result = migrateSettings(older, defaults);
    expect(result.settings.frameUserPresets).toEqual([]);
    expect(result.repairedKeys).toEqual([]);
    expect(result.droppedKeys).toEqual([]);
  });

  it("v1 files gain the default; stored presets survive and corrupt lists are repaired alone", () => {
    expect(migrateSettings({ theme: "dark" }, defaults).settings.frameUserPresets).toEqual([]);

    const kept = migrateSettings(
      { ...defaults, schemaVersion: SETTINGS_SCHEMA_VERSION, frameUserPresets: [preset("a")] },
      defaults,
    );
    expect(kept.settings.frameUserPresets).toEqual([preset("a")]);
    expect(kept.needsWrite).toBe(false);

    const repaired = migrateSettings(
      { ...defaults, theme: "dark", frameUserPresets: "nope" },
      defaults,
    );
    expect(repaired.repairedKeys).toEqual(["frameUserPresets"]);
    expect(repaired.settings.frameUserPresets).toEqual([]);
    expect(repaired.settings.theme).toBe("dark");
  });
});
