import type { TimelineThumb } from "./types";

/**
 * Filmstrip + mini waveform layout for video clip items (SPEC §6.7). Pure:
 * given an item's timeline span, where its source starts and the visible time
 * range, returns only the tiles / bars that intersect the viewport, positioned
 * in px relative to the item's left edge.
 */

export interface ClipPlacement {
  /** Item span on the timeline (ms). */
  readonly itemStartMs: number;
  readonly itemEndMs: number;
  /** Source ms shown at `itemStartMs`. */
  readonly sourceStartMs: number;
  /** Source ms advanced per timeline ms (1 = realtime). */
  readonly speed?: number | undefined;
  readonly pxPerMs: number;
  /** Visible timeline range (ms), overscan included. */
  readonly visibleStartMs: number;
  readonly visibleEndMs: number;
}

export interface FilmstripTile {
  readonly url: string;
  readonly sourceMs: number;
  /** px from the item's left edge. */
  readonly leftPx: number;
  readonly widthPx: number;
}

const finite = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);

/** Index of the thumb whose `sourceMs` is closest to `ms` (thumbs sorted ascending). */
export function nearestThumbIndex(thumbs: readonly TimelineThumb[], ms: number): number {
  if (thumbs.length === 0) return -1;
  let lo = 0;
  let hi = thumbs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((thumbs[mid] as TimelineThumb).sourceMs < ms) lo = mid + 1;
    else hi = mid;
  }
  const prev = thumbs[lo - 1];
  const at = thumbs[lo] as TimelineThumb;
  return prev && Math.abs(prev.sourceMs - ms) <= Math.abs(at.sourceMs - ms) ? lo - 1 : lo;
}

/** Visible px window of the item, relative to its left edge, or null when off-screen. */
function visibleWindow(p: ClipPlacement): { fromPx: number; toPx: number; widthPx: number } | null {
  const px = finite(p.pxPerMs);
  if (!(px > 0)) return null;
  const widthPx = Math.max(0, (finite(p.itemEndMs) - finite(p.itemStartMs)) * px);
  const fromPx = Math.max(0, (finite(p.visibleStartMs) - p.itemStartMs) * px);
  const toPx = Math.min(widthPx, (finite(p.visibleEndMs) - p.itemStartMs) * px);
  return toPx > fromPx ? { fromPx, toPx, widthPx } : null;
}

/**
 * Tiles of `tileWidthPx` laid edge to edge from the item's start; each shows the
 * thumb nearest the source time at the tile's centre. Off-screen tiles are skipped.
 */
export function visibleFilmstrip(
  thumbs: readonly TimelineThumb[],
  placement: ClipPlacement,
  tileWidthPx: number,
): FilmstripTile[] {
  const win = visibleWindow(placement);
  const tile = finite(tileWidthPx);
  if (!win || thumbs.length === 0 || !(tile > 0)) return [];
  const speed = placement.speed !== undefined && placement.speed > 0 ? placement.speed : 1;
  const first = Math.floor(win.fromPx / tile);
  const last = Math.ceil(win.toPx / tile);
  const out: FilmstripTile[] = [];
  for (let i = first; i < last; i++) {
    const leftPx = i * tile;
    const widthPx = Math.min(tile, win.widthPx - leftPx);
    if (widthPx <= 0) break;
    const centreMs = (leftPx + widthPx / 2) / placement.pxPerMs;
    const sourceMs = placement.sourceStartMs + centreMs * speed;
    const thumb = thumbs[nearestThumbIndex(thumbs, sourceMs)] as TimelineThumb;
    out.push({ url: thumb.url, sourceMs: thumb.sourceMs, leftPx, widthPx });
  }
  return out;
}

export interface WaveformBar {
  /** px from the item's left edge. */
  readonly leftPx: number;
  /** 0..1 peak over the bar's source range. */
  readonly peak: number;
}

/**
 * One bar per `barPx` of the visible part of the item, each the max of the peak
 * buckets its source range covers. Empty when peaks can't be placed.
 */
export function visibleWaveform(
  peaks: Float32Array | undefined,
  sourceDurationMs: number | undefined,
  placement: ClipPlacement,
  barPx: number,
): WaveformBar[] {
  const win = visibleWindow(placement);
  const bar = finite(barPx);
  const duration = finite(sourceDurationMs ?? 0);
  if (!win || !peaks || peaks.length === 0 || !(duration > 0) || !(bar > 0)) return [];
  const speed = placement.speed !== undefined && placement.speed > 0 ? placement.speed : 1;
  const bucketsPerMs = peaks.length / duration;
  const out: WaveformBar[] = [];
  for (let i = Math.floor(win.fromPx / bar); i * bar < win.toPx; i++) {
    const leftPx = i * bar;
    const s0 = placement.sourceStartMs + (leftPx / placement.pxPerMs) * speed;
    const s1 = placement.sourceStartMs + ((leftPx + bar) / placement.pxPerMs) * speed;
    const b0 = Math.max(0, Math.floor(s0 * bucketsPerMs));
    const b1 = Math.min(peaks.length, Math.max(b0 + 1, Math.ceil(s1 * bucketsPerMs)));
    let peak = 0;
    for (let b = b0; b < b1; b++) peak = Math.max(peak, peaks[b] as number);
    out.push({ leftPx, peak: Math.min(1, peak) });
  }
  return out;
}
