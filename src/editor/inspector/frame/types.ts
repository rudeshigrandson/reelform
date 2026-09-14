import { z } from "zod";

/**
 * Frame settings (design guide S13, engineering spec §9.2 "frame"):
 * background, blur, padding, radius, squircle, shadow, border, aspect, inset, crop.
 */

export const FRAME_LIMITS = {
  blur: { min: 0, max: 40 },
  padding: { min: 0, max: 200 },
  radius: { min: 0, max: 64 },
  shadowStrength: { min: 0, max: 100 },
  shadowOffsetY: { min: -100, max: 100 },
  shadowBlur: { min: 0, max: 100 },
  borderWidth: { min: 0, max: 8 },
  borderOpacity: { min: 0, max: 100 },
  inset: { min: 50, max: 100 },
  gradientAngle: { min: 0, max: 360 },
  gradientStops: { min: 2, max: 4 },
  customSize: { min: 64, max: 7680 },
} as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected #rrggbb");
const range = (r: { min: number; max: number }) => z.number().min(r.min).max(r.max);

export const BACKGROUND_KINDS = ["wallpaper", "color", "gradient", "image", "none"] as const;
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number];

export const ASPECT_PRESETS = [
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "4:5",
  "21:9",
  "source",
  "custom",
] as const;
export type AspectPreset = (typeof ASPECT_PRESETS)[number];

export const gradientStopSchema = z.object({
  color: hex,
  /** 0–100 along the gradient axis. */
  position: z.number().min(0).max(100),
});
export type GradientStop = z.infer<typeof gradientStopSchema>;

export const frameSettingsSchema = z.object({
  background: z.object({
    kind: z.enum(BACKGROUND_KINDS),
    wallpaperId: z.string(),
    color: hex,
    gradient: z.object({
      type: z.enum(["linear", "radial"]),
      angle: range(FRAME_LIMITS.gradientAngle),
      stops: z
        .array(gradientStopSchema)
        .min(FRAME_LIMITS.gradientStops.min)
        .max(FRAME_LIMITS.gradientStops.max),
    }),
    image: z.object({
      /** Project-relative path under `media/`; null = dropzone empty. */
      path: z.string().nullable(),
      fit: z.enum(["fit", "fill"]),
    }),
  }),
  /** Background blur in px (applies to wallpaper/image). */
  blur: range(FRAME_LIMITS.blur),
  padding: z.object({
    matchAll: z.boolean(),
    all: range(FRAME_LIMITS.padding),
    top: range(FRAME_LIMITS.padding),
    right: range(FRAME_LIMITS.padding),
    bottom: range(FRAME_LIMITS.padding),
    left: range(FRAME_LIMITS.padding),
  }),
  radius: range(FRAME_LIMITS.radius),
  squircle: z.boolean(),
  shadow: z.object({
    strength: range(FRAME_LIMITS.shadowStrength),
    offsetY: range(FRAME_LIMITS.shadowOffsetY),
    blur: range(FRAME_LIMITS.shadowBlur),
    color: hex,
  }),
  border: z.object({
    width: range(FRAME_LIMITS.borderWidth),
    color: hex,
    opacity: range(FRAME_LIMITS.borderOpacity),
  }),
  aspect: z.object({
    preset: z.enum(ASPECT_PRESETS),
    customWidth: z.number().int().min(FRAME_LIMITS.customSize.min).max(FRAME_LIMITS.customSize.max),
    customHeight: z
      .number()
      .int()
      .min(FRAME_LIMITS.customSize.min)
      .max(FRAME_LIMITS.customSize.max),
  }),
  /** Source scale inside the frame, percent. */
  inset: range(FRAME_LIMITS.inset),
  /** Normalized source crop rect (edited on canvas); null = uncropped. */
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .nullable(),
});

export type FrameSettings = z.infer<typeof frameSettingsSchema>;
export type FramePadding = FrameSettings["padding"];
export type FrameAspect = FrameSettings["aspect"];
export type FrameBackground = FrameSettings["background"];
export type FrameGradient = FrameBackground["gradient"];

export interface Size {
  width: number;
  height: number;
}

