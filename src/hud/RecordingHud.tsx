import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { usePrefersReducedMotion } from "../overlays/reducedMotion";
import { useHudT } from "./i18n";
import {
  APP_REGION_DRAG,
  CHIP_ROW_HEIGHT,
  DISCARD_CONFIRM_SIZE,
  HUD_GAP,
  INTERRUPTED_CARD,
  RECORDING_MENU_SIZE,
  RECORDING_PILL,
  type RecordingPanel,
} from "./layout";
import type { RecordingHudProps } from "./types";

/**
 * S10 — recording control pill (340×48 glass): pulsing red dot, mono timer
 * `00:42.1`, mini mic meter, Pause/Resume, Stop (red square) and an overflow
 * (Restart, Discard, Hide pill, Mute mic). The overflow menu and the discard
 * confirm are separate panels the container places in the grown HUD window;
 * {@link RecordingHud} composes everything in flow for previews and tests.
 * Interrupted capture shows the crimson "Capture interrupted" card instead.
 */

const METER_HEIGHTS = [5, 10, 12, 6] as const;
const METER_BARS = METER_HEIGHTS.length;

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

/** Warm tinted text for warning / danger surfaces (no dedicated token). */
const warnText = "color-mix(in srgb, var(--warning) 35%, var(--text-1))";
const dangerText = "color-mix(in srgb, var(--record) 35%, var(--text-1))";

const glass: CSSProperties = {
  display: "flex",
  alignItems: "center",
  boxSizing: "border-box",
  background: "color-mix(in srgb, var(--bg-panel) 90%, transparent)",
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
  gap: 10,
  width: RECORDING_PILL.width,
  height: RECORDING_PILL.height,
  padding: "0 8px 0 8px",
};

const roundButton = (size: number): CSSProperties => ({
  flex: "none",
  width: size,
  height: size,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 2,
  padding: 0,
  margin: 0,
  border: "none",
  borderRadius: "var(--radius-full)",
  font: "inherit",
  cursor: "pointer",
});

const gripStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  flex: "none",
  padding: "0 2px",
  cursor: "grab",
  color: "var(--text-3)",
  opacity: 0.7,
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
  const t = useHudT();
  return (
    <div
      style={{ ...gripStyle, ...APP_REGION_DRAG }}
      aria-hidden="true"
      data-testid="hud-grip"
      data-app-region="drag"
      title={t("hud.grip.drag")}
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

/** Struck-through mic (guide S10 muted state). */
function MutedMicGlyph() {
  return (
    <span
      aria-hidden="true"
      data-testid="mic-muted-icon"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        style={{ width: 6, height: 12, borderRadius: "var(--radius-full)", background: warnText }}
      />
      <span
        style={{
          position: "absolute",
          width: 22,
          height: 1.5,
          background: warnText,
          transform: "rotate(-45deg)",
        }}
      />
    </span>
  );
}

function MicMeter({ micLevel, muted }: { micLevel: number | undefined; muted: boolean }) {
  const t = useHudT();
  const silent = muted || micLevel === undefined;
  const clamped = silent ? 0 : Math.max(0, Math.min(1, micLevel ?? 0));
  const litCount = silent ? 0 : Math.round(clamped * METER_BARS);
  const label = t(
    muted ? "hud.rec.micMuted" : micLevel === undefined ? "hud.rec.noMicInput" : "hud.rec.micLevel",
  );

  if (muted) {
    return (
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-disabled
        data-testid="mic-meter"
        data-muted="true"
        style={{ fontSize: 11, whiteSpace: "nowrap" }}
      >
        {t("hud.rec.micMutedShort")}
      </span>
    );
  }

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={silent ? undefined : clamped}
      aria-disabled={silent || undefined}
      data-testid="mic-meter"
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 2,
        height: 12,
        opacity: silent ? 0.35 : 1,
      }}
    >
      {METER_HEIGHTS.map((h, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static meter
          key={i}
          data-lit={i < litCount ? "true" : "false"}
          style={{
            width: 2,
            height: h,
            background:
              i < litCount
                ? "var(--success)"
                : "color-mix(in srgb, var(--success) 40%, transparent)",
          }}
        />
      ))}
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
        boxSizing: "border-box",
        width: 13,
        height: 13,
        borderRadius: "50%",
        border: "2px solid var(--border-strong)",
        borderTopColor: "var(--accent)",
        animation: reduceMotion
          ? "reelform-hud-fade 1.6s ease-in-out infinite alternate"
          : "reelform-hud-spin 1s linear infinite",
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
        width: 9,
        height: 9,
        borderRadius: "50%",
        background: paused ? "var(--text-3)" : "var(--record)",
        animation: pulse ? "reelform-hud-pulse 1.4s ease-in-out infinite" : "none",
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

