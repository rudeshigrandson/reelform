import { Button } from "@design/components";
import { type CSSProperties, type ReactElement, type ReactNode, useState } from "react";
import {
  AnchorGrid,
  Card,
  ChoiceRow,
  ColorField,
  EmptyState,
  FieldRow,
  GroupLabel,
  NumberField,
  Slider,
  Switch,
  anchorToPoint,
  clamp,
  hintStyle,
  inspectorRootStyle,
  monoStyle,
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

/** Glyph for each shape tile; selected tiles draw in ink on the accent. */
function ShapeGlyph({ shape, on }: { shape: WebcamShape; on: boolean }): ReactElement {
  const style: CSSProperties = {
    display: "block",
    width: shape === "pill" ? "24px" : "18px",
    height: shape === "pill" ? "14px" : "18px",
    borderRadius: shape === "square" ? 0 : shape === "rounded" ? "6px" : "999px",
    background: on ? "var(--bg-app)" : "var(--text-2)",
  };
  return <span aria-hidden="true" style={style} />;
}

const L = WEBCAM_LIMITS;

const fieldsetStyle: CSSProperties = {
  border: 0,
  margin: 0,
  padding: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "14px",
};

const textButtonStyle: CSSProperties = {
  appearance: "none",
  background: "transparent",
  border: 0,
  padding: 0,
  fontFamily: "var(--font-body)",
  fontSize: "11px",
  cursor: "pointer",
  flex: "0 0 auto",
};

const groupStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: "8px" };

