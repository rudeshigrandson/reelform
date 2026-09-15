import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { WebcamBubbleProps } from "./types";

interface Drag {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

/**
 * Draggable circular/rounded webcam preview bubble. Renders a placeholder for
 * the video feed (no real camera) and can be repositioned within its parent
 * via pointer drag; position is clamped to non-negative coordinates.
 */
export function WebcamBubble({ size, shape, initialPosition, children }: WebcamBubbleProps) {
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

  const borderRadius = shape === "circle" ? "50%" : "var(--radius-lg)";

  return (
    <div
      data-testid="webcam-bubble"
      data-shape={shape}
      role="img"
      aria-label="Webcam preview"
      onPointerDown={startDrag}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: size,
        height: size,
        borderRadius,
        overflow: "hidden",
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-sunken)",
        border: "2px solid var(--border-strong)",
        boxShadow: "var(--shadow-lg)",
        userSelect: "none",
      }}
    >
      {children ?? (
        // Camera glyph placeholder when no feed is supplied.
        <span
          data-testid="webcam-glyph"
          aria-hidden="true"
          style={{
            fontSize: Math.max(20, size * 0.28),
            lineHeight: 1,
            opacity: 0.7,
          }}
        >
          📷
        </span>
      )}
    </div>
  );
}