function StopSquare() {
  return (
    <span
      aria-hidden="true"
      style={{ width: 12, height: 12, borderRadius: 2, background: "var(--text-1)" }}
    />
  );
}

/** "{message}. Recording saved up to <mono>00:42</mono>." */
function InterruptedDetail({ elapsedMs, message }: { elapsedMs: number; message?: string }) {
  const t = useHudT();
  const time = formatElapsed(elapsedMs);
  const [before = "", after = ""] = t("hud.rec.savedUpToSentence", { time: " " }).split(" ");
  const lead = message
    ? /[.!?…]$/.test(message.trim())
      ? message.trim()
      : `${message.trim()}.`
    : "";
  return (
    <span
      data-testid="hud-status"
      style={{
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}
    >
      {lead ? `${lead} ` : null}
      {before}
      <span data-testid="hud-timer" style={{ fontFamily: "var(--font-mono)" }}>
        {time}
      </span>
      {after}
    </span>
  );
}

/** The pill itself (what the HUD window is sized to). */
export function RecordingPill(props: RecordingPillProps) {
  const { phase, elapsedMs, micLevel, sourceLabel, countdownValue, onStop, onPauseToggle } = props;
  const isPaused = phase === "paused";
  const t = useHudT();

  if (phase === "interrupted") {
    return (
      <output
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          boxSizing: "border-box",
          width: INTERRUPTED_CARD.width,
          height: INTERRUPTED_CARD.height,
          padding: "12px 14px",
          borderRadius: "var(--radius-md)",
          background: "color-mix(in srgb, var(--record) 14%, var(--bg-panel))",
          border: "1px solid color-mix(in srgb, var(--record) 50%, transparent)",
          boxShadow: "var(--shadow-lg)",
          color: dangerText,
          fontFamily: "var(--font-body)",
          fontSize: 12,
          lineHeight: 1.4,
          userSelect: "none",
        }}
        data-testid="recording-hud"
        data-phase={phase}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <DragGrip />
          <span style={{ fontWeight: 600, color: "var(--text-1)" }}>
            {t("hud.rec.interrupted")}
          </span>
        </span>
        <InterruptedDetail
          elapsedMs={elapsedMs}
          {...(props.interruptedMessage ? { message: props.interruptedMessage } : {})}
        />
      </output>
    );
  }

  if (phase === "finalizing") {
    return (
      <output
        style={{ ...pillStyle, paddingRight: 14 }}
        data-testid="recording-hud"
        data-phase={phase}
      >
        <DragGrip />
        <Spinner />
        <span
          data-testid="hud-status"
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {t("hud.rec.processing")}
        </span>
        <span data-testid="hud-timer" style={{ ...timerStyle, color: "var(--text-3)" }}>
          {formatTimerTenths(elapsedMs)}
        </span>
        <style>{KEYFRAMES}</style>
      </output>
    );
  }

  if (phase === "countdown") {
    return (
      <div
        style={{ ...pillStyle, paddingRight: 14 }}
        data-testid="recording-hud"
        data-phase={phase}
      >
        <DragGrip />
        <span
          data-testid="countdown-value"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 22,
            lineHeight: 1,
            color: "var(--accent-hover)",
            minWidth: 22,
            textAlign: "center",
          }}
        >
          {countdownValue ?? ""}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-2)" }}>
          {t("hud.rec.startsSoon")}
        </span>
      </div>
    );
  }

  const muted = props.micMuted === true;
  const menuOpen = props.openPanel === "menu";
  const mutedSurface: CSSProperties = muted
    ? {
        background: "color-mix(in srgb, var(--warning) 16%, var(--bg-panel))",
        borderColor: "color-mix(in srgb, var(--warning) 50%, transparent)",
        color: warnText,
      }
    : {};

  return (
    <div
      style={{ ...pillStyle, ...mutedSurface }}
      data-testid="recording-hud"
      data-phase={phase}
      data-muted={muted ? "true" : undefined}
      title={sourceLabel ? t("hud.rec.recordingSource", { source: sourceLabel }) : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && props.openPanel) props.onPanelChange(null);
      }}
    >
      <DragGrip />
      <RecordingDot paused={isPaused} />
      <span
        data-testid="hud-timer"
        aria-label={t(isPaused ? "hud.rec.paused" : "hud.rec.elapsed")}
        style={{ ...timerStyle, color: isPaused ? "var(--text-3)" : undefined }}
      >
        {formatTimerTenths(elapsedMs)}
      </span>
      {isPaused && !muted ? (
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("hud.rec.paused")}</span>
      ) : (
        <MicMeter micLevel={micLevel} muted={muted} />
      )}
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        {muted ? (
          props.onMuteToggle ? (
            <button
              type="button"
              onClick={props.onMuteToggle}
              aria-label={t("hud.rec.unmuteMic")}
              title={t("hud.rec.unmuteMic")}
              style={{
                ...roundButton(30),
                background: "color-mix(in srgb, var(--bg-sunken) 40%, transparent)",
              }}
            >
              <MutedMicGlyph />
            </button>
          ) : (
            <span
              style={{
                ...roundButton(30),
                cursor: "default",
                background: "color-mix(in srgb, var(--bg-sunken) 40%, transparent)",
              }}
            >
              <MutedMicGlyph />
            </span>
          )
        ) : null}
        {isPaused ? (
          <button
            type="button"
            onClick={onPauseToggle}
            aria-label={t("hud.rec.resumeRecording")}
            title={t("hud.rec.resume")}
            style={{
              flex: "none",
              padding: "7px 14px",
              margin: 0,
              border: "none",
              borderRadius: "var(--radius-full)",
              background: "var(--accent)",
              color: "var(--on-accent)",
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("hud.rec.resume")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onPauseToggle}
            aria-label={t("hud.rec.pauseRecording")}
            title={t("hud.rec.pause")}
            style={{ ...roundButton(30), background: "var(--bg-panel-raised)" }}
          >
            <span
              aria-hidden="true"
              style={{ width: 3, height: 11, background: "var(--text-1)" }}
            />
            <span
              aria-hidden="true"
              style={{ width: 3, height: 11, background: "var(--text-1)" }}
            />
          </button>
        )}
        <button
          type="button"
          onClick={onStop}
          aria-label={t("hud.rec.stopRecording")}
          title={t("hud.rec.stop")}
          style={{ ...roundButton(34), background: "var(--record)" }}
        >
          <StopSquare />
        </button>
        <button
          type="button"
          onClick={() => props.onPanelChange(menuOpen ? null : "menu")}
          aria-label={t("hud.rec.moreOptions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={t("hud.more")}
          style={{
            ...roundButton(24),
            background: menuOpen ? "var(--bg-active)" : "transparent",
            color: muted ? warnText : "var(--text-2)",
          }}
        >
          ⋯
        </button>
      </span>
      <style>{KEYFRAMES}</style>
    </div>
  );
}

const panelStyle: CSSProperties = {
  boxSizing: "border-box",
  padding: 8,
  background: "color-mix(in srgb, var(--bg-panel) 94%, transparent)",
  backdropFilter: "blur(24px)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-lg)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  fontSize: 12,
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
        justifyContent: "space-between",
        width: "100%",
        height: 30,
        padding: "0 10px",
        border: "none",
        borderRadius: 10,
        background: checked ? "var(--accent-soft)" : "transparent",
        color: danger ? dangerText : "var(--text-1)",
        opacity: disabled ? 0.45 : 1,
        font: "inherit",
        textAlign: "left",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <span>{children}</span>
      {checked ? (
        <span aria-hidden="true" style={{ color: "var(--accent-hover)" }}>
          ✓
        </span>
      ) : null}
    </button>
  );
}

