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

const STYLE_OPTIONS: ReadonlyArray<SegmentedOption<CursorStyle>> = [
  { value: "macos", label: "macOS" },
  { value: "macos-dark", label: "macOS Dark" },
  { value: "windows", label: "Windows" },
  { value: "minimal-dot", label: "Minimal Dot" },
  { value: "custom", label: "Custom" },
];

const EFFECT_OPTIONS: ReadonlyArray<SegmentedOption<ClickEffect>> = [
  { value: "none", label: "None" },
  { value: "ripple", label: "Ripple" },
  { value: "bounce", label: "Bounce" },
  { value: "highlight", label: "Highlight ring" },
];

const SOUND_OPTIONS: ReadonlyArray<SegmentedOption<ClickSound>> = [
  { value: "none", label: "None" },
  { value: "soft", label: "Soft" },
  { value: "mechanical", label: "Mechanical" },
  { value: "custom", label: "Custom" },
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
const PREVIEW_VARIANTS: ReadonlyArray<{ id: PreviewVariant; label: string }> = [
  { id: "arrow", label: "Arrow" },
  { id: "hand", label: "Hand" },
  { id: "text", label: "Text beam" },
  { id: "resize", label: "Resize" },
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
  const { fill, stroke } = packColors(style);
  return (
    <div
      aria-label="Cursor preview"
      style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-1)" }}
    >
      {PREVIEW_VARIANTS.map((v) => (
        <div
          key={v.id}
          title={v.label}
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
          <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label={v.label}>
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
  const ids = { style: useId(), effect: useId(), sound: useId() };
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
    <div style={rootStyle} aria-label="Cursor inspector">
      {!tracked && (
        <EmptyState title="No cursor data — rendered cursor unavailable">
          This recording has no cursor telemetry, so Reelform can’t draw a styled cursor. Any cursor
          baked into the video stays as recorded.
        </EmptyState>
      )}

      <Switch
        label="Show cursor"
        checked={value.show}
        disabled={!tracked}
        onChange={(show) => patch({ show })}
      />

      <fieldset
        disabled={controlsDisabled}
        style={{ ...fieldsetStyle, opacity: controlsDisabled ? 0.5 : 1 }}
      >
        <Section title="Style">
          <Group label="Cursor style">
            <Segmented
              name={ids.style}
              value={value.style}
              options={STYLE_OPTIONS}
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
                aria-label="Custom cursor file"
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
                    Replace
                  </Button>
                </div>
              ) : (
                <Button
                  block
                  disabled={!onUploadCustomCursor}
                  onClick={() => cursorFileRef.current?.click()}
                >
                  Upload PNG or SVG…
                </Button>
              )}
              <span style={hintStyle}>
                Replaces the arrow; other cursor types use the macOS set.
              </span>
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
            label="Size"
            value={value.size}
            min={L.size.min}
            max={L.size.max}
            unit="%"
            disabled={controlsDisabled}
            onChange={(size) => patch({ size })}
          />
        </Section>

        <Section title="Motion">
          <Slider
            label="Smoothing"
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
            <span>Snappy</span>
            <span aria-hidden="true">⟷</span>
            <span>Silky</span>
          </div>
          <Switch
            label="Motion blur"
            checked={value.motionBlur.enabled}
            disabled={controlsDisabled}
            onChange={(enabled) => patch({ motionBlur: { ...value.motionBlur, enabled } })}
          />
          <Slider
            label="Amount"
            value={value.motionBlur.amount}
            min={L.motionBlurAmount.min}
            max={L.motionBlurAmount.max}
            disabled={controlsDisabled || !value.motionBlur.enabled}
            onChange={(amount) => patch({ motionBlur: { ...value.motionBlur, amount } })}
          />
          <Switch
            label="Sway"
            hint="Subtle idle drift"
            checked={value.sway}
            disabled={controlsDisabled}
            onChange={(sway) => patch({ sway })}
          />
          <Switch
            label="Hide when idle"
            checked={value.hideWhenIdle.enabled}
            disabled={controlsDisabled}
            onChange={(enabled) => patch({ hideWhenIdle: { ...value.hideWhenIdle, enabled } })}
          />
          <Slider
            label="Delay"
            value={value.hideWhenIdle.delaySec}
            min={L.hideIdleDelaySec.min}
            max={L.hideIdleDelaySec.max}
            step={0.5}
            unit="s"
            disabled={controlsDisabled || !value.hideWhenIdle.enabled}
            onChange={(delaySec) => patch({ hideWhenIdle: { ...value.hideWhenIdle, delaySec } })}
          />
          <Switch
            label="Loop mode"
            hint="Returns to start position for seamless GIF loops"
            checked={value.loop}
            disabled={controlsDisabled}
            onChange={(loop) => patch({ loop })}
          />
        </Section>

        <Section title="Click effect">
          <Group label="Click effect">
            <Segmented
              name={ids.effect}
              value={value.clickEffect.type}
              options={EFFECT_OPTIONS}
              onChange={(type) => patch({ clickEffect: { ...value.clickEffect, type } })}
            />
          </Group>
          <ColorField
            label="Color"
            value={value.clickEffect.color}
            disabled={controlsDisabled || value.clickEffect.type === "none"}
            onChange={(color) => patch({ clickEffect: { ...value.clickEffect, color } })}
          />
          <Slider
            label="Effect size"
            value={value.clickEffect.size}
            min={L.clickEffectSize.min}
            max={L.clickEffectSize.max}
            unit="%"
            disabled={controlsDisabled || value.clickEffect.type === "none"}
            onChange={(size) => patch({ clickEffect: { ...value.clickEffect, size } })}
          />
        </Section>

        <Section title="Click sound">
          <Group label="Click sound">
            <Segmented
              name={ids.sound}
              value={value.clickSound.type}
              options={SOUND_OPTIONS}
              onChange={(type) => patch({ clickSound: { ...value.clickSound, type } })}
            />
          </Group>
          {value.clickSound.type === "custom" && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <input
                ref={soundFileRef}
                type="file"
                accept="audio/*"
                aria-label="Custom click sound file"
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
                {value.clickSound.customSound ? "Replace" : "Choose sound…"}
              </Button>
            </div>
          )}
          <Slider
            label="Volume"
            value={value.clickSound.volume}
            min={L.clickSoundVolume.min}
            max={L.clickSoundVolume.max}
            unit="%"
            disabled={controlsDisabled || value.clickSound.type === "none"}
            onChange={(volume) => patch({ clickSound: { ...value.clickSound, volume } })}
          />
        </Section>
      </fieldset>

      <Section title="Cursor data">
        {tracked ? (
          <div>
            <Tag variant="accent">Tracked ✓ {formatPointCount(cursorPointCount)}</Tag>
          </div>
        ) : (
          <div
            role="note"
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
          >
            <span style={errorStyle}>No cursor data — rendered cursor unavailable</span>
            <span style={hintStyle}>
              Cursor movement wasn’t tracked for this recording (e.g. imported video or input
              monitoring was off). Auto-zoom and cursor effects need it.
            </span>
          </div>
        )}
      </Section>
    </div>
  );
}
