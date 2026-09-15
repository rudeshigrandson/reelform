import type { Bounds, SourceOutlineProps } from "./types";

/**
 * Source outline (SPEC §5.7): a 2px accent outline around the selected window
 * source plus a small label, drawn in a transparent, click-through,
 * content-protected overlay window covering one display. `bounds` is
 * display-local (CSS px of that window).
 */

const LABEL_HEIGHT = 24;

export function SourceOutline({ bounds, label }: SourceOutlineProps) {
  const b = normalize(bounds);
  // The label sits above the outline, or just inside it at the top of the display.
  const labelTop = b.y >= LABEL_HEIGHT + 4 ? b.y - LABEL_HEIGHT - 4 : b.y + 4;
  return (
    <div
      data-testid="source-outline"
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, pointerEvents: "none", fontFamily: "var(--font-body)" }}
    >
      <div
        data-testid="source-outline-rect"
        style={{
          position: "absolute",
          left: b.x,
          top: b.y,
          width: b.width,
          height: b.height,
          boxSizing: "border-box",
          border: "2px solid var(--accent)",
          borderRadius: "var(--radius-sm)",
        }}
      />
      {label ? (
        <span
          data-testid="source-outline-label"
          style={{
            position: "absolute",
            left: b.x + 4,
            top: labelTop,
            maxWidth: Math.max(80, b.width - 8),
            height: LABEL_HEIGHT,
            boxSizing: "border-box",
            display: "inline-flex",
            alignItems: "center",
            padding: "0 var(--space-2)",
            borderRadius: "var(--radius-full)",
            background: "var(--accent)",
            color: "var(--on-accent)",
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

function normalize(b: Bounds): Bounds {
  const fin = (v: number) => (Number.isFinite(v) ? Math.round(v) : 0);
  return {
    x: fin(b.x),
    y: fin(b.y),
    width: Math.max(0, fin(b.width)),
    height: Math.max(0, fin(b.height)),
  };
}
