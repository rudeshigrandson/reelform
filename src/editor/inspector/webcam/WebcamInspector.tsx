import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Button, Segmented, type SegmentedOption } from "@design/components";
import {
  AnchorGrid,
  ColorField,
  EmptyState,
  NumberField,
  Section,
  Slider,
  Switch,
  anchorToPoint,
  clamp,
} from "../controls";
import { CropModal } from "./CropModal";
import { clampSyncOffset, formatDuration, type Size } from "./logic";
import {
  DEFAULT_WEBCAM_SOURCE_SIZE,
  WEBCAM_LIMITS,
  type CropRect,
  type WebcamSettings,
  type WebcamShape,
  type WebcamSource,
} from "./types";

/** S16 — Inspector: Webcam. Presentational; all state flows through props. */

export interface WebcamInspectorProps {
  value: WebcamSettings;
  onChange: (next: WebcamSettings) => void;
  source: WebcamSource | null;
  onUpload: () => void;
  onReplace: () => void;
  onRemove: () => void;
  /** "Auto-sync" — aligns webcam to mic by audio (§9.4). */
  onAutoSync: () => void;
  /** Probed webcam dimensions; defaults to 1280×720. */
  sourceSize?: Size | undefined;
  /** Frame shown under the crop overlay in S16b. */
  cropPreview?: ReactNode | undefined;
  onCenterOnFace?: (() => Promise<{ x: number; y: number } | null>) | undefined;
}

const SHAPE_OPTIONS: ReadonlyArray<SegmentedOption<WebcamShape>> = [
  { value: "circle", label: "Circle" },
  { value: "rounded", label: "Rounded" },
  { value: "square", label: "Square" },
  { value: "pill", label: "Pill" },
];

const L = WEBCAM_LIMITS;

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "var(--space-3)",
  fontFamily: "var(--font-body)",
  color: "var(--color-neutral-200)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  flexWrap: "wrap",
  fontSize: "13px",
};

const fieldsetStyle: CSSProperties = { border: 0, margin: 0, padding: 0, minWidth: 0 };

