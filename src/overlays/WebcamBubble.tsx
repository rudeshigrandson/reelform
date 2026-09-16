import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../i18n";
import type { WebcamBubbleProps } from "./types";

interface Drag {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

/** Camera outline + caption for bubbles without a feed (guide S09 "No camera"). */
export function CameraPlaceholder({
  label,
  tone = "muted",
}: {
  label: ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "var(--space-2)",
        textAlign: "center",
        fontFamily: "var(--font-body)",
        fontSize: 10,
        color:
          tone === "danger"
            ? "color-mix(in srgb, var(--record) 35%, var(--text-1))"
            : "var(--text-3)",
      }}
    >
      <span
        data-testid="webcam-glyph"
        aria-hidden="true"
        style={{
          boxSizing: "border-box",
          width: 22,
          height: 16,
          borderRadius: 4,
          border: "2px solid color-mix(in srgb, var(--text-3) 70%, transparent)",
        }}
      />
      {label}
    </span>
  );
}

/**
 * Draggable circle / rounded-square webcam bubble (guide S09). Live feed via
 * `children`; without one (or with `empty`) it draws the dashed "No camera"
 * look. `mirrored` gives the accent rim, `controls` sit on a gradient bar along
 * the bottom edge. Position is clamped to non-negative coordinates.
 */
export function WebcamBubble({
  size,
  shape,
  initialPosition,
  children,
  mirrored = false,
  empty,
  controls,
}: WebcamBubbleProps) {
  const t = useT();
  const [pos, setPos] = useState<{ x: number; y: number }>(initialPosition ?? { x: 0, y: 0 });
  const dragRef = useRef<Drag | null>(null);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const nx = drag.originX + (e.clientX - drag.startX);
    const ny = drag.originY + (e.clientY - drag.startY);
    setPos({ x: Math.max(0, nx), y: Math.max(0, ny) });
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

  const startDrag = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: pos.x,
        originY: pos.y,
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
    },
    [pos.x, pos.y, onPointerMove, endDrag],
  );

  useEffect(() => () => endDrag(), [endDrag]);

  const isEmpty = empty ?? children === undefined;
  const borderRadius = shape === "circle" ? "50%" : "var(--radius-lg)";
  const border = isEmpty
    ? "2px dashed color-mix(in srgb, var(--text-1) 24%, transparent)"
    : mirrored
      ? "3px solid color-mix(in srgb, var(--accent) 70%, transparent)"
      : "3px solid color-mix(in srgb, var(--text-1) 28%, transparent)";

  return (
    <div
      data-testid="webcam-bubble"
      data-shape={shape}
      data-mirrored={mirrored ? "true" : undefined}
      role="img"
      aria-label={t("overlays.webcam.label")}
      onPointerDown={startDrag}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: size,
        height: size,
        boxSizing: "border-box",
        borderRadius,
        overflow: "hidden",
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: isEmpty
          ? "var(--bg-sunken)"
          : "linear-gradient(160deg, color-mix(in srgb, var(--text-3) 45%, var(--bg-panel)), var(--bg-panel))",
        border,
        boxShadow: isEmpty ? undefined : "var(--shadow-lg)",
        userSelect: "none",
      }}
    >
      {children ?? <CameraPlaceholder label={t("overlays.webcam.noCamera")} />}
      {controls ? (
        <div
          data-testid="webcam-bubble-controls"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background:
              "linear-gradient(transparent, color-mix(in srgb, var(--bg-sunken) 70%, transparent))",
            color: "var(--text-1)",
            fontFamily: "var(--font-body)",
            fontSize: 11,
            cursor: "default",
          }}
        >
          {controls}
        </div>
      ) : null}
    </div>
  );
}
