import { Button } from "@design/components";
import type { CSSProperties, KeyboardEvent, ReactElement } from "react";
import {
  AnchorGrid,
  Callout,
  Card,
  ChoiceRow,
  EmptyState,
  FieldRow,
  GroupLabel,
  NumberField,
  Section,
  Slider,
  SliderScale,
  Spinner,
  Switch,
  hintStyle,
  inspectorRootStyle,
  valueBoxStyle,
} from "../controls";
import { useInspectorT } from "../i18n";
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

/** Inspector: Zoom (design guide S15 / S15b). Presentational; all state via props. */
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

const pillStyle: CSSProperties = { borderRadius: "999px", fontSize: "12px" };

export function ZoomInspector(props: ZoomInspectorProps): ReactElement {
  const t = useInspectorT();
  const { settings, onSettingsChange, selectedRegion, status, hasTelemetry } = props;
  const analyzing = status === "analyzing";
  const auto = settings.autoZoom;
  const setAuto = (patch: Partial<ZoomSettings["autoZoom"]>): void =>
    onSettingsChange({ ...settings, autoZoom: { ...auto, ...patch } });
  const setCamera = (patch: Partial<ZoomSettings["camera"]>): void =>
    onSettingsChange({ ...settings, camera: { ...settings.camera, ...patch } });

  return (
    <div style={inspectorRootStyle} aria-label={t("inspector.zoom.label")}>
      {!hasTelemetry && (
        <Callout tone="warning" title={t("inspector.zoom.unavailable.title")}>
          {t("inspector.zoom.unavailable.body")}
        </Callout>
      )}

      <Card gap="10px">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span aria-hidden="true" style={{ color: "var(--accent-hover)" }}>
            ✦
          </span>
          <span style={{ fontSize: "12px", fontWeight: 600 }}>{t("inspector.zoom.autoZoom")}</span>
        </div>
        <Button
          variant="primary"
          block
          disabled={!hasTelemetry || analyzing}
          aria-busy={analyzing}
          onClick={props.onGenerate}
          style={pillStyle}
        >
          {props.hasSuggestions ? t("inspector.zoom.regenerate") : t("inspector.zoom.generate")}
        </Button>
        {analyzing && (
          <output
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <Spinner size={18} />
            {t("inspector.zoom.analyzing")}
          </output>
        )}
        <Slider
          label={t("inspector.zoom.sensitivity")}
          value={Math.round(auto.sensitivity * 100)}
          min={0}
          max={100}
          hideValue
          labelWidth={60}
          disabled={!hasTelemetry}
          onChange={(v) => setAuto({ sensitivity: v / 100 })}
        />
        <SliderScale start={t("inspector.zoom.fewer")} end={t("inspector.zoom.more")} indent={70} />
        <Switch
          label={t("inspector.zoom.followCursorWhileZoomed")}
          checked={auto.followCursor}
          disabled={!hasTelemetry}
          onChange={(followCursor) => setAuto({ followCursor })}
        />
        <Switch
          label={t("inspector.zoom.zoomOnClicks")}
          checked={auto.zoomOnClicks}
          disabled={!hasTelemetry}
          onChange={(zoomOnClicks) => setAuto({ zoomOnClicks })}
        />
        <Switch
          label={t("inspector.zoom.zoomOnTyping")}
          checked={auto.zoomOnTyping}
          disabled={!hasTelemetry}
          onChange={(zoomOnTyping) => setAuto({ zoomOnTyping })}
        />
      </Card>

      {selectedRegion ? (
        <RegionEditor {...props} region={selectedRegion} />
      ) : (
        <EmptyState title={t("inspector.zoom.noSelection.title")} icon="⊕">
          {t("inspector.zoom.noSelection.body")}
        </EmptyState>
      )}

      <Section title={t("inspector.common.motion")}>
        <Slider
          label={t("inspector.zoom.cameraSmoothing")}
          value={Math.round(settings.camera.smoothing * 100)}
          min={0}
          max={100}
          onChange={(v) => setCamera({ smoothing: v / 100 })}
        />
        <Slider
          label={t("inspector.zoom.maxZoomSpeed")}
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

const groupStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "8px" };

function RegionEditor({
  region,
  onRegionChange,
  onDuplicate,
  onDelete,
  timelineDurationMs,
}: ZoomInspectorProps & { region: ZoomRegion }): ReactElement {
  const t = useInspectorT();
  const follow = region.focus.mode === "follow";
  const curveOptions = ZOOM_CURVES.map((c) => {
    const label = t(c.labelKey);
    return { value: c.value, label, ariaLabel: label };
  });
  const curveKey = ZOOM_CURVES.find((c) => c.value === region.curve)?.labelKey;
  const curveName = t(curveKey ?? "inspector.zoom.curve.ease");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <Slider
            label={t("inspector.zoom.zoomLevel")}
            value={region.level}
            min={ZOOM_LEVEL_MIN}
            max={ZOOM_LEVEL_MAX}
            step={0.1}
            hideValue
            labelWidth={60}
            onChange={(v) => onRegionChange(setLevel(region, v))}
          />
        </div>
        <div style={{ flex: "0 0 76px", display: "flex" }}>
          <NumberField
            inline
            label={t("inspector.zoom.level")}
            value={region.level}
            min={ZOOM_LEVEL_MIN}
            max={ZOOM_LEVEL_MAX}
            step={0.1}
            unit="×"
            onChange={(v) => onRegionChange(setLevel(region, v))}
          />
        </div>
      </div>

      <div style={groupStyle}>
        <GroupLabel>{t("inspector.zoom.focus")}</GroupLabel>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <AnchorGrid
            hideLabel
            label={t("inspector.zoom.focus")}
            value={follow ? null : focusToAnchor(region.focus)}
            disabled={follow}
            onChange={(a) => onRegionChange(setFocusAnchor(region, a))}
          />
          <div
            style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}
          >
            <Switch
              label={t("inspector.zoom.followCursor")}
              checked={follow}
              onChange={(on) => onRegionChange(setFocusMode(region, on ? "follow" : "fixed"))}
            />
            <FieldRow>
              <NumberField
                inline
                label={t("inspector.common.x")}
                value={Math.round(region.focus.x * 100)}
                min={0}
                max={100}
                unit="%"
                disabled={follow}
                onChange={(v) => onRegionChange(setFocusPoint(region, v / 100, region.focus.y))}
              />
              <NumberField
                inline
                label={t("inspector.common.y")}
                value={Math.round(region.focus.y * 100)}
                min={0}
                max={100}
                unit="%"
                disabled={follow}
                onChange={(v) => onRegionChange(setFocusPoint(region, region.focus.x, v / 100))}
              />
            </FieldRow>
            <span style={hintStyle}>{t("inspector.zoom.focusHint")}</span>
          </div>
        </div>
      </div>

      <div style={groupStyle}>
        <GroupLabel>{t("inspector.zoom.easing")}</GroupLabel>
        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <ChoiceRow
              label={t("inspector.zoom.curve")}
              value={region.curve}
              options={curveOptions}
              onChange={(c) => onRegionChange(setCurve(region, c))}
            />
          </div>
          <CurvePreview
            curve={region.curve}
            label={t("inspector.zoom.curvePreview", { curve: curveName })}
          />
        </div>
        <FieldRow>
          <NumberField
            inline
            label={t("inspector.zoom.easeIn")}
            value={region.easeInMs}
            min={0}
            max={EASE_MS_MAX}
            step={50}
            unit="ms"
            onChange={(v) => onRegionChange(setEaseMs(region, "easeInMs", v))}
          />
          <NumberField
            inline
            label={t("inspector.zoom.easeOut")}
            value={region.easeOutMs}
            min={0}
            max={EASE_MS_MAX}
            step={50}
            unit="ms"
            onChange={(v) => onRegionChange(setEaseMs(region, "easeOutMs", v))}
          />
        </FieldRow>
      </div>

      <div style={{ ...groupStyle, gap: "6px" }}>
        <GroupLabel>{t("inspector.common.timing")}</GroupLabel>
        <FieldRow>
          <TimeField
            key={`start-${region.id}-${region.startMs}`}
            label={t("inspector.common.start")}
            valueMs={region.startMs}
            onCommit={(ms) => {
              const next = setStartMs(region, ms);
              onRegionChange(next);
              return next.startMs;
            }}
          />
          <TimeField
            key={`end-${region.id}-${region.endMs}`}
            label={t("inspector.common.end")}
            valueMs={region.endMs}
            onCommit={(ms) => {
              const next = setEndMs(region, ms, timelineDurationMs);
              onRegionChange(next);
              return next.endMs;
            }}
          />
          <span
            data-testid="zoom-duration"
            aria-label={t("inspector.common.duration")}
            title={t("inspector.common.duration")}
            style={{ ...valueBoxStyle, flex: "0 0 72px", color: "var(--text-2)" }}
          >
            {formatTimecode(regionDurationMs(region))}
          </span>
        </FieldRow>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <Button variant="secondary" block onClick={() => onDuplicate(region.id)} style={pillStyle}>
          {t("inspector.common.duplicate")}
        </Button>
        <Button
          variant="ghost"
          block
          onClick={() => onDelete(region.id)}
          style={{
            ...pillStyle,
            color: "color-mix(in srgb, var(--record) 45%, var(--text-1))",
          }}
        >
          {t("inspector.common.delete")}
        </Button>
      </div>
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
    <input
      aria-label={label}
      title={label}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      defaultValue={formatTimecode(valueMs)}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={onKeyDown}
      style={{ ...valueBoxStyle, flex: "1 1 0", width: 0, outline: "none" }}
    />
  );
}

function CurvePreview({ curve, label }: { curve: ZoomCurve; label: string }): ReactElement {
  const w = 46;
  const h = 28;
  const pad = 4;
  return (
    <svg
      role="img"
      aria-label={label}
      width={w}
      height={h}
      viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`}
      style={{ flex: "0 0 auto", background: "var(--bg-sunken)", borderRadius: "8px" }}
    >
      <path
        d={curvePath(sampleCurve(curve), w, h)}
        fill="none"
        stroke="var(--accent-hover)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