export function WebcamInspector(props: WebcamInspectorProps): ReactElement {
  const { value, onChange, source, onUpload, onReplace, onRemove, onAutoSync } = props;
  const [cropOpen, setCropOpen] = useState(false);

  if (source === null) {
    return (
      <div style={panelStyle} aria-label="Webcam inspector">
        <EmptyState title="Add a webcam video">
          <p style={{ margin: "0 0 var(--space-2)" }}>
            No webcam was recorded. Upload a video to show it as a bubble over your recording.
          </p>
          <Button variant="primary" onClick={onUpload}>
            Upload video…
          </Button>
        </EmptyState>
      </div>
    );
  }

  const set = <K extends keyof WebcamSettings>(key: K, v: WebcamSettings[K]) => onChange({ ...value, [key]: v });
  const off = !value.enabled;
  const sourceSize = props.sourceSize ?? DEFAULT_WEBCAM_SOURCE_SIZE;

  // With an anchor selected, X/Y mirror that anchor's point; editing them switches to custom.
  const point = value.anchor !== null ? anchorToPoint(value.anchor) : { x: value.customX, y: value.customY };
  const setCustom = (axis: "x" | "y", pct: number) => {
    const n = clamp(pct, 0, 100) / 100;
    onChange({
      ...value,
      anchor: null,
      customX: axis === "x" ? n : point.x,
      customY: axis === "y" ? n : point.y,
    });
  };

  const sourceLabel =
    source.kind === "recorded" ? `Recorded webcam (${formatDuration(source.durationMs)})` : source.name;

  return (
    <div style={panelStyle} aria-label="Webcam inspector">
      <Section title="Source">
        <Switch label="Enabled" checked={value.enabled} onChange={(v) => set("enabled", v)} />
        <div style={rowStyle}>
          <span
            title={sourceLabel}
            style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {sourceLabel}
          </span>
          <Button variant="secondary" onClick={onReplace}>
            Replace
          </Button>
          <Button variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </Section>

      <fieldset disabled={off} style={{ ...fieldsetStyle, opacity: off ? 0.5 : 1 }} aria-label="Webcam settings">
        <Section title="Shape">
          <Segmented name="webcam-shape" value={value.shape} options={SHAPE_OPTIONS} onChange={(v) => set("shape", v)} />
          <Slider
            label="Size"
            value={value.sizePct}
            min={L.sizePct.min}
            max={L.sizePct.max}
            unit="%"
            disabled={off}
            onChange={(v) => set("sizePct", v)}
          />
        </Section>

        <Section title="Position">
          <AnchorGrid label="Position" value={value.anchor} disabled={off} onChange={(a) => set("anchor", a)} />
          <NumberField
            label="X"
            value={Math.round(point.x * 100)}
            min={0}
            max={100}
            unit="%"
            disabled={off}
            onChange={(v) => setCustom("x", v)}
          />
          <NumberField
            label="Y"
            value={Math.round(point.y * 100)}
            min={0}
            max={100}
            unit="%"
            disabled={off}
            onChange={(v) => setCustom("y", v)}
          />
          <Slider
            label="Margin"
            value={value.marginPx}
            min={L.marginPx.min}
            max={L.marginPx.max}
            unit="px"
            disabled={off}
            onChange={(v) => set("marginPx", v)}
          />
        </Section>

        <Section title="Style">
          <Switch label="Mirror" checked={value.mirror} disabled={off} onChange={(v) => set("mirror", v)} />
          <Slider
            label="Border"
            value={value.borderWidth}
            min={L.borderWidth.min}
            max={L.borderWidth.max}
            unit="px"
            disabled={off}
            onChange={(v) => set("borderWidth", v)}
          />
          <ColorField
            label="Border color"
            value={value.borderColor}
            disabled={off}
            onChange={(v) => set("borderColor", v)}
          />
          <Slider
            label="Shadow"
            value={value.shadow}
            min={L.shadow.min}
            max={L.shadow.max}
            disabled={off}
            onChange={(v) => set("shadow", v)}
          />
          {value.shape === "rounded" && (
            <Slider
              label="Corner radius"
              value={value.radius}
              min={L.radius.min}
              max={L.radius.max}
              unit="px"
              disabled={off}
              onChange={(v) => set("radius", v)}
            />
          )}
          <Switch
            label="Zoom-reactive"
            hint="Shrinks during zooms to keep balance"
            checked={value.zoomReactive}
            disabled={off}
            onChange={(v) => set("zoomReactive", v)}
          />
        </Section>

        <Section title="Framing">
          <div style={rowStyle}>
            <Button variant="secondary" disabled={off} onClick={() => setCropOpen(true)}>
              Crop / reframe
            </Button>
            {value.crop !== null && (
              <Button variant="ghost" disabled={off} onClick={() => set("crop", null)}>
                Reset crop
              </Button>
            )}
          </div>
          <div style={rowStyle}>
            <NumberField
              label="Sync offset"
              value={value.syncOffsetMs}
              min={L.syncOffsetMs.min}
              max={L.syncOffsetMs.max}
              step={10}
              unit="ms"
              disabled={off}
              onChange={(v) => set("syncOffsetMs", clampSyncOffset(v))}
            />
            <Button variant="secondary" disabled={off} onClick={onAutoSync}>
              Auto-sync
            </Button>
          </div>
        </Section>
      </fieldset>

      <CropModal
        open={cropOpen && !off}
        shape={value.shape}
        sourceSize={sourceSize}
        value={value.crop}
        preview={props.cropPreview}
        onCenterOnFace={props.onCenterOnFace}
        onClose={() => setCropOpen(false)}
        onApply={(crop: CropRect) => {
          setCropOpen(false);
          set("crop", crop);
        }}
      />
    </div>
  );
}
