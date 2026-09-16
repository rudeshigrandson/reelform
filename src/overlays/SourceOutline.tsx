import { useT } from "../i18n";
import type { Bounds, SourceOutlineProps } from "./types";

/**
 * Source outline (SPEC §5.7, guide S05): a 2px accent outline offset 4px
 * around the selected window source, with a "Recording target" chip in its
 * bottom-left corner. Drawn in a transparent, click-through, content-protected
 * overlay window covering one display. `bounds` is display-local (CSS px).
 */

const CHIP_HEIGHT = 20;
const CHIP_INSET = 10;

export function SourceOutline({ bounds, label }: SourceOutlineProps) {
  const t = useT();
  const b = normalize(bounds);
  const chipFits = b.height >= CHIP_HEIGHT + CHIP_INSET * 2 && b.width >= 80;
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
          outline: "2px solid var(--accent)",
          outlineOffset: 4,
          borderRadius: 12,
        }}
      />
      {chipFits ? (
        <span
          data-testid="source-outline-chip"
          title={label}
          style={{
            position: "absolute",
            left: b.x + 12,
            top: b.y + b.height - CHIP_INSET - CHIP_HEIGHT,
            maxWidth: Math.max(60, b.width - 24),
            height: CHIP_HEIGHT,
            boxSizing: "border-box",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 10px",
            borderRadius: "var(--radius-full)",
            background: "var(--accent)",
            color: "var(--on-accent)",
            fontSize: 10,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          <span style={{ fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {t("overlays.outline.target")}
          </span>
          {label ? (
            <span
              data-testid="source-outline-label"
              style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {label}
            </span>
          ) : null}
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
