import { z } from "zod";
import type { SpeedRegion } from "../../model/schema";

/**
 * Effects inspector settings — design guide S20, ENGINEERING_SPEC §9.5.
 * Persisted on the project as `effects: EffectsSettings`. Speed regions live on
 * the timeline (`timeline.speeds`); this tab edits the selected one.
 */

export const TRANSITION_KINDS = ["none", "cross-dissolve", "cut-with-zoom"] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

/** Ranges for every numeric setting; shared by the schema, logic, and UI. */
export const EFFECTS_LIMITS = {
  speedRate: { min: 0.25, max: 8 },
  transitionMs: { min: 100, max: 2000 },
  titleCardMs: { min: 500, max: 10000 },
  /** Brightness / contrast / saturation offset, 0 = unchanged. */
  colorAdjust: { min: -100, max: 100 },
  vignette: { min: 0, max: 100 },
  silenceThresholdDb: { min: -80, max: -10 },
  minSilenceMs: { min: 100, max: 5000 },
} as const;

const L = EFFECTS_LIMITS;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const titleCardSchema = z.object({
  text: z.string(),
  /** #rrggbb */
  bg: hex,
  durationMs: z.number().min(L.titleCardMs.min).max(L.titleCardMs.max),
});
export type TitleCard = z.infer<typeof titleCardSchema>;

const adjust = z.number().min(L.colorAdjust.min).max(L.colorAdjust.max);

export const effectsSettingsSchema = z.object({
  /** Applied at clip boundaries (after split). */
  transition: z.object({
    kind: z.enum(TRANSITION_KINDS),
    durationMs: z.number().min(L.transitionMs.min).max(L.transitionMs.max),
  }),
  intro: titleCardSchema.nullable(),
  outro: titleCardSchema.nullable(),
  color: z.object({
    brightness: adjust,
    contrast: adjust,
    saturation: adjust,
    /** Subtle film grain. */
    grain: z.boolean(),
    vignette: z.number().min(L.vignette.min).max(L.vignette.max),
  }),
  motion: z.object({
    /** "Subtle 3D tilt on zooms". */
    tilt3d: z.boolean(),
    /** "Parallax background". */
    parallax: z.boolean(),
  }),
});
export type EffectsSettings = z.infer<typeof effectsSettingsSchema>;

export const DEFAULT_EFFECTS_SETTINGS: EffectsSettings = {
  transition: { kind: "none", durationMs: 400 },
  intro: null,
  outro: null,
  color: { brightness: 0, contrast: 0, saturation: 0, grain: false, vignette: 0 },
  motion: { tilt3d: false, parallax: false },
};

export const DEFAULT_TITLE_CARD: TitleCard = { text: "Title", bg: "#111114", durationMs: 2500 };

/** A timeline speed region plus the ramp extras edited in this tab. */
export type SpeedRegionEdit = SpeedRegion & {
  rampInMs: number;
  rampOutMs: number;
};

/** Remove-silence analysis parameters (§9.5: RMS threshold dBFS + min length). */
export interface SilenceParams {
  thresholdDb: number;
  minSilenceMs: number;
}

export const DEFAULT_SILENCE_PARAMS: SilenceParams = { thresholdDb: -40, minSilenceMs: 700 };

/** A dB envelope (one value per analysis window) at `sampleRateHz` windows/s. */
export interface AudioEnvelope {
  envelopeDb: readonly number[];
  sampleRateHz: number;
}

/** Half-open timeline range `[startMs, endMs)`. */
export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface SilencePreview {
  count: number;
  totalMs: number;
}

/** A cursor telemetry point; `click` marks a click/key event that breaks idleness. */
export interface CursorSample {
  tMs: number;
  x: number;
  y: number;
  click?: boolean | undefined;
}

export interface IdleParams {
  /** Minimum stillness to count as idle (§9.5: > 3s). */
  minIdleMs: number;
  /** Max movement between consecutive samples still considered "no movement". */
  epsilon: number;
  /** Speed applied to suggested regions (§9.5: 3×). */
  rate: number;
  /** Ramp in/out on suggested regions (§9.5: 300ms). */
  rampMs: number;
}

export const DEFAULT_IDLE_PARAMS: IdleParams = {
  minIdleMs: 3000,
  epsilon: 0.002,
  rate: 3,
  rampMs: 300,
};
