import { Button, Tag } from "@design/components";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { usePrefersReducedMotion } from "../overlays/reducedMotion";
import {
  APP_REGION_DRAG,
  CHIP_ROW_HEIGHT,
  DISCARD_CONFIRM_SIZE,
  HUD_GAP,
  PILL_HEIGHT,
  PILL_WIDTH,
  RECORDING_MENU_SIZE,
  RECORDING_PILL,
  type RecordingPanel,
} from "./layout";
import type { RecordingHudProps } from "./types";

/**
 * S10 — recording control pill (300×48 glass): pulsing red dot, mono timer
 * `00:42.1`, mini mic meter, Pause/Resume, Stop (red square) and an overflow
 * (Restart, Discard, Hide pill, Mute mic). The overflow menu and the discard
 * confirm are separate panels the container places in the grown HUD window;
 * {@link RecordingHud} composes everything in flow for previews and tests.
 * The interrupted state keeps the wide warning pill for its message.
 */

const METER_BARS = 8;

/** Format a millisecond duration as mm:ss (clamps negatives to 0). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

/** Recording timer with tenths, `00:42.1` (guide S10). Negative / non-finite → `00:00.0`. */
export function formatTimerTenths(ms: number): string {
  const tenths = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 100)) : 0;
  return `${formatElapsed(Math.floor(tenths / 10) * 1000)}.${tenths % 10}`;
}

const glass: CSSProperties = {
  display: "flex",
  alignItems: "center",
  boxSizing: "border-box",
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

const pillStyle: CSSProperties = {
  ...glass,
  gap: 6,
  width: RECORDING_PILL.width,
  height: RECORDING_PILL.height,
  padding: "0 var(--space-2) 0 var(--space-3)",
};

const widePillStyle: CSSProperties = {
  ...glass,
  gap: "var(--space-3)",
  width: PILL_WIDTH,
  height: PILL_HEIGHT,
  padding: "0 var(--space-4)",
};

const smallIcon: CSSProperties = { width: 28, height: 28, minWidth: 28, padding: 0 };

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

/** Drag handle: the window moves by this region (SPEC §5.7); position is persisted by main. */
export function DragGrip() {
  return (
    <div
      style={{ ...gripStyle, ...APP_REGION_DRAG }}
      aria-hidden="true"
      data-testid="hud-grip"
      data-app-region="drag"
      title="Drag"
    >
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

const timerStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
  fontSize: 13,
};

function MicMeter({ micLevel, muted }: { micLevel: number | undefined; muted: boolean }) {
  const silent = muted || micLevel === undefined;
  const clamped = silent ? 0 : Math.max(0, Math.min(1, micLevel ?? 0));
  const litCount = silent ? 0 : Math.round(clamped * METER_BARS);
  const bars = Array.from({ length: METER_BARS }, (_, i) => i < litCount);

  return (
    <div
      role="meter"
      aria-label={
        muted
          ? "Microphone muted"
          : micLevel === undefined
            ? "No microphone input"
            : "Microphone level"
      }
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={silent ? undefined : clamped}
      aria-disabled={silent || undefined}
      data-testid="mic-meter"
      data-muted={muted ? "true" : undefined}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-end",
        gap: 2,
        height: 16,
        opacity: silent && !muted ? 0.35 : 1,
      }}
    >
      {bars.map((lit, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static meter
          key={i}
          data-lit={lit ? "true" : "false"}
          style={{
            width: 2,
            height: 6 + i,
            borderRadius: 1,
            background: lit ? "var(--accent)" : muted ? "var(--warning)" : "var(--border-strong)",
            opacity: muted ? 0.5 : 1,
          }}
        />
      ))}
      {muted ? (
        // Struck-through mic (guide S10 muted state), warning tint.
        <span
          aria-hidden="true"
          data-testid="mic-muted-icon"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--warning)",
            fontSize: 12,
            textDecoration: "line-through",
            textDecorationThickness: 2,
          }}
        >
          🎙
        </span>
      ) : null}
    </div>
  );
}

function Spinner() {
  const reduceMotion = usePrefersReducedMotion();
  return (
    <span
      aria-hidden="true"
      data-testid="hud-processing"
      data-motion={reduceMotion ? "reduced" : "full"}
      style={{
        flex: "none",
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "2px solid var(--border-strong)",
        borderTopColor: "var(--accent)",
        animation: reduceMotion
          ? "reelform-hud-fade 1.6s ease-in-out infinite alternate"
          : "reelform-hud-spin 900ms linear infinite",
      }}
    />
  );
}

function RecordingDot({ paused }: { paused: boolean }) {
  const reduceMotion = usePrefersReducedMotion();
  const pulse = !paused && !reduceMotion;
  return (
    <span
      aria-hidden="true"
      data-testid="hud-record-dot"
      data-pulse={pulse ? "true" : "false"}
      style={{
        flex: "none",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "var(--record)",
        animation: pulse ? "reelform-hud-pulse 1.2s ease-in-out infinite" : "none",
      }}
    />
  );
}

