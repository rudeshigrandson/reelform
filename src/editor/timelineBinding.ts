import { createAnnotation } from "./inspector/annotations/annotations";
import { addCaptionAt } from "./inspector/captions/logic";
import { normalizeSpeedRegion } from "./inspector/effects/logic";
import type { SpeedRegionEdit } from "./inspector/effects/types";
import { MIN_ZOOM_REGION_MS, type ZoomRegion } from "./inspector/zoom/types";
import type { EditorData } from "./store";
import {
  type TimeSpan,
  type TimelineTrack,
  type TrackKind,
  annotationsToItems,
  captionsToItems,
  makeTrack,
  spanLimits,
  speedToItems,
  zoomToItems,
} from "./timeline";

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Playback-bar zoom slider (0 = fit whole timeline, 1 = 5s visible) → timeline
 * px/ms. Geometric so each slider step feels like the same zoom factor.
 */
export function zoomToScale(zoom: number, durationMs: number, viewportPx: number): number {
  const { minMs, maxMs } = spanLimits(durationMs);
  const visibleMs = maxMs * (minMs / maxMs) ** clamp01(zoom);
  return Math.max(0, viewportPx) / visibleMs;
}

/** Inverse of {@link zoomToScale}, for ⌘-wheel zoom on the timeline moving the slider. */
export function scaleToZoom(pxPerMs: number, durationMs: number, viewportPx: number): number {
  const { minMs, maxMs } = spanLimits(durationMs);
  if (maxMs <= minMs || !(pxPerMs > 0) || !(viewportPx > 0)) return 0;
  const visibleMs = Math.min(maxMs, Math.max(minMs, viewportPx / pxPerMs));
  return clamp01(Math.log(maxMs / visibleMs) / Math.log(maxMs / minMs));
}

/**
 * Pure glue between the editor document store and the props-driven timeline
 * (SPEC §6.7). Every function returns a store patch (or null for "no change") so
 * the future command/history layer (§7) can wrap them unchanged.
 */

export type TimelineDoc = Pick<
  EditorData,
  "durationMs" | "zoomRegions" | "speedRegions" | "annotations" | "captions"
>;

/** Manual add = 2s region at the playhead (§9.3). */
export const ADD_REGION_MS = 2000;
const DEFAULT_ADD_ZOOM_LEVEL = 2;
const DEFAULT_ADD_SPEED_RATE = 2;
const DEFAULT_SPEED_RAMP_MS = 300;

export function buildTracks(d: TimelineDoc): TimelineTrack[] {
  return [
    makeTrack("zoom", zoomToItems(d.zoomRegions)),
    makeTrack("speed", speedToItems(d.speedRegions)),
    makeTrack("annotations", annotationsToItems(d.annotations)),
    makeTrack("captions", captionsToItems(d.captions)),
  ];
}

function replaceSpan<T extends TimeSpan>(
  list: readonly T[],
  span: TimeSpan,
  edit: (item: T) => T,
): T[] | null {
  let found = false;
  const next = list.map((item) => {
    if (item.id !== span.id) return item;
    found = true;
    return edit({ ...item, startMs: span.startMs, endMs: span.endMs });
  });
  return found ? next : null;
}

/** Commit a dropped move/resize from the timeline into the document. */
export function applyItemChange(
  d: TimelineDoc,
  kind: TrackKind,
  span: TimeSpan,
): Partial<EditorData> | null {
  switch (kind) {
    case "zoom": {
      // Editing a suggestion makes it the user's (§8: regenerate keeps edited regions).
      const zoomRegions = replaceSpan(
        d.zoomRegions,
        span,
        (r): ZoomRegion => ({ ...r, source: "manual" }),
      );
      return zoomRegions && { zoomRegions };
    }
    case "speed": {
      const speedRegions = replaceSpan(d.speedRegions, span, normalizeSpeedRegion);
      return speedRegions && { speedRegions };
    }
    case "annotations": {
      const annotations = replaceSpan(d.annotations, span, (a) => a);
      return annotations && { annotations };
    }
    case "captions": {
      // Word-level retiming is v1.1 (§9.6); word timestamps are left as recorded.
      const captions = replaceSpan(d.captions, span, (c) => c);
      return captions && { captions };
    }
    case "video":
      // Clips are not in the editor store until the project model owns them.
      return null;
  }
}

/** Mirror the timeline selection into the per-kind ids the inspector tabs read. */
export function selectionPatch(
  d: TimelineDoc,
  ids: ReadonlySet<string>,
): Pick<EditorData, "selectedZoomId" | "selectedSpeedId" | "selectedAnnotationId"> {
  const first = (list: readonly TimeSpan[]): string | null =>
    list.find((item) => ids.has(item.id))?.id ?? null;
  return {
    selectedZoomId: first(d.zoomRegions),
    selectedSpeedId: first(d.speedRegions),
    selectedAnnotationId: first(d.annotations),
  };
}

