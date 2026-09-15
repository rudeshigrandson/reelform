import { createAnnotation } from "./inspector/annotations/annotations";
import { addCaptionAt } from "./inspector/captions/logic";
import { normalizeSpeedRegion } from "./inspector/effects/logic";
import type { SpeedRegionEdit } from "./inspector/effects/types";
import { MIN_ZOOM_REGION_MS, type ZoomRegion } from "./inspector/zoom/types";
import type { Clip } from "./model/schema";
import type { EditorData } from "./store";
import {
  MIN_ITEM_MS,
  type TimeSpan,
  type TimelineTrack,
  type TrackKind,
  annotationsToItems,
  captionsToItems,
  clipsToItems,
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
  "durationMs" | "clips" | "zoomRegions" | "speedRegions" | "annotations" | "captions" | "audio"
>;

/** Manual add = 2s region at the playhead (§9.3). */
export const ADD_REGION_MS = 2000;
const DEFAULT_ADD_ZOOM_LEVEL = 2;
const DEFAULT_ADD_SPEED_RATE = 2;
const DEFAULT_SPEED_RAMP_MS = 300;

export function buildTracks(d: TimelineDoc): TimelineTrack[] {
  return [
    makeTrack("video", clipsToItems(d.clips)),
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
  opts: ClipEditOptions = {},
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
      return resizeClip(d, span, opts);
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
  if (d.clips.some((c) => ids.has(c.id))) {
    // Regions first, then ripple the clip ranges out of what is left.
    const regions = deleteRegions(d, ids);
    const ripple = rippleDeleteClips({ ...d, ...regions }, ids);
    if (!ripple) return regions;
    return {
      ...regions,
      ...ripple,
      selectedZoomId: null,
      selectedSpeedId: null,
      selectedAnnotationId: null,
    };
  }
  return deleteRegions(d, ids);
}

function deleteRegions(d: TimelineDoc, ids: ReadonlySet<string>): Partial<EditorData> | null {
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

// ── Video clip operations (SPEC §6.7: split, trim to playhead, ripple delete) ─

export interface ClipEditOptions {
  /** Source video length; clip edges can only grow back out up to it. */
  sourceDurationMs?: number | undefined;
  /** Id factory for clip halves created by a split / middle cut. */
  makeId?: ((prefix: string) => string) | undefined;
}

export const clipLengthMs = (c: Clip): number => c.sourceEndMs - c.sourceStartMs;

/** Restamp `timelineStartMs` so clips are contiguous from 0 (SPEC §4). */
export function layoutClips(clips: readonly Clip[]): Clip[] {
  let at = 0;
  return clips.map((c) => {
    const next = c.timelineStartMs === at ? c : { ...c, timelineStartMs: at };
    at += clipLengthMs(c);
    return next;
  });
}

export function clipsDurationMs(clips: readonly Clip[]): number {
  return clips.reduce((sum, c) => sum + clipLengthMs(c), 0);
}

/** Index of the clip whose timeline range strictly contains `t` (edges excluded). */
function clipIndexInside(clips: readonly Clip[], t: number): number {
  return clips.findIndex((c) => t > c.timelineStartMs && t < c.timelineStartMs + clipLengthMs(c));
}

const roundMs = (v: number): number => Math.round(Number.isFinite(v) ? v : 0);

function uniqueClipId(
  clips: readonly Clip[],
  base: string,
  makeId?: (p: string) => string,
): string {
  const taken = new Set(clips.map((c) => c.id));
  if (makeId) {
    for (let i = 0; i < 100; i++) {
      const id = makeId("clip");
      if (!taken.has(id)) return id;
    }
  }
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** S: split the clip under the playhead in two. Regions are untouched (no time removed). */
export function splitClipAt(
  d: Pick<TimelineDoc, "clips">,
  playheadMs: number,
  makeId?: ((prefix: string) => string) | undefined,
): Partial<EditorData> | null {
  const t = roundMs(playheadMs);
  const i = clipIndexInside(d.clips, t);
  const clip = d.clips[i];
  if (!clip) return null;
  const offset = t - clip.timelineStartMs;
  if (offset < MIN_ITEM_MS || clipLengthMs(clip) - offset < MIN_ITEM_MS) return null;
  const cut = clip.sourceStartMs + offset;
  const left: Clip = { ...clip, sourceEndMs: cut };
  const right: Clip = {
    id: uniqueClipId(d.clips, clip.id, makeId),
    sourceStartMs: cut,
    sourceEndMs: clip.sourceEndMs,
    timelineStartMs: t,
  };
  const clips = [...d.clips.slice(0, i), left, right, ...d.clips.slice(i + 1)];
  return { clips: layoutClips(clips) };
}

/** Map a timeline time across the removal of `[a, b)`. */
function mapRemoved(x: number, a: number, b: number): number {
  if (x <= a) return x;
  if (x >= b) return x - (b - a);
  return a;
}

/** Shift a region across a removal; null when it collapsed inside the removed range. */
function remapSpan<T extends { startMs: number; endMs: number }>(
  item: T,
  a: number,
  b: number,
  minMs: number,
): T | null {
  const startMs = mapRemoved(item.startMs, a, b);
  const endMs = mapRemoved(item.endMs, a, b);
  const wasPoint = item.endMs === item.startMs;
  if (wasPoint) {
    // Point items keep their spot unless they sat inside the removed range.
    return item.startMs > a && item.startMs < b ? null : { ...item, startMs, endMs };
  }
  if (endMs - startMs < minMs || endMs === startMs) return null;
  return startMs === item.startMs && endMs === item.endMs ? item : { ...item, startMs, endMs };
}

/**
 * Ripple: cut timeline range `[a, b)` out of every clip, then shift every
 * region after it left (SPEC §6.7 "delete selected clip range and shift
 * everything"). Null when nothing would be removed or no video would remain.
 */
export function removeTimelineRange(
  d: TimelineDoc,
  startMs: number,
  endMs: number,
  makeId?: ((prefix: string) => string) | undefined,
): Partial<EditorData> | null {
  const total = clipsDurationMs(d.clips);
  const a = Math.max(0, roundMs(Math.min(startMs, endMs)));
  const b = Math.min(total, roundMs(Math.max(startMs, endMs)));
  if (!(b > a)) return null;
  if (total - (b - a) < MIN_ITEM_MS) return null;

  const pieces: Clip[] = [];
  for (const clip of d.clips) {
    const s = clip.timelineStartMs;
    const e = s + clipLengthMs(clip);
    const cutS = Math.max(s, a);
    const cutE = Math.min(e, b);
    if (cutE <= cutS) {
      pieces.push(clip);
      continue;
    }
    const leftLen = cutS - s;
    const rightLen = e - cutE;
    if (leftLen > 0) pieces.push({ ...clip, sourceEndMs: clip.sourceStartMs + leftLen });
    if (rightLen > 0) {
      const id = leftLen > 0 ? uniqueClipId([...d.clips, ...pieces], clip.id, makeId) : clip.id;
      pieces.push({ ...clip, id, sourceStartMs: clip.sourceEndMs - rightLen });
    }
  }
  const clips = layoutClips(pieces);
  const durationMs = clipsDurationMs(clips);

  const keep = <T extends { startMs: number; endMs: number }>(list: readonly T[], minMs: number) =>
    list.flatMap((item) => {
      const next = remapSpan(item, a, b, minMs);
      return next ? [next] : [];
    });

  const captions = d.captions.flatMap((c) => {
    const next = remapSpan(c, a, b, 0);
    if (!next) return [];
    if (next === c) return [c];
    const words = c.words.flatMap((w) => {
      const t0 = mapRemoved(w.t0, a, b);
      const t1 = mapRemoved(w.t1, a, b);
      return w.t1 > w.t0 && t1 === t0 ? [] : [{ ...w, t0, t1 }];
    });
    return [{ ...next, words }];
  });

  return {
    clips,
    durationMs,
    zoomRegions: keep(d.zoomRegions, MIN_ZOOM_REGION_MS),
    speedRegions: keep(d.speedRegions, MIN_ZOOM_REGION_MS).map((r) =>
      d.speedRegions.includes(r) ? r : normalizeSpeedRegion(r),
    ),
    annotations: keep(d.annotations, 0),
    captions,
    audio: { ...d.audio, regions: keep(d.audio.regions, 0) },
  };
}

/** `[` / `]`: trim the clip under the playhead so it starts / ends at the playhead (ripple). */
export function trimClipToPlayhead(
  d: TimelineDoc,
  playheadMs: number,
  edge: "start" | "end",
): Partial<EditorData> | null {
  const t = roundMs(playheadMs);
  const clip = d.clips[clipIndexInside(d.clips, t)];
  if (!clip) return null;
  const s = clip.timelineStartMs;
  const e = s + clipLengthMs(clip);
  if (edge === "start") return e - t < MIN_ITEM_MS ? null : removeTimelineRange(d, s, t);
  return t - s < MIN_ITEM_MS ? null : removeTimelineRange(d, t, e);
}

/** Delete whole clips and close the gaps. Null when none match or every clip would go. */
export function rippleDeleteClips(
  d: TimelineDoc,
  ids: ReadonlySet<string>,
): Partial<EditorData> | null {
  const doomed = d.clips.filter((c) => ids.has(c.id));
  if (doomed.length === 0 || doomed.length === d.clips.length) return null;
  // Latest first, so earlier ranges keep their timeline coordinates.
  let doc: TimelineDoc = d;
  let changed = false;
  for (const clip of [...doomed].sort((x, y) => y.timelineStartMs - x.timelineStartMs)) {
    const current = doc.clips.find((c) => c.id === clip.id);
    if (!current) continue;
    const patch = removeTimelineRange(
      doc,
      current.timelineStartMs,
      current.timelineStartMs + clipLengthMs(current),
    );
    if (!patch) continue;
    doc = { ...doc, ...patch };
    changed = true;
  }
  if (!changed) return null;
  const { clips, durationMs, zoomRegions, speedRegions, annotations, captions, audio } = doc;
  return { clips, durationMs, zoomRegions, speedRegions, annotations, captions, audio };
}

/** Timeline edge drag on a clip: shrinking ripples time out, growing reveals source again. */
function resizeClip(
  d: TimelineDoc,
  span: TimeSpan,
  opts: ClipEditOptions,
): Partial<EditorData> | null {
  const clip = d.clips.find((c) => c.id === span.id);
  if (!clip) return null;
  const s = clip.timelineStartMs;
  const e = s + clipLengthMs(clip);
  const ns = roundMs(span.startMs);
  const ne = roundMs(span.endMs);
  if (ne - ns < MIN_ITEM_MS) return null;
  const startMoved = ns !== s;
  const endMoved = ne !== e;
  // A clip body move has no meaning in a contiguous sequence; one edge at a time.
  if (startMoved === endMoved) return null;
  if (startMoved) {
    if (ns > s) return removeTimelineRange(d, s, ns, opts.makeId);
    const grow = Math.min(s - ns, clip.sourceStartMs);
    if (grow <= 0) return null;
    return growClip(d, clip.id, grow, "start");
  }
  if (ne < e) return removeTimelineRange(d, ne, e, opts.makeId);
  if (opts.sourceDurationMs === undefined) return null;
  const grow = Math.min(ne - e, opts.sourceDurationMs - clip.sourceEndMs);
  if (grow <= 0) return null;
  return growClip(d, clip.id, grow, "end");
}

function growClip(
  d: TimelineDoc,
  id: string,
  growMs: number,
  edge: "start" | "end",
): Partial<EditorData> {
  const clip = d.clips.find((c) => c.id === id) as Clip;
  // New time is inserted at the clip's start (start edge) or end (end edge).
  const at = edge === "start" ? clip.timelineStartMs : clip.timelineStartMs + clipLengthMs(clip);
  const clips = layoutClips(
    d.clips.map((c) =>
      c.id !== id
        ? c
        : edge === "start"
          ? { ...c, sourceStartMs: c.sourceStartMs - growMs }
          : { ...c, sourceEndMs: c.sourceEndMs + growMs },
    ),
  );
  const shift = (x: number): number => (x >= at ? x + growMs : x);
  const move = <T extends { startMs: number; endMs: number }>(list: readonly T[]): T[] =>
    list.map((item) =>
      item.startMs >= at
        ? { ...item, startMs: shift(item.startMs), endMs: shift(item.endMs) }
        : item,
    );
  return {
    clips,
    durationMs: clipsDurationMs(clips),
    zoomRegions: move(d.zoomRegions),
    speedRegions: move(d.speedRegions),
    annotations: move(d.annotations),
    captions: d.captions.map((c) =>
      c.startMs >= at
        ? {
            ...c,
            startMs: shift(c.startMs),
            endMs: shift(c.endMs),
            words: c.words.map((w) => ({ ...w, t0: shift(w.t0), t1: shift(w.t1) })),
          }
        : c,
    ),
    audio: { ...d.audio, regions: move(d.audio.regions) },
  };
}

/** Undo tooltip label for a committed timeline drag ("Move zoom", "Trim clip"). */
export function itemChangeLabel(d: TimelineDoc, kind: TrackKind, span: TimeSpan): string {
  if (kind === "video") return "Trim clip";
  const noun = { zoom: "zoom", speed: "speed", annotations: "annotation", captions: "caption" }[
    kind
  ];
  const list: readonly TimeSpan[] =
    kind === "zoom"
      ? d.zoomRegions
      : kind === "speed"
        ? d.speedRegions
        : kind === "annotations"
          ? d.annotations
          : d.captions;
  const before = list.find((i) => i.id === span.id);
  const resized =
    before !== undefined && before.endMs - before.startMs !== span.endMs - span.startMs;
  return `${resized ? "Resize" : "Move"} ${noun}`;
}