const KEYFRAMES =
  "@keyframes reelform-hud-spin { to { transform: rotate(360deg); } }" +
  " @keyframes reelform-hud-fade { from { opacity: 1; } to { opacity: 0.45; } }" +
  " @keyframes reelform-hud-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }";

export type RecordingPillProps = RecordingHudProps & {
  openPanel: RecordingPanel | null;
  onPanelChange: (panel: RecordingPanel | null) => void;
};

/** The pill itself (what the HUD window is sized to). */
export function RecordingPill(props: RecordingPillProps) {
  const { phase, elapsedMs, micLevel, sourceLabel, countdownValue, onStop, onPauseToggle } = props;
  const isPaused = phase === "paused";

  if (phase === "interrupted") {
    return (
      <output
        style={{ ...widePillStyle, borderColor: "var(--warning)" }}
        data-testid="recording-hud"
        data-phase={phase}
      >
        <DragGrip />
        <Tag variant="outline" style={{ color: "var(--warning)", borderColor: "var(--warning)" }}>
          Interrupted
        </Tag>
        <span
          data-testid="hud-status"
          style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-1)" }}
        >
          {`Recording saved up to ${formatElapsed(elapsedMs)}`}
          {props.interruptedMessage ? (
            <span style={{ color: "var(--text-2)" }}> — {props.interruptedMessage}</span>
          ) : null}
        </span>
        <span data-testid="hud-timer" style={{ ...timerStyle, color: "var(--text-2)" }}>
          {formatElapsed(elapsedMs)}
        </span>
      </output>
    );
  }

  if (phase === "finalizing") {
    return (
      <output style={pillStyle} data-testid="recording-hud" data-phase={phase}>
        <DragGrip />
        <Spinner />
        <span
          data-testid="hud-status"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          Processing recording…
        </span>
        <span data-testid="hud-timer" style={{ ...timerStyle, color: "var(--text-2)" }}>
          {formatTimerTenths(elapsedMs)}
        </span>
        <style>{KEYFRAMES}</style>
      </output>
    );
  }

  if (phase === "countdown") {
    return (
      <div style={pillStyle} data-testid="recording-hud" data-phase={phase}>
        <DragGrip />
        <span
          data-testid="countdown-value"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 24,
            fontWeight: 700,
            lineHeight: 1,
            color: "var(--accent)",
            minWidth: 24,
            textAlign: "center",
          }}
        >
          {countdownValue ?? ""}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-2)" }}>
          Recording starts soon
        </span>
      </div>
    );
  }

  const menuOpen = props.openPanel === "menu";
  return (
    <div
      style={pillStyle}
      data-testid="recording-hud"
      data-phase={phase}
      title={sourceLabel ? `Recording ${sourceLabel}` : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && props.openPanel) props.onPanelChange(null);
      }}
    >
      <DragGrip />
      <RecordingDot paused={isPaused} />
      <span
        data-testid="hud-timer"
        aria-label={isPaused ? "Paused" : "Elapsed"}
        style={{ ...timerStyle, minWidth: 54, opacity: isPaused ? 0.55 : 1 }}
      >
        {formatTimerTenths(elapsedMs)}
      </span>
      <MicMeter micLevel={micLevel} muted={props.micMuted === true} />
      <span style={{ flex: 1 }} />
      <Button
        variant="ghost"
        icon
        onClick={onPauseToggle}
        aria-label={isPaused ? "Resume recording" : "Pause recording"}
        title={isPaused ? "Resume" : "Pause"}
        style={smallIcon}
      >
        {isPaused ? "▶" : "❚❚"}
      </Button>
      <Button
        variant="primary"
        icon
        onClick={onStop}
        aria-label="Stop recording"
        title="Stop"
        style={{
          ...smallIcon,
          background: "var(--record)",
          borderColor: "var(--record)",
          color: "var(--on-accent)",
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: 2,
            background: "var(--on-accent)",
          }}
        />
      </Button>
      <Button
        variant="ghost"
        icon
        onClick={() => props.onPanelChange(menuOpen ? null : "menu")}
        aria-label="More recording options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="More"
        style={smallIcon}
      >
        ⋯
      </Button>
      <style>{KEYFRAMES}</style>
    </div>
  );
}

const panelStyle: CSSProperties = {
  boxSizing: "border-box",
  padding: "var(--space-2)",
  background: "var(--bg-panel-raised)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-lg)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
};

