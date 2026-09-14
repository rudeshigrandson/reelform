import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@design/components";
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

interface Drag {
  kind: "move" | Handle;
  startX: number;
  startY: number;
  origin: Bounds;
}

const HANDLE_SIZE = 14;

/**
 * Fullscreen transparent overlay for choosing a screen-capture region.
 * A dark scrim with a transparent "hole" = the current selection, resize
 * handles on the edges, a move affordance, and a px readout.
 */
export function RegionSelector({
  initialBounds,
  onConfirm,
  onCancel,
  minSize = 32,
}: RegionSelectorProps) {
  const [bounds, setBounds] = useState<Bounds>(initialBounds);
  const dragRef = useRef<Drag | null>(null);

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
        if (drag.kind === "move") {
          return {
            ...o,
            x: Math.max(0, o.x + dx),
            y: Math.max(0, o.y + dy),
          };
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
        // Clamp to minSize, keeping the anchored edge fixed.
        if (width < minSize) {
          if (h.includes("w")) x -= minSize - width;
          width = minSize;
        }
        if (height < minSize) {
          if (h.includes("n")) y -= minSize - height;
          height = minSize;
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
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", endDrag);
    },
    [bounds, onPointerMove, endDrag],
  );

  useEffect(() => () => endDrag(), [endDrag]);

  const readout = `${Math.round(bounds.width)}×${Math.round(bounds.height)}`;

  return (
    <div
      data-testid="region-overlay"
      role="dialog"
      aria-label="Select capture region"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        // A single translucent scrim; the selection rect punches a bright ring.
        background: "rgba(10, 10, 12, 0.45)",
        userSelect: "none",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Selection rectangle */}
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
          // Cut a hole in the scrim with a big surrounding shadow.
          boxShadow: "0 0 0 100vmax rgba(10, 10, 12, 0.45)",
          outline: "2px solid var(--color-accent)",
          borderRadius: "var(--radius-sm, 4px)",
          background: "transparent",
        }}
      >
        {/* Resize handles */}
        {HANDLES.map((h) => {
          const pos = HANDLE_POS[h];
          return (
            <div
              key={h}
              data-testid={`handle-${h}`}
              aria-label={`Resize ${h}`}
              onPointerDown={startDrag(h)}
              style={{
                position: "absolute",
                left: pos.left,
                top: pos.top,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                transform: "translate(-50%, -50%)",
                background: "var(--color-accent)",
                border: "2px solid var(--color-surface, #fff)",
                borderRadius: "50%",
                cursor: pos.cursor,
                boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.4))",
              }}
            />
          );
        })}
      </div>

      {/* WxH readout, pinned just above/inside the rect */}
      <div
        data-testid="region-readout"
        style={{
          position: "absolute",
          left: bounds.x,
          top: Math.max(0, bounds.y - 28),
          padding: "var(--space-1, 4px) var(--space-2, 8px)",
          background: "rgba(10, 10, 12, 0.85)",
          color: "var(--color-text, #fff)",
          borderRadius: "var(--radius-sm, 4px)",
          fontSize: 12,
          fontVariantNumeric: "tabular-nums",
          pointerEvents: "none",
        }}
      >
        {readout} px
      </div>

      {/* Toolbar */}
      <div
        data-testid="region-toolbar"
        style={{
          position: "absolute",
          left: "50%",
          bottom: "var(--space-6, 24px)",
          transform: "translateX(-50%)",
          display: "flex",
          gap: "var(--space-2, 8px)",
          padding: "var(--space-2, 8px)",
          background: "rgba(20, 20, 24, 0.9)",
          borderRadius: "var(--radius-lg, 12px)",
          boxShadow: "var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.5))",
        }}
      >
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onConfirm(bounds)}>
          Record
        </Button>
      </div>
    </div>
  );
}
