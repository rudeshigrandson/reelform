import { z } from "zod";
import {
  type ANNOTATION_KINDS,
  type Annotation,
  type AnnotationKind,
  TEXT_FONTS,
} from "../../inspector/annotations/types";
import type {
  AudioRegion,
  MasterSettings,
  MicTrackSettings,
  TrackSettings,
} from "../../inspector/audio/types";
import { AUDIO_LIMITS } from "../../inspector/audio/types";
import type {
  Caption,
  CaptionModel,
  CaptionPosition,
  CaptionPreset,
  CaptionStyle,
} from "../../inspector/captions/types";
import { EFFECTS_LIMITS, TRANSITION_KINDS } from "../../inspector/effects/types";
import {
  type AutoZoomSettings,
  type CameraSettings,
  MAX_ZOOM_SPEED_MAX,
  MAX_ZOOM_SPEED_MIN,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
  type ZoomRegion,
} from "../../inspector/zoom/types";

/**
 * Zod schemas for the inspector tabs that only ship TypeScript types
 * (annotations, audio, captions, zoom). Tabs that already own a zod schema
 * (frame, cursor, webcam, effects) are reused as-is by `project.ts`.
 *
 * Each schema is checked against its TS type at compile time (bottom of file)
 * so the two cannot drift apart silently.
 */

export const msSchema = z.number().finite().nonnegative();
export const finite = z.number().finite();
export const unit = z.number().finite().min(0).max(1);
/** #rrggbb or #rrggbbaa (annotation fills use an alpha channel). */
export const colorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Expected #rrggbb or #rrggbbaa");
const hex6 = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected #rrggbb");

// ── Annotations (SPEC §9.7) ─────────────────────────────────────────────────

export const annotationAnimSchema = z.object({
  type: z.enum(["none", "fade", "pop", "slide"]),
  direction: z.enum(["left", "right", "up", "down"]),
  ms: msSchema,
});

const annotationBase = {
  id: z.string().min(1),
  startMs: msSchema,
  endMs: msSchema,
  x: finite,
  y: finite,
  w: finite,
  h: finite,
  rotation: finite,
  opacity: unit,
  followZoom: z.boolean(),
  animIn: annotationAnimSchema,
  animOut: annotationAnimSchema,
};

const shape = { fill: colorSchema, stroke: colorSchema, strokeWidth: msSchema };

export const annotationSchema = z.discriminatedUnion("kind", [
  z.object({
    ...annotationBase,
    kind: z.literal("text"),
    text: z.string(),
    font: z.enum(TEXT_FONTS),
    fontSize: z.number().finite().positive(),
    fontWeight: z.union([z.literal(400), z.literal(500), z.literal(700)]),
    color: colorSchema,
    background: z.boolean(),
    backgroundColor: colorSchema,
    padding: msSchema,
    align: z.enum(["left", "center", "right"]),
  }),
  z.object({
    ...annotationBase,
    kind: z.literal("arrow"),
    strokeWidth: msSchema,
    color: colorSchema,
    headStyle: z.enum(["triangle", "open", "circle", "none"]),
    dashed: z.boolean(),
  }),
  z.object({
    ...annotationBase,
    kind: z.literal("line"),
    strokeWidth: msSchema,
    color: colorSchema,
    dashed: z.boolean(),
  }),
  z.object({ ...annotationBase, ...shape, kind: z.literal("rect"), radius: msSchema }),
  z.object({ ...annotationBase, ...shape, kind: z.literal("ellipse") }),
  z.object({
    ...annotationBase,
    kind: z.literal("highlight"),
    fill: colorSchema,
    radius: msSchema,
  }),
  z.object({
    ...annotationBase,
    kind: z.literal("blur"),
    strength: msSchema,
    pixelate: z.boolean(),
  }),
  z.object({
    ...annotationBase,
    kind: z.literal("image"),
    src: z.string(),
    fit: z.enum(["contain", "cover", "fill"]),
    cornerRadius: msSchema,
  }),
  z.object({ ...annotationBase, kind: z.literal("emoji"), emoji: z.string() }),
  z.object({
    ...annotationBase,
    kind: z.literal("numberBadge"),
    value: finite,
    fill: colorSchema,
    color: colorSchema,
  }),
  z.object({ ...annotationBase, kind: z.literal("keystrokeBadge"), label: z.string() }),
]);
export type AnnotationDoc = z.infer<typeof annotationSchema>;

