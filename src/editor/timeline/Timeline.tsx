import type {
  CSSProperties,
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { shortcutScopeProps } from "../../shortcuts/matcher";
import { visibleFilmstrip, visibleWaveform } from "./filmstrip";
import { collectSnapTargets } from "./snapping";
import {
  type TimeScale,
  clampScale,
  fitScale,
  formatClock,
  msToPx,
  pxToMs,
  rulerTicks,
  zoomAround,
} from "./timeScale";
import { INVALID_COLOR, TRACK_COLORS, itemFill } from "./trackColors";
import {
  type OpContext,
  type OpResult,
  applySelection,
  clearSelection,
  moveItem,
  overlaps,
  resizeItemEnd,
  resizeItemStart,
  resolveOverlapByTrimming,
  selectInRange,
} from "./trackOps";
import {
  ITEM_NOUNS,
  type TimeSpan,
  type TimelineItem,
  type TimelineMedia,
  type TimelineTrack,
  type TrackKind,
} from "./types";

/**
 * Timeline (design guide S12 region E, §2.6, §5; ENGINEERING_SPEC §6.7).
 * Props-driven: all edits surface through callbacks; the only internal state
 * is view state (zoom when uncontrolled, scroll, in-progress gestures).
 */

export const HEADER_WIDTH_PX = 140;
export const RULER_HEIGHT_PX = 24;
export const LANE_HEIGHT_PX = 36;
/** Pointer travel before a press on an item becomes a drag instead of a click. */
export const DRAG_THRESHOLD_PX = 3;
const EDGE_GRAB_PX = 6;
const OVERSCAN_PX = 120;
const WHEEL_ZOOM_SENSITIVITY = 0.002;
const ITEM_HEIGHT_PX = LANE_HEIGHT_PX - 9;
const WAVEFORM_HEIGHT_PX = 9;
const WAVEFORM_BAR_PX = 2;

export interface TimelineProps {
  durationMs: number;
  currentMs: number;
  fps: number;
  tracks: readonly TimelineTrack[];
  selectedIds: ReadonlySet<string>;
  snapEnabled: boolean;
  /** Controlled zoom. When omitted the timeline keeps its own (starting at fit). */
  pxPerMs?: number | undefined;
  onScaleChange?: ((pxPerMs: number) => void) | undefined;
  /** While playing, the view page-flips to keep the playhead visible (guide §5). */
  isPlaying?: boolean | undefined;
  onSeek: (ms: number) => void;
  onSelect: (ids: ReadonlySet<string>) => void;
  /** Fired on drop of a valid move/resize with the committed times. */
  onItemChange: (kind: TrackKind, item: TimeSpan) => void;
  /**
   * One gesture changing several items, to commit as one edit: a group move of
   * the selection, or a shift-drop that trims the neighbours it overlaps.
   */
  onItemsChange?:
    | ((changes: ReadonlyArray<{ kind: TrackKind; span: TimeSpan }>) => void)
    | undefined;
  /** Alt-drag drop: copy the dragged item to `span` (the original stays). */
  onItemDuplicate?: ((kind: TrackKind, span: TimeSpan) => void) | undefined;
  onAddAtPlayhead?: ((kind: TrackKind) => void) | undefined;
}

type DragMode = "move" | "start" | "end";

interface GroupMember {
  kind: TrackKind;
  item: TimelineItem;
}

interface DragState {
  trackKind: TrackKind;
  origin: TimelineItem;
  mode: DragMode;
  startX: number;
  moved: boolean;
  shift: boolean;
  toggle: boolean;
  targets: number[];
  /** Other selected items moving by the same delta (move mode, multi-selection). */
  group: GroupMember[];
  last: OpResult<TimelineItem> | null;
  /** Group delta and validity from the last pointer move. */
  lastDelta: number;
  lastGroupValid: boolean;
  /** Alt-drag copy validity (the original counts as a neighbour). */
  lastDuplicateValid: boolean;
}

interface PreviewSpan {
  startMs: number;
  endMs: number;
  valid: boolean;
}

interface Preview {
  spans: ReadonlyMap<string, PreviewSpan>;
  snappedTo: number | null;
}

/** Group move: every member shifted by `delta`, validity checked against non-moving siblings. */
function groupPreview(
  origin: GroupMember,
  group: readonly GroupMember[],
  delta: number,
  tracks: readonly TimelineTrack[],
): { spans: Map<string, PreviewSpan>; valid: boolean } {
  const members = [origin, ...group];
  const moving = new Set(members.map((m) => m.item.id));
  const spans = new Map<string, PreviewSpan>();
  let valid = true;
  for (const m of members) {
    const track = tracks.find((t) => t.kind === m.kind);
    const next = { startMs: m.item.startMs + delta, endMs: m.item.endMs + delta };
    const ok =
      track === undefined ||
      track.allowOverlap ||
      !overlaps(
        track.items.filter((i) => !moving.has(i.id)),
        next,
      );
    valid &&= ok;
    spans.set(m.item.id, { ...next, valid: ok });
  }
  return { spans, valid };
}

interface MarqueeState {
  startX: number;
  startLane: number;
  curX: number;
  curLane: number;
  moved: boolean;
  additive: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Drop of a moved drag (SPEC §6.7): alt → duplicate; multi-selection → one
 * batch; a valid single move/resize → `onItemChange`; an invalid drop with
 * shift held → the item plus trimmed neighbours as one batch.
 */
function commitDrag(
  d: DragState,
  e: PointerEvent,
  p: TimelineProps,
  track: TimelineTrack | undefined,
): void {
  const r = d.last;
  if (!r) return;
  const span = (item: TimeSpan): TimeSpan => ({
    id: item.id,
    startMs: item.startMs,
    endMs: item.endMs,
  });
  const changed = r.item.startMs !== d.origin.startMs || r.item.endMs !== d.origin.endMs;

  if (d.group.length > 0) {
    if (!d.lastGroupValid || d.lastDelta === 0) return;
    const changes = [{ kind: d.trackKind, item: d.origin }, ...d.group].map((m) => ({
      kind: m.kind,
      span: {
        id: m.item.id,
        startMs: m.item.startMs + d.lastDelta,
        endMs: m.item.endMs + d.lastDelta,
      },
    }));
    if (p.onItemsChange) p.onItemsChange(changes);
    else for (const c of changes) p.onItemChange(c.kind, c.span);
    return;
  }

  if (d.mode === "move" && e.altKey && p.onItemDuplicate) {
    if (changed && d.lastDuplicateValid) p.onItemDuplicate(d.trackKind, span(r.item));
    return;
  }

  if (!changed) return;
  if (r.valid) {
    p.onItemChange(d.trackKind, span(r.item));
    return;
  }
  if (e.shiftKey && track && p.onItemsChange) {
    const trims = resolveOverlapByTrimming(r.item, track.items);
    if (!trims) return;
    p.onItemsChange([
      { kind: d.trackKind, span: span(r.item) },
      ...trims.map((n) => ({ kind: track.kind, span: span(n) })),
    ]);
  }
}

/** Filmstrip + mini waveform inside a video clip item, limited to its visible part. */
function ClipMedia({
  media,
  startMs,
  endMs,
  sourceStartMs,
  pxPerMs,
  visibleStartMs,
  visibleEndMs,
}: {
  media: TimelineMedia;
  startMs: number;
  endMs: number;
  sourceStartMs: number;
  pxPerMs: number;
  visibleStartMs: number;
  visibleEndMs: number;
}): ReactElement {
  const placement = {
    itemStartMs: startMs,
    itemEndMs: endMs,
    sourceStartMs,
    pxPerMs,
    visibleStartMs,
    visibleEndMs,
  };
  const aspect = media.aspect !== undefined && media.aspect > 0 ? media.aspect : 16 / 9;
  const tiles = visibleFilmstrip(media.thumbs, placement, ITEM_HEIGHT_PX * aspect);
  const bars = visibleWaveform(media.peaks, media.sourceDurationMs, placement, WAVEFORM_BAR_PX);
  const path = bars
    .map((b) => {
      const h = Math.max(0.5, b.peak * WAVEFORM_HEIGHT_PX);
      return `M${b.leftPx} ${WAVEFORM_HEIGHT_PX}v${-h}h${WAVEFORM_BAR_PX - 0.5}v${h}z`;
    })
    .join("");
  return (
    <div
      aria-hidden="true"
      data-testid="clip-media"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      {tiles.map((t) => (
        <img
          key={`${t.leftPx}`}
          src={t.url}
          alt=""
          draggable={false}
          data-testid="filmstrip-thumb"
          style={{
            position: "absolute",
            top: 0,
            left: `${t.leftPx}px`,
            width: `${t.widthPx}px`,
            height: "100%",
            objectFit: "cover",
            objectPosition: "left center",
            opacity: 0.55,
          }}
        />
      ))}
      {bars.length > 0 && (
        <svg
          data-testid="clip-waveform"
          width="100%"
          height={WAVEFORM_HEIGHT_PX}
          style={{ position: "absolute", left: 0, bottom: 0, color: "var(--text-1)", opacity: 0.6 }}
        >
          <title>Audio waveform</title>
          <path d={path} fill="currentColor" />
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const rootStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
  background: "var(--bg-panel)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  userSelect: "none",
  outline: "none",
};

const topRowStyle: CSSProperties = {
  display: "flex",
  flex: "0 0 auto",
  height: `${RULER_HEIGHT_PX}px`,
  borderBottom: "1px solid var(--border)",
};

const cornerStyle: CSSProperties = {
  width: `${HEADER_WIDTH_PX}px`,
  flex: "0 0 auto",
  borderRight: "1px solid var(--border)",
  background: "var(--bg-panel)",
};

const rulerStyle: CSSProperties = {
  position: "relative",
  flex: "1 1 auto",
  overflow: "hidden",
  background: "var(--bg-panel)",
  cursor: "col-resize",
};

const bodyStyle: CSSProperties = {
  display: "flex",
  flex: "1 1 auto",
  minHeight: 0,
  overflowX: "hidden",
  overflowY: "auto",
};

const headerColStyle: CSSProperties = {
  width: `${HEADER_WIDTH_PX}px`,
  flex: "0 0 auto",
  borderRight: "1px solid var(--border)",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  height: `${LANE_HEIGHT_PX}px`,
  padding: "0 var(--space-2) 0 var(--space-3)",
  boxSizing: "border-box",
  borderBottom: "1px solid var(--border)",
  fontSize: "12px",
  color: "var(--text-2)",
};

const addButtonStyle: CSSProperties = {
  appearance: "none",
  marginLeft: "auto",
  width: "24px",
  height: "24px",
  padding: 0,
  borderRadius: "var(--radius-sm)",
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--text-2)",
  fontFamily: "var(--font-body)",
  fontSize: "16px",
  lineHeight: 1,
  cursor: "pointer",
};

const lanesColStyle: CSSProperties = {
  position: "relative",
  flex: "1 1 auto",
  minWidth: 0,
};

const laneStyle: CSSProperties = {
  position: "relative",
  height: `${LANE_HEIGHT_PX}px`,
  boxSizing: "border-box",
  overflow: "hidden",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-sunken)",
};

const itemLabelStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
  padding: "0 var(--space-1)",
  fontSize: "12px",
  color: "var(--text-1)",
  pointerEvents: "none",
  position: "relative",
  zIndex: 1,
};

function handleStyle(edge: "start" | "end"): CSSProperties {
  return {
    position: "absolute",
    zIndex: 2,
    top: 0,
    bottom: 0,
    ...(edge === "start" ? { left: 0 } : { right: 0 }),
    width: `${EDGE_GRAB_PX}px`,
    cursor: "ew-resize",
  };
}

function itemStyle(
  kind: TrackKind,
  leftPx: number,
  widthPx: number,
  selected: boolean,
  ghost: boolean,
  invalid: boolean,
): CSSProperties {
  const hue = TRACK_COLORS[kind];
  const edge = invalid ? INVALID_COLOR : selected ? "var(--accent)" : hue;
  const edgeWidth = invalid || selected ? "2px" : "1px";
  const lineStyle = ghost ? "dashed" : "solid";
  return {
    position: "absolute",
    top: "4px",
    height: `${LANE_HEIGHT_PX - 9}px`,
    left: `${leftPx}px`,
    width: `${Math.max(2, widthPx)}px`,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    borderRadius: "6px",
    background: itemFill(hue),
    borderTop: `${edgeWidth} ${lineStyle} ${edge}`,
    borderRight: `${edgeWidth} ${lineStyle} ${edge}`,
    borderBottom: `${edgeWidth} ${lineStyle} ${edge}`,
    borderLeft: `3px ${lineStyle} ${hue}`,
    boxShadow: selected ? "0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent)" : "none",
    opacity: ghost ? 0.5 : 1,
    cursor: "grab",
    overflow: "hidden",
    touchAction: "none",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Timeline(props: TimelineProps): ReactElement {
  const { durationMs, currentMs, fps, tracks, selectedIds, onAddAtPlayhead } = props;

  const rootRef = useRef<HTMLElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);

  const [viewportPx, setViewportPx] = useState(0);
  const [internalPxPerMs, setInternalPxPerMs] = useState<number | null>(null);
  const [scrollMs, setScrollMs] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  const drag = useRef<DragState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const scrubbing = useRef(false);

  const scale: TimeScale = clampScale(
    {
      pxPerMs: props.pxPerMs ?? internalPxPerMs ?? fitScale(durationMs, viewportPx).pxPerMs,
      scrollMs,
    },
    durationMs,
    viewportPx,
  );

  const applyScale = (next: TimeScale): void => {
    const clamped = clampScale(next, durationMs, viewportPx);
    if (props.pxPerMs === undefined) setInternalPxPerMs(clamped.pxPerMs);
    if (clamped.pxPerMs !== scale.pxPerMs) props.onScaleChange?.(clamped.pxPerMs);
    setScrollMs(clamped.scrollMs);
  };

  // Latest render values for window-level listeners.
  const latest = useRef({ props, scale, applyScale });
  useLayoutEffect(() => {
    latest.current = { props, scale, applyScale };
  });

  // Measure the lanes viewport (ruler shares its width and left edge).
  useLayoutEffect(() => {
    const el = rulerRef.current;
    if (!el) return;
    const measure = (): void => setViewportPx(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Page-flip auto-scroll while playing.
  const visibleMs = scale.pxPerMs > 0 ? viewportPx / scale.pxPerMs : 0;
  useEffect(() => {
    if (!props.isPlaying || visibleMs <= 0) return;
    if (currentMs < scale.scrollMs || currentMs >= scale.scrollMs + visibleMs)
      setScrollMs(currentMs);
  }, [props.isPlaying, currentMs, scale.scrollMs, visibleMs]);

  // ⌘/Ctrl + wheel zooms around the cursor; shift + wheel (or horizontal wheel) pans.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent): void => {
      const { scale: s, applyScale: apply } = latest.current;
      const rect = rulerRef.current?.getBoundingClientRect();
      if (!rect || !(s.pxPerMs > 0)) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const anchor = clamp(e.clientX - rect.left, 0, rect.width);
        apply(zoomAround(s, anchor, Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY)));
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const d = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
        apply({ pxPerMs: s.pxPerMs, scrollMs: s.scrollMs + d / s.pxPerMs });
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, []);

  // Window-level pointer engine: drags, ruler scrubbing, marquee.
  useEffect(() => {
    const seekAt = (clientX: number): void => {
      const { props: p, scale: s } = latest.current;
      const rect = rulerRef.current?.getBoundingClientRect();
      if (!rect) return;
      p.onSeek(clamp(pxToMs(clientX - rect.left, s), 0, Math.max(0, p.durationMs)));
    };

    const laneAt = (clientY: number): number => {
      const rect = lanesRef.current?.getBoundingClientRect();
      const count = latest.current.props.tracks.length;
      if (!rect || count === 0) return 0;
      return clamp(Math.floor((clientY - rect.top) / LANE_HEIGHT_PX), 0, count - 1);
    };

    const onMove = (e: PointerEvent): void => {
      const { props: p, scale: s } = latest.current;
      if (scrubbing.current) {
        seekAt(e.clientX);
        return;
      }
      const d = drag.current;
      if (d) {
        const dx = e.clientX - d.startX;
        if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        if (!(s.pxPerMs > 0)) return;
        d.moved = true;
        const track = p.tracks.find((t) => t.kind === d.trackKind);
        const ctx: OpContext = {
          durationMs: p.durationMs,
          allowOverlap: track?.allowOverlap ?? true,
          siblings: track?.items ?? [],
          snap: {
            targets: d.targets,
            pxPerMs: s.pxPerMs,
            enabled: p.snapEnabled,
            bypass: e.altKey,
          },
        };
        const op =
          d.mode === "move" ? moveItem : d.mode === "start" ? resizeItemStart : resizeItemEnd;
        const r = op(d.origin, dx / s.pxPerMs, ctx);
        d.last = r;
        if (d.group.length > 0) {
          // The grabbed item snaps; the rest follow, clamped so all stay on the timeline.
          const members = [d.origin, ...d.group.map((g) => g.item)];
          const lo = -Math.min(...members.map((i) => i.startMs));
          const hi = p.durationMs - Math.max(...members.map((i) => i.endMs));
          const raw = r.item.startMs - d.origin.startMs;
          const delta = Math.min(Math.max(raw, lo), Math.max(lo, hi));
          const g = groupPreview({ kind: d.trackKind, item: d.origin }, d.group, delta, p.tracks);
          d.lastDelta = delta;
          d.lastGroupValid = g.valid;
          setPreview({ spans: g.spans, snappedTo: delta === raw ? r.snappedTo : null });
          return;
        }
        let valid = r.valid;
        if (d.mode === "move" && e.altKey && p.onItemDuplicate) {
          // A copy may not land on the original either.
          d.lastDuplicateValid = (track?.allowOverlap ?? true) || !overlaps(ctx.siblings, r.item);
          valid = d.lastDuplicateValid;
        }
        setPreview({
          spans: new Map([[d.origin.id, { startMs: r.item.startMs, endMs: r.item.endMs, valid }]]),
          snappedTo: r.snappedTo,
        });
        return;
      }
      const m = marqueeRef.current;
      if (m) {
        const rect = lanesRef.current?.getBoundingClientRect();
        if (!rect) return;
        const curX = e.clientX - rect.left;
        const next: MarqueeState = {
          ...m,
          curX,
          curLane: laneAt(e.clientY),
          moved: m.moved || Math.abs(curX - m.startX) >= DRAG_THRESHOLD_PX,
        };
        marqueeRef.current = next;
        if (next.moved) setMarquee(next);
      }
    };

    const onUp = (e: PointerEvent): void => {
      const { props: p, scale: s } = latest.current;
      if (scrubbing.current) {
        scrubbing.current = false;
        return;
      }
      const d = drag.current;
      if (d) {
        drag.current = null;
        setPreview(null);
        const track = p.tracks.find((t) => t.kind === d.trackKind);
        if (d.moved) {
          commitDrag(d, e, p, track);
        } else if (track) {
          const ordered = [...track.items].sort((a, b) => a.startMs - b.startMs).map((i) => i.id);
          p.onSelect(
            applySelection(
              p.selectedIds,
              d.origin.id,
              { shift: d.shift || e.shiftKey, toggle: d.toggle || e.metaKey || e.ctrlKey },
              ordered,
            ),
          );
        }
        return;
      }
      const m = marqueeRef.current;
      if (m) {
        marqueeRef.current = null;
        setMarquee(null);
        if (!m.moved) {
          p.onSelect(clearSelection());
          seekAt(e.clientX);
          return;
        }
        const aMs = pxToMs(m.startX, s);
        const bMs = pxToMs(m.curX, s);
        const lo = Math.min(m.startLane, m.curLane);
        const hi = Math.max(m.startLane, m.curLane);
        const ids = new Set<string>(m.additive ? p.selectedIds : []);
        for (const t of p.tracks.slice(lo, hi + 1)) {
          for (const id of selectInRange(t.items, aMs, bMs)) ids.add(id);
        }
        p.onSelect(ids);
      }
    };

    const onCancel = (): void => {
      scrubbing.current = false;
      drag.current = null;
      marqueeRef.current = null;
      setPreview(null);
      setMarquee(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  const onRulerPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubbing.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    props.onSeek(clamp(pxToMs(e.clientX - rect.left, scale), 0, Math.max(0, durationMs)));
  };

  const onItemPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    track: TimelineTrack,
    item: TimelineItem,
  ): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const handle = e.target instanceof HTMLElement ? e.target.dataset.handle : undefined;
    const mode: DragMode = handle === "start" ? "start" : handle === "end" ? "end" : "move";
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // Grabbing one of several selected items moves the whole selection (clips stay put).
    const group: GroupMember[] =
      mode === "move" && track.kind !== "video" && selectedIds.has(item.id) && selectedIds.size > 1
        ? tracks.flatMap((t) =>
            t.kind === "video"
              ? []
              : t.items
                  .filter((i) => i.id !== item.id && selectedIds.has(i.id))
                  .map((i) => ({ kind: t.kind, item: i })),
          )
        : [];
    const moving = new Set([item.id, ...group.map((g) => g.item.id)]);
    drag.current = {
      trackKind: track.kind,
      origin: item,
      mode,
      startX: e.clientX,
      moved: false,
      shift: e.shiftKey,
      toggle: e.metaKey || e.ctrlKey,
      targets: collectSnapTargets({
        playheadMs: currentMs,
        items: tracks.flatMap((t) => t.items),
        excludeIds: moving,
        pxPerMs: scale.pxPerMs,
        durationMs,
        wordBoundaries:
          track.kind === "captions"
            ? track.items.flatMap((i) =>
                // Moving words travel with their caption; a resize snaps to its own words.
                mode === "move" && moving.has(i.id) ? [] : (i.wordBoundaries ?? []),
              )
            : undefined,
      }),
      group,
      last: null,
      lastDelta: 0,
      lastGroupValid: true,
      lastDuplicateValid: false,
    };
  };

  const onLanesPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const count = tracks.length;
    const lane =
      count === 0 ? 0 : clamp(Math.floor((e.clientY - rect.top) / LANE_HEIGHT_PX), 0, count - 1);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    marqueeRef.current = {
      startX: e.clientX - rect.left,
      startLane: lane,
      curX: e.clientX - rect.left,
      curLane: lane,
      moved: false,
      additive: e.shiftKey || e.metaKey || e.ctrlKey,
    };
  };

  const onItemKeyDown = (
    e: ReactKeyboardEvent<HTMLDivElement>,
    track: TimelineTrack,
    item: TimelineItem,
  ): void => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const ordered = [...track.items].sort((a, b) => a.startMs - b.startMs).map((i) => i.id);
    props.onSelect(
      applySelection(
        selectedIds,
        item.id,
        { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey },
        ordered,
      ),
    );
  };

  const onRootKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.key === "Escape") props.onSelect(clearSelection());
  };

  const ready = scale.pxPerMs > 0;
  const ticks = ready ? rulerTicks(scale, viewportPx, fps) : [];
  const overscanMs = ready ? OVERSCAN_PX / scale.pxPerMs : 0;
  const visStart = scale.scrollMs - overscanMs;
  const visEnd = scale.scrollMs + visibleMs + overscanMs;
  const playheadPx = msToPx(currentMs, scale);
  const playheadVisible = ready && playheadPx >= 0 && playheadPx <= viewportPx;

  return (
    <section
      ref={rootRef}
      style={rootStyle}
      aria-label="Timeline"
      // Focusable so a click inside puts focus in the `timeline` shortcut scope (§6.9).
      tabIndex={-1}
      {...shortcutScopeProps("timeline")}
      onKeyDown={onRootKeyDown}
    >
      <div style={topRowStyle}>
        <div style={cornerStyle} />
        <div
          ref={rulerRef}
          style={rulerStyle}
          data-testid="timeline-ruler"
          onPointerDown={onRulerPointerDown}
        >
          {ticks.map((t) => (
            <div
              key={`${t.major ? "M" : "m"}${t.ms}`}
              style={{
                position: "absolute",
                left: `${t.px}px`,
                bottom: 0,
                width: "1px",
                height: t.major ? "10px" : "4px",
                background: t.major ? "var(--text-3)" : "var(--border-strong)",
                pointerEvents: "none",
              }}
            >
              {t.label !== null && (
                <span
                  style={{
                    position: "absolute",
                    left: "var(--space-1)",
                    bottom: "8px",
                    fontSize: "11px",
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--text-2)",
                  }}
                >
                  {t.label}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={bodyStyle}>
        <div style={headerColStyle}>
          {tracks.map((track) => (
            <div key={track.kind} style={headerRowStyle}>
              <span
                aria-hidden="true"
                style={{
                  width: "3px",
                  height: "14px",
                  borderRadius: "2px",
                  background: TRACK_COLORS[track.kind],
                  flex: "0 0 auto",
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {track.label}
              </span>
              {onAddAtPlayhead && (
                <button
                  type="button"
                  style={addButtonStyle}
                  aria-label={`Add ${track.label} at playhead`}
                  title={`Add ${track.label} at playhead`}
                  onClick={() => onAddAtPlayhead(track.kind)}
                >
                  +
                </button>
              )}
            </div>
          ))}
        </div>

        <div
          ref={lanesRef}
          style={lanesColStyle}
          data-testid="timeline-lanes"
          onPointerDown={onLanesPointerDown}
        >
          {tracks.map((track) => (
            <div
              key={track.kind}
              style={laneStyle}
              role="group"
              aria-label={`${track.label} track`}
              data-track-kind={track.kind}
            >
              {ready &&
                track.items.map((item) => {
                  const live = preview?.spans.get(item.id) ?? null;
                  const startMs = live ? live.startMs : item.startMs;
                  const endMs = live ? live.endMs : item.endMs;
                  if (!live && !(item.startMs < visEnd && item.endMs > visStart)) return null;
                  const selected = selectedIds.has(item.id);
                  const invalid = live !== null && !live.valid;
                  const ghost = item.ghost === true;
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      aria-invalid={invalid || undefined}
                      aria-label={`${ITEM_NOUNS[track.kind]} ${item.label} ${formatClock(startMs)}–${formatClock(endMs)}`}
                      data-ghost={ghost || undefined}
                      style={itemStyle(
                        track.kind,
                        msToPx(startMs, scale),
                        (endMs - startMs) * scale.pxPerMs,
                        selected,
                        ghost,
                        invalid,
                      )}
                      onPointerDown={(e) => onItemPointerDown(e, track, item)}
                      onKeyDown={(e) => onItemKeyDown(e, track, item)}
                    >
                      {track.media && item.sourceStartMs !== undefined && (
                        <ClipMedia
                          media={track.media}
                          startMs={startMs}
                          endMs={endMs}
                          sourceStartMs={item.sourceStartMs}
                          pxPerMs={scale.pxPerMs}
                          visibleStartMs={visStart}
                          visibleEndMs={visEnd}
                        />
                      )}
                      <div data-handle="start" aria-hidden="true" style={handleStyle("start")} />
                      <span style={itemLabelStyle}>{item.label}</span>
                      <div data-handle="end" aria-hidden="true" style={handleStyle("end")} />
                    </div>
                  );
                })}
            </div>
          ))}

          {preview && preview.snappedTo !== null && (
            <div
              data-testid="timeline-snap-guide"
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${msToPx(preview.snappedTo, scale)}px`,
                width: "1px",
                background: "var(--accent)",
                opacity: 0.6,
                pointerEvents: "none",
              }}
            />
          )}

          {marquee && (
            <div
              data-testid="timeline-marquee"
              aria-hidden="true"
              style={{
                position: "absolute",
                left: `${Math.min(marquee.startX, marquee.curX)}px`,
                width: `${Math.abs(marquee.curX - marquee.startX)}px`,
                top: `${Math.min(marquee.startLane, marquee.curLane) * LANE_HEIGHT_PX}px`,
                height: `${(Math.abs(marquee.curLane - marquee.startLane) + 1) * LANE_HEIGHT_PX}px`,
                boxSizing: "border-box",
                border: "1px solid var(--accent)",
                background: "color-mix(in srgb, var(--accent) 12%, transparent)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </div>

      <div
        data-testid="timeline-playhead"
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${HEADER_WIDTH_PX + playheadPx}px`,
          width: "1px",
          background: "var(--accent)",
          pointerEvents: "none",
          visibility: playheadVisible ? "visible" : "hidden",
          zIndex: 2,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "-5px",
            width: "10px",
            height: "10px",
            background: "var(--accent)",
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
          }}
        />
      </div>
    </section>
  );
}
