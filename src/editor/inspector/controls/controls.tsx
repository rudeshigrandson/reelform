import { type CSSProperties, type ReactElement, type ReactNode, useId, useState } from "react";

/**
 * Shared inspector controls (design guide S13–S21). Every tab builds from these
 * so the rail stays visually consistent. Styling uses tokens only.
 */

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minHeight: "28px",
  fontSize: "13px",
  color: "var(--color-neutral-200)",
};

const labelStyle: CSSProperties = { flex: "0 0 96px", color: "var(--color-neutral-400)" };

const monoStyle: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "12px",
  color: "var(--color-neutral-300)",
  minWidth: "44px",
  textAlign: "right",
};

export interface SectionProps {
  title: string;
  defaultOpen?: boolean | undefined;
  children: ReactNode;
}

/** Collapsible accordion section; open by default. */
export function Section({ title, defaultOpen = true, children }: SectionProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section
      style={{ borderBottom: "1px solid var(--color-neutral-800)", paddingBlock: "var(--space-2)" }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        style={{
          appearance: "none",
          background: "transparent",
          border: 0,
          padding: 0,
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          fontFamily: "var(--font-body)",
          fontSize: "12px",
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--color-neutral-300)",
        }}
      >
        {open ? "▾" : "▸"} {title}
      </button>
      {open && (
        <div
          id={bodyId}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            marginTop: "var(--space-2)",
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number | undefined;
  /** Unit suffix shown after the value, e.g. "px", "%", "×". */
  unit?: string | undefined;
  disabled?: boolean | undefined;
  onChange: (value: number) => void;
}

/** Labeled range slider with a mono value readout. Clamps to [min, max]. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  disabled,
  onChange,
}: SliderProps): ReactElement {
  const id = useId();
  return (
    <div style={rowStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
        style={{ flex: "1 1 auto", accentColor: "var(--color-accent)" }}
      />
      <span style={monoStyle}>
        {value}
        {unit}
      </span>
    </div>
  );
}

export interface SwitchProps {
  label: string;
  checked: boolean;
  disabled?: boolean | undefined;
  /** Optional secondary line under the label. */
  hint?: string | undefined;
  onChange: (checked: boolean) => void;
}

/** Toggle switch; exposed to AT as role="switch". */
export function Switch({ label, checked, disabled, hint, onChange }: SwitchProps): ReactElement {
  return (
    <div style={{ ...rowStyle, justifyContent: "space-between" }}>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span>{label}</span>
        {hint && (
          <span style={{ fontSize: "11px", color: "var(--color-neutral-500)" }}>{hint}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          appearance: "none",
          flex: "0 0 auto",
          width: "32px",
          height: "18px",
          borderRadius: "999px",
          border: 0,
          padding: "2px",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
          background: checked ? "var(--color-accent)" : "var(--color-neutral-700)",
          display: "flex",
          justifyContent: checked ? "flex-end" : "flex-start",
        }}
      >
        <span
          style={{
            width: "14px",
            height: "14px",
            borderRadius: "999px",
            background: "var(--color-neutral-100)",
          }}
        />
      </button>
    </div>
  );
}

export interface NumberFieldProps {
  label: string;
  value: number;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  unit?: string | undefined;
  disabled?: boolean | undefined;
  onChange: (value: number) => void;
}

/** Compact numeric stepper. Ignores non-finite input; clamps when bounds given. */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled,
  onChange,
}: NumberFieldProps): ReactElement {
  const id = useId();
  return (
    <div style={rowStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value === "" || !Number.isFinite(n)) return;
          onChange(clamp(n, min ?? Number.NEGATIVE_INFINITY, max ?? Number.POSITIVE_INFINITY));
        }}
        style={{
          width: "72px",
          background: "var(--color-neutral-800)",
          color: "var(--color-neutral-100)",
          border: "1px solid var(--color-neutral-700)",
          borderRadius: "var(--radius-sm)",
          padding: "2px var(--space-1)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "12px",
        }}
      />
      {unit && <span style={{ color: "var(--color-neutral-500)", fontSize: "12px" }}>{unit}</span>}
    </div>
  );
}

export interface ColorFieldProps {
  label: string;
  value: string;
  disabled?: boolean | undefined;
  onChange: (value: string) => void;
}

/** Swatch + native color picker. Value is a #rrggbb string. */
export function ColorField({ label, value, disabled, onChange }: ColorFieldProps): ReactElement {
  const id = useId();
  return (
    <div style={rowStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "32px", height: "22px", border: 0, padding: 0, background: "transparent" }}
      />
      <span style={monoStyle}>{value}</span>
    </div>
  );
}

export type Anchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

export const ANCHORS: readonly Anchor[] = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;

/** Normalized (0–1) coordinates for each anchor cell. */
export function anchorToPoint(anchor: Anchor): { x: number; y: number } {
  const i = ANCHORS.indexOf(anchor);
  return { x: (i % 3) / 2, y: Math.floor(i / 3) / 2 };
}

export interface AnchorGridProps {
  label: string;
  value: Anchor | null;
  disabled?: boolean | undefined;
  onChange: (anchor: Anchor) => void;
}

/** 3×3 position picker (focus / webcam position). `null` = custom position. */
export function AnchorGrid({ label, value, disabled, onChange }: AnchorGridProps): ReactElement {
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        style={{ display: "grid", gridTemplateColumns: "repeat(3, 18px)", gap: "3px" }}
      >
        {ANCHORS.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={value === a}
            aria-label={a}
            disabled={disabled}
            onClick={() => onChange(a)}
            style={{
              appearance: "none",
              width: "18px",
              height: "18px",
              borderRadius: "4px",
              border: "1px solid var(--color-neutral-700)",
              cursor: disabled ? "default" : "pointer",
              background: value === a ? "var(--color-accent)" : "var(--color-neutral-800)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
}

/** Inline empty / disabled explanation block used by tab states. */
export function EmptyState({ title, children }: EmptyStateProps): ReactElement {
  return (
    <div
      role="status"
      style={{
        padding: "var(--space-3)",
        borderRadius: "var(--radius-md)",
        border: "1px dashed var(--color-neutral-700)",
        color: "var(--color-neutral-400)",
        fontSize: "13px",
      }}
    >
      <div style={{ color: "var(--color-neutral-200)", fontWeight: 600 }}>{title}</div>
      {children && <div style={{ marginTop: "var(--space-1)" }}>{children}</div>}
    </div>
  );
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
