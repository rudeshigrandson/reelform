import type {
  CSSProperties,
  ReactElement,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  resizeItemEnd,
  resizeItemStart,
  selectInRange,
} from "./trackOps";
import {
  ITEM_NOUNS,
  type TimeSpan,
  type TimelineItem,
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
  onAddAtPlayhead?: ((kind: TrackKind) => void) | undefined;
}

type DragMode = "move" | "start" | "end";

interface DragState {
  trackKind: TrackKind;
  origin: TimelineItem;
  mode: DragMode;
  startX: number;
  moved: boolean;
  shift: boolean;
  toggle: boolean;
  targets: number[];
  last: OpResult<TimelineItem> | null;
}

interface Preview {
  id: string;
  startMs: number;
  endMs: number;
  valid: boolean;
  snappedTo: number | null;
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
  background: "var(--color-neutral-900)",
  color: "var(--color-neutral-100)",
  fontFamily: "var(--font-body)",
  userSelect: "none",
};

const topRowStyle: CSSProperties = {
  display: "flex",
  flex: "0 0 auto",
  height: `${RULER_HEIGHT_PX}px`,
  borderBottom: "1px solid var(--color-neutral-800)",
};

const cornerStyle: CSSProperties = {
  width: `${HEADER_WIDTH_PX}px`,
  flex: "0 0 auto",
  borderRight: "1px solid var(--color-neutral-800)",
  background: "var(--color-neutral-800)",
};

const rulerStyle: CSSProperties = {
  position: "relative",
  flex: "1 1 auto",
  overflow: "hidden",
  background: "var(--color-neutral-800)",
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
  borderRight: "1px solid var(--color-neutral-800)",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  height: `${LANE_HEIGHT_PX}px`,
  padding: "0 var(--space-2) 0 var(--space-3)",
  boxSizing: "border-box",
  borderBottom: "1px solid var(--color-neutral-800)",
  fontSize: "12px",
  color: "var(--color-neutral-300)",
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
  color: "var(--color-neutral-300)",
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
  borderBottom: "1px solid var(--color-neutral-800)",
  background: "color-mix(in srgb, var(--color-neutral-800) 40%, transparent)",
};

const itemLabelStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
  padding: "0 var(--space-1)",
  fontSize: "12px",
  color: "var(--color-neutral-100)",
  pointerEvents: "none",
};

function handleStyle(edge: "start" | "end"): CSSProperties {
  return {
    position: "absolute",
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
  const edge = invalid ? INVALID_COLOR : selected ? "var(--color-accent)" : hue;
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
    boxShadow: selected
      ? "0 0 0 2px color-mix(in srgb, var(--color-accent) 25%, transparent)"
      : "none",
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
        setPreview({
          id: d.origin.id,
          startMs: r.item.startMs,
          endMs: r.item.endMs,
          valid: r.valid,
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
          const r = d.last;
          const changed =
            r !== null && (r.item.startMs !== d.origin.startMs || r.item.endMs !== d.origin.endMs);
          if (r && r.valid && changed) {
            p.onItemChange(d.trackKind, {
              id: r.item.id,
              startMs: r.item.startMs,
              endMs: r.item.endMs,
            });
          }
        } else if (track) {
          const ordered = [...track.items].sort((a, b) => a.startMs - b.startMs).map((i) => i.id);
          p.onSelect(
            applySelection(
              p.selectedIds,
              d.origin.id,
              { shift: d.shift, toggle: d.toggle },
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
        p.tracks.slice(lo, hi + 1).forEach((t) => {
          for (const id of selectInRange(t.items, aMs, bMs)) ids.add(id);
        });
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
        excludeIds: new Set([item.id]),
        pxPerMs: scale.pxPerMs,
        durationMs,
      }),
      last: null,
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
    <section ref={rootRef} style={rootStyle} aria-label="Timeline" onKeyDown={onRootKeyDown}>
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
                background: t.major ? "var(--color-neutral-500)" : "var(--color-neutral-600)",
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
                    color: "var(--color-neutral-400)",
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
            >
              {ready &&
                track.items.map((item) => {
                  const live = preview?.id === item.id ? preview : null;
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
                background: "var(--color-accent)",
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
                border: "1px solid var(--color-accent)",
                background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
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
          background: "var(--color-accent)",
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
            background: "var(--color-accent)",
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
          }}
        />
      </div>
    </section>
  );
}