function MenuItem({
  onClick,
  checked,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  checked?: boolean | undefined;
  disabled?: boolean | undefined;
  danger?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        height: 32,
        padding: "0 var(--space-2)",
        border: "none",
        borderRadius: "var(--radius-sm)",
        background: checked ? "var(--accent-soft)" : "transparent",
        color: danger ? "var(--danger)" : "var(--text-1)",
        opacity: disabled ? 0.45 : 1,
        font: "inherit",
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** Overflow menu: Restart, Discard…, Hide pill, Mute mic. */
export function RecordingHudMenu(props: RecordingPillProps) {
  const close = () => props.onPanelChange(null);
  return (
    <div
      role="menu"
      aria-label="Recording options"
      data-testid="hud-recording-menu"
      style={{
        ...panelStyle,
        width: RECORDING_MENU_SIZE.width,
        maxHeight: RECORDING_MENU_SIZE.height,
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <div
        data-testid="hud-source"
        title={props.sourceLabel}
        style={{
          padding: "var(--space-1) var(--space-2)",
          color: "var(--text-3)",
          fontSize: 12,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {props.sourceLabel}
      </div>
      <MenuItem
        disabled={!props.onRestart}
        onClick={() => {
          close();
          props.onRestart?.();
        }}
      >
        Restart
      </MenuItem>
      <MenuItem danger onClick={() => props.onPanelChange("confirm")}>
        Discard…
      </MenuItem>
      <MenuItem
        disabled={!props.onHidePill}
        onClick={() => {
          close();
          props.onHidePill?.();
        }}
      >
        Hide pill
      </MenuItem>
      <MenuItem
        checked={props.micMuted === true}
        disabled={!props.onMuteToggle}
        onClick={() => {
          close();
          props.onMuteToggle?.();
        }}
      >
        Mute mic
      </MenuItem>
    </div>
  );
}

/** Inline discard confirm next to the pill (a system dialog would be clipped by the HUD window). */
export function DiscardConfirm(props: RecordingPillProps) {
  const close = () => props.onPanelChange(null);
  return (
    <div
      role="alertdialog"
      aria-label="Discard recording?"
      aria-describedby="hud-discard-detail"
      data-testid="hud-discard-confirm"
      style={{
        ...panelStyle,
        width: DISCARD_CONFIRM_SIZE.width,
        height: DISCARD_CONFIRM_SIZE.height,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        borderColor: "var(--danger)",
        padding: "var(--space-3)",
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <strong style={{ fontSize: 13 }}>Discard recording?</strong>
      <span id="hud-discard-detail" style={{ fontSize: 12, color: "var(--text-2)" }}>
        The current recording ({formatTimerTenths(props.elapsedMs)}) will be deleted. This can't be
        undone.
      </span>
      <span style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
        <Button variant="ghost" autoFocus onClick={close}>
          Keep recording
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            close();
            props.onDiscard();
          }}
        >
          Discard
        </Button>
      </span>
    </div>
  );
}

/** The open panel, if any (only recording / paused have one). */
export function RecordingHudPanel(props: RecordingPillProps) {
  if (props.phase !== "recording" && props.phase !== "paused") return null;
  if (props.openPanel === "menu") return <RecordingHudMenu {...props} />;
  if (props.openPanel === "confirm") return <DiscardConfirm {...props} />;
  return null;
}

/** Low disk space / capture warning strip above the recording pill (guide S10). */
export function RecordingWarningStrip({ warning }: { warning: string | undefined }) {
  if (!warning) return null;
  return (
    // <output> is the live status region; the tag is only the chip look.
    <output style={{ display: "contents" }}>
      <Tag
        variant="outline"
        data-testid="hud-warning"
        title={warning}
        style={{
          boxSizing: "border-box",
          height: CHIP_ROW_HEIGHT,
          display: "inline-flex",
          alignItems: "center",
          maxWidth: RECORDING_PILL.width,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--warning)",
          borderColor: "var(--warning)",
          background: "var(--bg-panel-raised)",
        }}
      >
        {warning}
      </Tag>
    </output>
  );
}

/** Standalone composition (previews, tests): warning strip, pill, then the open panel. */
export function RecordingHud(props: RecordingHudProps) {
  const [localPanel, setLocalPanel] = useState<RecordingPanel | null>(null);
  const openPanel = props.openPanel !== undefined ? props.openPanel : localPanel;
  const onPanelChange = (panel: RecordingPanel | null) => {
    if (props.openPanel === undefined) setLocalPanel(panel);
    props.onPanelChange?.(panel);
  };
  const full: RecordingPillProps = { ...props, openPanel, onPanelChange };
  const live = props.phase === "recording" || props.phase === "paused";
  return (
    <div
      data-testid="recording-hud-stack"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: HUD_GAP }}
    >
      {live ? <RecordingWarningStrip warning={props.warning} /> : null}
      <RecordingPill {...full} />
      <RecordingHudPanel {...full} />
    </div>
  );
}

export default RecordingHud;
