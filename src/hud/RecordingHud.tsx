import { Button, Dialog, Tag } from "@design/components";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { RecordingHudProps } from "./types";

const METER_BARS = 12;

/** Format a millisecond duration as mm:ss (clamps negatives to 0). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

const pillStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  width: 560,
  height: 64,
  boxSizing: "border-box",
  padding: "0 var(--space-4)",
  // Glass pill (guide §2.4): 88% panel + blur, 1px strong hairline.
  background: "color-mix(in srgb, var(--bg-panel) 88%, transparent)",
  backdropFilter: "blur(24px)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-1)",
  borderRadius: "var(--radius-full)",
  boxShadow: "var(--shadow-lg)",
  fontFamily: "var(--font-body)",
  userSelect: "none",
};

const gripStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  padding: "0 var(--space-1)",
  cursor: "grab",
  color: "var(--text-3)",
};

const gripDotRow: CSSProperties = { display: "flex", gap: 3 };
const gripDot: CSSProperties = {
  width: 3,
  height: 3,
  borderRadius: "50%",
  background: "currentColor",
};

function DragGrip() {
  return (
    <div style={gripStyle} aria-hidden="true" data-testid="hud-grip" title="Drag">
      <div style={gripDotRow}>
        <span style={gripDot} />
        <span style={gripDot} />
      </div>
      <div style={gripDotRow}>
        <span style={gripDot} />
        <span style={gripDot} />
      </div>
      <div style={gripDotRow}>
        <span style={gripDot} />
        <span style={gripDot} />
      </div>
    </div>
  );
}

const stopDotStyle: CSSProperties = {
  display: "inline-block",
  width: 14,
  height: 14,
  borderRadius: 3,
  background: "var(--on-accent)",
};

const stopButtonStyle: CSSProperties = {
  background: "var(--record)",
  borderColor: "var(--record)",
  color: "var(--on-accent)",
};

function MicMeter({ micLevel }: { micLevel: number | undefined }) {
  const muted = micLevel === undefined;
  const clamped = muted ? 0 : Math.max(0, Math.min(1, micLevel));
  const litCount = muted ? 0 : Math.round(clamped * METER_BARS);
  const bars = Array.from({ length: METER_BARS }, (_, i) => i < litCount);

  return (
    <div
      role="meter"
      aria-label={muted ? "Microphone muted" : "Microphone level"}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={muted ? undefined : clamped}
      aria-disabled={muted || undefined}
      data-testid="mic-meter"
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 2,
        height: 22,
        opacity: muted ? 0.35 : 1,
      }}
    >
      {bars.map((lit, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static meter
          key={i}
          data-lit={lit ? "true" : "false"}
          style={{
            width: 3,
            height: 6 + i,
            borderRadius: 1,
            background: lit ? "var(--accent)" : "var(--border-strong)",
          }}
        />
      ))}
    </div>
  );
}

export function RecordingHud(props: RecordingHudProps) {
  const {
    phase,
    elapsedMs,
    micLevel,
    sourceLabel,
    warning,
    countdownValue,
    onStop,
    onPauseToggle,
    onDiscard,
  } = props;

  const [confirmOpen, setConfirmOpen] = useState(false);
  const isPaused = phase === "paused";

  if (phase === "countdown") {
    return (
      <div style={pillStyle} data-testid="recording-hud" data-phase={phase}>
        <DragGrip />
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-4)",
          }}
        >
          <span
            data-testid="countdown-value"
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1,
              color: "var(--accent)",
              minWidth: 40,
              textAlign: "center",
            }}
          >
            {countdownValue ?? ""}
          </span>
          <span style={{ fontSize: 13, color: "var(--text-2)" }}>
            Get ready — recording starts soon
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={pillStyle} data-testid="recording-hud" data-phase={phase}>
        <DragGrip />

        <Button
          variant="primary"
          icon
          onClick={onStop}
          aria-label="Stop recording"
          title="Stop"
          style={stopButtonStyle}
        >
          <span style={stopDotStyle} />
        </Button>

        <Button
          variant="ghost"
          icon
          onClick={onPauseToggle}
          aria-label={isPaused ? "Resume recording" : "Pause recording"}
          title={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? "▶" : "❚❚"}
        </Button>

        <Button
          variant="ghost"
          icon
          onClick={() => setConfirmOpen(true)}
          aria-label="Discard recording"
          title="Discard"
        >
          🗑
        </Button>

        <span
          data-testid="hud-timer"
          style={{
            fontFamily: "var(--font-heading)",
            fontVariantNumeric: "tabular-nums",
            fontSize: 20,
            fontWeight: 600,
            minWidth: 62,
            textAlign: "center",
            opacity: isPaused ? 0.45 : 1,
          }}
        >
          {formatElapsed(elapsedMs)}
        </span>

        {isPaused ? <Tag variant="accent-2">Paused</Tag> : null}

        <MicMeter micLevel={micLevel} />

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "var(--space-2)",
            minWidth: 0,
          }}
        >
          {warning ? (
            <Tag variant="outline" data-testid="hud-warning">
              {warning}
            </Tag>
          ) : null}
          <span
            data-testid="hud-source"
            style={{
              fontSize: 12,
              color: "var(--text-2)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={sourceLabel}
          >
            {sourceLabel}
          </span>
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Discard recording?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Keep recording
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmOpen(false);
                onDiscard();
              }}
            >
              Discard
            </Button>
          </>
        }
      >
        This will permanently delete the current recording. This can't be undone.
      </Dialog>
    </>
  );
}

export default RecordingHud;