export function WebcamInspector(props: WebcamInspectorProps): ReactElement {
  const t = useInspectorT();
  const { value, onChange, source, onUpload, onReplace, onRemove, onAutoSync } = props;
  const [cropOpen, setCropOpen] = useState(false);

  if (source === null) {
    return (
      <div style={inspectorRootStyle} aria-label={t("inspector.webcam.label")}>
        <EmptyState
          icon="◉"
          title={t("inspector.webcam.empty.title")}
          action={
            <Button
              variant="primary"
              onClick={onUpload}
              style={{ padding: "8px 16px", fontSize: "12px" }}
            >
              {t("inspector.webcam.upload")}
            </Button>
          }
        >
          {t("inspector.webcam.empty.body")}
        </EmptyState>
      </div>
    );
  }

  const set = <K extends keyof WebcamSettings>(key: K, v: WebcamSettings[K]) =>
    onChange({ ...value, [key]: v });
  const off = !value.enabled;
  const sourceSize = props.sourceSize ?? DEFAULT_WEBCAM_SOURCE_SIZE;
  const syncing = props.syncing === true;

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

  const title = source.kind === "recorded" ? t("inspector.webcam.recordedTitle") : source.name;
  const meta = source.kind === "recorded" ? formatDuration(source.durationMs) : null;

  return (
    <div style={inspectorRootStyle} aria-label={t("inspector.webcam.label")}>
      <Switch
        label={t("inspector.webcam.enabled")}
        checked={value.enabled}
        onChange={(v) => set("enabled", v)}
      />

      <Card
        gap="0"
        style={{ padding: "10px", flexDirection: "row", alignItems: "center", gap: "10px" }}
      >
        <span
          aria-hidden="true"
          style={{
            flex: "0 0 auto",
            width: "36px",
            height: "36px",
            boxSizing: "border-box",
            borderRadius: "999px",
            background: "linear-gradient(160deg, var(--text-3), var(--bg-panel))",
            border: "2px solid color-mix(in srgb, var(--text-1) 30%, transparent)",
          }}
        />
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div
            title={title}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
          {meta && <div style={{ ...monoStyle, color: "var(--text-3)" }}>{meta}</div>}
        </div>
        <button
          type="button"
          onClick={onReplace}
          style={{ ...textButtonStyle, color: "var(--accent-hover)" }}
        >
          {t("inspector.common.replace")}
        </button>
        <button
          type="button"
          onClick={onRemove}
          style={{ ...textButtonStyle, color: "var(--text-3)" }}
        >
          {t("inspector.common.remove")}
        </button>
      </Card>

      <fieldset
        disabled={off}
        style={{ ...fieldsetStyle, opacity: off ? 0.5 : 1 }}
        aria-label={t("inspector.webcam.settings")}
      >
        <div style={groupStyle}>
          <GroupLabel>{t("inspector.webcam.shape")}</GroupLabel>
          <ChoiceRow
            label={t("inspector.webcam.shape")}
            variant="grid"
            columns={4}
            height={36}
            value={value.shape}
            disabled={off}
            options={SHAPE_OPTIONS.map((o) => ({
              value: o.value,
              ariaLabel: t(o.labelKey),
              label: <ShapeGlyph shape={o.value} on={o.value === value.shape} />,
            }))}
            onChange={(v) => set("shape", v)}
          />
        </div>

        <Slider
          label={t("inspector.common.size")}
          labelWidth={56}
          value={value.sizePct}
          min={L.sizePct.min}
          max={L.sizePct.max}
          unit="%"
          disabled={off}
          onChange={(v) => set("sizePct", v)}
        />

        <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", minWidth: 0 }}>
          <AnchorGrid
            label={t("inspector.common.position")}
            hideLabel
            value={value.anchor}
            disabled={off}
            onChange={(a) => set("anchor", a)}
          />
          <div
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <Slider
              label={t("inspector.webcam.margin")}
              labelWidth={40}
              value={value.marginPx}
              min={L.marginPx.min}
              max={L.marginPx.max}
              format={(v) => String(v)}
              disabled={off}
              onChange={(v) => set("marginPx", v)}
            />
            <Switch
              label={t("inspector.webcam.mirror")}
              checked={value.mirror}
              disabled={off}
              onChange={(v) => set("mirror", v)}
            />
            <FieldRow>
              <NumberField
                inline
                label={t("inspector.common.x")}
                value={Math.round(point.x * 100)}
                min={0}
                max={100}
                unit="%"
                disabled={off}
                onChange={(v) => setCustom("x", v)}
              />
              <NumberField
                inline
                label={t("inspector.common.y")}
                value={Math.round(point.y * 100)}
                min={0}
                max={100}
                unit="%"
                disabled={off}
                onChange={(v) => setCustom("y", v)}
              />
            </FieldRow>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
          <Slider
            label={t("inspector.common.border")}
            labelWidth={56}
            value={value.borderWidth}
            min={L.borderWidth.min}
            max={L.borderWidth.max}
            unit=" px"
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
            labelWidth={56}
            value={value.shadow}
            min={L.shadow.min}
            max={L.shadow.max}
            unit=" %"
            disabled={off}
            onChange={(v) => set("shadow", v)}
          />
          {value.shape === "rounded" && (
            <Slider
              label={t("inspector.common.cornerRadius")}
              labelWidth={56}
              value={value.radius}
              min={L.radius.min}
              max={L.radius.max}
              unit=" px"
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <NumberField
                label={t("inspector.webcam.syncOffset")}
                labelWidth={66}
                value={value.syncOffsetMs}
                min={L.syncOffsetMs.min}
                max={L.syncOffsetMs.max}
                step={10}
                unit="ms"
                disabled={off}
                onChange={(v) => set("syncOffsetMs", clampSyncOffset(v))}
              />
            </div>
            <button
              type="button"
              disabled={off || syncing}
              aria-busy={syncing}
              onClick={onAutoSync}
              style={{
                ...textButtonStyle,
                color: "var(--accent-hover)",
                cursor: off || syncing ? "default" : "pointer",
              }}
            >
              {syncing ? t("inspector.webcam.syncing") : t("inspector.webcam.autoSync")}
            </button>
          </div>
          {props.syncNotice ? (
            <output style={{ ...hintStyle, display: "block" }}>{props.syncNotice}</output>
          ) : null}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Button
            variant="secondary"
            block
            disabled={off}
            onClick={() => setCropOpen(true)}
            style={{ padding: "9px", fontSize: "12px" }}
          >
            {t("inspector.webcam.crop")}
          </Button>
          {value.crop !== null && (
            <button
              type="button"
              disabled={off}
              onClick={() => set("crop", null)}
              style={{ ...textButtonStyle, alignSelf: "center", color: "var(--text-3)" }}
            >
              {t("inspector.webcam.resetCrop")}
            </button>
          )}
        </div>
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
