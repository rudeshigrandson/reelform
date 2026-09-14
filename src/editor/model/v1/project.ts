import { z } from "zod";
import { ANNOTATION_KINDS } from "../../inspector/annotations/types";
import { DEFAULT_AUDIO_SETTINGS } from "../../inspector/audio/types";
import { DEFAULT_CAPTION_STYLE } from "../../inspector/captions/types";
import { DEFAULT_CURSOR_SETTINGS, cursorSettingsSchema } from "../../inspector/cursor/types";
import {
  DEFAULT_EFFECTS_SETTINGS,
  effectsSettingsSchema,
  titleCardSchema,
} from "../../inspector/effects/types";
import { DEFAULT_FRAME_SETTINGS, frameSettingsSchema } from "../../inspector/frame/types";
import { DEFAULT_WEBCAM_SETTINGS, webcamSettingsSchema } from "../../inspector/webcam/types";
import { DEFAULT_ZOOM_SETTINGS } from "../../inspector/zoom/types";
import { Clip, MediaSource } from "../schema";
import {
  type AudioSettingsDoc,
  annotationSchema,
  audioRegionDocSchema,
  audioSettingsDocSchema,
  autoZoomSettingsSchema,
  cameraSettingsSchema,
  captionOptionsSchema,
  captionSchema,
  captionStyleSchema,
  msSchema,
  rangeSchema,
  speedRegionDocSchema,
  transitionSchema,
  zoomRegionSchema,
} from "./tabs";

/**
 * Full `.reelform` `project.json` document — schema v1 (ENGINEERING_SPEC §4).
 *
 * A strict superset of the M0 subset in `../schema.ts`: every field added after
 * M0 has a default, so any document the M0 schema accepts parses here too.
 * The document is JSON-safe (no `-Infinity`, no `undefined` values).
 */

export const SCHEMA_VERSION = 1 as const;

/** SPEC §4 `MediaSource`, extended with the optional `colorSpace`. */
export const mediaSourceV1Schema = MediaSource.extend({ colorSpace: z.string().optional() });
export type MediaSourceV1 = z.infer<typeof mediaSourceV1Schema>;

export const telemetryRefSchema = z.object({
  path: z.string().min(1),
  pointCount: z.number().int().nonnegative(),
  hasClicks: z.boolean(),
  hasKeys: z.boolean(),
  sampleHz: z.number().finite().nonnegative(),
});
export type TelemetryRef = z.infer<typeof telemetryRefSchema>;

export const CAPTURE_BACKENDS = ["sck", "wgc", "dxgi", "electron"] as const;

export const captureInfoSchema = z.object({
  backend: z.enum(CAPTURE_BACKENDS),
  os: z.string(),
  display: z.union([z.string(), z.number()]).optional(),
  window: z.union([z.string(), z.number()]).optional(),
  region: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().finite().positive(),
      height: z.number().finite().positive(),
    })
    .optional(),
  scaleFactor: z.number().finite().positive(),
  recordedFps: z.number().finite().positive(),
});
export type CaptureInfo = z.infer<typeof captureInfoSchema>;

/**
 * Export settings (SPEC §10 / design S22). The export module owns the exact
 * shape; the document validates the common fields and preserves the rest.
 */
export const exportConfigSchema = z
  .object({
    name: z.string().optional(),
    format: z.enum(["mp4", "gif", "webm"]).optional(),
    container: z.enum(["mp4", "webm"]).optional(),
    codec: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().finite().positive().optional(),
    quality: z.string().optional(),
  })
  .passthrough();
export type ExportConfigDoc = z.infer<typeof exportConfigSchema>;

type Ranged = { id?: string; startMs: number; endMs: number };

/** Adds `endMs` ordering and unique-id issues with precise paths. */
function checkTrack(
  ctx: z.RefinementCtx,
  track: string,
  items: readonly Ranged[],
  strictlyAfter: boolean,
): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const bad = strictlyAfter ? item.endMs <= item.startMs : item.endMs < item.startMs;
    if (bad) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [track, i, "endMs"],
        message: `endMs must be ${strictlyAfter ? "after" : "at or after"} startMs`,
      });
    }
    if (item.id === undefined) return;
    if (seen.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [track, i, "id"],
        message: `duplicate id "${item.id}"`,
      });
    }
    seen.add(item.id);
  });
}

