import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../i18n";
import { SNAP_THRESHOLD_PX, snapRect } from "./snap";
import type { Bounds, RegionSelectorProps } from "./types";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_POS: Record<Handle, { left: string; top: string; cursor: string }> = {
  nw: { left: "0%", top: "0%", cursor: "nwse-resize" },
  n: { left: "50%", top: "0%", cursor: "ns-resize" },
  ne: { left: "100%", top: "0%", cursor: "nesw-resize" },
  e: { left: "100%", top: "50%", cursor: "ew-resize" },
  se: { left: "100%", top: "100%", cursor: "nwse-resize" },
  s: { left: "50%", top: "100%", cursor: "ns-resize" },
  sw: { left: "0%", top: "100%", cursor: "nesw-resize" },
  w: { left: "0%", top: "50%", cursor: "ew-resize" },
};

/** Aspect presets above the selection (guide S07); `null` = free ("Custom"). */
export const ASPECT_PRESETS: ReadonlyArray<{ id: string; ratio: number | null }> = [
  { id: "16:9", ratio: 16 / 9 },
  { id: "4:3", ratio: 4 / 3 },
  { id: "1:1", ratio: 1 },
  { id: "9:16", ratio: 9 / 16 },
  { id: "custom", ratio: null },
];

interface Drag {
  kind: "move" | Handle;
  startX: number;
  startY: number;
  origin: Bounds;
}

/** Pointer target around each 10px handle square. */
const HANDLE_HIT = 20;
const HANDLE_SIZE = 10;
const PRESET_ROW_OFFSET = 52;

const dim = "color-mix(in srgb, var(--bg-sunken) 55%, transparent)";
const guideColor = "color-mix(in srgb, var(--accent) 70%, transparent)";

const viewport = () => ({
  width: typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth,
  height: typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerHeight,
});

/** Reshape `b` to `ratio`, keeping its top-left and width unless the result would leave the viewport. */
function applyRatio(b: Bounds, ratio: number, minSize: number): Bounds {
  const vp = viewport();
  let width = b.width;
  let height = width / ratio;
  const maxH = Math.max(minSize, vp.height - b.y);
  if (height > maxH) {
    height = maxH;
    width = height * ratio;
  }
  const maxW = Math.max(minSize, vp.width - b.x);
  if (width > maxW) {
    width = maxW;
    height = width / ratio;
  }
  return { x: b.x, y: b.y, width: Math.round(width), height: Math.round(height) };
}

/**
 * Fullscreen transparent overlay for choosing a screen-capture region (guide
 * S07). The desktop is dimmed around a clear selection with square handles,
 * a centred size readout, aspect presets and accent snap guides. Edges snap to
 * `snapTargets` (window rects on this display) within 8px while dragging.
 */
