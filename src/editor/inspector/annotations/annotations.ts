import { clamp } from "../controls";
import {
  type Annotation,
  type AnnotationTool,
  DEFAULT_BASE,
  DEFAULT_BASE_OVERRIDES,
  DEFAULT_PROPS,
} from "./types";

/** New annotations last 3s (design guide S19). */
export const DEFAULT_DURATION_MS = 3000;
/** Shortest allowed annotation; guarantees `endMs > startMs`. */
export const MIN_DURATION_MS = 100;
/** Normalized offset applied to duplicates so they don't sit exactly on top. */
export const DUPLICATE_OFFSET = 0.02;

/** Next number-badge value: max existing + 1 (1 when there are none). */
export function nextBadgeNumber(existing: readonly Annotation[]): number {
  let max = 0;
  for (const a of existing) if (a.kind === "numberBadge" && a.value > max) max = a.value;
  return max + 1;
}

/**
 * Clamp a `[startMs, endMs)` range into `[0, timelineDurationMs]` keeping at
 * least `MIN_DURATION_MS` of length. Timelines shorter than the minimum are
 * treated as `MIN_DURATION_MS` long.
 */
export function clampRange(
  startMs: number,
  endMs: number,
  timelineDurationMs: number,
): { startMs: number; endMs: number } {
  const total = Math.max(
    MIN_DURATION_MS,
    Number.isFinite(timelineDurationMs) ? timelineDurationMs : Number.POSITIVE_INFINITY,
  );
  let start = clamp(Number.isFinite(startMs) ? startMs : 0, 0, total - MIN_DURATION_MS);
  let end = clamp(Number.isFinite(endMs) ? endMs : start + MIN_DURATION_MS, 0, total);
  if (end - start < MIN_DURATION_MS) {
    end = Math.min(total, start + MIN_DURATION_MS);
    start = Math.min(start, end - MIN_DURATION_MS);
  }
  return { startMs: start, endMs: end };
}

export interface CreateAnnotationOptions {
  id: string;
  playheadMs: number;
  timelineDurationMs: number;
  /** Existing annotations; used for number-badge auto-increment. */
  existing?: readonly Annotation[] | undefined;
  /** Normalized click point; the annotation is centered on it. */
  at?: { x: number; y: number } | undefined;
}

/**
 * Create an annotation for `tool` at the playhead with the default 3s duration,
 * clamped to the timeline. When the playhead is too close to the end, the item
 * is pulled back so it keeps as much of its default duration as fits.
 */
export function createAnnotation(tool: AnnotationTool, opts: CreateAnnotationOptions): Annotation {
  const total = Math.max(MIN_DURATION_MS, opts.timelineDurationMs);
  const playhead = clamp(opts.playheadMs, 0, total);
  const endMs = Math.min(total, playhead + DEFAULT_DURATION_MS);
  const startMs =
    endMs - playhead < MIN_DURATION_MS ? Math.max(0, endMs - DEFAULT_DURATION_MS) : playhead;

  const merged = { ...DEFAULT_BASE, ...DEFAULT_BASE_OVERRIDES[tool] };
  const base = { ...merged, animIn: { ...merged.animIn }, animOut: { ...merged.animOut } };
  if (opts.at) {
    base.x = clamp(opts.at.x - base.w / 2, 0, 1 - base.w);
    base.y = clamp(opts.at.y - base.h / 2, 0, 1 - base.h);
  }
  const annotation = { ...base, ...DEFAULT_PROPS[tool], id: opts.id, startMs, endMs } as Annotation;
  if (annotation.kind === "numberBadge") annotation.value = nextBadgeNumber(opts.existing ?? []);
  return annotation;
}

/**
 * Copy with a new id, nudged down-right (kept in frame). Number badges take the
 * next number when `existing` is given.
 */
export function duplicateAnnotation(
  a: Annotation,
  id: string,
  existing?: readonly Annotation[] | undefined,
): Annotation {
  const copy: Annotation = {
    ...a,
    id,
    x: clamp(a.x + DUPLICATE_OFFSET, 0, Math.max(0, 1 - a.w)),
    y: clamp(a.y + DUPLICATE_OFFSET, 0, Math.max(0, 1 - a.h)),
    animIn: { ...a.animIn },
    animOut: { ...a.animOut },
  };
  if (copy.kind === "numberBadge" && existing) copy.value = nextBadgeNumber(existing);
  return copy;
}

/**
 * Change timing; the edited edge wins. Editing only the start keeps `endMs`
 * where it was unless that would invert the range (then end is pushed).
 */
export function updateTiming<A extends Annotation>(
  a: A,
  patch: { startMs?: number | undefined; endMs?: number | undefined },
  timelineDurationMs: number,
): A {
  const total = Math.max(MIN_DURATION_MS, timelineDurationMs);
  let start = patch.startMs ?? a.startMs;
  let end = patch.endMs ?? a.endMs;
  if (patch.startMs !== undefined && patch.endMs === undefined) {
    start = clamp(start, 0, total - MIN_DURATION_MS);
    end = Math.max(end, start + MIN_DURATION_MS);
  } else if (patch.endMs !== undefined && patch.startMs === undefined) {
    end = clamp(end, MIN_DURATION_MS, total);
    start = Math.min(start, end - MIN_DURATION_MS);
  }
  return { ...a, ...clampRange(start, end, total) };
}
