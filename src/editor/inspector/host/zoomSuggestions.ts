import { type SuggestedZoom, suggestZooms } from "../../autozoom";
import type { Telemetry } from "../../autozoom";
import type { Clip } from "../../model/schema";
import type { AutoZoomSettings, ZoomRegion } from "../zoom/types";

/**
 * Auto-zoom glue (SPEC §8): run the engine with the tab settings, then merge so
 * regenerate replaces only untouched `source:'auto'` regions — edited regions
 * are `manual` (zoomLogic marks them) and survive.
 */

export interface GenerateInput {
  telemetry: Telemetry;
  sourceSize: { width: number; height: number } | null;
  clips: readonly Clip[];
  settings: AutoZoomSettings;
}

export function generateSuggestions(input: GenerateInput): SuggestedZoom[] {
  const { settings } = input;
  const raw = suggestZooms({
    telemetry: input.telemetry,
    content: { w: input.sourceSize?.width ?? 1920, h: input.sourceSize?.height ?? 1080 },
    clips: input.clips,
    sensitivity: settings.sensitivity,
    options: {
      followCursor: settings.followCursor,
      zoomOnClicks: settings.zoomOnClicks,
      zoomOnTyping: settings.zoomOnTyping,
    },
  });
  return suggestionsToTimeline(raw, input.clips);
}

/**
 * The engine works in source ms (telemetry time); zoom regions live on the
 * timeline. Each suggestion is placed through the clip containing its start
 * and cut at that clip's end; suggestions starting in trimmed-away source are
 * dropped. With no clips the times pass through unchanged.
 */
export function suggestionsToTimeline(
  suggestions: readonly SuggestedZoom[],
  clips: readonly Clip[],
): SuggestedZoom[] {
  if (clips.length === 0) return [...suggestions];
  const out: SuggestedZoom[] = [];
  for (const s of suggestions) {
    const clip = clips.find((c) => s.startMs >= c.sourceStartMs && s.startMs < c.sourceEndMs);
    if (!clip) continue;
    const startMs = clip.timelineStartMs + (s.startMs - clip.sourceStartMs);
    const endMs = clip.timelineStartMs + (Math.min(s.endMs, clip.sourceEndMs) - clip.sourceStartMs);
    if (endMs <= startMs) continue;
    out.push({ ...s, startMs, endMs });
  }
  out.sort((a, b) => a.startMs - b.startMs);
  // Clips can be reordered on the timeline; keep the no-overlap guarantee.
  const clean: SuggestedZoom[] = [];
  for (const s of out) {
    const prev = clean.at(-1);
    if (prev && s.startMs < prev.endMs) continue;
    clean.push(s);
  }
  return clean;
}

const overlaps = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) =>
  a.startMs < b.endMs && b.startMs < a.endMs;

/**
 * Drop untouched auto regions, keep everything else, add the accepted
 * suggestions that don't collide with a kept region. Sorted by start; ids made
 * unique against kept regions.
 */
export function mergeZoomSuggestions(
  existing: readonly ZoomRegion[],
  accepted: readonly SuggestedZoom[],
): ZoomRegion[] {
  const kept = existing.filter((r) => r.source !== "auto");
  const ids = new Set(kept.map((r) => r.id));
  const added: ZoomRegion[] = [];
  for (const s of accepted) {
    if (kept.some((k) => overlaps(k, s))) continue;
    let id = s.id;
    for (let n = 2; ids.has(id); n++) id = `${s.id}-${n}`;
    ids.add(id);
    added.push({ ...s, id, focus: { ...s.focus } });
  }
  return [...kept, ...added].sort((a, b) => a.startMs - b.startMs);
}

// ── Review stepper ────────────────────────────────────────────

export interface ReviewState {
  suggestions: readonly SuggestedZoom[];
  index: number;
  kept: readonly SuggestedZoom[];
}

export function startReview(suggestions: readonly SuggestedZoom[]): ReviewState {
  return { suggestions, index: 0, kept: [] };
}

export function reviewStep(state: ReviewState, decision: "keep" | "skip"): ReviewState {
  const current = state.suggestions[state.index];
  if (!current) return state;
  return {
    ...state,
    index: state.index + 1,
    kept: decision === "keep" ? [...state.kept, current] : state.kept,
  };
}

export function reviewDone(state: ReviewState): boolean {
  return state.index >= state.suggestions.length;
}

export function suggestionsToastText(n: number): string {
  if (n === 0) return "No zoom suggestions found";
  return `We suggested ${n} ${n === 1 ? "zoom" : "zooms"}`;
}
