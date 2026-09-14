import { useEffect } from "react";
import type { CountdownProps } from "./types";

/**
 * Centered pre-record countdown. Shows a large number with a pulsing ring
 * and an Esc-to-cancel hint. Escape calls onCancel.
 */
export function Countdown({ count, onCancel }: CountdownProps) {
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
      aria-label="Recording countdown"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-4)",
        background: "var(--scrim)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        data-testid="countdown-ring"
        style={{
          position: "relative",
          width: 200,
          height: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          border: "4px solid var(--accent)",
          // Glass disc (guide §2.4) so the numeral reads in both themes.
          background: "color-mix(in srgb, var(--bg-panel) 70%, transparent)",
          backdropFilter: "blur(24px)",
          boxShadow: "0 0 0 8px var(--accent-soft), var(--shadow-lg)",
          animation: "reelform-countdown-pulse 1s ease-out infinite",
        }}
      >
        <span
          data-testid="countdown-number"
          aria-live="assertive"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 96,
            fontWeight: 700,
            lineHeight: 1,
            color: "var(--text-1)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </div>

      <p
        data-testid="countdown-hint"
        style={{
          margin: 0,
          padding: "var(--space-1) var(--space-3)",
          borderRadius: "var(--radius-full)",
          background: "color-mix(in srgb, var(--bg-panel) 70%, transparent)",
          backdropFilter: "blur(24px)",
          color: "var(--text-2)",
          fontSize: 14,
        }}
      >
        Press Esc to cancel
      </p>

      {/* Keyframes for the pulse; scoped by a unique animation name. */}
      <style>
        {`@keyframes reelform-countdown-pulse {
            0% { transform: scale(1); opacity: 1; }
            70% { transform: scale(1.08); opacity: 0.85; }
            100% { transform: scale(1); opacity: 1; }
          }`}
      </style>
    </div>
  );
}
