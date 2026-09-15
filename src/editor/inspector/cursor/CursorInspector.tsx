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
import { ColorField, EmptyState, Section, Slider, Switch } from "../controls";
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

const rootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  fontFamily: "var(--font-body)",
  color: "var(--text-1)",
};

const fieldsetStyle: CSSProperties = { border: 0, margin: 0, padding: 0, minWidth: 0 };

const hintStyle: CSSProperties = { fontSize: "11px", color: "var(--text-3)" };

const errorStyle: CSSProperties = {
  fontSize: "12px",
  color: "var(--warning)",
};

const groupLabelStyle: CSSProperties = { fontSize: "13px", color: "var(--text-2)" };

function Group({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
    >
      <span style={groupLabelStyle}>{label}</span>
      {children}
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
  arrow: "M6 3 L6 19 L10 15 L13 21 L15.5 20 L12.5 14 L18 14 Z",
  hand: "M9 11 V5 a1.5 1.5 0 0 1 3 0 V10 h0.5 V8.5 a1.5 1.5 0 0 1 3 0 V11 a1.5 1.5 0 0 1 3 0 V16 a5 5 0 0 1 -5 5 h-2 a5 5 0 0 1 -4.2 -2.3 L4.5 14 a1.5 1.5 0 0 1 2.4 -1.8 Z",
  text: "M8 4 h8 v2 h-3 v12 h3 v2 h-8 v-2 h3 v-12 h-3 Z",
  resize: "M3 12 L7 8 V11 H17 V8 L21 12 L17 16 V13 H7 V16 Z",
};

/** Fill/outline per built-in pack. Tokens only. */
function packColors(style: CursorStyle): { fill: string; stroke: string } {
  switch (style) {
    case "macos-dark":
      return { fill: "var(--color-neutral-100)", stroke: "var(--color-neutral-900)" };
    case "windows":
      return { fill: "var(--color-neutral-100)", stroke: "var(--color-neutral-900)" };
    default:
      return { fill: "var(--color-neutral-900)", stroke: "var(--color-neutral-100)" };
  }
}

function CursorPreview({ style }: { style: CursorStyle }): ReactElement {
  const t = useInspectorT();
  const { fill, stroke } = packColors(style);
  return (
    <div
      aria-label={t("inspector.cursor.preview")}
      style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-1)" }}
    >
      {PREVIEW_VARIANTS.map((v) => (
        <div
          key={v.id}
          title={t(v.labelKey)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "44px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-sunken)",
            border: "1px solid var(--border-strong)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label={t(v.labelKey)}>
            {style === "minimal-dot" ? (
              <circle
                cx="12"
                cy="12"
                r={v.id === "text" ? 3 : 5}
                fill={stroke}
                stroke={fill}
                strokeWidth="1"
              />
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
  const ids = { style: useId(), effect: useId(), sound: useId() };
  const options = <T extends string | number>(
    list: OptionKeys<T>,
  ): ReadonlyArray<SegmentedOption<T>> =>
    list.map((o) => ({ value: o.value, label: t(o.labelKey) }));
  const cursorFileRef = useRef<HTMLInputElement>(null);
  const soundFileRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const tracked = hasTelemetry(cursorPointCount);
  const controlsDisabled = !tracked || !value.show;

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
    <div style={rootStyle} aria-label={t("inspector.cursor.label")}>
      {!tracked && (
        <EmptyState title={t("inspector.cursor.noData.title")}>
          {t("inspector.cursor.noData.body")}
        </EmptyState>
      )}

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
        <Section title={t("inspector.common.style")}>
          <Group label={t("inspector.cursor.cursorStyle")}>
            <Segmented
              name={ids.style}
              value={value.style}
              options={options(STYLE_OPTIONS)}
              onChange={(style) => {
                setUploadError(null);
                patch({ style });
              }}
            />
          </Group>

          {value.style === "custom" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
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
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
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

          <Slider
            label={t("inspector.common.size")}
            value={value.size}
            min={L.size.min}
            max={L.size.max}
            unit="%"
            disabled={controlsDisabled}
            onChange={(size) => patch({ size })}
          />
          <Switch
            label={t("inspector.cursor.scaleWithZoom")}
            hint={t("inspector.cursor.scaleWithZoom.hint")}
            checked={value.scaleWithZoom}
            disabled={controlsDisabled}
            onChange={(scaleWithZoom) => patch({ scaleWithZoom })}
          />
        </Section>

        <Section title={t("inspector.common.motion")}>
          <Slider
            label={t("inspector.cursor.smoothing")}
            value={value.smoothing}
            min={L.smoothing.min}
            max={L.smoothing.max}
            disabled={controlsDisabled}
            onChange={(smoothing) => patch({ smoothing })}
          />
          <div
            style={{
              ...hintStyle,
              display: "flex",
              justifyContent: "space-between",
              paddingLeft: "104px",
            }}
          >
            <span>{t("inspector.cursor.snappy")}</span>
            <span aria-hidden="true">⟷</span>
            <span>{t("inspector.cursor.silky")}</span>
          </div>
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
            disabled={controlsDisabled || !value.motionBlur.enabled}
            onChange={(amount) => patch({ motionBlur: { ...value.motionBlur, amount } })}
          />
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
        </Section>

        <Section title={t("inspector.cursor.clickEffect")}>
          <Group label={t("inspector.cursor.clickEffect")}>
            <Segmented
              name={ids.effect}
              value={value.clickEffect.type}
              options={options(EFFECT_OPTIONS)}
              onChange={(type) => patch({ clickEffect: { ...value.clickEffect, type } })}
            />
          </Group>
          <ColorField
            label={t("inspector.common.color")}
            value={value.clickEffect.color}
            disabled={controlsDisabled || value.clickEffect.type === "none"}
            onChange={(color) => patch({ clickEffect: { ...value.clickEffect, color } })}
          />
          <Slider
            label={t("inspector.cursor.effectSize")}
            value={value.clickEffect.size}
            min={L.clickEffectSize.min}
            max={L.clickEffectSize.max}
            unit="%"
            disabled={controlsDisabled || value.clickEffect.type === "none"}
            onChange={(size) => patch({ clickEffect: { ...value.clickEffect, size } })}
          />
        </Section>

        <Section title={t("inspector.cursor.clickSound")}>
          <Group label={t("inspector.cursor.clickSound")}>
            <Segmented
              name={ids.sound}
              value={value.clickSound.type}
              options={options(SOUND_OPTIONS)}
              onChange={(type) => patch({ clickSound: { ...value.clickSound, type } })}
            />
          </Group>
          {value.clickSound.type === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
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
            disabled={controlsDisabled || value.clickSound.type === "none"}
            onChange={(volume) => patch({ clickSound: { ...value.clickSound, volume } })}
          />
        </Section>
      </fieldset>

      <Section title={t("inspector.cursor.data")}>
        {tracked ? (
          <div>
            <Tag variant="accent">
              {t("inspector.cursor.tracked", { points: formatPointCount(cursorPointCount) })}
            </Tag>
          </div>
        ) : (
          <div
            role="note"
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
          >
            <span style={errorStyle}>{t("inspector.cursor.noData.title")}</span>
            <span style={hintStyle}>{t("inspector.cursor.noData.note")}</span>
          </div>
        )}
      </Section>
    </div>
  );
}
