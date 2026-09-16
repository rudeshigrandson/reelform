import { Button, Segmented, Tag } from "@design/components";
import type { SegmentedOption } from "@design/components";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react";
import {
  Callout,
  ColorField,
  GroupLabel,
  Slider,
  SliderScale,
  Switch,
  hintStyle,
  inspectorRootStyle,
  useInspectorControlStyles,
} from "../controls";
import { type InspectorMessageKey, useInspectorT } from "../i18n";
import { formatPointCount, hasTelemetry, validateCustomCursorFile } from "./logic";
import {
  type ClickEffect,
  type ClickSound,
  type CursorSettings,
  type CursorStyle,
  CURSOR_LIMITS as L,
} from "./types";

export interface CursorInspectorProps {
  value: CursorSettings;
  onChange: (next: CursorSettings) => void;
  /** Tracked cursor telemetry points; `null` (or 0) = no cursor data. */
  cursorPointCount: number | null;
  /** Receives a validated PNG/SVG; host copies it into the project and sets `customCursor`. */
  onUploadCustomCursor?: ((file: File) => void) | undefined;
  /** Receives an audio file; host copies it and sets `clickSound.customSound`. */
  onUploadCustomSound?: ((file: File) => void) | undefined;
}

type OptionKeys<T> = ReadonlyArray<{ value: T; labelKey: InspectorMessageKey }>;

const STYLE_OPTIONS: OptionKeys<CursorStyle> = [
  { value: "macos", labelKey: "inspector.cursor.style.macos" },
  { value: "macos-dark", labelKey: "inspector.cursor.style.macosDark" },
  { value: "windows", labelKey: "inspector.cursor.style.windows" },
  { value: "minimal-dot", labelKey: "inspector.cursor.style.minimalDot" },
  { value: "custom", labelKey: "inspector.common.custom" },
];

const EFFECT_OPTIONS: OptionKeys<ClickEffect> = [
  { value: "none", labelKey: "inspector.common.none" },
  { value: "ripple", labelKey: "inspector.cursor.effect.ripple" },
  { value: "bounce", labelKey: "inspector.cursor.effect.bounce" },
  { value: "highlight", labelKey: "inspector.cursor.effect.highlight" },
];

const SOUND_OPTIONS: OptionKeys<ClickSound> = [
  { value: "none", labelKey: "inspector.common.none" },
  { value: "soft", labelKey: "inspector.cursor.sound.soft" },
  { value: "mechanical", labelKey: "inspector.cursor.sound.mechanical" },
  { value: "custom", labelKey: "inspector.common.custom" },
];

const fieldsetStyle: CSSProperties = {
  border: 0,
  margin: 0,
  padding: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: "14px",
};

const stackStyle = (gap: number): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: `${gap}px`,
  minWidth: 0,
});

const errorStyle: CSSProperties = { fontSize: "11px", color: "var(--accent-hover)" };

/** Labeled control group (design: uppercase label, 8px gap). */
function Group({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div role="group" aria-label={label} style={stackStyle(8)}>
      <GroupLabel>{label}</GroupLabel>
      {children}
    </div>
  );
}

const ARROW_PATH = "M6 3 L6 19 L10 15 L13 21 L15.5 20 L12.5 14 L18 14 Z";

/** Tile glyph per built-in pack (design S14 style row). Tokens only. */
function StyleGlyph({ style }: { style: CursorStyle }): ReactElement {
  switch (style) {
    case "macos":
    case "macos-dark": {
      const light = style === "macos";
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d={ARROW_PATH}
            fill={light ? "var(--text-1)" : "var(--bg-app)"}
            stroke={light ? "var(--bg-app)" : "var(--text-1)"}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      );
    }
    case "windows":
      return (
        <span aria-hidden="true" style={{ fontSize: "14px", color: "var(--text-1)" }}>
          ⌖
        </span>
      );
    case "minimal-dot":
      return (
        <span
          aria-hidden="true"
          style={{
            width: "12px",
            height: "12px",
            borderRadius: "999px",
            background: "var(--text-1)",
          }}
        />
      );
    case "custom":
      return (
        <span aria-hidden="true" style={{ color: "var(--text-3)", fontSize: "13px" }}>
          ＋
        </span>
      );
  }
}

