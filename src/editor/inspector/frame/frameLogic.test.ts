import { describe, expect, it } from "vitest";
import {
  addGradientStop,
  applyPreset,
  aspectRatio,
  clampFrameSettings,
  findMatchingPreset,
  gradientToCss,
  outputSize,
  removeGradientStop,
  resolvePadding,
  setPaddingAll,
  setPaddingMatchAll,
  setPaddingSide,
  updateGradientStop,
  validateCustomSize,
} from "./frameLogic";
import {
  BUILT_IN_FRAME_PRESETS,
  DEFAULT_FRAME_SETTINGS,
  PLACEHOLDER_WALLPAPERS,
  frameSettingsSchema,
  type FrameAspect,
  type FrameSettings,
} from "./types";

const base = (): FrameSettings => structuredClone(DEFAULT_FRAME_SETTINGS);
const aspect = (preset: FrameAspect["preset"], w = 1920, h = 1080): FrameAspect => ({ preset, customWidth: w, customHeight: h });

describe("types", () => {
  it("defaults and every bundled preset satisfy the schema", () => {
    expect(frameSettingsSchema.safeParse(DEFAULT_FRAME_SETTINGS).success).toBe(true);
    for (const p of BUILT_IN_FRAME_PRESETS) expect(frameSettingsSchema.safeParse(p.settings).success).toBe(true);
  });

  it("ships the five named presets and 24 placeholder wallpapers with unique ids", () => {
    expect(BUILT_IN_FRAME_PRESETS.map((p) => p.name)).toEqual(["Default", "Minimal", "Product Hunt", "Twitter", "Vertical"]);
    expect(PLACEHOLDER_WALLPAPERS).toHaveLength(24);
    expect(new Set(PLACEHOLDER_WALLPAPERS.map((w) => w.id)).size).toBe(24);
  });

  it("schema rejects out-of-range values", () => {
    expect(frameSettingsSchema.safeParse({ ...base(), padding: { ...base().padding, all: 201 } }).success).toBe(false);
    expect(frameSettingsSchema.safeParse({ ...base(), inset: 49 }).success).toBe(false);
  });
});

describe("clampFrameSettings", () => {
  it("clamps every numeric field and replaces NaN with the minimum", () => {
    const s = base();
    const out = clampFrameSettings({
      ...s,
      blur: 99,
      radius: -5,
      inset: 10,
      padding: { ...s.padding, all: 500, left: -1 },
      shadow: { ...s.shadow, strength: Number.NaN, offsetY: -999 },
      border: { ...s.border, width: 20, opacity: 101 },
      aspect: { ...s.aspect, customWidth: 10, customHeight: 99999.4 },
    });
    expect(out.blur).toBe(40);
    expect(out.radius).toBe(0);
    expect(out.inset).toBe(50);
    expect(out.padding.all).toBe(200);
    expect(out.padding.left).toBe(0);
    expect(out.shadow.strength).toBe(0);
    expect(out.shadow.offsetY).toBe(-100);
    expect(out.border).toMatchObject({ width: 8, opacity: 100 });
    expect(out.aspect).toMatchObject({ customWidth: 64, customHeight: 7680 });
    expect(frameSettingsSchema.safeParse(out).success).toBe(true);
  });

  it("does not mutate its input", () => {
    const s = { ...base(), blur: 100 };
    clampFrameSettings(s);
    expect(s.blur).toBe(100);
  });
});

describe("presets", () => {
  it("applyPreset replaces styling but keeps the source crop", () => {
    const crop = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    const vertical = BUILT_IN_FRAME_PRESETS.find((p) => p.id === "vertical");
    if (!vertical) throw new Error("missing preset");
    const out = applyPreset({ ...base(), radius: 60, crop }, vertical);
    expect(out.aspect.preset).toBe("9:16");
    expect(out.radius).toBe(vertical.settings.radius);
    expect(out.crop).toEqual(crop);
  });

  it("applied preset is a deep copy", () => {
    const def = BUILT_IN_FRAME_PRESETS[0];
    if (!def) throw new Error("missing preset");
    const out = applyPreset(base(), def);
    out.background.gradient.stops[0]!.color = "#000000";
    expect(def.settings.background.gradient.stops[0]?.color).not.toBe("#000000");
  });

  it("findMatchingPreset detects the active preset and ignores crop", () => {
    expect(findMatchingPreset(base(), BUILT_IN_FRAME_PRESETS)).toBe("default");
    expect(findMatchingPreset({ ...base(), crop: { x: 0, y: 0, width: 1, height: 1 } }, BUILT_IN_FRAME_PRESETS)).toBe("default");
    expect(findMatchingPreset({ ...base(), radius: 13 }, BUILT_IN_FRAME_PRESETS)).toBeNull();
  });
});

