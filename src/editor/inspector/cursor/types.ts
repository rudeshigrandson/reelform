import { z } from "zod";

/**
 * Cursor inspector settings — design guide S14, ENGINEERING_SPEC §6.6 / §9.2.
 * Persisted on the project as `cursor: CursorSettings`.
 */

export const CURSOR_STYLES = ["macos", "macos-dark", "windows", "minimal-dot", "custom"] as const;
export type CursorStyle = (typeof CURSOR_STYLES)[number];

export const CLICK_EFFECTS = ["none", "ripple", "bounce", "highlight"] as const;
export type ClickEffect = (typeof CLICK_EFFECTS)[number];

export const CLICK_SOUNDS = ["none", "soft", "mechanical", "custom"] as const;
export type ClickSound = (typeof CLICK_SOUNDS)[number];

/** Ranges for every numeric setting; shared by the schema and the UI. */
export const CURSOR_LIMITS = {
  size: { min: 50, max: 300 },
  smoothing: { min: 0, max: 100 },
  motionBlurAmount: { min: 0, max: 100 },
  clickEffectSize: { min: 50, max: 300 },
  hideIdleDelaySec: { min: 0.5, max: 10 },
  clickSoundVolume: { min: 0, max: 100 },
} as const;

const L = CURSOR_LIMITS;

/** A user-supplied file reference (custom cursor PNG/SVG or custom click sound). */
export const customAssetSchema = z.object({
  fileName: z.string().min(1),
  /** Absolute path or media-protocol URL resolved by the host. */
  path: z.string().min(1),
});
export type CustomAsset = z.infer<typeof customAssetSchema>;

export const customCursorSchema = customAssetSchema.extend({
  kind: z.enum(["png", "svg"]),
});
export type CustomCursor = z.infer<typeof customCursorSchema>;

export const cursorSettingsSchema = z.object({
  /** Master "Show cursor" switch. */
  show: z.boolean(),
  style: z.enum(CURSOR_STYLES),
  /** Custom arrow sprite (§9.2: custom = user PNG/SVG for arrow only). */
  customCursor: customCursorSchema.nullable(),
  /** Percent of base 32px sprite. */
  size: z.number().min(L.size.min).max(L.size.max),
  /**
   * §6.6 "scale with zoom": when on, the cursor grows with the camera zoom
   * instead of keeping its apparent size. Defaults off for older documents.
   */
  scaleWithZoom: z.boolean().default(false),
  /** "Snappy ⟷ Silky", 0–100. */
  smoothing: z.number().min(L.smoothing.min).max(L.smoothing.max),
  motionBlur: z.object({
    enabled: z.boolean(),
    amount: z.number().min(L.motionBlurAmount.min).max(L.motionBlurAmount.max),
  }),
  clickEffect: z.object({
    type: z.enum(CLICK_EFFECTS),
    /** #rrggbb */
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** Percent. */
    size: z.number().min(L.clickEffectSize.min).max(L.clickEffectSize.max),
  }),
  /** Subtle idle drift. */
  sway: z.boolean(),
  hideWhenIdle: z.object({
    enabled: z.boolean(),
    delaySec: z.number().min(L.hideIdleDelaySec.min).max(L.hideIdleDelaySec.max),
  }),
  /** Cursor returns to its start position for seamless GIF loops. */
  loop: z.boolean(),
  clickSound: z.object({
    type: z.enum(CLICK_SOUNDS),
    /** Percent. */
    volume: z.number().min(L.clickSoundVolume.min).max(L.clickSoundVolume.max),
    customSound: customAssetSchema.nullable(),
  }),
});

export type CursorSettings = z.infer<typeof cursorSettingsSchema>;

export const DEFAULT_CURSOR_SETTINGS: CursorSettings = {
  show: true,
  style: "macos",
  customCursor: null,
  size: 100,
  scaleWithZoom: false,
  smoothing: 50,
  motionBlur: { enabled: false, amount: 50 },
  clickEffect: { type: "ripple", color: "#ffffff", size: 100 },
  sway: false,
  hideWhenIdle: { enabled: false, delaySec: 2 },
  loop: false,
  clickSound: { type: "none", volume: 60, customSound: null },
};