// ── Audio (SPEC §9.5) ───────────────────────────────────────────────────────

/**
 * Volume in dB. `null` encodes silence (`-Infinity` in the editor), because
 * `-Infinity` is not JSON-safe.
 */
export const volumeDbSchema = z.number().finite().max(AUDIO_LIMITS.maxDb).nullable();

export const trackSettingsDocSchema = z.object({
  volumeDb: volumeDbSchema,
  muted: z.boolean(),
  solo: z.boolean(),
  normalize: z.boolean(),
  fadeInMs: msSchema,
  fadeOutMs: msSchema,
});
export const micTrackSettingsDocSchema = trackSettingsDocSchema.extend({
  noiseReduction: z.boolean(),
});

export const audioSettingsDocSchema = z.object({
  tracks: z.object({ mic: micTrackSettingsDocSchema, system: trackSettingsDocSchema }),
  master: z.object({ volumeDb: volumeDbSchema, muteAll: z.boolean() }),
  clickVolume: z.number().min(AUDIO_LIMITS.clickVolume.min).max(AUDIO_LIMITS.clickVolume.max),
});
export type AudioSettingsDoc = z.infer<typeof audioSettingsDocSchema>;

/** Extra audio on the timeline (`timeline.audioRegions`). */
export const audioRegionDocSchema = z.object({
  id: z.string().min(1),
  fileName: z.string(),
  path: z.string(),
  startMs: msSchema,
  endMs: msSchema,
  /** Offset into the audio file (SPEC §4); the editor does not edit it yet. */
  offsetMs: msSchema.default(0),
  volumeDb: volumeDbSchema,
  fadeInMs: msSchema,
  fadeOutMs: msSchema,
  loop: z.boolean(),
  duck: z.object({
    enabled: z.boolean(),
    amountDb: z.number().min(AUDIO_LIMITS.duckAmountDb.min).max(AUDIO_LIMITS.duckAmountDb.max),
  }),
});
export type AudioRegionDoc = z.infer<typeof audioRegionDocSchema>;

// ── Captions (SPEC §9.6) ────────────────────────────────────────────────────

export const wordSchema = z.object({ t0: msSchema, t1: msSchema, text: z.string() });

export const captionSchema = z.object({
  id: z.string().min(1),
  startMs: msSchema,
  endMs: msSchema,
  text: z.string(),
  words: z.array(wordSchema).default([]),
});
export type CaptionDoc = z.infer<typeof captionSchema>;

export const CAPTION_PRESET_IDS = ["clean", "bold", "karaoke", "outline", "pill"] as const;
export const CAPTION_POSITIONS = ["bottom", "top", "custom"] as const;
export const CAPTION_MODEL_IDS = ["fast", "balanced", "accurate"] as const;

export const captionStyleSchema = z.object({
  preset: z.enum(CAPTION_PRESET_IDS),
  font: z.string(),
  sizePx: z.number().finite().positive(),
  color: hex6,
  bgColor: hex6,
  bgOpacity: z.number().min(0).max(100),
  position: z.enum(CAPTION_POSITIONS),
  customY: z.number().min(0).max(100),
  maxLines: z.number().int().min(1),
  wordHighlight: z.boolean(),
  highlightColor: hex6,
  uppercase: z.boolean(),
  outline: z.boolean(),
});

// ── Zoom (SPEC §6.5 / §8) ───────────────────────────────────────────────────

export const zoomRegionSchema = z.object({
  id: z.string().min(1),
  startMs: msSchema,
  endMs: msSchema,
  level: z.number().min(ZOOM_LEVEL_MIN).max(ZOOM_LEVEL_MAX),
  focus: z.object({ mode: z.enum(["fixed", "follow"]), x: unit, y: unit }),
  easeInMs: msSchema,
  easeOutMs: msSchema,
  curve: z.enum(["ease-out-cubic", "spring", "linear"]),
  source: z.enum(["auto", "manual"]),
  reason: z.string().optional(),
});
export type ZoomRegionDoc = z.infer<typeof zoomRegionSchema>;