function StyleTiles({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CursorStyle;
  onChange: (style: CursorStyle) => void;
}): ReactElement {
  const t = useInspectorT();
  useInspectorControlStyles();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "6px" }}
    >
      {STYLE_OPTIONS.map((o) => {
        const on = o.value === value;
        const name = t(o.labelKey);
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            className="rf-anchor"
            aria-checked={on}
            aria-label={name}
            title={name}
            onClick={() => onChange(o.value)}
            style={{
              appearance: "none",
              height: "44px",
              padding: 0,
              borderRadius: "10px",
              background: "var(--bg-panel-raised)",
              border:
                o.value === "custom" ? "1px dashed var(--border-strong)" : "1px solid transparent",
              outline: on ? "2px solid var(--accent)" : "none",
              outlineOffset: "2px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <StyleGlyph style={o.value} />
          </button>
        );
      })}
    </div>
  );
}

type PreviewVariant = "arrow" | "hand" | "text" | "resize";
const PREVIEW_VARIANTS: ReadonlyArray<{ id: PreviewVariant; labelKey: InspectorMessageKey }> = [
  { id: "arrow", labelKey: "inspector.cursor.variant.arrow" },
  { id: "hand", labelKey: "inspector.cursor.variant.hand" },
  { id: "text", labelKey: "inspector.cursor.variant.text" },
  { id: "resize", labelKey: "inspector.cursor.variant.resize" },
];

const PREVIEW_PATHS: Record<PreviewVariant, string> = {
  arrow: ARROW_PATH,
  hand: "M9 11 V5 a1.5 1.5 0 0 1 3 0 V10 h0.5 V8.5 a1.5 1.5 0 0 1 3 0 V11 a1.5 1.5 0 0 1 3 0 V16 a5 5 0 0 1 -5 5 h-2 a5 5 0 0 1 -4.2 -2.3 L4.5 14 a1.5 1.5 0 0 1 2.4 -1.8 Z",
  text: "M8 4 h8 v2 h-3 v12 h3 v2 h-8 v-2 h3 v-12 h-3 Z",
  resize: "M3 12 L7 8 V11 H17 V8 L21 12 L17 16 V13 H7 V16 Z",
};

/** Fill/outline per built-in pack. Tokens only. */
function packColors(style: CursorStyle): { fill: string; stroke: string } {
  return style === "macos-dark" || style === "windows"
    ? { fill: "var(--bg-app)", stroke: "var(--text-1)" }
    : { fill: "var(--text-1)", stroke: "var(--bg-app)" };
}

/** Compact strip showing the selected pack's arrow / hand / text / resize shapes. */
function CursorPreview({ style }: { style: CursorStyle }): ReactElement {
  const t = useInspectorT();
  const { fill, stroke } = packColors(style);
  return (
    <div
      aria-label={t("inspector.cursor.preview")}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "1px",
        height: "28px",
        borderRadius: "8px",
        overflow: "hidden",
        background: "var(--border)",
      }}
    >
      {PREVIEW_VARIANTS.map((v) => (
        <div
          key={v.id}
          title={t(v.labelKey)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg-sunken)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" role="img" aria-label={t(v.labelKey)}>
            {style === "minimal-dot" ? (
              <circle cx="12" cy="12" r={v.id === "text" ? 3 : 5} fill="var(--text-1)" />
            ) : (
              <path
                d={PREVIEW_PATHS[v.id]}
                fill={fill}
                stroke={stroke}
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </div>
      ))}
    </div>
  );
}

const CURSOR_ACCEPT = ".png,.svg,image/png,image/svg+xml";

