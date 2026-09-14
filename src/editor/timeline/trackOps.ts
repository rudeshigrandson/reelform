import { snap } from "./snapping";
import type { TimeSpan } from "./types";

/**
 * Pure timeline item operations (ENGINEERING_SPEC §6.7) and the selection
 * model (design guide §5). All ops start from the item as it was at drag start
 * plus a total delta, so repeated pointer moves never accumulate error.
 */

/** Shortest item length (matches MIN_ZOOM_REGION_MS). */
export const MIN_ITEM_MS = 100;

export interface SnapConfig {
  readonly targets: readonly number[];
  readonly pxPerMs: number;
  readonly enabled: boolean;
  readonly bypass?: boolean | undefined;
  readonly tolerancePx?: number | undefined;
}

export interface OpContext {
  readonly durationMs: number;
  /** False for zoom/speed tracks: overlapping results are marked invalid. */
  readonly allowOverlap: boolean;
  /** Other items on the same track (the edited item may be included; it is ignored by id). */
  readonly siblings: readonly TimeSpan[];
  readonly minMs?: number | undefined;
  readonly snap?: SnapConfig | undefined;
}

export interface OpResult<T extends TimeSpan> {
  readonly item: T;
  /** False when the result overlaps a neighbour on a no-overlap track: reject on drop. */
  readonly valid: boolean;
  readonly snappedTo: number | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

function bounds(ctx: OpContext): { duration: number; min: number } {
  const duration = Math.max(0, finite(ctx.durationMs));
  return { duration, min: Math.min(Math.max(0, ctx.minMs ?? MIN_ITEM_MS), duration) };
}

/** Half-open intersection test against every item except `ignoreId`. */
export function overlaps(
  items: readonly TimeSpan[],
  candidate: Pick<TimeSpan, "startMs" | "endMs">,
  ignoreId?: string | undefined,
): boolean {
  return items.some(
    (it) => it.id !== ignoreId && it.startMs < candidate.endMs && candidate.startMs < it.endMs,
  );
}

function finish<T extends TimeSpan>(
  origin: T,
  startMs: number,
  endMs: number,
  snappedTo: number | null,
  ctx: OpContext,
): OpResult<T> {
  const item = { ...origin, startMs, endMs };
  const valid = ctx.allowOverlap || !overlaps(ctx.siblings, item, origin.id);
  return { item, valid, snappedTo };
}

function snapOne(
  ms: number,
  cfg: SnapConfig | undefined,
): { ms: number; snappedTo: number | null } {
  if (!cfg) return { ms, snappedTo: null };
  return snap(ms, cfg.targets, cfg, cfg);
}

/** Move keeping length; both edges try to snap and the closer one wins. */
export function moveItem<T extends TimeSpan>(
  origin: T,
  deltaMs: number,
  ctx: OpContext,
): OpResult<T> {
  const { duration, min } = bounds(ctx);
  const len = clamp(finite(origin.endMs - origin.startMs), min, duration);
  const maxStart = duration - len;
  let start = clamp(finite(origin.startMs) + finite(deltaMs), 0, maxStart);
  let snappedTo: number | null = null;
  if (ctx.snap) {
    const s = snapOne(start, ctx.snap);
    const e = snapOne(start + len, ctx.snap);
    const ds = s.snappedTo === null ? Number.POSITIVE_INFINITY : Math.abs(s.ms - start);
    const de = e.snappedTo === null ? Number.POSITIVE_INFINITY : Math.abs(e.ms - (start + len));
    if (ds <= de && s.snappedTo !== null) {
      start = clamp(s.ms, 0, maxStart);
      snappedTo = start === s.ms ? s.snappedTo : null;
    } else if (e.snappedTo !== null) {
      const next = clamp(e.ms - len, 0, maxStart);
      snappedTo = next === e.ms - len ? e.snappedTo : null;
      start = next;
    }
  }
  return finish(origin, start, Math.min(start + len, duration), snappedTo, ctx);
}

/** Drag the start edge; end stays put, length ≥ min. */
export function resizeItemStart<T extends TimeSpan>(
  origin: T,
  deltaMs: number,
  ctx: OpContext,
): OpResult<T> {
  const { duration, min } = bounds(ctx);
  const end = clamp(finite(origin.endMs), min, duration);
  const s = snapOne(finite(origin.startMs) + finite(deltaMs), ctx.snap);
  const start = clamp(s.ms, 0, Math.max(0, end - min));
  return finish(origin, start, end, start === s.ms ? s.snappedTo : null, ctx);
}

/** Drag the end edge; start stays put, length ≥ min. */
export function resizeItemEnd<T extends TimeSpan>(
  origin: T,
  deltaMs: number,
  ctx: OpContext,
): OpResult<T> {
  const { duration, min } = bounds(ctx);
  const start = clamp(finite(origin.startMs), 0, Math.max(0, duration - min));
  const e = snapOne(finite(origin.endMs) + finite(deltaMs), ctx.snap);
  const end = clamp(e.ms, start + min, duration);
  return finish(origin, start, end, end === e.ms ? e.snappedTo : null, ctx);
}

/** Shift by whole frames (←/→), keeping length and staying inside [0, duration]. */
export function nudge<T extends TimeSpan>(
  item: T,
  frames: number,
  fps: number,
  durationMs: number,
): T {
  const delta = fps > 0 && Number.isFinite(fps) ? (finite(frames) * 1000) / fps : 0;
  return moveItem(item, delta, { durationMs, allowOverlap: true, siblings: [], minMs: 0 }).item;
}

/** Ids of items intersecting the marquee range (order-independent bounds, inclusive touch excluded). */
export function selectInRange(items: readonly TimeSpan[], aMs: number, bMs: number): string[] {
  const lo = Math.min(aMs, bMs);
  const hi = Math.max(aMs, bMs);
  return items.filter((it) => it.startMs < hi && lo < it.endMs).map((it) => it.id);
}

export interface SelectionModifiers {
  /** Extend: select the range from the last selected item on this track. */
  readonly shift?: boolean | undefined;
  /** ⌘ (mac) / Ctrl: toggle. */
  readonly toggle?: boolean | undefined;
}

/**
 * Selection model (guide §5): click selects one; shift extends a range within
 * the same track; ⌘/Ctrl toggles. Esc clears — see `clearSelection`.
 */
export function applySelection(
  prev: ReadonlySet<string>,
  id: string,
  modifiers: SelectionModifiers,
  orderedIdsOnTrack: readonly string[],
): ReadonlySet<string> {
  if (modifiers.toggle) {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }
  if (modifiers.shift) {
    const target = orderedIdsOnTrack.indexOf(id);
    const anchorId = [...prev].reverse().find((p) => orderedIdsOnTrack.includes(p));
    if (target < 0 || anchorId === undefined) return new Set([...prev, id]);
    const anchor = orderedIdsOnTrack.indexOf(anchorId);
    const [lo, hi] = anchor <= target ? [anchor, target] : [target, anchor];
    const next = new Set(prev);
    for (const rid of orderedIdsOnTrack.slice(lo, hi + 1)) next.add(rid);
    // Keep the clicked id last so it anchors the next shift-click.
    next.delete(id);
    next.add(id);
    return next;
  }
  return new Set([id]);
}

export function clearSelection(): ReadonlySet<string> {
  return new Set<string>();
}
