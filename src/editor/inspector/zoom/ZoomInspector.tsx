import { Button, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import type { CSSProperties, KeyboardEvent, ReactElement } from "react";
import { useId } from "react";
import { AnchorGrid, EmptyState, NumberField, Section, Slider, Switch } from "../controls";
import {
  EASE_MS_MAX,
  MAX_ZOOM_SPEED_MAX,
  MAX_ZOOM_SPEED_MIN,
  ZOOM_CURVES,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
  type ZoomCurve,
  type ZoomRegion,
  type ZoomSettings,
  type ZoomStatus,
} from "./types";
import {
  curvePath,
  focusToAnchor,
  formatTimecode,
  parseTimecode,
  regionDurationMs,
  sampleCurve,
  setCurve,
  setEaseMs,
  setEndMs,
  setFocusAnchor,
  setFocusMode,
  setFocusPoint,
  setLevel,
  setStartMs,
} from "./zoomLogic";

/** Inspector: Zoom (design guide S15). Presentational; all state via props. */
export interface ZoomInspectorProps {
  settings: ZoomSettings;
  onSettingsChange: (next: ZoomSettings) => void;
  selectedRegion: ZoomRegion | null;
  onRegionChange: (next: ZoomRegion) => void;
  onDuplicate: (regionId: string) => void;
  onDelete: (regionId: string) => void;
  onGenerate: () => void;
  status: ZoomStatus;
  hasTelemetry: boolean;
  hasSuggestions: boolean;
  /** Timeline length; region end is clamped to it. */
  timelineDurationMs: number;
}

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  color: "var(--text-1)",
  fontFamily: "var(--font-body)",
};

const hintStyle: CSSProperties = { fontSize: "11px", color: "var(--text-3)" };

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minHeight: "28px",
  fontSize: "13px",
};

const labelStyle: CSSProperties = { flex: "0 0 96px", color: "var(--text-2)" };

const CURVE_OPTIONS: ReadonlyArray<SegmentedOption<ZoomCurve>> = ZOOM_CURVES;

export function ZoomInspector(props: ZoomInspectorProps): ReactElement {
  const { settings, onSettingsChange, selectedRegion, status, hasTelemetry } = props;
  const analyzing = status === "analyzing";
  const auto = settings.autoZoom;
  const setAuto = (patch: Partial<ZoomSettings["autoZoom"]>): void =>
    onSettingsChange({ ...settings, autoZoom: { ...auto, ...patch } });
  const setCamera = (patch: Partial<ZoomSettings["camera"]>): void =>
    onSettingsChange({ ...settings, camera: { ...settings.camera, ...patch } });

  return (
    <div style={rootStyle} aria-label="Zoom inspector">
      <Section title="Auto-zoom">
        {!hasTelemetry && (
          <EmptyState title="Auto-zoom unavailable">
            This recording has no cursor data, so zooms can’t be suggested. You can still add zooms
            manually on the timeline.
          </EmptyState>
        )}
        <Button
          variant="primary"
          block
          disabled={!hasTelemetry || analyzing}
          aria-busy={analyzing}
          onClick={props.onGenerate}
        >
          {props.hasSuggestions ? "Regenerate" : "Generate suggestions"}
        </Button>
        {analyzing && (
          <div role="status" style={{ ...rowStyle, color: "var(--text-2)" }}>
            <Spinner />
            Analyzing cursor activity…
          </div>
        )}
        <Slider
          label="Sensitivity"
          value={Math.round(auto.sensitivity * 100)}
          min={0}
          max={100}
          disabled={!hasTelemetry}
          onChange={(v) => setAuto({ sensitivity: v / 100 })}
        />
        <div
          style={{
            ...hintStyle,
            display: "flex",
            justifyContent: "space-between",
            paddingLeft: "104px",
          }}
        >
          <span>Fewer</span>
          <span>More</span>
        </div>
        <Switch
          label="Follow cursor while zoomed"
          checked={auto.followCursor}
          disabled={!hasTelemetry}
          onChange={(followCursor) => setAuto({ followCursor })}
        />
        <Switch
          label="Zoom on clicks"
          checked={auto.zoomOnClicks}
          disabled={!hasTelemetry}
          onChange={(zoomOnClicks) => setAuto({ zoomOnClicks })}
        />
        <Switch
          label="Zoom on typing"
          checked={auto.zoomOnTyping}
          disabled={!hasTelemetry}
          onChange={(zoomOnTyping) => setAuto({ zoomOnTyping })}
        />
      </Section>

      {selectedRegion ? (
        <RegionEditor {...props} region={selectedRegion} />
      ) : (
        <Section title="Zoom">
          <EmptyState title="No zoom selected">
            Select a zoom on the timeline or add one at the playhead (+)
          </EmptyState>
        </Section>
      )}

      <Section title="Motion">
        <Slider
          label="Camera smoothing"
          value={Math.round(settings.camera.smoothing * 100)}
          min={0}
          max={100}
          onChange={(v) => setCamera({ smoothing: v / 100 })}
        />
        <Slider
          label="Max zoom speed"
          value={settings.camera.maxZoomSpeed}
          min={MAX_ZOOM_SPEED_MIN}
          max={MAX_ZOOM_SPEED_MAX}
          step={0.5}
          unit="×/s"
          onChange={(maxZoomSpeed) => setCamera({ maxZoomSpeed })}
        />
      </Section>
    </div>
  );
}

