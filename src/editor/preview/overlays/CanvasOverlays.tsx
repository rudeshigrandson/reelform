import { Button } from "@design/components";
import { useRef, useState } from "react";
import type { CSSProperties, ReactElement, PointerEvent as ReactPointerEvent } from "react";
import type { Annotation } from "../../inspector/annotations/types";
import type { Anchor } from "../../inspector/controls";
import { bubbleRect } from "../../inspector/webcam/logic";
import type { WebcamSettings } from "../../inspector/webcam/types";
import type { ZoomRegion } from "../../inspector/zoom/types";
import type { CameraTransform } from "../camera";
import type { RectPx } from "../layers/geometry";
import type { FrameLayout } from "../layout";
import { canvasToFrameNorm, frameNormScale, frameNormToCanvas } from "./coords";
import { FULL_CROP, type NormRect, moveCrop, normalizeCrop, resizeCrop } from "./cropMath";
import {
  type GizmoBox,
  HANDLES,
  type HandleId,
  moveBox,
  resizeBox,
  rotationFromPointer,
} from "./gizmoMath";
import {
  WEBCAM_SNAP_PX,
  type WebcamDropResult,
  webcamDropPosition,
  webcamGrid,
} from "./webcamDrag";

/**
 * Canvas interaction overlays (guide S12 B, states 3 / 8 / 9 / 10): zoom focus
 * reticle, annotation TransformGizmo, crop mode and webcam bubble drag. DOM
 * over the Pixi canvas in the same CSS-px space as `FrameLayout`. Every edit
 * is reported through callbacks (`commit` = pointer released); the host
 * writes the store.
 */

export interface AnnotationBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

export interface WebcamPosition {
  anchor: Anchor | null;
  customX: number;
  customY: number;
}

export interface CanvasOverlaysProps {
  layout: FrameLayout;
  camera: CameraTransform;
  zoomRegion?: ZoomRegion | null | undefined;
  onZoomFocusChange?: ((focus: { x: number; y: number }, commit: boolean) => void) | undefined;
  annotation?: Annotation | null | undefined;
  onAnnotationBoxChange?: ((box: AnnotationBox, commit: boolean) => void) | undefined;
  webcam?: { settings: WebcamSettings; rect: RectPx } | null | undefined;
  onWebcamMove?: ((pos: WebcamPosition, commit: boolean) => void) | undefined;
  /** Crop mode: `layout` must be the uncropped layout. */
  crop?:
    | {
        value: NormRect | null;
        onDone: (crop: NormRect | null) => void;
        onCancel?: (() => void) | undefined;
      }
    | null
    | undefined;
}

// ── styles (semantic tokens only) ───────────────────────────────────────────