export function RegionSelector({
  initialBounds,
  onConfirm,
  onCancel,
  minSize = 32,
  hint,
  snapTargets,
}: RegionSelectorProps) {
  const t = useT();
  const [bounds, setBounds] = useState<Bounds>(initialBounds);
  const [aspect, setAspect] = useState<string>("custom");
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<Drag | null>(null);
  const snapRef = useRef(snapTargets);
  snapRef.current = snapTargets;
  const ratio = ASPECT_PRESETS.find((p) => p.id === aspect)?.ratio ?? null;
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const o = drag.origin;

      setBounds(() => {
        const targets = snapRef.current;
        if (drag.kind === "move") {
          const moved = { ...o, x: o.x + dx, y: o.y + dy };
          const snapped = targets?.length ? snapRect(moved, targets, SNAP_THRESHOLD_PX) : moved;
          return { ...snapped, x: Math.max(0, snapped.x), y: Math.max(0, snapped.y) };
        }
        let { x, y, width, height } = o;
        const h = drag.kind;
        if (h.includes("e")) width = o.width + dx;
        if (h.includes("s")) height = o.height + dy;
        if (h.includes("w")) {
          width = o.width - dx;
          x = o.x + dx;
        }
        if (h.includes("n")) {
          height = o.height - dy;
          y = o.y + dy;
        }
        if (targets?.length) {
          ({ x, y, width, height } = snapRect({ x, y, width, height }, targets, SNAP_THRESHOLD_PX, {
            left: h.includes("w"),
            right: h.includes("e"),
            top: h.includes("n"),
            bottom: h.includes("s"),
          }));
        }
        // Clamp to minSize, keeping the anchored edge fixed.
        if (width < minSize) {
          if (h.includes("w")) x -= minSize - width;
          width = minSize;
        }
        if (height < minSize) {
          if (h.includes("n")) y -= minSize - height;
          height = minSize;
        }
        const r = ratioRef.current;
        if (r) {
          const vertical = h === "n" || h === "s";
          if (vertical) {
            width = Math.max(minSize, height * r);
          } else {
            height = Math.max(minSize, width / r);
            if (h.includes("n")) y = o.y + o.height - height;
          }
          if (h.includes("w")) x = o.x + o.width - width;
        }
        x = Math.max(0, x);
        y = Math.max(0, y);
        return { x, y, width, height };
      });
    },
    [minSize],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

  const startDrag = useCallback(
    (kind: Drag["kind"]) => (e: ReactPointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        origin: bounds,
      };
      setDragging(true);
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
    },
    [bounds, onPointerMove, endDrag],
  );

  useEffect(() => () => endDrag(), [endDrag]);

  const pickAspect = (id: string) => {
    setAspect(id);
    const r = ASPECT_PRESETS.find((p) => p.id === id)?.ratio;
    if (r) setBounds((b) => applyRatio(b, r, minSize));
  };

  // Strings, not numbers: a pixel size reads "1920 × 1080", never "1,920 × 1,080".
  const readout = t("overlays.region.readout", {
    width: String(Math.round(bounds.width)),
    height: String(Math.round(bounds.height)),
  });

  // Snap guides: edges that sit exactly on a window edge while dragging.
  const guides: { v: number[]; h: number[] } = { v: [], h: [] };
  if (dragging && snapTargets?.length) {
    const left = bounds.x;
    const right = bounds.x + bounds.width;
    const top = bounds.y;
    const bottom = bounds.y + bounds.height;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    for (const edge of [left, right]) {
      if (snapTargets.some((s) => near(edge, s.x) || near(edge, s.x + s.width)))
        guides.v.push(edge);
    }
    for (const edge of [top, bottom]) {
      if (snapTargets.some((s) => near(edge, s.y) || near(edge, s.y + s.height)))
        guides.h.push(edge);
    }
  }

  const presetsInside = bounds.y < PRESET_ROW_OFFSET + 8;

  const chip = (active: boolean): CSSProperties => ({
    padding: "5px 12px",
    margin: 0,
    borderRadius: "var(--radius-full)",
    border: active ? "1px solid var(--accent)" : "1px solid var(--border-strong)",
    background: active ? "var(--accent)" : "color-mix(in srgb, var(--bg-panel) 82%, transparent)",
    color: active ? "var(--on-accent)" : "var(--text-1)",
    font: "inherit",
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
    whiteSpace: "nowrap",
  });

  return (
    <div
      data-testid="region-overlay"
      role="dialog"
      aria-label={t("overlays.region.label")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        overflow: "hidden",
        userSelect: "none",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Selection rectangle; its spread shadow dims everything around it. */}
      <div
        data-testid="region-rect"
        onPointerDown={startDrag("move")}
        style={{
          position: "absolute",
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
          cursor: "move",
          boxShadow: `0 0 0 100vmax ${dim}`,
          outline: "1px solid color-mix(in srgb, var(--text-1) 70%, transparent)",
          background: "transparent",
        }}
      >
        {HANDLES.map((h) => {
          const pos = HANDLE_POS[h];
          return (
            <div
              key={h}
              data-testid={`handle-${h}`}
              aria-label={t("overlays.region.resizeHandle", { handle: h })}
              onPointerDown={startDrag(h)}
              style={{
                position: "absolute",
                left: pos.left,
                top: pos.top,
                width: HANDLE_HIT,
                height: HANDLE_HIT,
                transform: "translate(-50%, -50%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: pos.cursor,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  borderRadius: 2,
                  background: "var(--text-1)",
                  boxShadow: "var(--shadow-sm)",
                }}
              />
            </div>
          );
        })}

        <div
          data-testid="region-readout"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: "var(--radius-full)",
            background: "color-mix(in srgb, var(--bg-sunken) 75%, transparent)",
            backdropFilter: "blur(12px)",
            color: "var(--text-1)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {ratio ? (
            <span aria-hidden="true" data-testid="region-lock">
              🔒
            </span>
          ) : null}
          {readout}
        </div>

        <div
          role="radiogroup"
          aria-label={t("overlays.region.aspect")}
          data-testid="region-presets"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: presetsInside ? 8 : 0,
            top: presetsInside ? 8 : -PRESET_ROW_OFFSET,
            display: "flex",
            gap: 6,
          }}
        >
          {ASPECT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={aspect === p.id}
              onClick={() => pickAspect(p.id)}
              style={chip(aspect === p.id)}
            >
              {p.ratio === null ? t("overlays.region.aspectFree") : p.id}
            </button>
          ))}
        </div>
      </div>

      {guides.v.map((x) => (
        <div
          key={`v${x}`}
          aria-hidden="true"
          data-testid="region-guide"
          style={{
            position: "absolute",
            left: x,
            top: 0,
            bottom: 0,
            width: 1,
            background: guideColor,
            pointerEvents: "none",
          }}
        />
      ))}
      {guides.h.map((y) => (
        <div
          key={`h${y}`}
          aria-hidden="true"
          data-testid="region-guide"
          style={{
            position: "absolute",
            top: y,
            left: 0,
            right: 0,
            height: 1,
            background: guideColor,
            pointerEvents: "none",
          }}
        />
      ))}

      <div
        data-testid="region-hint"
        style={{
          position: "absolute",
          top: "var(--space-6)",
          left: "50%",
          transform: "translateX(-50%)",
          padding: "6px 14px",
          borderRadius: "var(--radius-full)",
          background: "color-mix(in srgb, var(--bg-panel) 75%, transparent)",
          backdropFilter: "blur(24px)",
          border: "1px solid var(--border-strong)",
          color: "var(--text-2)",
          fontSize: 12,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {hint ?? t("overlays.region.hint")}
      </div>

      <div
        data-testid="region-toolbar"
        style={{
          position: "absolute",
          left: "50%",
          bottom: 40,
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: "var(--radius-full)",
          background: "color-mix(in srgb, var(--bg-panel) 75%, transparent)",
          backdropFilter: "blur(24px)",
          border: "1px solid var(--border-strong)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <button
          type="button"
          onClick={() => onConfirm(bounds)}
          style={{
            padding: "9px 20px",
            margin: 0,
            border: "none",
            borderRadius: "var(--radius-full)",
            background: "var(--record)",
            color: "var(--text-1)",
            font: "inherit",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {t("overlays.region.record")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "9px 16px",
            margin: 0,
            border: "none",
            borderRadius: "var(--radius-full)",
            background: "transparent",
            color: "var(--text-2)",
            font: "inherit",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {t("common.cancel")}
        </button>
        <span
          aria-hidden="true"
          style={{
            paddingRight: 6,
            color: "var(--text-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          {t("overlays.region.escKey")}
        </span>
      </div>
    </div>
  );
}
