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
        gap: "var(--space-4, 16px)",
        background: "rgba(10, 10, 12, 0.55)",
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
          border: "4px solid var(--color-accent)",
          boxShadow: "0 0 0 8px rgba(198, 113, 57, 0.18), var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.5))",
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
            color: "var(--color-text, #fff)",
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
          color: "var(--color-neutral-300, #cbcbcb)",
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