export const DEFAULT_FRAME_SETTINGS: FrameSettings = {
  background: {
    kind: "wallpaper",
    wallpaperId: "abstract-1",
    color: "#1c2129",
    gradient: {
      type: "linear",
      angle: 135,
      stops: [
        { color: "#6e7bff", position: 0 },
        { color: "#b57bff", position: 100 },
      ],
    },
    image: { path: null, fit: "fill" },
  },
  blur: 0,
  padding: { matchAll: true, all: 64, top: 64, right: 64, bottom: 64, left: 64 },
  radius: 12,
  squircle: false,
  shadow: { strength: 50, offsetY: 12, blur: 40, color: "#000000" },
  border: { width: 0, color: "#ffffff", opacity: 16 },
  aspect: { preset: "16:9", customWidth: 1920, customHeight: 1080 },
  inset: 100,
  crop: null,
};

export interface FramePreset {
  id: string;
  name: string;
  /** Bundled presets ship with the app; user presets live in settings. */
  builtIn: boolean;
  settings: FrameSettings;
}

function preset(id: string, name: string, patch: (s: FrameSettings) => FrameSettings): FramePreset {
  return { id, name, builtIn: true, settings: patch(structuredClone(DEFAULT_FRAME_SETTINGS)) };
}

const uniformPadding = (n: number): FramePadding => ({
  matchAll: true,
  all: n,
  top: n,
  right: n,
  bottom: n,
  left: n,
});

export const BUILT_IN_FRAME_PRESETS: readonly FramePreset[] = [
  preset("default", "Default", (s) => s),
  preset("minimal", "Minimal", (s) => ({
    ...s,
    background: { ...s.background, kind: "color", color: "#0f1115" },
    padding: uniformPadding(32),
    radius: 8,
    shadow: { ...s.shadow, strength: 20, offsetY: 4, blur: 16 },
  })),
  preset("product-hunt", "Product Hunt", (s) => ({
    ...s,
    background: {
      ...s.background,
      kind: "gradient",
      gradient: {
        type: "linear",
        angle: 135,
        stops: [
          { color: "#ff6154", position: 0 },
          { color: "#ffb84d", position: 100 },
        ],
      },
    },
    padding: uniformPadding(96),
    radius: 16,
    squircle: true,
    shadow: { ...s.shadow, strength: 70, offsetY: 24, blur: 64 },
  })),
  preset("twitter", "Twitter", (s) => ({
    ...s,
    background: { ...s.background, kind: "wallpaper", wallpaperId: "gradient-2" },
    padding: uniformPadding(80),
    radius: 16,
    aspect: { ...s.aspect, preset: "16:9" },
  })),
  preset("vertical", "Vertical", (s) => ({
    ...s,
    background: { ...s.background, kind: "wallpaper", wallpaperId: "mesh-1" },
    padding: uniformPadding(40),
    radius: 20,
    aspect: { ...s.aspect, preset: "9:16" },
    inset: 90,
  })),
];

export const WALLPAPER_CATEGORIES = [
  "Abstract",
  "Gradient",
  "Mesh",
  "Mac",
  "Solid",
  "Custom",
] as const;
export type WallpaperCategory = (typeof WALLPAPER_CATEGORIES)[number];

export interface Wallpaper {
  id: string;
  name: string;
  category: WallpaperCategory;
  /** CSS background for the thumbnail tile (token colors for placeholders, url() for real files). */
  preview: string;
}

const TILE_TOKENS = [
  "var(--color-accent-400)",
  "var(--color-accent-600)",
  "var(--color-accent-2-400)",
  "var(--color-accent-2-600)",
  "var(--color-neutral-600)",
  "var(--color-neutral-800)",
] as const;

/** Placeholder wallpaper pack: 24 thumbnails across the bundled categories. */
export const PLACEHOLDER_WALLPAPERS: readonly Wallpaper[] = (
  ["Abstract", "Gradient", "Mesh", "Mac", "Solid"] as const
).flatMap((category, ci) =>
  Array.from({ length: ci === 4 ? 4 : 5 }, (_, i): Wallpaper => {
    const a = TILE_TOKENS[(ci + i) % TILE_TOKENS.length] ?? TILE_TOKENS[0];
    const b = TILE_TOKENS[(ci + i + 2) % TILE_TOKENS.length] ?? TILE_TOKENS[1];
    return {
      id: `${category.toLowerCase()}-${i + 1}`,
      name: `${category} ${i + 1}`,
      category,
      preview: category === "Solid" ? a : `linear-gradient(135deg, ${a}, ${b})`,
    };
  }),
);
