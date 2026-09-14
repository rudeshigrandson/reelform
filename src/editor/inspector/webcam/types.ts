import { z } from "zod";
import { ANCHORS, type Anchor } from "../controls";

/**
 * Webcam inspector settings — design guide S16/S16b, ENGINEERING_SPEC §6.5 / §9.4.
 * Persisted on the project as `webcam: WebcamSettings`.
 */

export const WEBCAM_SHAPES = ["circle", "rounded", "square", "pill"] as const;
export type WebcamShape = (typeof WEBCAM_SHAPES)[number];

/** Ranges for every numeric setting; shared by the schema, the logic and the UI. */
export const WEBCAM_LIMITS = {
  /** Percent of output frame height. */
  sizePct: { min: 10, max: 50 },
  /** Output-frame px between bubble and frame edge. */
  marginPx: { min: 0, max: 200 },
  borderWidth: { min: 0, max: 8 },
  shadow: { min: 0, max: 100 },
  /** Corner radius (px) — only used by the "rounded" shape. */
  radius: { min: 0, max: 64 },
  /** Crop zoom factor relative to the largest crop that fits the source. */
  cropZoom: { min: 1, max: 4 },
  syncOffsetMs: { min: -5000, max: 5000 },
} as const;

const L = WEBCAM_LIMITS;

/** Crop / reframe rect in source pixel coordinates (§9.4). */
export const cropRectSchema = z.object({
  x: z.number().min(0),
  y: z.number().min(0),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type CropRect = z.infer<typeof cropRectSchema>;

export const webcamSettingsSchema = z.object({
  enabled: z.boolean(),
  shape: z.enum(WEBCAM_SHAPES),
  sizePct: z.number().min(L.sizePct.min).max(L.sizePct.max),
  /** 3×3 anchor, or `null` for a custom position given by `customX`/`customY`. */
  anchor: z
    .custom<Anchor>((v) => typeof v === "string" && (ANCHORS as readonly string[]).includes(v))
    .nullable(),
  /** Bubble center, normalized 0–1 of the frame. Used when `anchor` is null. */
  customX: z.number().min(0).max(1),
  customY: z.number().min(0).max(1),
  marginPx: z.number().min(L.marginPx.min).max(L.marginPx.max),
  mirror: z.boolean(),
  borderWidth: z.number().min(L.borderWidth.min).max(L.borderWidth.max),
  /** #rrggbb */
  borderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  shadow: z.number().min(L.shadow.min).max(L.shadow.max),
  radius: z.number().min(L.radius.min).max(L.radius.max),
  /** "Shrinks during zooms to keep balance". */
  zoomReactive: z.boolean(),
  /** `null` = automatic centered crop at the shape's aspect. */
  crop: cropRectSchema.nullable(),
  syncOffsetMs: z.number().int().min(L.syncOffsetMs.min).max(L.syncOffsetMs.max),
});

export type WebcamSettings = z.infer<typeof webcamSettingsSchema>;

/** Default bubble: bottom-left circle (matches the S09 recording bubble). */
export const DEFAULT_WEBCAM_SETTINGS: WebcamSettings = {
  enabled: true,
  shape: "circle",
  sizePct: 20,
  anchor: "bottom-left",
  customX: 0.15,
  customY: 0.8,
  marginPx: 32,
  mirror: false,
  borderWidth: 0,
  borderColor: "#ffffff",
  shadow: 40,
  radius: 24,
  zoomReactive: true,
  crop: null,
  syncOffsetMs: 0,
};

/** Default source size when the host hasn't probed the webcam file (§7: 1280×720). */
export const DEFAULT_WEBCAM_SOURCE_SIZE = { width: 1280, height: 720 } as const;

export type WebcamSource =
  | { kind: "recorded"; durationMs: number }
  | { kind: "uploaded"; name: string };