const rootStyle: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none" };
const HANDLE = 10;
const handleStyle = (left: string, top: string, cursor: string): CSSProperties => ({
  position: "absolute",
  left,
  top,
  width: HANDLE,
  height: HANDLE,
  marginLeft: -HANDLE / 2,
  marginTop: -HANDLE / 2,
  background: "var(--bg-panel)",
  border: "1.5px solid var(--accent)",
  borderRadius: "var(--radius-xs)",
  cursor,
  pointerEvents: "auto",
  touchAction: "none",
});
const HANDLE_POS: Record<HandleId, [string, string, string]> = {
  nw: ["0%", "0%", "nwse-resize"],
  n: ["50%", "0%", "ns-resize"],
  ne: ["100%", "0%", "nesw-resize"],
  e: ["100%", "50%", "ew-resize"],
  se: ["100%", "100%", "nwse-resize"],
  s: ["50%", "100%", "ns-resize"],
  sw: ["0%", "100%", "nesw-resize"],
  w: ["0%", "50%", "ew-resize"],
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// ── pointer drag helper ─────────────────────────────────────────────────────

interface DragState<T> {
  start: T;
  x: number;
  y: number;
}

type DragMove<T> = (start: T, dx: number, dy: number, e: ReactPointerEvent<Element>) => void;

function useDrag<T>(onMove: DragMove<T>, onEnd: (e: ReactPointerEvent<Element>) => void) {
  const ref = useRef<DragState<T> | null>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  return {
    dragging: (): boolean => ref.current !== null,
    handlers: (start: () => T) => ({
      onPointerDown: (e: ReactPointerEvent<Element>) => {
        e.stopPropagation();
        e.preventDefault();
        const el = e.currentTarget as Element & { setPointerCapture?: (id: number) => void };
        if (typeof e.pointerId === "number") el.setPointerCapture?.(e.pointerId);
        ref.current = { start: start(), x: e.clientX, y: e.clientY };
      },
      onPointerMove: (e: ReactPointerEvent<Element>) => {
        const d = ref.current;
        if (!d) return;
        moveRef.current(d.start, e.clientX - d.x, e.clientY - d.y, e);
      },
      onPointerUp: (e: ReactPointerEvent<Element>) => {
        if (!ref.current) return;
        ref.current = null;
        endRef.current(e);
      },
      onPointerCancel: (e: ReactPointerEvent<Element>) => {
        if (!ref.current) return;
        ref.current = null;
        endRef.current(e);
      },
    }),
  };
}

// ── zoom focus reticle (state 3) ────────────────────────────────────────────

/** Visible rect of a zoom region in un-zoomed canvas px (focus clamped like the camera). */
export function reticleRect(
  layout: FrameLayout,
  level: number,
  focus: { x: number; y: number },
): RectPx {
  const cw = layout.content.width;
  const ch = layout.content.height;
  const z = Math.max(1, Number.isFinite(level) ? level : 1);
  const w = cw / z;
  const h = ch / z;
  const cx = clamp(focus.x * cw, w / 2, cw - w / 2);
  const cy = clamp(focus.y * ch, h / 2, ch - h / 2);
  return {
    x: layout.content.x + cx - w / 2,
    y: layout.content.y + cy - h / 2,
    width: w,
    height: h,
  };
}

function ZoomReticle({
  layout,
  region,
  onChange,
}: {
  layout: FrameLayout;
  region: ZoomRegion;
  onChange: (f: { x: number; y: number }, commit: boolean) => void;
}): ReactElement {
  const r = reticleRect(layout, region.level, region.focus);
  const last = useRef<{ x: number; y: number } | null>(null);
  const drag = useDrag<{ x: number; y: number }>(
    (start, dx, dy) => {
      const cw = layout.content.width || 1;
      const ch = layout.content.height || 1;
      const next = { x: clamp(start.x + dx / cw, 0, 1), y: clamp(start.y + dy / ch, 0, 1) };
      last.current = next;
      onChange(next, false);
    },
    () => {
      if (last.current) onChange(last.current, true);
      last.current = null;
    },
  );
  const cw = layout.content.width || 1;
  const ch = layout.content.height || 1;
  const style: CSSProperties = {
    position: "absolute",
    left: r.x,
    top: r.y,
    width: r.width,
    height: r.height,
    border: "1.5px solid var(--accent)",
    borderRadius: "var(--radius-sm)",
    background: "var(--accent-soft)",
    cursor: "move",
    pointerEvents: "auto",
    touchAction: "none",
  };
  const line = (v: boolean): CSSProperties => ({
    position: "absolute",
    background: "var(--accent)",
    ...(v
      ? { left: "50%", top: "35%", bottom: "35%", width: 1 }
      : { top: "50%", left: "35%", right: "35%", height: 1 }),
  });
  return (
    <div
      data-testid="zoom-reticle"
      role="slider"
      aria-label="Zoom focus"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(region.focus.x * 100)}
      aria-valuetext={`${Math.round(region.focus.x * 100)}%, ${Math.round(region.focus.y * 100)}%`}
      tabIndex={-1}
      style={style}
      {...drag.handlers(() => ({
        x: (r.x - layout.content.x + r.width / 2) / cw,
        y: (r.y - layout.content.y + r.height / 2) / ch,
      }))}
    >
      <div style={line(true)} />
      <div style={line(false)} />
    </div>
  );
}

// ── annotation transform gizmo (state 8) ────────────────────────────────────

type GizmoMode = { kind: "move" } | { kind: "resize"; handle: HandleId } | { kind: "rotate" };