function RegionEditor({
  region,
  onRegionChange,
  onDuplicate,
  onDelete,
  timelineDurationMs,
}: ZoomInspectorProps & { region: ZoomRegion }): ReactElement {
  const follow = region.focus.mode === "follow";
  const curveName = ZOOM_CURVES.find((c) => c.value === region.curve)?.label ?? "Ease";

  return (
    <>
      <Section title="Zoom">
        <Slider
          label="Zoom level"
          value={region.level}
          min={ZOOM_LEVEL_MIN}
          max={ZOOM_LEVEL_MAX}
          step={0.1}
          unit="×"
          onChange={(v) => onRegionChange(setLevel(region, v))}
        />
        <NumberField
          label="Level"
          value={region.level}
          min={ZOOM_LEVEL_MIN}
          max={ZOOM_LEVEL_MAX}
          step={0.1}
          unit="×"
          onChange={(v) => onRegionChange(setLevel(region, v))}
        />
      </Section>

      <Section title="Focus">
        <AnchorGrid
          label="Focus"
          value={follow ? null : focusToAnchor(region.focus)}
          disabled={follow}
          onChange={(a) => onRegionChange(setFocusAnchor(region, a))}
        />
        <Switch
          label="Follow cursor"
          checked={follow}
          onChange={(on) => onRegionChange(setFocusMode(region, on ? "follow" : "fixed"))}
        />
        <NumberField
          label="X"
          value={Math.round(region.focus.x * 100)}
          min={0}
          max={100}
          unit="%"
          disabled={follow}
          onChange={(v) => onRegionChange(setFocusPoint(region, v / 100, region.focus.y))}
        />
        <NumberField
          label="Y"
          value={Math.round(region.focus.y * 100)}
          min={0}
          max={100}
          unit="%"
          disabled={follow}
          onChange={(v) => onRegionChange(setFocusPoint(region, region.focus.x, v / 100))}
        />
        <span style={hintStyle}>Set from canvas: click the preview to place the focus.</span>
      </Section>

      <Section title="Easing">
        <NumberField
          label="Ease in"
          value={region.easeInMs}
          min={0}
          max={EASE_MS_MAX}
          step={50}
          unit="ms"
          onChange={(v) => onRegionChange(setEaseMs(region, "easeInMs", v))}
        />
        <NumberField
          label="Ease out"
          value={region.easeOutMs}
          min={0}
          max={EASE_MS_MAX}
          step={50}
          unit="ms"
          onChange={(v) => onRegionChange(setEaseMs(region, "easeOutMs", v))}
        />
        <div style={rowStyle}>
          <span style={labelStyle}>Curve</span>
          <Segmented
            name={`zoom-curve-${region.id}`}
            value={region.curve}
            options={CURVE_OPTIONS}
            onChange={(c) => onRegionChange(setCurve(region, c))}
          />
          <CurvePreview curve={region.curve} label={`${curveName} curve preview`} />
        </div>
      </Section>

      <Section title="Timing">
        <TimeField
          key={`start-${region.id}-${region.startMs}`}
          label="Start"
          valueMs={region.startMs}
          onCommit={(ms) => {
            const next = setStartMs(region, ms);
            onRegionChange(next);
            return next.startMs;
          }}
        />
        <TimeField
          key={`end-${region.id}-${region.endMs}`}
          label="End"
          valueMs={region.endMs}
          onCommit={(ms) => {
            const next = setEndMs(region, ms, timelineDurationMs);
            onRegionChange(next);
            return next.endMs;
          }}
        />
        <div style={rowStyle}>
          <span style={labelStyle}>Duration</span>
          <span
            data-testid="zoom-duration"
            style={{ fontFamily: mono, fontSize: "12px", color: "var(--text-2)" }}
          >
            {formatTimecode(regionDurationMs(region))}
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)" }}>
          <Button variant="secondary" onClick={() => onDuplicate(region.id)}>
            Duplicate
          </Button>
          <Button variant="danger" onClick={() => onDelete(region.id)}>
            Delete
          </Button>
        </div>
      </Section>
    </>
  );
}

interface TimeFieldProps {
  label: string;
  valueMs: number;
  /** Receives parsed ms; returns the value actually applied (after clamping). */
  onCommit: (ms: number) => number;
}

/** Mono editable timecode. Commits on Enter/blur; invalid text or Escape reverts. */
function TimeField({ label, valueMs, onCommit }: TimeFieldProps): ReactElement {
  const id = useId();
  const commit = (input: HTMLInputElement): void => {
    const parsed = parseTimecode(input.value);
    if (parsed === null || parsed === valueMs) {
      input.value = formatTimecode(valueMs);
      return;
    }
    input.value = formatTimecode(onCommit(parsed));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") commit(e.currentTarget);
    if (e.key === "Escape") e.currentTarget.value = formatTimecode(valueMs);
  };
  return (
    <div style={rowStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        spellCheck={false}
        defaultValue={formatTimecode(valueMs)}
        onBlur={(e) => commit(e.currentTarget)}
        onKeyDown={onKeyDown}
        style={{
          width: "96px",
          background: "var(--bg-sunken)",
          color: "var(--text-1)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-sm)",
          padding: "2px var(--space-1)",
          fontFamily: mono,
          fontSize: "12px",
        }}
      />
    </div>
  );
}

function CurvePreview({ curve, label }: { curve: ZoomCurve; label: string }): ReactElement {
  const w = 40;
  const h = 24;
  return (
    <svg
      role="img"
      aria-label={label}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{
        flex: "0 0 auto",
        background: "var(--bg-sunken)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <path
        d={curvePath(sampleCurve(curve), w, h)}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function Spinner(): ReactElement {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx={8} cy={8} r={6} fill="none" stroke="var(--border-strong)" strokeWidth={2} />
      <path
        d="M8 2 a6 6 0 0 1 6 6"
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 8 8"
          to="360 8 8"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
