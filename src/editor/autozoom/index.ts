/**
 * Auto-zoom suggestion engine (ENGINEERING_SPEC §8).
 *
 * Pure & deterministic: given the same inputs it always yields the same
 * `SuggestedZoom[]`. No DOM, no Electron, no `Date.now()`, no randomness.
 *
 * Pipeline: normalize → candidates → score/suppress → regionize → level →
 * focus → easing → emit.
 */

import { collectCandidates } from "./candidates.js";
import { resample } from "./normalize.js";
import {
  buildRegions,
  easingFor,
  focusFor,
  levelFor,
  reasonFor,
} from "./regionize.js";
import { nonMaxSuppress, scoreCandidates } from "./score.js";
import { clamp } from "./util.js";
import type { Region } from "./regionize.js";
import type { SuggestParams, SuggestedZoom } from "./types.js";

export type {
  Telemetry,
  TelemetryPoint,
  TelemetryClick,
  TelemetryKey,
  TelemetryScroll,
  ContentSize,
  AutoZoomOptions,
  SuggestParams,
  SuggestedZoom,
  Focus,
  FocusMode,
  ClipRange,
  EaseCurve,
} from "./types.js";

const CURVE = "ease-out-cubic" as const;

/**
 * The end of the usable timeline (ms). Derived from the last telemetry event and
 * the last kept clip so output regions can be clamped to `[0, timelineEnd]`.
 */
export function timelineEnd(params: SuggestParams): number {
  let end = 0;
  const t = params.telemetry;
  for (const p of t.points) end = Math.max(end, p[0]);
  for (const c of t.clicks) end = Math.max(end, c[0]);
  for (const k of t.keys) end = Math.max(end, k[0]);
  for (const s of t.scrolls) end = Math.max(end, s[0]);
  for (const clip of params.clips) end = Math.max(end, clip.sourceEndMs);
  return end;
}

/** Run the full pipeline and return non-overlapping, in-bounds suggestions. */
export function suggestZooms(params: SuggestParams): SuggestedZoom[] {
  const { telemetry, clips, sensitivity, options } = params;

  const samples = resample(telemetry.points);
  const candidates = collectCandidates(telemetry, samples, {
    zoomOnClicks: options.zoomOnClicks,
    zoomOnTyping: options.zoomOnTyping,
  });
  const scored = scoreCandidates(candidates, sensitivity, clips);
  const survivors = nonMaxSuppress(scored);
  const regions = buildRegions(survivors);

  const end = timelineEnd(params);
  const out: SuggestedZoom[] = [];
  let prevEnd = 0;

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (region === undefined) continue;

    // clamp region to timeline and to previous region end (guarantee no overlap)
    let startMs = clamp(region.startMs, 0, end);
    let endMs = clamp(region.endMs, 0, end);
    if (startMs < prevEnd) startMs = prevEnd;
    if (endMs <= startMs) continue; // degenerate after clamping

    const finalized: Region = { ...region, startMs, endMs };
    const level = levelFor(finalized, sensitivity);
    const focus = focusFor(finalized, options.followCursor);
    const easing = easingFor(finalized);
    const reason = reasonFor(finalized);

    out.push({
      id: makeId(i, startMs, endMs),
      startMs,
      endMs,
      level,
      focus,
      easeInMs: easing.easeInMs,
      easeOutMs: easing.easeOutMs,
      curve: CURVE,
      source: "auto",
      reason,
    });
    prevEnd = endMs;
  }

  return out;
}

/** Deterministic id from index + bounds (no randomness / time). */
function makeId(index: number, startMs: number, endMs: number): string {
  return `az_${index}_${Math.round(startMs)}_${Math.round(endMs)}`;
}