function AnnotationGizmo({
  layout,
  camera,
  annotation,
  onChange,
}: {
  layout: FrameLayout;
  camera: CameraTransform;
  annotation: Annotation;
  onChange: (b: AnnotationBox, commit: boolean) => void;
}): ReactElement {
  const follow = annotation.followZoom;
  const tl = frameNormToCanvas({ x: annotation.x, y: annotation.y }, layout, camera, follow);
  const k = frameNormScale(layout, camera, follow);
  const box: GizmoBox = {
    x: tl.x,
    y: tl.y,
    width: annotation.w * k.x,
    height: annotation.h * k.y,
    rotation: annotation.rotation,
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const last = useRef<AnnotationBox | null>(null);

  const toAnnotation = (b: GizmoBox): AnnotationBox => {
    const p = canvasToFrameNorm({ x: b.x, y: b.y }, layout, camera, follow);
    return {
      x: p.x,
      y: p.y,
      w: b.width / (k.x || 1),
      h: b.height / (k.y || 1),
      rotation: b.rotation,
    };
  };

  const drag = useDrag<{ box: GizmoBox; mode: GizmoMode }>(
    ({ box: start, mode }, dx, dy, e) => {
      let next: GizmoBox;
      if (mode.kind === "move") next = moveBox(start, dx, dy);
      else if (mode.kind === "resize")
        next = resizeBox(start, mode.handle, dx, dy, { keepAspect: e.shiftKey, minSize: 6 });
      else {
        const host = rootRef.current?.parentElement?.getBoundingClientRect();
        const p = { x: e.clientX - (host?.left ?? 0), y: e.clientY - (host?.top ?? 0) };
        next = { ...start, rotation: rotationFromPointer(start, p, e.shiftKey) };
      }
      const out = toAnnotation(next);
      last.current = out;
      onChange(out, false);
    },
    () => {
      if (last.current) onChange(last.current, true);
      last.current = null;
    },
  );

  const style: CSSProperties = {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
    transform: `rotate(${box.rotation}deg)`,
    transformOrigin: "50% 50%",
    outline: "1.5px solid var(--accent)",
    cursor: "move",
    pointerEvents: "auto",
    touchAction: "none",
  };
  return (
    <div
      ref={rootRef}
      data-testid="annotation-gizmo"
      style={style}
      {...drag.handlers(() => ({ box, mode: { kind: "move" } }))}
    >
      {HANDLES.map((h) => {
        const [left, top, cursor] = HANDLE_POS[h];
        return (
          <div
            key={h}
            data-testid={`gizmo-handle-${h}`}
            style={handleStyle(left, top, cursor)}
            {...drag.handlers(() => ({ box, mode: { kind: "resize", handle: h } }))}
          />
        );
      })}
      <div
        data-testid="gizmo-rotate"
        style={{ ...handleStyle("50%", "-22px", "grab"), borderRadius: "var(--radius-full)" }}
        {...drag.handlers(() => ({ box, mode: { kind: "rotate" } }))}
      />
    </div>
  );
}

// ── crop mode (state 9) ─────────────────────────────────────────────────────

function CropOverlay({
  layout,
  value,
  onDone,
  onCancel,
}: {
  layout: FrameLayout;
  value: NormRect | null;
  onDone: (c: NormRect | null) => void;
  onCancel?: (() => void) | undefined;
}): ReactElement {
  const [draft, setDraft] = useState<NormRect>(value ?? { ...FULL_CROP });
  const [lock, setLock] = useState(false);
  const aspect = useRef<number | null>(null);
  const cw = layout.content.width || 1;
  const ch = layout.content.height || 1;

  const drag = useDrag<{ rect: NormRect; handle: HandleId | null }>(
    ({ rect, handle }, dx, dy) => {
      setDraft(
        handle === null
          ? moveCrop(rect, dx / cw, dy / ch)
          : resizeCrop(rect, handle, dx / cw, dy / ch, lock ? aspect.current : null),
      );
    },
    () => {},
  );

  const px = {
    left: layout.content.x + draft.x * cw,
    top: layout.content.y + draft.y * ch,
    width: draft.width * cw,
    height: draft.height * ch,
  };
  const rectStyle: CSSProperties = {
    position: "absolute",
    ...px,
    outline: "1.5px solid var(--accent)",
    // Dim everything outside the crop.
    boxShadow: "0 0 0 100vmax color-mix(in srgb, var(--bg-app) 62%, transparent)",
    cursor: "move",
    pointerEvents: "auto",
    touchAction: "none",
  };
  const barStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    bottom: "var(--space-4)",
    transform: "translateX(-50%)",
    display: "flex",
    gap: "var(--space-2)",
    padding: "var(--space-2)",
    background: "var(--bg-panel-raised)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    pointerEvents: "auto",
  };
  return (
    <>
      <div
        data-testid="crop-rect"
        style={rectStyle}
        {...drag.handlers(() => ({ rect: draft, handle: null }))}
      >
        {HANDLES.map((h) => {
          const [left, top, cursor] = HANDLE_POS[h];
          return (
            <div
              key={h}
              data-testid={`crop-handle-${h}`}
              style={handleStyle(left, top, cursor)}
              {...drag.handlers(() => ({ rect: draft, handle: h }))}
            />
          );
        })}
      </div>
      <div style={barStyle} data-testid="crop-toolbar">
        <Button
          variant={lock ? "primary" : "ghost"}
          aria-pressed={lock}
          onClick={() => {
            aspect.current = draft.height > 0 ? draft.width / draft.height : null;
            setLock(!lock);
          }}
        >
          Lock aspect
        </Button>
        <Button variant="ghost" onClick={() => setDraft({ ...FULL_CROP })}>
          Reset
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button variant="primary" onClick={() => onDone(normalizeCrop(draft))}>
          Done
        </Button>
      </div>
    </>
  );
}

