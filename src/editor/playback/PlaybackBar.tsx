import { Button } from "@design/components";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { formatPlaybackTime } from "./format";
import { shortcutLabel } from "./shortcuts";

/** Playback bar — design guide S12 region D (44px above the timeline; 40px narrow). */
export interface PlaybackBarProps {
  currentMs: number;
  durationMs: number;
  fps: number;
  isPlaying: boolean;
  loop: boolean;
  snapEnabled: boolean;
  /** 0 (zoomed out) … 1 (zoomed in). */
  timelineZoom: number;
  onTogglePlay: () => void;
  onStepFrame: (n: number) => void;
  onSkipStart: () => void;
  onSkipEnd: () => void;
  onLoopChange: (loop: boolean) => void;
  onSplit: () => void;
  onDelete: () => void;
  canDelete: boolean;
  onSnapChange: (snap: boolean) => void;
  onTimelineZoomChange: (zoom: number) => void;
  onFit: () => void;
}

const ZOOM_STEP = 0.1;

const barStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  height: "100%",
  minHeight: "40px",
  padding: "0 14px",
  background: "var(--bg-panel)",
  borderTop: "1px solid var(--border)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  boxSizing: "border-box",
  minWidth: 0,
};

const transportStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "4px",
  color: "var(--text-2)",
};

const toolsStyle: CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minWidth: 0,
  color: "var(--text-2)",
  fontSize: "12px",
};

const readoutStyle: CSSProperties = {
  marginLeft: "10px",
  fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
  fontVariantNumeric: "tabular-nums",
  fontSize: "12px",
  whiteSpace: "nowrap",
  color: "var(--text-1)",
};

const totalStyle: CSSProperties = { color: "var(--text-3)" };

const dividerStyle: CSSProperties = {
  width: "1px",
  height: "20px",
  background: "var(--border-strong)",
  flex: "none",
};

const iconButtonStyle: CSSProperties = {
  width: "28px",
  height: "28px",
  padding: 0,
  borderRadius: "var(--radius-sm)",
  color: "inherit",
  flex: "none",
};

const mutedButtonStyle: CSSProperties = { ...iconButtonStyle, color: "var(--text-3)" };

/** Toggle on (snap, loop): accent-soft fill, accent hairline (component sheet). */
const pressedStyle: CSSProperties = {
  ...iconButtonStyle,
  color: "var(--accent-hover)",
  background: "var(--accent-soft)",
  border: "1px solid var(--accent)",
};

const playButtonStyle: CSSProperties = {
  width: "34px",
  height: "34px",
  padding: 0,
  borderRadius: "var(--radius-full)",
  flex: "none",
};

const fitStyle: CSSProperties = {
  padding: "4px 10px",
  borderRadius: "var(--radius-full)",
  background: "var(--bg-panel-raised)",
  border: "none",
  color: "var(--text-2)",
  fontSize: "12px",
  fontWeight: 400,
};

const sliderWrapStyle: CSSProperties = {
  position: "relative",
  width: "120px",
  height: "12px",
  flex: "none",
  display: "flex",
  alignItems: "center",
};

const sliderTrackStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "4px",
  borderRadius: "var(--radius-full)",
  background: "var(--bg-panel-raised)",
  pointerEvents: "none",
};

/** The native range stays the accessible, focusable control; the drawn track sits beneath it. */
const sliderInputStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  margin: 0,
  opacity: 0,
  cursor: "pointer",
};

function Glyph({ children }: { children: ReactNode }): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const icons = {
  skipStart: (
    <Glyph>
      <path d="M4 3v10" />
      <path d="M12 3 6 8l6 5z" fill="currentColor" />
    </Glyph>
  ),
  skipEnd: (
    <Glyph>
      <path d="M12 3v10" />
      <path d="M4 3l6 5-6 5z" fill="currentColor" />
    </Glyph>
  ),
  frameBack: (
    <Glyph>
      <path d="M12 4 7 8l5 4z" fill="currentColor" />
      <path d="M4 4v8" />
    </Glyph>
  ),
  frameForward: (
    <Glyph>
      <path d="M4 4l5 4-5 4z" fill="currentColor" />
      <path d="M12 4v8" />
    </Glyph>
  ),
  play: (
    <Glyph>
      <path d="M5.5 3.5l7 4.5-7 4.5z" fill="currentColor" />
    </Glyph>
  ),
  pause: (
    <Glyph>
      <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="2.5" />
    </Glyph>
  ),
  loop: (
    <Glyph>
      <path d="M3 7V6a2 2 0 0 1 2-2h7l-2-2M13 9v1a2 2 0 0 1-2 2H4l2 2" />
    </Glyph>
  ),
  split: (
    <Glyph>
      <circle cx="4" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <path d="M5.5 5.5 13 12M5.5 10.5 13 4" />
    </Glyph>
  ),
  delete: (
    <Glyph>
      <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5" />
    </Glyph>
  ),
  snap: (
    <Glyph>
      <path d="M3 2v6a5 5 0 0 0 10 0V2h-3v6a2 2 0 0 1-4 0V2z" />
      <path d="M3 5h3M10 5h3" />
    </Glyph>
  ),
  minus: (
    <Glyph>
      <path d="M4 8h8" />
    </Glyph>
  ),
  plus: (
    <Glyph>
      <path d="M4 8h8M8 4v8" />
    </Glyph>
  ),
};

