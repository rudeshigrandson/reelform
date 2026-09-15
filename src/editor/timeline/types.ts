import type { Annotation } from "../inspector/annotations/types";
import { TOOL_LABELS } from "../inspector/annotations/types";
import type { Caption } from "../inspector/captions/types";
import type { SpeedRegionEdit } from "../inspector/effects/types";
import type { ZoomRegion } from "../inspector/zoom/types";
import type { Clip } from "../model/schema";

/**
 * Timeline view model (ENGINEERING_SPEC §6.7, design guide S12 region E).
 * The timeline component only knows about generic time spans; adapters below
 * turn project regions into labelled items.
 */

export type TrackKind = "video" | "zoom" | "speed" | "annotations" | "captions";

/** The committed shape of an item edit: identity plus timeline times (ms). */
export interface TimeSpan {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** One cached filmstrip frame (SPEC §6.7: every 2s of source at 160px height). */
export interface TimelineThumb {
  readonly sourceMs: number;
  readonly url: string;
}

/** Source media drawn inside video clip items: filmstrip + mini waveform. */
export interface TimelineMedia {
  /** Sorted by `sourceMs`. */
  readonly thumbs: readonly TimelineThumb[];
  /** Peak |amplitude| 0..1 per bucket, evenly spread over `sourceDurationMs`. */
  readonly peaks?: Float32Array | undefined;
  /** Source length the peaks span; required to place peaks. */
  readonly sourceDurationMs?: number | undefined;
  /** Frame width / height; 16:9 when unknown. */
  readonly aspect?: number | undefined;
}

export interface TimelineItem extends TimeSpan {
  readonly label: string;
  /** Auto-zoom suggestion not yet accepted: drawn dashed at 50% opacity. */
  readonly ghost?: boolean | undefined;
  /** Video clips: source ms at the item's start (filmstrip/waveform alignment). */
  readonly sourceStartMs?: number | undefined;
  /** Captions: word start/end times (timeline ms), extra snap targets while dragging. */
  readonly wordBoundaries?: readonly number[] | undefined;
}

export interface TimelineTrack {
  readonly kind: TrackKind;
  readonly label: string;
  readonly items: readonly TimelineItem[];
  /** Zooms and speeds may not overlap on their own track; annotations/captions may. */
  readonly allowOverlap: boolean;
  /** Video track: thumbnails + peaks for its clips. */
  readonly media?: TimelineMedia | undefined;
}

export const TRACK_LABELS: Readonly<Record<TrackKind, string>> = {
  video: "Video",
  zoom: "Zoom",
  speed: "Speed",
  annotations: "Annotations",
  captions: "Captions",
};

/** Singular noun used in item accessible names, e.g. "Zoom 1.8× 00:02.000–00:04.500". */
export const ITEM_NOUNS: Readonly<Record<TrackKind, string>> = {
  video: "Clip",
  zoom: "Zoom",
  speed: "Speed",
  annotations: "Annotation",
  captions: "Caption",
};

export const TRACK_ALLOWS_OVERLAP: Readonly<Record<TrackKind, boolean>> = {
  video: false,
  zoom: false,
  speed: false,
  annotations: true,
  captions: true,
};

/** Build a track with the default label and overlap rule for its kind. */
export function makeTrack(kind: TrackKind, items: readonly TimelineItem[]): TimelineTrack {
  return { kind, label: TRACK_LABELS[kind], items, allowOverlap: TRACK_ALLOWS_OVERLAP[kind] };
}

/** "1.8×", "2×", "0.5×" — at most two decimals, trailing zeros dropped. */
export function formatMultiplier(value: number): string {
  const safe = Number.isFinite(value) ? value : 1;
  return `${Number(safe.toFixed(2))}×`;
}

export const CAPTION_LABEL_MAX = 32;

export function truncateLabel(text: string, max = CAPTION_LABEL_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…` : flat;
}

/**
 * Only suggestions still awaiting Keep / Review / Dismiss (`pending`, editor UI
 * state) are ghosts; a kept `auto` region draws like any other (§8).
 */
export function zoomToItems(
  regions: readonly ZoomRegion[],
  pending: ReadonlySet<string> = new Set(),
): TimelineItem[] {
  return regions.map((r) => ({
    id: r.id,
    startMs: r.startMs,
    endMs: r.endMs,
    label: formatMultiplier(r.level),
    ghost: r.source === "auto" && pending.has(r.id),
  }));
}

export function speedToItems(
  regions: ReadonlyArray<Pick<SpeedRegionEdit, "id" | "startMs" | "endMs" | "rate">>,
): TimelineItem[] {
  return regions.map((r) => ({
    id: r.id,
    startMs: r.startMs,
    endMs: r.endMs,
    label: formatMultiplier(r.rate),
  }));
}

export function annotationsToItems(annotations: readonly Annotation[]): TimelineItem[] {
  return annotations.map((a) => ({
    id: a.id,
    startMs: a.startMs,
    endMs: a.endMs,
    label: TOOL_LABELS[a.kind],
  }));
}

export function captionsToItems(captions: readonly Caption[]): TimelineItem[] {
  return captions.map((c) => ({
    id: c.id,
    startMs: c.startMs,
    endMs: c.endMs,
    label: truncateLabel(c.text),
    wordBoundaries: c.words.flatMap((w) => [w.t0, w.t1]),
  }));
}

export function clipsToItems(clips: readonly Clip[]): TimelineItem[] {
  return clips.map((c, i) => ({
    id: c.id,
    startMs: c.timelineStartMs,
    endMs: c.timelineStartMs + (c.sourceEndMs - c.sourceStartMs),
    label: `Clip ${i + 1}`,
    sourceStartMs: c.sourceStartMs,
  }));
}
