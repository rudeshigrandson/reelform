import { Button, Segmented } from "@design/components";
import { type CSSProperties, type ReactElement, type ReactNode, useState } from "react";
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
import { type InspectorMessageKey, useInspectorT } from "../i18n";
import { CropModal } from "./CropModal";
import { type Size, clampSyncOffset, formatDuration } from "./logic";
import {
  type CropRect,
  DEFAULT_WEBCAM_SOURCE_SIZE,
  WEBCAM_LIMITS,
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
  /** True while auto-sync decodes and correlates audio. */
  syncing?: boolean | undefined;
  /** Result or failure line under the sync row. */
  syncNotice?: string | null | undefined;
  /** Probed webcam dimensions; defaults to 1280×720. */
  sourceSize?: Size | undefined;
  /** Frame shown under the crop overlay in S16b. */
  cropPreview?: ReactNode | undefined;
  onCenterOnFace?: (() => Promise<{ x: number; y: number } | null>) | undefined;
}

const SHAPE_OPTIONS: ReadonlyArray<{ value: WebcamShape; labelKey: InspectorMessageKey }> = [
  { value: "circle", labelKey: "inspector.webcam.shape.circle" },
  { value: "rounded", labelKey: "inspector.webcam.shape.rounded" },
  { value: "square", labelKey: "inspector.webcam.shape.square" },
  { value: "pill", labelKey: "inspector.webcam.shape.pill" },
];

const L = WEBCAM_LIMITS;

const panelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "var(--space-3)",
  fontFamily: "var(--font-body)",
  color: "var(--text-1)",
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
  const t = useInspectorT();
  const { value, onChange, source, onUpload, onReplace, onRemove, onAutoSync } = props;
  const [cropOpen, setCropOpen] = useState(false);

  if (source === null) {
    return (
      <div style={panelStyle} aria-label={t("inspector.webcam.label")}>
        <EmptyState title={t("inspector.webcam.empty.title")}>
          <p style={{ margin: "0 0 var(--space-2)" }}>{t("inspector.webcam.empty.body")}</p>
          <Button variant="primary" onClick={onUpload}>
            {t("inspector.webcam.upload")}
          </Button>
        </EmptyState>
      </div>
    );
  }

  const set = <K extends keyof WebcamSettings>(key: K, v: WebcamSettings[K]) =>
    onChange({ ...value, [key]: v });
  const off = !value.enabled;
  const sourceSize = props.sourceSize ?? DEFAULT_WEBCAM_SOURCE_SIZE;

  // With an anchor selected, X/Y mirror that anchor's point; editing them switches to custom.
  const point =
    value.anchor !== null ? anchorToPoint(value.anchor) : { x: value.customX, y: value.customY };
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
    source.kind === "recorded"
      ? t("inspector.webcam.recorded", { duration: formatDuration(source.durationMs) })
      : source.name;

  return (
    <div style={panelStyle} aria-label={t("inspector.webcam.label")}>
      <Section title={t("inspector.common.source")}>
        <Switch
          label={t("inspector.webcam.enabled")}
          checked={value.enabled}
          onChange={(v) => set("enabled", v)}
        />
        <div style={rowStyle}>
          <span
            title={sourceLabel}
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {sourceLabel}
          </span>
          <Button variant="secondary" onClick={onReplace}>
            {t("inspector.common.replace")}
          </Button>
          <Button variant="danger" onClick={onRemove}>
            {t("inspector.common.remove")}
          </Button>
        </div>
      </Section>

      <fieldset
        disabled={off}
        style={{ ...fieldsetStyle, opacity: off ? 0.5 : 1 }}
        aria-label={t("inspector.webcam.settings")}
      >
        <Section title={t("inspector.webcam.shape")}>
          <Segmented
            name="webcam-shape"
            value={value.shape}
            options={SHAPE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(v) => set("shape", v)}
          />
          <Slider
            label={t("inspector.common.size")}
            value={value.sizePct}
            min={L.sizePct.min}
            max={L.sizePct.max}
            unit="%"
            disabled={off}
            onChange={(v) => set("sizePct", v)}
          />
        </Section>

        <Section title={t("inspector.common.position")}>
          <AnchorGrid
            label={t("inspector.common.position")}
            value={value.anchor}
            disabled={off}
            onChange={(a) => set("anchor", a)}
          />
          <NumberField
            label={t("inspector.common.x")}
            value={Math.round(point.x * 100)}
            min={0}
            max={100}
            unit="%"
            disabled={off}
            onChange={(v) => setCustom("x", v)}
          />
          <NumberField
            label={t("inspector.common.y")}
            value={Math.round(point.y * 100)}
            min={0}
            max={100}
            unit="%"
            disabled={off}
            onChange={(v) => setCustom("y", v)}
          />
          <Slider
            label={t("inspector.webcam.margin")}
            value={value.marginPx}
            min={L.marginPx.min}
            max={L.marginPx.max}
            unit="px"
            disabled={off}
            onChange={(v) => set("marginPx", v)}
          />
        </Section>

        <Section title={t("inspector.common.style")}>
          <Switch
            label={t("inspector.webcam.mirror")}
            checked={value.mirror}
            disabled={off}
            onChange={(v) => set("mirror", v)}
          />
          <Slider
            label={t("inspector.common.border")}
            value={value.borderWidth}
            min={L.borderWidth.min}
            max={L.borderWidth.max}
            unit="px"
            disabled={off}
            onChange={(v) => set("borderWidth", v)}
          />
          <ColorField
            label={t("inspector.common.borderColor")}
            value={value.borderColor}
            disabled={off}
            onChange={(v) => set("borderColor", v)}
          />
          <Slider
            label={t("inspector.common.shadow")}
            value={value.shadow}
            min={L.shadow.min}
            max={L.shadow.max}
            disabled={off}
            onChange={(v) => set("shadow", v)}
          />
          {value.shape === "rounded" && (
            <Slider
              label={t("inspector.common.cornerRadius")}
              value={value.radius}
              min={L.radius.min}
              max={L.radius.max}
              unit="px"
              disabled={off}
              onChange={(v) => set("radius", v)}
            />
          )}
          <Switch
            label={t("inspector.webcam.zoomReactive")}
            hint={t("inspector.webcam.zoomReactive.hint")}
            checked={value.zoomReactive}
            disabled={off}
            onChange={(v) => set("zoomReactive", v)}
          />
        </Section>

        <Section title={t("inspector.webcam.framing")}>
          <div style={rowStyle}>
            <Button variant="secondary" disabled={off} onClick={() => setCropOpen(true)}>
              {t("inspector.webcam.crop")}
            </Button>
            {value.crop !== null && (
              <Button variant="ghost" disabled={off} onClick={() => set("crop", null)}>
                {t("inspector.webcam.resetCrop")}
              </Button>
            )}
          </div>
          <div style={rowStyle}>
            <NumberField
              label={t("inspector.webcam.syncOffset")}
              value={value.syncOffsetMs}
              min={L.syncOffsetMs.min}
              max={L.syncOffsetMs.max}
              step={10}
              unit="ms"
              disabled={off}
              onChange={(v) => set("syncOffsetMs", clampSyncOffset(v))}
            />
            <Button
              variant="secondary"
              disabled={off || props.syncing === true}
              aria-busy={props.syncing === true}
              onClick={onAutoSync}
            >
              {props.syncing === true
                ? t("inspector.webcam.syncing")
                : t("inspector.webcam.autoSync")}
            </Button>
          </div>
          {props.syncNotice ? (
            <output style={{ display: "block", fontSize: "12px", color: "var(--text-2)" }}>
              {props.syncNotice}
            </output>
          ) : null}
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