const withShortcut = (label: string, id: string): string => {
  const key = shortcutLabel(id);
  return key ? `${label} (${key})` : label;
};

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function PlaybackBar(props: PlaybackBarProps): ReactElement {
  const { currentMs, durationMs, fps, isPlaying, loop, snapEnabled, timelineZoom, canDelete } =
    props;
  const zoom = clamp01(timelineZoom);
  const playLabel = withShortcut(isPlaying ? "Pause" : "Play", "play-pause");
  const frameMs = fps > 0 ? Math.round(1000 / fps) : 0;
  const zoomPct = `${zoom * 100}%`;

  const iconButton = (
    label: string,
    icon: ReactElement,
    onClick: () => void,
    extra: { pressed?: boolean; disabled?: boolean; muted?: boolean } = {},
  ): ReactElement => (
    <Button
      variant="ghost"
      icon
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={extra.disabled}
      aria-pressed={extra.pressed}
      style={extra.pressed ? pressedStyle : extra.muted ? mutedButtonStyle : iconButtonStyle}
    >
      {icon}
    </Button>
  );

  return (
    <div role="toolbar" aria-label="Playback" style={barStyle}>
      <div style={transportStyle}>
        {iconButton(
          withShortcut("Skip to start", "skip-start"),
          icons.skipStart,
          props.onSkipStart,
        )}
        {iconButton(withShortcut("Back 1 frame", "frame-back"), icons.frameBack, () =>
          props.onStepFrame(-1),
        )}
        <Button
          variant="primary"
          icon
          aria-label={playLabel}
          title={playLabel}
          onClick={props.onTogglePlay}
          style={playButtonStyle}
        >
          {isPlaying ? icons.pause : icons.play}
        </Button>
        {iconButton(withShortcut("Forward 1 frame", "frame-forward"), icons.frameForward, () =>
          props.onStepFrame(1),
        )}
        {iconButton(withShortcut("Skip to end", "skip-end"), icons.skipEnd, props.onSkipEnd)}
        {iconButton("Loop", icons.loop, () => props.onLoopChange(!loop), {
          pressed: loop,
          muted: true,
        })}
      </div>

      <output
        aria-label="Playhead time"
        title={frameMs > 0 ? `${fps} fps` : undefined}
        style={readoutStyle}
      >
        <span data-testid="playback-current">{formatPlaybackTime(currentMs)}</span>
        <span style={totalStyle}>
          {" / "}
          <span data-testid="playback-total">{formatPlaybackTime(durationMs)}</span>
        </span>
      </output>

      <div style={toolsStyle}>
        {iconButton(withShortcut("Split at playhead", "split"), icons.split, props.onSplit)}
        {iconButton(withShortcut("Delete selection", "delete"), icons.delete, props.onDelete, {
          disabled: !canDelete,
        })}
        {iconButton("Snap", icons.snap, () => props.onSnapChange(!snapEnabled), {
          pressed: snapEnabled,
        })}
        <span aria-hidden="true" style={dividerStyle} />
        {iconButton("Zoom out timeline", icons.minus, () =>
          props.onTimelineZoomChange(clamp01(zoom - ZOOM_STEP)),
        )}
        <div style={sliderWrapStyle}>
          <div style={sliderTrackStyle}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: zoomPct,
                borderRadius: "var(--radius-full)",
                background: "var(--text-3)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: zoomPct,
                top: "-4px",
                width: "12px",
                height: "12px",
                marginLeft: "-6px",
                borderRadius: "var(--radius-full)",
                background: "var(--text-1)",
              }}
            />
          </div>
          <input
            type="range"
            aria-label="Timeline zoom"
            min={0}
            max={1}
            step={0.01}
            value={zoom}
            onChange={(e) => props.onTimelineZoomChange(clamp01(Number(e.currentTarget.value)))}
            style={sliderInputStyle}
          />
        </div>
        {iconButton("Zoom in timeline", icons.plus, () =>
          props.onTimelineZoomChange(clamp01(zoom + ZOOM_STEP)),
        )}
        <Button
          variant="secondary"
          onClick={props.onFit}
          title="Fit timeline to window"
          style={fitStyle}
        >
          Fit
        </Button>
      </div>
    </div>
  );
}