/** S14 — Inspector: Cursor. Presentational; all state flows through `value` / `onChange`. */
export function CursorInspector({
  value,
  onChange,
  cursorPointCount,
  onUploadCustomCursor,
  onUploadCustomSound,
}: CursorInspectorProps): ReactElement {
  const t = useInspectorT();
  const ids = { effect: useId(), sound: useId() };
  const options = <T extends string | number>(
    list: OptionKeys<T>,
  ): ReadonlyArray<SegmentedOption<T>> =>
    list.map((o) => ({ value: o.value, label: t(o.labelKey) }));
  const cursorFileRef = useRef<HTMLInputElement>(null);
  const soundFileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const tracked = hasTelemetry(cursorPointCount);
  const controlsDisabled = !tracked || !value.show;
  const effectOff = controlsDisabled || value.clickEffect.type === "none";

  const patch = (partial: Partial<CursorSettings>): void => onChange({ ...value, ...partial });

  const handleCursorFile = (file: File | undefined): void => {
    if (!file) return;
    const result = validateCustomCursorFile(file);
    if (!result.ok) {
      setUploadError(result.error);
      return;
    }
    setUploadError(null);
    onUploadCustomCursor?.(file);
  };

  return (
    <div style={inspectorRootStyle} aria-label={t("inspector.cursor.label")}>
      <Switch
        label={t("inspector.cursor.show")}
        checked={value.show}
        disabled={!tracked}
        onChange={(show) => patch({ show })}
      />

      <fieldset
        disabled={controlsDisabled}
        style={{ ...fieldsetStyle, opacity: controlsDisabled ? 0.5 : 1 }}
      >
        <Group label={t("inspector.common.style")}>
          <StyleTiles
            label={t("inspector.cursor.cursorStyle")}
            value={value.style}
            onChange={(style) => {
              setUploadError(null);
              patch({ style });
            }}
          />
          <div style={{ color: "var(--text-3)" }}>
            {STYLE_OPTIONS.map((o) => t(o.labelKey)).join(" · ")}
          </div>

          {value.style === "custom" ? (
            <div style={stackStyle(6)}>
              <input
                ref={cursorFileRef}
                type="file"
                accept={CURSOR_ACCEPT}
                aria-label={t("inspector.cursor.customFile")}
                hidden
                onChange={(e) => {
                  handleCursorFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {value.customCursor ? (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Tag variant="outline" title={value.customCursor.path}>
                    {value.customCursor.fileName}
                  </Tag>
                  <Button
                    variant="ghost"
                    disabled={!onUploadCustomCursor}
                    onClick={() => cursorFileRef.current?.click()}
                  >
                    {t("inspector.common.replace")}
                  </Button>
                </div>
              ) : (
                <Button
                  block
                  disabled={!onUploadCustomCursor}
                  onClick={() => cursorFileRef.current?.click()}
                >
                  {t("inspector.cursor.upload")}
                </Button>
              )}
              <span style={hintStyle}>{t("inspector.cursor.customHint")}</span>
              {uploadError && (
                <span role="alert" style={errorStyle}>
                  {uploadError}
                </span>
              )}
            </div>
          ) : (
            <CursorPreview style={value.style} />
          )}
        </Group>

        <div style={stackStyle(10)}>
          <Slider
            label={t("inspector.common.size")}
            value={value.size}
            min={L.size.min}
            max={L.size.max}
            unit="%"
            labelWidth={66}
            disabled={controlsDisabled}
            onChange={(size) => patch({ size })}
          />
          <Slider
            label={t("inspector.cursor.smoothing")}
            value={value.smoothing}
            min={L.smoothing.min}
            max={L.smoothing.max}
            labelWidth={66}
            disabled={controlsDisabled}
            onChange={(smoothing) => patch({ smoothing })}
          />
          <SliderScale start={t("inspector.cursor.snappy")} end={t("inspector.cursor.silky")} />
          <Switch
            label={t("inspector.cursor.motionBlur")}
            checked={value.motionBlur.enabled}
            disabled={controlsDisabled}
            onChange={(enabled) => patch({ motionBlur: { ...value.motionBlur, enabled } })}
          />
          <Slider
            label={t("inspector.cursor.amount")}
            value={value.motionBlur.amount}
            min={L.motionBlurAmount.min}
            max={L.motionBlurAmount.max}
            labelWidth={66}
            disabled={controlsDisabled || !value.motionBlur.enabled}
            onChange={(amount) => patch({ motionBlur: { ...value.motionBlur, amount } })}
          />
          <Switch
            label={t("inspector.cursor.scaleWithZoom")}
            hint={t("inspector.cursor.scaleWithZoom.hint")}
            checked={value.scaleWithZoom}
            disabled={controlsDisabled}
            onChange={(scaleWithZoom) => patch({ scaleWithZoom })}
          />
        </div>

        <Group label={t("inspector.cursor.clickEffect")}>
          <Segmented
            name={ids.effect}
            size="sm"
            value={value.clickEffect.type}
            options={options(EFFECT_OPTIONS)}
            onChange={(type) => patch({ clickEffect: { ...value.clickEffect, type } })}
          />
          <ColorField
            label={t("inspector.common.color")}
            value={value.clickEffect.color}
            disabled={effectOff}
            onChange={(color) => patch({ clickEffect: { ...value.clickEffect, color } })}
          />
          <Slider
            label={t("inspector.cursor.effectSize")}
            value={value.clickEffect.size}
            min={L.clickEffectSize.min}
            max={L.clickEffectSize.max}
            unit="%"
            labelWidth={66}
            disabled={effectOff}
            onChange={(size) => patch({ clickEffect: { ...value.clickEffect, size } })}
          />
        </Group>

        <div style={stackStyle(9)}>
          <Switch
            label={t("inspector.cursor.sway")}
            hint={t("inspector.cursor.sway.hint")}
            checked={value.sway}
            disabled={controlsDisabled}
            onChange={(sway) => patch({ sway })}
          />
          <Switch
            label={t("inspector.cursor.hideWhenIdle")}
            checked={value.hideWhenIdle.enabled}
            disabled={controlsDisabled}
            onChange={(enabled) => patch({ hideWhenIdle: { ...value.hideWhenIdle, enabled } })}
          />
          <Slider
            label={t("inspector.cursor.delay")}
            value={value.hideWhenIdle.delaySec}
            min={L.hideIdleDelaySec.min}
            max={L.hideIdleDelaySec.max}
            step={0.5}
            unit="s"
            labelWidth={66}
            disabled={controlsDisabled || !value.hideWhenIdle.enabled}
            onChange={(delaySec) => patch({ hideWhenIdle: { ...value.hideWhenIdle, delaySec } })}
          />
          <Switch
            label={t("inspector.cursor.loop")}
            hint={t("inspector.cursor.loop.hint")}
            checked={value.loop}
            disabled={controlsDisabled}
            onChange={(loop) => patch({ loop })}
          />
        </div>

        <Group label={t("inspector.cursor.clickSound")}>
          <Segmented
            name={ids.sound}
            size="sm"
            value={value.clickSound.type}
            options={options(SOUND_OPTIONS)}
            onChange={(type) => patch({ clickSound: { ...value.clickSound, type } })}
          />
          {value.clickSound.type === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                ref={soundFileRef}
                type="file"
                accept="audio/*"
                aria-label={t("inspector.cursor.customSoundFile")}
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadCustomSound?.(file);
                  e.target.value = "";
                }}
              />
              {value.clickSound.customSound && (
                <Tag variant="outline" title={value.clickSound.customSound.path}>
                  {value.clickSound.customSound.fileName}
                </Tag>
              )}
              <Button
                variant={value.clickSound.customSound ? "ghost" : "secondary"}
                disabled={!onUploadCustomSound}
                onClick={() => soundFileRef.current?.click()}
              >
                {value.clickSound.customSound
                  ? t("inspector.common.replace")
                  : t("inspector.cursor.chooseSound")}
              </Button>
            </div>
          )}
          <Slider
            label={t("inspector.common.volume")}
            value={value.clickSound.volume}
            min={L.clickSoundVolume.min}
            max={L.clickSoundVolume.max}
            unit="%"
            labelWidth={66}
            disabled={controlsDisabled || value.clickSound.type === "none"}
            onChange={(volume) => patch({ clickSound: { ...value.clickSound, volume } })}
          />
        </Group>
      </fieldset>

      <div role="note" aria-label={t("inspector.cursor.data")}>
        {tracked ? (
          <Callout tone="success">
            <span style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span>
                {t("inspector.cursor.tracked", { points: formatPointCount(cursorPointCount) })}
              </span>
            </span>
          </Callout>
        ) : (
          <Callout tone="warning" role="status" title={`⚠ ${t("inspector.cursor.noData.title")}`}>
            <span>{t("inspector.cursor.noData.body")}</span>
            <span style={{ color: "var(--text-3)" }}>{t("inspector.cursor.noData.note")}</span>
          </Callout>
        )}
      </div>
    </div>
  );
}