function overlapsAny(list: readonly TimeSpan[], startMs: number, endMs: number): boolean {
  return list.some((item) => startMs < item.endMs && endMs > item.startMs);
}

/** A span of up to ADD_REGION_MS at the playhead, clamped to the timeline. */
function spanAtPlayhead(durationMs: number, playheadMs: number, minMs: number) {
  const startMs = Math.min(Math.max(0, playheadMs), Math.max(0, durationMs - minMs));
  const endMs = Math.min(durationMs, startMs + ADD_REGION_MS);
  return endMs - startMs >= minMs ? { startMs, endMs } : null;
}

export interface AddResult {
  patch: Partial<EditorData>;
  id: string;
}

/**
 * "+" on a track header. Returns null when nothing fits (no-overlap tracks
 * refuse to add on top of an existing region; captions refuse inside one).
 */
export function addAtPlayhead(
  d: TimelineDoc,
  kind: TrackKind,
  playheadMs: number,
  makeId: (prefix: string) => string,
): AddResult | null {
  switch (kind) {
    case "zoom": {
      const span = spanAtPlayhead(d.durationMs, playheadMs, MIN_ZOOM_REGION_MS);
      if (!span || overlapsAny(d.zoomRegions, span.startMs, span.endMs)) return null;
      const short = span.endMs - span.startMs < 2000;
      const region: ZoomRegion = {
        id: makeId("zoom"),
        ...span,
        level: DEFAULT_ADD_ZOOM_LEVEL,
        focus: { mode: "fixed", x: 0.5, y: 0.5 },
        // §8 easing: 600/700ms, or 400/500 for regions under 2s.
        easeInMs: short ? 400 : 600,
        easeOutMs: short ? 500 : 700,
        curve: "ease-out-cubic",
        source: "manual",
      };
      const zoomRegions = [...d.zoomRegions, region].sort((a, b) => a.startMs - b.startMs);
      return { patch: { zoomRegions, selectedZoomId: region.id }, id: region.id };
    }
    case "speed": {
      const span = spanAtPlayhead(d.durationMs, playheadMs, MIN_ZOOM_REGION_MS);
      if (!span || overlapsAny(d.speedRegions, span.startMs, span.endMs)) return null;
      const region: SpeedRegionEdit = normalizeSpeedRegion({
        id: makeId("speed"),
        ...span,
        rate: DEFAULT_ADD_SPEED_RATE,
        keepPitch: true,
        rampInMs: DEFAULT_SPEED_RAMP_MS,
        rampOutMs: DEFAULT_SPEED_RAMP_MS,
      });
      const speedRegions = [...d.speedRegions, region].sort((a, b) => a.startMs - b.startMs);
      return { patch: { speedRegions, selectedSpeedId: region.id }, id: region.id };
    }
    case "annotations": {
      const annotation = createAnnotation("text", {
        id: makeId("ann"),
        playheadMs,
        timelineDurationMs: d.durationMs,
        existing: d.annotations,
      });
      return {
        patch: {
          annotations: [...d.annotations, annotation],
          selectedAnnotationId: annotation.id,
        },
        id: annotation.id,
      };
    }
    case "captions": {
      const result = addCaptionAt(d.captions, playheadMs, { maxMs: d.durationMs });
      return result && { patch: { captions: result.captions }, id: result.id };
    }
    case "video":
      return null;
  }
}

/** Delete every selected item across tracks; null when nothing matched. */
export function deleteSelection(
  d: TimelineDoc,
  ids: ReadonlySet<string>,
): Partial<EditorData> | null {
  if (ids.size === 0) return null;
  const keep = <T extends TimeSpan>(list: readonly T[]): T[] =>
    list.filter((item) => !ids.has(item.id));
  const zoomRegions = keep(d.zoomRegions);
  const speedRegions = keep(d.speedRegions);
  const annotations = keep(d.annotations);
  const captions = keep(d.captions);
  const removed =
    d.zoomRegions.length -
    zoomRegions.length +
    (d.speedRegions.length - speedRegions.length) +
    (d.annotations.length - annotations.length) +
    (d.captions.length - captions.length);
  if (removed === 0) return null;
  return {
    zoomRegions,
    speedRegions,
    annotations,
    captions,
    selectedZoomId: null,
    selectedSpeedId: null,
    selectedAnnotationId: null,
  };
}
