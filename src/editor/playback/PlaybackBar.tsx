import { Button } from "@design/components";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { formatPlaybackTime } from "./format";
import { shortcutLabel } from "./shortcuts";

/** Playback bar — design guide S12 region D (44px above the timeline). */
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
  gap: "var(--space-2)",
  height: "44px",
  padding: "0 var(--space-3)",
  background: "var(--bg-panel)",
  borderTop: "1px solid var(--border)",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
  boxSizing: "border-box",
  minWidth: 0,
};

const groupStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-1)",
};

const readoutStyle: CSSProperties = {
  marginLeft: "var(--space-3)",
  fontFamily: 'ui-monospace, "JetBrains Mono", monospace',
  fontVariantNumeric: "tabular-nums",
  fontSize: "13px",
  whiteSpace: "nowrap",
  color: "var(--text-1)",
};

const totalStyle: CSSProperties = { color: "var(--text-2)" };

const dividerStyle: CSSProperties = {
  width: "1px",
  height: "20px",
  margin: "0 var(--space-1)",
  background: "var(--border-strong)",
};

const iconButtonStyle: CSSProperties = { width: "32px", height: "32px", padding: 0 };

const pressedStyle: CSSProperties = {
  ...iconButtonStyle,
  color: "var(--accent)",
  background: "var(--accent-soft)",
};

const sliderStyle: CSSProperties = { width: "96px", accentColor: "var(--accent)" };

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
      <path d="M10 4 6 8l4 4" />
    </Glyph>
  ),
  frameForward: (
    <Glyph>
      <path d="m6 4 4 4-4 4" />
    </Glyph>
  ),
  play: (
    <Glyph>
      <path d="M5 3l8 5-8 5z" fill="currentColor" />
    </Glyph>
  ),
  pause: (
    <Glyph>
      <path d="M5 3v10M11 3v10" strokeWidth="2.5" />
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

  const iconButton = (
    label: string,
    icon: ReactElement,
    onClick: () => void,
    extra: { pressed?: boolean; disabled?: boolean } = {},
  ): ReactElement => (
    <Button
      variant="ghost"
      icon
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={extra.disabled}
      aria-pressed={extra.pressed}
      style={extra.pressed ? pressedStyle : iconButtonStyle}
    >
      {icon}
    </Button>
  );

  return (
    <div role="toolbar" aria-label="Playback" style={barStyle}>
      <div style={groupStyle}>
        {iconButton(
          withShortcut("Skip to start", "skip-start"),
          icons.skipStart,
          props.onSkipStart,
        )}
        {iconButton(withShortcut("Back 1 frame", "frame-back"), icons.frameBack, () =>
          props.onStepFrame(-1),
        )}
        {iconButton(playLabel, isPlaying ? icons.pause : icons.play, props.onTogglePlay)}
        {iconButton(withShortcut("Forward 1 frame", "frame-forward"), icons.frameForward, () =>
          props.onStepFrame(1),
        )}
        {iconButton(withShortcut("Skip to end", "skip-end"), icons.skipEnd, props.onSkipEnd)}
        {iconButton("Loop", icons.loop, () => props.onLoopChange(!loop), { pressed: loop })}
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

      <div style={{ flex: 1 }} />

      <div style={groupStyle}>
        {iconButton(withShortcut("Split at playhead", "split"), icons.split, props.onSplit)}
        {iconButton(withShortcut("Delete selection", "delete"), icons.delete, props.onDelete, {
          disabled: !canDelete,
        })}
        {iconButton("Snap", icons.snap, () => props.onSnapChange(!snapEnabled), {
          pressed: snapEnabled,
        })}
        <span style={dividerStyle} />
        {iconButton("Zoom out timeline", icons.minus, () =>
          props.onTimelineZoomChange(clamp01(zoom - ZOOM_STEP)),
        )}
        <input
          type="range"
          aria-label="Timeline zoom"
          min={0}
          max={1}
          step={0.01}
          value={zoom}
          onChange={(e) => props.onTimelineZoomChange(clamp01(Number(e.currentTarget.value)))}
          style={sliderStyle}
        />
        {iconButton("Zoom in timeline", icons.plus, () =>
          props.onTimelineZoomChange(clamp01(zoom + ZOOM_STEP)),
        )}
        <Button variant="ghost" onClick={props.onFit} title="Fit timeline to window">
          Fit
        </Button>
      </div>
    </div>
  );
}