export const autoZoomSettingsSchema = z.object({
  sensitivity: unit,
  followCursor: z.boolean(),
  zoomOnClicks: z.boolean(),
  zoomOnTyping: z.boolean(),
});

export const cameraSettingsSchema = z.object({
  smoothing: unit,
  maxZoomSpeed: z.number().min(MAX_ZOOM_SPEED_MIN).max(MAX_ZOOM_SPEED_MAX),
});

// ── Timeline extras (SPEC §4 / §9.8) ────────────────────────────────────────

export const speedRegionDocSchema = z.preprocess(
  (raw) => {
    // SPEC §4 names a single `rampMs`; the editor edits in/out separately.
    if (typeof raw !== "object" || raw === null || !("rampMs" in raw)) return raw;
    const { rampMs, ...rest } = raw as Record<string, unknown>;
    return { rampInMs: rampMs, rampOutMs: rampMs, ...rest };
  },
  z.object({
    id: z.string().min(1),
    startMs: msSchema,
    endMs: msSchema,
    rate: z.number().min(EFFECTS_LIMITS.speedRate.min).max(EFFECTS_LIMITS.speedRate.max),
    keepPitch: z.boolean().default(true),
    rampInMs: msSchema.default(0),
    rampOutMs: msSchema.default(0),
  }),
);
export type SpeedRegionDoc = z.infer<typeof speedRegionDocSchema>;

/** A transition at a clip boundary: sits between `afterClipId` and the next clip. */
export const transitionSchema = z.object({
  id: z.string().min(1),
  afterClipId: z.string().min(1),
  kind: z.enum(TRANSITION_KINDS),
  durationMs: z.number().min(EFFECTS_LIMITS.transitionMs.min).max(EFFECTS_LIMITS.transitionMs.max),
});
export type TransitionDoc = z.infer<typeof transitionSchema>;

export const rangeSchema = z.object({ startMs: msSchema, endMs: msSchema });
export type RangeDoc = z.infer<typeof rangeSchema>;

export const captionOptionsSchema = z.object({
  model: z.enum(CAPTION_MODEL_IDS),
  /** Whisper language code or "auto". */
  language: z.string().min(1),
  burnIn: z.boolean(),
});

// ── Compile-time drift checks ───────────────────────────────────────────────

type Assert<T extends true> = T;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Covers<Schema, Ts> = [Schema] extends [Ts] ? true : false;

export type _AnnotationCheck = Assert<Mutual<AnnotationDoc, Annotation>>;
export type _AnnotationKindCheck = Assert<
  Mutual<AnnotationDoc["kind"], AnnotationKind | (typeof ANNOTATION_KINDS)[number]>
>;
export type _CaptionStyleCheck = Assert<Mutual<z.infer<typeof captionStyleSchema>, CaptionStyle>>;
export type _CaptionEnumsCheck = Assert<
  Mutual<
    [CaptionPreset, CaptionPosition, CaptionModel],
    [
      (typeof CAPTION_PRESET_IDS)[number],
      (typeof CAPTION_POSITIONS)[number],
      (typeof CAPTION_MODEL_IDS)[number],
    ]
  >
>;
// Editor captions carry readonly word arrays, so only schema → editor is checked.
export type _CaptionCheck = Assert<Covers<CaptionDoc, Caption>>;
export type _ZoomRegionCheck = Assert<Mutual<ZoomRegionDoc, ZoomRegion>>;
export type _AutoZoomCheck = Assert<
  Mutual<z.infer<typeof autoZoomSettingsSchema>, AutoZoomSettings>
>;
export type _CameraCheck = Assert<Mutual<z.infer<typeof cameraSettingsSchema>, CameraSettings>>;
type Encoded<T> = Omit<T, "volumeDb"> & { volumeDb: number | null };
export type _TrackCheck = Assert<
  Mutual<z.infer<typeof trackSettingsDocSchema>, Encoded<TrackSettings>>
>;
export type _MicCheck = Assert<
  Mutual<z.infer<typeof micTrackSettingsDocSchema>, Encoded<MicTrackSettings>>
>;
export type _MasterCheck = Assert<Mutual<AudioSettingsDoc["master"], Encoded<MasterSettings>>>;
export type _AudioRegionCheck = Assert<
  Mutual<Omit<AudioRegionDoc, "offsetMs">, Encoded<AudioRegion>>
>;