describe("aspect ratio / output size", () => {
  it.each([
    ["16:9", 1920, 1080],
    ["9:16", 1080, 1920],
    ["1:1", 1080, 1080],
    ["4:3", 1440, 1080],
    ["4:5", 1080, 1350],
    ["21:9", 2520, 1080],
  ] as const)("%s → %i×%i", (preset, w, h) => {
    expect(outputSize(aspect(preset), null)).toEqual({ width: w, height: h });
  });

  it("source uses recording size rounded to even, falls back to 1080p when unknown", () => {
    expect(outputSize(aspect("source"), { width: 2559, height: 1601 })).toEqual({ width: 2560, height: 1602 });
    expect(outputSize(aspect("source"), null)).toEqual({ width: 1920, height: 1080 });
    expect(aspectRatio(aspect("source"), null)).toBeNull();
    expect(aspectRatio(aspect("source"), { width: 0, height: 100 })).toBeNull();
  });

  it("custom uses W×H", () => {
    expect(outputSize(aspect("custom", 1000, 1001), null)).toEqual({ width: 1000, height: 1002 });
    expect(aspectRatio(aspect("custom", 800, 400), null)).toBe(2);
  });

  it("validateCustomSize accepts integers in range and rejects junk", () => {
    expect(validateCustomSize("1280", " 720 ")).toEqual({ ok: true, width: 1280, height: 720 });
    expect(validateCustomSize("64", "7680").ok).toBe(true);
    for (const [w, h] of [["", "720"], ["12.5", "720"], ["-100", "720"], ["abc", "1"], ["1e3", "720"]] as const) {
      expect(validateCustomSize(w, h)).toMatchObject({ ok: false, error: expect.stringMatching(/whole numbers/) });
    }
    expect(validateCustomSize("63", "720")).toMatchObject({ ok: false, error: expect.stringMatching(/between 64 and 7680/) });
    expect(validateCustomSize("1920", "7681").ok).toBe(false);
  });
});

describe("padding", () => {
  it("turning match-all off seeds per-side values from the uniform value", () => {
    const p = setPaddingMatchAll({ ...base().padding, all: 40, top: 1, right: 2, bottom: 3, left: 4 }, false);
    expect(p).toEqual({ matchAll: false, all: 40, top: 40, right: 40, bottom: 40, left: 40 });
  });

  it("turning match-all on adopts the top side", () => {
    const p = setPaddingMatchAll({ matchAll: false, all: 10, top: 30, right: 5, bottom: 6, left: 7 }, true);
    expect(resolvePadding(p)).toEqual({ top: 30, right: 30, bottom: 30, left: 30 });
  });

  it("same-state toggle is a no-op", () => {
    const p = base().padding;
    expect(setPaddingMatchAll(p, true)).toBe(p);
  });

  it("per-side edits clamp and only touch one side", () => {
    const p = setPaddingMatchAll(base().padding, false);
    const out = setPaddingSide(p, "left", 999);
    expect(resolvePadding(out)).toEqual({ top: 64, right: 64, bottom: 64, left: 200 });
    expect(setPaddingAll(p, -3).top).toBe(0);
  });
});

describe("gradient stops", () => {
  const g = () => base().background.gradient;

  it("adds a stop in the widest gap up to four", () => {
    let x = addGradientStop(g());
    expect(x.stops.map((s) => s.position)).toEqual([0, 50, 100]);
    x = addGradientStop(x);
    expect(x.stops.map((s) => s.position)).toEqual([0, 25, 50, 100]);
    expect(addGradientStop(x)).toBe(x);
  });

  it("never removes below two stops and ignores bad indexes", () => {
    const two = g();
    expect(removeGradientStop(two, 0)).toBe(two);
    const three = addGradientStop(two);
    expect(removeGradientStop(three, 5)).toBe(three);
    expect(removeGradientStop(three, 1).stops).toHaveLength(2);
  });

  it("updateGradientStop clamps position", () => {
    expect(updateGradientStop(g(), 1, { position: 140 }).stops[1]?.position).toBe(100);
    expect(updateGradientStop(g(), 0, { color: "#123456" }).stops[0]).toEqual({ color: "#123456", position: 0 });
  });

  it("gradientToCss renders linear and radial", () => {
    expect(gradientToCss(g())).toBe("linear-gradient(135deg, #6e7bff 0%, #b57bff 100%)");
    expect(gradientToCss({ ...g(), type: "radial" })).toMatch(/^radial-gradient\(circle, /);
  });
});