// ── webcam bubble drag (state 10) ───────────────────────────────────────────

function WebcamDrag({
  layout,
  settings,
  rect,
  onMove,
}: {
  layout: FrameLayout;
  settings: WebcamSettings;
  rect: RectPx;
  onMove: (p: WebcamPosition, commit: boolean) => void;
}): ReactElement {
  const [result, setResult] = useState<WebcamDropResult | null>(null);
  const frame = { width: layout.frame.width, height: layout.frame.height };
  const margin = settings.marginPx * layout.scale;
  const base = bubbleRect(frame, { ...settings, marginPx: margin });
  const last = useRef<WebcamDropResult | null>(null);
  const drag = useDrag<{ x: number; y: number }>(
    (start, dx, dy) => {
      const r = webcamDropPosition(
        { x: start.x + dx, y: start.y + dy, w: base.w, h: base.h },
        frame,
        margin,
        WEBCAM_SNAP_PX,
      );
      last.current = r;
      setResult(r);
      onMove({ anchor: r.anchor, customX: r.customX, customY: r.customY }, false);
    },
    () => {
      const r = last.current;
      if (r) onMove({ anchor: r.anchor, customX: r.customX, customY: r.customY }, true);
      last.current = null;
      setResult(null);
    },
  );
  const fx = layout.frame.x;
  const fy = layout.frame.y;
  const grid = result ? webcamGrid(frame, base, margin) : null;
  const cell = (x: number, y: number, key: string): ReactElement => (
    <div
      key={key}
      style={{
        position: "absolute",
        left: fx + x,
        top: fy + y,
        width: base.w,
        height: base.h,
        border: "1px dashed var(--border-strong)",
        borderRadius: "var(--radius-md)",
      }}
    />
  );
  return (
    <>
      {grid && (
        <div data-testid="webcam-grid" style={rootStyle}>
          {grid.ys.flatMap((y, r) => grid.xs.map((x, c) => cell(x, y, `${r}-${c}`)))}
          {result?.guides.vertical.map((x) => (
            <div
              key={`v${x}`}
              data-testid="webcam-guide"
              style={{
                position: "absolute",
                left: fx + x,
                top: fy,
                width: 1,
                height: frame.height,
                background: "var(--accent)",
              }}
            />
          ))}
          {result?.guides.horizontal.map((y) => (
            <div
              key={`h${y}`}
              data-testid="webcam-guide"
              style={{
                position: "absolute",
                top: fy + y,
                left: fx,
                height: 1,
                width: frame.width,
                background: "var(--accent)",
              }}
            />
          ))}
        </div>
      )}
      <div
        data-testid="webcam-drag"
        aria-label="Webcam bubble"
        style={{
          position: "absolute",
          left: fx + rect.x,
          top: fy + rect.y,
          width: rect.width,
          height: rect.height,
          borderRadius: "var(--radius-full)",
          outline: result ? "1.5px solid var(--accent)" : "none",
          cursor: "grab",
          pointerEvents: "auto",
          touchAction: "none",
        }}
        {...drag.handlers(() => ({ x: base.x, y: base.y }))}
      />
    </>
  );
}

// ── root ────────────────────────────────────────────────────────────────────

export function CanvasOverlays(props: CanvasOverlaysProps): ReactElement {
  const { layout, camera, zoomRegion, annotation, webcam, crop } = props;
  if (crop) {
    return (
      <div style={rootStyle} data-testid="canvas-overlays">
        <CropOverlay
          layout={layout}
          value={crop.value}
          onDone={crop.onDone}
          onCancel={crop.onCancel}
        />
      </div>
    );
  }
  return (
    <div style={rootStyle} data-testid="canvas-overlays">
      {zoomRegion && props.onZoomFocusChange && (
        <ZoomReticle layout={layout} region={zoomRegion} onChange={props.onZoomFocusChange} />
      )}
      {webcam && props.onWebcamMove && (
        <WebcamDrag
          layout={layout}
          settings={webcam.settings}
          rect={webcam.rect}
          onMove={props.onWebcamMove}
        />
      )}
      {annotation && props.onAnnotationBoxChange && (
        <AnnotationGizmo
          layout={layout}
          camera={camera}
          annotation={annotation}
          onChange={props.onAnnotationBoxChange}
        />
      )}
    </div>
  );
}