export const timelineV1Schema = z
  .object({
    durationMs: msSchema,
    clips: z.array(Clip),
    zooms: z.array(zoomRegionSchema).default([]),
    speeds: z.array(speedRegionDocSchema).default([]),
    annotations: z.array(annotationSchema).default([]),
    captions: z.array(captionSchema).default([]),
    webcamRegions: z.array(rangeSchema).default([]),
    audioRegions: z.array(audioRegionDocSchema).default([]),
    transitions: z.array(transitionSchema).default([]),
    intro: titleCardSchema.optional(),
    outro: titleCardSchema.optional(),
  })
  .superRefine((t, ctx) => {
    // Clip ordering is already refined per clip by the M0 `Clip` schema.
    checkTrack(
      ctx,
      "clips",
      t.clips.map((c) => ({ id: c.id, startMs: c.sourceStartMs, endMs: c.sourceEndMs })),
      true,
    );
    checkTrack(ctx, "zooms", t.zooms, true);
    checkTrack(ctx, "speeds", t.speeds, true);
    checkTrack(ctx, "annotations", t.annotations, false);
    checkTrack(ctx, "captions", t.captions, false);
    checkTrack(ctx, "webcamRegions", t.webcamRegions, false);
    // The audio tab's `addRegion` allows zero-length regions (endMs === startMs).
    checkTrack(ctx, "audioRegions", t.audioRegions, false);
    const clipIds = new Set(t.clips.map((c) => c.id));
    t.transitions.forEach((tr, i) => {
      if (!clipIds.has(tr.afterClipId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["transitions", i, "afterClipId"],
          message: `unknown clip "${tr.afterClipId}"`,
        });
      }
    });
  });
export type TimelineV1 = z.infer<typeof timelineV1Schema>;

/** Effects on the document; intro/outro live on the timeline (SPEC §4). */
export const effectsDocSchema = effectsSettingsSchema.omit({ intro: true, outro: true });
export type EffectsDoc = z.infer<typeof effectsDocSchema>;

export const uiStateSchema = z.object({
  inspectorTab: z.string().default("frame"),
  timelineZoom: z.number().finite().nonnegative().default(0),
  timelineHeight: z.number().finite().nonnegative().default(240),
  collapsed: z.record(z.boolean()).default({}),
  activeTool: z.enum(ANNOTATION_KINDS).nullable().default(null),
  selection: z
    .object({
      zoomId: z.string().nullable().default(null),
      annotationId: z.string().nullable().default(null),
      speedId: z.string().nullable().default(null),
    })
    .default({}),
});
export type UiState = z.infer<typeof uiStateSchema>;

function defaultAudioDoc(): AudioSettingsDoc {
  const { tracks, master, clickVolume } = structuredClone(DEFAULT_AUDIO_SETTINGS);
  return { tracks, master, clickVolume };
}

const clone =
  <T>(value: T) =>
  (): T =>
    structuredClone(value);

export const projectV1Schema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  modifiedAt: z.string(),
  appVersion: z.string(),
  sources: z.object({
    video: mediaSourceV1Schema,
    mic: mediaSourceV1Schema.optional(),
    system: mediaSourceV1Schema.optional(),
    webcam: mediaSourceV1Schema.optional(),
    telemetry: telemetryRefSchema.optional(),
    /** Optional so M0 documents (written before capture metadata) still load. */
    capture: captureInfoSchema.optional(),
  }),
  timeline: timelineV1Schema,
  frame: frameSettingsSchema.default(clone(DEFAULT_FRAME_SETTINGS)),
  cursor: cursorSettingsSchema.default(clone(DEFAULT_CURSOR_SETTINGS)),
  webcam: webcamSettingsSchema.default(clone(DEFAULT_WEBCAM_SETTINGS)),
  audio: audioSettingsDocSchema.default(defaultAudioDoc),
  captionsStyle: captionStyleSchema.default(clone(DEFAULT_CAPTION_STYLE)),
  /** Transcription choices + burn-in toggle (editor state beyond SPEC §4's list). */
  captionsOptions: captionOptionsSchema.default({
    model: "balanced",
    language: "auto",
    burnIn: false,
  }),
  effects: effectsDocSchema.default(() => {
    const { intro: _i, outro: _o, ...rest } = structuredClone(DEFAULT_EFFECTS_SETTINGS);
    return rest;
  }),
  camera: cameraSettingsSchema.default(clone(DEFAULT_ZOOM_SETTINGS.camera)),
  /** Auto-zoom generation settings (SPEC §8 inputs), persisted per project. */
  autoZoom: autoZoomSettingsSchema.default(clone(DEFAULT_ZOOM_SETTINGS.autoZoom)),
  prefs: z.object({ saveRawWithProject: z.boolean() }).default({ saveRawWithProject: true }),
  exportPresets: z.array(exportConfigSchema).default([]),
  lastExport: exportConfigSchema.optional(),
  /** Non-semantic; may be dropped (SPEC §4). */
  ui: uiStateSchema.default({}),
});

/** Validated, defaults-applied v1 document. */
export type ProjectV1 = z.infer<typeof projectV1Schema>;
/** What a v1 document may look like on disk (defaults not yet applied). */
export type ProjectV1Input = z.input<typeof projectV1Schema>;
