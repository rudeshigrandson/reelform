import { useEffect } from "react";
import { useT } from "../i18n";
import { usePrefersReducedMotion } from "./reducedMotion";
import type { CountdownProps } from "./types";

/**
 * Centered pre-record countdown (guide S08): a glass disc with a Caprasimo
 * numeral and an accent progress ring, an Esc-to-cancel hint, and a crimson
 * "Go" pill at zero. Escape calls onCancel. With reduce motion the disc is
 * static and each numeral fades in instead.
 */
export function Countdown({ count, total, onCancel }: CountdownProps) {
  const t = useT();
  const reduceMotion = usePrefersReducedMotion();
  const go = count <= 0;
  const progress =
    total !== undefined && total > 0 ? Math.min(1, Math.max(0, (total - count) / total)) : 1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      data-testid="countdown-overlay"
      role="dialog"
      aria-label={t("overlays.countdown.label")}
      data-go={go ? "true" : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-5)",
        background: `color-mix(in srgb, var(--bg-sunken) ${go ? 20 : 35}%, transparent)`,
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        data-testid="countdown-ring"
        data-motion={reduceMotion ? "reduced" : "full"}
        style={{
          position: "relative",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-full)",
          color: "var(--text-1)",
          fontFamily: "var(--font-heading)",
          fontWeight: "var(--font-heading-weight)",
          lineHeight: 1,
          animation: reduceMotion ? "none" : "reelform-countdown-pulse 1s ease-out infinite",
          ...(go
            ? {
                padding: "14px 26px",
                background: "color-mix(in srgb, var(--record) 90%, transparent)",
                fontSize: 28,
              }
            : {
                width: 120,
                height: 120,
                background: "color-mix(in srgb, var(--bg-panel) 70%, transparent)",
                backdropFilter: "blur(24px)",
                border: "1px solid color-mix(in srgb, var(--text-1) 18%, transparent)",
                fontSize: 54,
              }),
        }}
      >
        <span
          aria-hidden="true"
          data-testid="countdown-progress"
          data-progress={progress.toFixed(3)}
          style={{
            position: "absolute",
            inset: -7,
            display: go ? "none" : undefined,
            borderRadius: "var(--radius-full)",
            background: `conic-gradient(var(--accent) ${progress * 360}deg, color-mix(in srgb, var(--text-1) 14%, transparent) 0deg)`,
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 0)",
          }}
        />
        <span
          key={go ? "go" : count}
          data-testid="countdown-number"
          aria-live="assertive"
          style={{
            position: "relative",
            animation: reduceMotion ? "reelform-countdown-fade 240ms ease-out" : undefined,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {go ? t("overlays.countdown.go") : count}
        </span>
      </div>

      <p
        data-testid="countdown-hint"
        style={{
          margin: 0,
          color: "color-mix(in srgb, var(--text-1) 75%, transparent)",
          fontSize: 11,
          visibility: go ? "hidden" : undefined,
        }}
      >
        {t("overlays.countdown.hint")}
      </p>

      <style>
        {`@keyframes reelform-countdown-pulse {
            0% { transform: scale(1); opacity: 1; }
            70% { transform: scale(1.06); opacity: 0.9; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes reelform-countdown-fade { from { opacity: 0; } to { opacity: 1; } }`}
      </style>
    </div>
  );
}