/** Overflow menu: Restart, Discard…, Hide pill, Mute mic. */
export function RecordingHudMenu(props: RecordingPillProps) {
  const t = useHudT();
  const close = () => props.onPanelChange(null);
  return (
    <div
      role="menu"
      aria-label={t("hud.rec.options")}
      data-testid="hud-recording-menu"
      style={{
        ...panelStyle,
        display: "flex",
        flexDirection: "column",
        gap: 2,
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
          padding: "4px 10px",
          color: "var(--text-3)",
          fontSize: 11,
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
        {t("hud.rec.restart")}
      </MenuItem>
      <MenuItem
        disabled={!props.onHidePill}
        onClick={() => {
          close();
          props.onHidePill?.();
        }}
      >
        {t("hud.rec.hidePill")}
      </MenuItem>
      <MenuItem
        checked={props.micMuted === true}
        disabled={!props.onMuteToggle}
        onClick={() => {
          close();
          props.onMuteToggle?.();
        }}
      >
        {t("hud.rec.muteMic")}
      </MenuItem>
      <MenuItem danger onClick={() => props.onPanelChange("confirm")}>
        {t("hud.rec.discardEllipsis")}
      </MenuItem>
    </div>
  );
}

const pillAction: CSSProperties = {
  padding: "7px 14px",
  margin: 0,
  borderRadius: "var(--radius-full)",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

/** Inline discard confirm next to the pill (a system dialog would be clipped by the HUD window). */
export function DiscardConfirm(props: RecordingPillProps) {
  const t = useHudT();
  const close = () => props.onPanelChange(null);
  return (
    <div
      role="alertdialog"
      aria-label={t("hud.rec.discardTitle")}
      aria-describedby="hud-discard-detail"
      data-testid="hud-discard-confirm"
      style={{
        ...panelStyle,
        width: DISCARD_CONFIRM_SIZE.width,
        height: DISCARD_CONFIRM_SIZE.height,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        borderColor: "color-mix(in srgb, var(--record) 50%, transparent)",
        padding: "12px 14px",
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      <strong style={{ fontSize: 13, fontWeight: 600 }}>{t("hud.rec.discardTitle")}</strong>
      <span id="hud-discard-detail" style={{ fontSize: 12, color: "var(--text-2)" }}>
        {t("hud.rec.discardDetail", { time: formatTimerTenths(props.elapsedMs) })}
      </span>
      <span style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: "auto" }}>
        <button
          type="button"
          // biome-ignore lint/a11y/noAutofocus: focus the safe action in the confirm
          autoFocus
          onClick={close}
          style={{
            ...pillAction,
            fontWeight: 400,
            background: "var(--bg-panel-raised)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-1)",
          }}
        >
          {t("hud.rec.keepRecording")}
        </button>
        <button
          type="button"
          onClick={() => {
            close();
            props.onDiscard();
          }}
          style={{
            ...pillAction,
            border: "none",
            background: "var(--record)",
            color: "var(--text-1)",
          }}
        >
          {t("hud.rec.discard")}
        </button>
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
    <output
      data-testid="hud-warning"
      title={warning}
      style={{
        boxSizing: "border-box",
        height: CHIP_ROW_HEIGHT,
        width: RECORDING_PILL.width,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 14px",
        borderRadius: "var(--radius-md)",
        background: "color-mix(in srgb, var(--warning) 14%, var(--bg-panel))",
        border: "1px solid color-mix(in srgb, var(--warning) 45%, transparent)",
        color: warnText,
        fontFamily: "var(--font-body)",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true">⚠</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{warning}</span>
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
