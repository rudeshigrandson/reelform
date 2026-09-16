import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  createContext,
  useContext,
  useId,
  useInsertionEffect,
  useState,
} from "react";
import { type InspectorMessageKey, useInspectorT } from "../i18n";

/**
 * Shared inspector controls (design S13–S21, component sheet S00). Every tab
 * builds from these so the rail stays visually consistent: 11px Figtree rows,
 * 4px accent-filled tracks with a 13px ink thumb, 32×18 pill toggles, sunken
 * mono value boxes, uppercase letter-spaced group labels. Tokens only.
 */

export const MONO_FONT = "var(--font-mono)";

/** Root column of every tab body (design: 14px rhythm, 11px copy). */
export const inspectorRootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "14px",
  fontFamily: "var(--font-body)",
  fontSize: "11px",
  color: "var(--text-1)",
  minWidth: 0,
};

/** Secondary explanatory copy. */
export const hintStyle: CSSProperties = { fontSize: "11px", color: "var(--text-3)" };

/** Tabular mono readout (timecodes, values). */
export const monoStyle: CSSProperties = {
  fontFamily: MONO_FONT,
  fontVariantNumeric: "tabular-nums",
  fontSize: "11px",
  color: "var(--text-1)",
};

/** Uppercase 11px section label. */
export const groupLabelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-3)",
};

/** Sunken mono input box (x / y, in / out, timecodes). */
export const valueBoxStyle: CSSProperties = {
  boxSizing: "border-box",
  minWidth: 0,
  padding: "5px 8px",
  borderRadius: "8px",
  background: "var(--bg-sunken)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-1)",
  fontFamily: MONO_FONT,
  fontVariantNumeric: "tabular-nums",
  fontSize: "11px",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  minHeight: "18px",
  fontSize: "11px",
  color: "var(--text-1)",
  minWidth: 0,
};

const labelStyle: CSSProperties = { flex: "0 0 66px", color: "var(--text-2)" };

const STYLE_ID = "rf-inspector-controls";

const CONTROLS_CSS = `
.rf-range{-webkit-appearance:none;appearance:none;flex:1 1 auto;min-width:0;height:4px;margin:4.5px 0;padding:0;border-radius:999px;cursor:pointer}
.rf-range::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:transparent}
.rf-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;margin-top:-4.5px;border:0;border-radius:999px;background:var(--text-1);box-shadow:0 2px 6px color-mix(in srgb,var(--bg-sunken) 60%,transparent)}
.rf-range:focus-visible{outline:none}
.rf-range:focus-visible::-webkit-slider-thumb{outline:2px solid var(--accent-hover);outline-offset:2px}
.rf-range:disabled{cursor:default;opacity:.45}
.rf-switch:focus-visible,.rf-choice:focus-visible,.rf-anchor:focus-visible,.rf-section-head:focus-visible{outline:2px solid var(--accent-hover);outline-offset:2px}
.rf-choice:not([aria-checked="true"]):not(:disabled):hover{color:var(--text-1);background:var(--bg-hover)}
.rf-anchor:not([aria-checked="true"]):not(:disabled):hover{background:var(--bg-hover)}
.rf-valuebox:focus-within{border-color:var(--accent)}
.rf-valuebox input{all:unset;min-width:0;flex:1 1 auto;font:inherit;color:inherit;text-align:right}
.rf-valuebox input::-webkit-inner-spin-button,.rf-valuebox input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
@keyframes rf-spin{to{transform:rotate(360deg)}}
`;

/** Track colour for sliders / off toggles: raised on the panel, panel inside a raised Card. */
const TrackContext = createContext<string>("var(--bg-panel-raised)");

/** Injects the pseudo-element rules inline styles cannot express (once per document). */
export function useInspectorControlStyles(): void {
  useInsertionEffect(() => {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CONTROLS_CSS;
    document.head.appendChild(el);
  }, []);
}

export interface SectionProps {
  title: string;
  defaultOpen?: boolean | undefined;
  /** Trailing header content (count, action). */
  aside?: ReactNode;
  children: ReactNode;
}

/** Accordion section; open by default. Header is the uppercase group label. */
export function Section({
  title,
  defaultOpen = true,
  aside,
  children,
}: SectionProps): ReactElement {
  useInspectorControlStyles();
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          type="button"
          className="rf-section-head"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          style={{
            appearance: "none",
            background: "transparent",
            border: 0,
            padding: 0,
            flex: "1 1 auto",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            textAlign: "left",
            cursor: "pointer",
            fontFamily: "var(--font-body)",
            borderRadius: "4px",
            ...groupLabelStyle,
          }}
        >
          <span>{title}</span>
          <span
            aria-hidden="true"
            style={{
              fontSize: "9px",
              color: "var(--text-3)",
              transform: open ? "none" : "rotate(-90deg)",
              transition: "transform 120ms ease",
            }}
          >
            ▾
          </span>
        </button>
        {aside}
      </div>
      {open && (
        <div id={bodyId} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {children}
        </div>
      )}
    </section>
  );
}

/** Non-collapsible uppercase label for a group of controls. */
export function GroupLabel({
  children,
  aside,
  id,
}: {
  children: ReactNode;
  aside?: ReactNode;
  id?: string | undefined;
}): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span id={id} style={groupLabelStyle}>
        {children}
      </span>
      {aside && <span style={{ marginLeft: "auto" }}>{aside}</span>}
    </div>
  );
}

export interface CardProps {
  children: ReactNode;
  gap?: string | undefined;
  style?: CSSProperties | undefined;
  "aria-label"?: string | undefined;
  role?: string | undefined;
}

/**
 * Raised 12px card (auto-zoom block, audio track, extra audio row). Sliders and
 * toggles inside switch their track to the panel colour so they stay visible.
 */
export function Card({ children, gap = "9px", style, ...rest }: CardProps): ReactElement {
  return (
    <div
      {...rest}
      style={{
        padding: "12px",
        borderRadius: "12px",
        background: "var(--bg-panel-raised)",
        display: "flex",
        flexDirection: "column",
        gap,
        minWidth: 0,
        ...style,
      }}
    >
      <TrackContext.Provider value="var(--bg-panel)">{children}</TrackContext.Provider>
    </div>
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
  /** Custom readout; defaults to `{value}{unit}`. */
  format?: ((value: number) => string) | undefined;
  /** Hide the readout (e.g. sensitivity). */
  hideValue?: boolean | undefined;
  /** Label column width in px (design varies 44–80). */
  labelWidth?: number | undefined;
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
  format,
  hideValue,
  labelWidth,
  onChange,
}: SliderProps): ReactElement {
  useInspectorControlStyles();
  const track = useContext(TrackContext);
  const id = useId();
  const span = max - min;
  const pct = span > 0 ? ((clamp(value, min, max) - min) / span) * 100 : 0;
  return (
    <div style={rowStyle}>
      <label
        htmlFor={id}
        style={
          labelWidth === undefined ? labelStyle : { ...labelStyle, flexBasis: `${labelWidth}px` }
        }
      >
        {label}
      </label>
      <input
        id={id}
        className="rf-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value), min, max))}
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}%, ${track} ${pct}%)`,
        }}
      />
      {!hideValue && (
        <span
          style={{
            ...monoStyle,
            flex: "0 0 auto",
            minWidth: "44px",
            textAlign: "right",
            whiteSpace: "nowrap",
            opacity: disabled ? 0.45 : 1,
          }}
        >
          {format ? format(value) : `${value}${unit}`}
        </span>
      )}
    </div>
  );
}

/** "Snappy ⟷ Silky" style caption under a slider, aligned to the track. */
export function SliderScale({
  start,
  end,
  indent = 76,
}: {
  start: string;
  end: string;
  indent?: number | undefined;
}): ReactElement {
  return (
    <div
      style={{
        ...hintStyle,
        display: "flex",
        justifyContent: "space-between",
        paddingLeft: `${indent}px`,
        marginTop: "-4px",
      }}
    >
      <span>{start}</span>
      <span aria-hidden="true">⟷</span>
      <span>{end}</span>
    </div>
  );
}

export interface ToggleProps {
  checked: boolean;
  label: string;
  disabled?: boolean | undefined;
  onChange: (checked: boolean) => void;
}

/** Bare 32×18 pill toggle (role="switch"), for headers and inline rows. */
export function Toggle({ checked, label, disabled, onChange }: ToggleProps): ReactElement {
  useInspectorControlStyles();
  const track = useContext(TrackContext);
  return (
    <button
      type="button"
      role="switch"
      className="rf-switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        appearance: "none",
        position: "relative",
        flex: "0 0 auto",
        width: "32px",
        height: "18px",
        borderRadius: "999px",
        border: 0,
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        background: checked ? "var(--accent)" : track,
        transition: "background 120ms ease",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "2px",
          left: checked ? "16px" : "2px",
          width: "14px",
          height: "14px",
          borderRadius: "999px",
          background: checked ? "var(--bg-app)" : "var(--text-3)",
          transition: "left 120ms ease",
        }}
      />
    </button>
  );
}

export interface SwitchProps {
  label: string;
  checked: boolean;
  disabled?: boolean | undefined;
  /** Optional secondary copy, shown after the label ("· shrinks during zooms"). */
  hint?: string | undefined;
  onChange: (checked: boolean) => void;
}

/** Label + toggle row; exposed to AT as role="switch". */
export function Switch({ label, checked, disabled, hint, onChange }: SwitchProps): ReactElement {
  return (
    <div style={{ ...rowStyle, justifyContent: "space-between" }}>
      <span style={{ color: "var(--text-2)", minWidth: 0, opacity: disabled ? 0.6 : 1 }}>
        {label}
        {hint && (
          <>
            <span aria-hidden="true" style={{ color: "var(--text-3)" }}>
              {" · "}
            </span>
            <span style={{ color: "var(--text-3)" }}>{hint}</span>
          </>
        )}
      </span>
      <Toggle label={label} checked={checked} disabled={disabled} onChange={onChange} />
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
  /**
   * Inline variant: the label sits inside the sunken box as a prefix
   * ("in 420 ms", "x 48%"); the box flexes to fill its row.
   */
  inline?: boolean | undefined;
  /** Label column width in px for the stacked variant. */
  labelWidth?: number | undefined;
  /** Overrides for the sunken box (e.g. panel fill without border inside a Card). */
  boxStyle?: CSSProperties | undefined;
  onChange: (value: number) => void;
}

/** Compact numeric field. Ignores non-finite input; clamps when bounds given. */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled,
  inline,
  labelWidth,
  boxStyle,
  onChange,
}: NumberFieldProps): ReactElement {
  useInspectorControlStyles();
  const id = useId();
  const input = (
    <input
      id={id}
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      {...(inline ? { "aria-label": label } : {})}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (e.target.value === "" || !Number.isFinite(n)) return;
        onChange(clamp(n, min ?? Number.NEGATIVE_INFINITY, max ?? Number.POSITIVE_INFINITY));
      }}
    />
  );
  const box = (grow: boolean): ReactElement => (
    <span
      className="rf-valuebox"
      style={{
        ...valueBoxStyle,
        display: "flex",
        alignItems: "center",
        gap: "4px",
        flex: grow ? "1 1 0" : "0 0 72px",
        opacity: disabled ? 0.45 : 1,
        ...boxStyle,
      }}
    >
      {inline && <span style={{ color: "var(--text-3)", flex: "0 0 auto" }}>{label}</span>}
      {input}
      {unit && <span style={{ color: "var(--text-3)", flex: "0 0 auto" }}>{unit}</span>}
    </span>
  );
  if (inline) return box(true);
  return (
    <div style={rowStyle}>
      <label
        htmlFor={id}
        style={
          labelWidth === undefined ? labelStyle : { ...labelStyle, flexBasis: `${labelWidth}px` }
        }
      >
        {label}
      </label>
      {box(false)}
    </div>
  );
}

/** Row of inline fields / value boxes sharing the width (design: gap 6px). */
export function FieldRow({ children }: { children: ReactNode }): ReactElement {
  return <div style={{ display: "flex", gap: "6px", minWidth: 0 }}>{children}</div>;
}

export interface ColorFieldProps {
  label: string;
  value: string;
  disabled?: boolean | undefined;
  /** Hide the text label (swatch-only rows). */
  hideLabel?: boolean | undefined;
  onChange: (value: string) => void;
}

/** 24px swatch (native picker underneath) + mono hex. Value is a #rrggbb string. */
export function ColorField({
  label,
  value,
  disabled,
  hideLabel,
  onChange,
}: ColorFieldProps): ReactElement {
  const id = useId();
  return (
    <div style={{ ...rowStyle, gap: "8px", opacity: disabled ? 0.45 : 1 }}>
      <label
        htmlFor={id}
        style={hideLabel ? visuallyHidden : { ...labelStyle, flexBasis: "auto", minWidth: "56px" }}
      >
        {label}
      </label>
      <span
        style={{
          position: "relative",
          flex: "0 0 auto",
          width: "24px",
          height: "24px",
          borderRadius: "8px",
          border: "1px solid var(--border-strong)",
          // User content colour (data), not chrome.
          background: value,
          boxSizing: "border-box",
        }}
      >
        <input
          id={id}
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: 0,
            border: 0,
            padding: 0,
            cursor: disabled ? "default" : "pointer",
          }}
        />
      </span>
      <span style={{ ...monoStyle, color: "var(--text-2)", textTransform: "uppercase" }}>
        {value}
      </span>
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
  /** Render only the grid (label kept for AT); design places it beside a column. */
  hideLabel?: boolean | undefined;
  onChange: (anchor: Anchor) => void;
}

const ANCHOR_LABEL_KEYS: Readonly<Record<Anchor, InspectorMessageKey>> = {
  "top-left": "inspector.anchor.topLeft",
  top: "inspector.anchor.top",
  "top-right": "inspector.anchor.topRight",
  left: "inspector.anchor.left",
  center: "inspector.anchor.center",
  right: "inspector.anchor.right",
  "bottom-left": "inspector.anchor.bottomLeft",
  bottom: "inspector.anchor.bottom",
  "bottom-right": "inspector.anchor.bottomRight",
};

/** 3×3 position picker (focus / webcam position). `null` = custom position. */
export function AnchorGrid({
  label,
  value,
  disabled,
  hideLabel,
  onChange,
}: AnchorGridProps): ReactElement {
  useInspectorControlStyles();
  const t = useInspectorT();
  const grid = (
    <div
      role="radiogroup"
      aria-label={label}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 20px)",
        gridTemplateRows: "repeat(3, 20px)",
        gap: "4px",
        flex: "0 0 auto",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {ANCHORS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          className="rf-anchor"
          aria-checked={value === a}
          aria-label={t(ANCHOR_LABEL_KEYS[a])}
          disabled={disabled}
          onClick={() => onChange(a)}
          style={{
            appearance: "none",
            width: "20px",
            height: "20px",
            padding: 0,
            borderRadius: "5px",
            border: 0,
            cursor: disabled ? "default" : "pointer",
            background: value === a ? "var(--accent)" : "var(--bg-panel-raised)",
          }}
        />
      ))}
    </div>
  );
  if (hideLabel) return grid;
  return (
    <div style={{ ...rowStyle, alignItems: "flex-start" }}>
      <span style={labelStyle}>{label}</span>
      {grid}
    </div>
  );
}

export interface ChoiceOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is not plain text (icons, glyphs). */
  ariaLabel?: string | undefined;
  title?: string | undefined;
}

export interface ChoiceRowProps<T extends string | number> {
  label: string;
  value: T;
  options: ReadonlyArray<ChoiceOption<T>>;
  onChange: (value: T) => void;
  /**
   * "chip" — 999px pills that wrap (caption styles).
   * "tile" — 8px-radius buttons (easing, animate, transitions).
   * "grid" — equal square-ish tiles in `columns` columns (shapes, tools).
   */
  variant?: "chip" | "tile" | "grid" | undefined;
  columns?: number | undefined;
  /** Tile height for the grid variant. */
  height?: number | undefined;
  disabled?: boolean | undefined;
}

/** Single-choice button group (radio semantics) in the design's chip / tile styles. */
export function ChoiceRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
  variant = "tile",
  columns = 4,
  height = 36,
  disabled,
}: ChoiceRowProps<T>): ReactElement {
  useInspectorControlStyles();
  const isGrid = variant === "grid";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={
        isGrid
          ? {
              display: "grid",
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: "6px",
            }
          : { display: "flex", flexWrap: "wrap", gap: variant === "chip" ? "5px" : "6px" }
      }
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            className="rf-choice"
            aria-checked={on}
            aria-label={o.ariaLabel}
            title={o.title ?? o.ariaLabel}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            style={{
              appearance: "none",
              border: 0,
              cursor: disabled ? "default" : "pointer",
              opacity: disabled ? 0.45 : 1,
              fontFamily: "var(--font-body)",
              fontSize: "11px",
              fontWeight: on ? 600 : 400,
              color: on ? "var(--on-accent)" : "var(--text-2)",
              background: on ? "var(--accent)" : "var(--bg-panel-raised)",
              borderRadius: variant === "chip" ? "999px" : "8px",
              padding: isGrid ? 0 : variant === "chip" ? "4px 10px" : "5px 12px",
              ...(isGrid
                ? {
                    height: `${height}px`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }
                : {}),
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  /** Glyph in the 44px circle. */
  icon?: ReactNode;
  /** Primary call to action under the copy. */
  action?: ReactNode;
  /** Small footnote under the action. */
  footnote?: ReactNode;
  children?: ReactNode;
}

/** Centered empty state (design S15b / S18b): icon circle, title, copy, action. */
export function EmptyState({
  title,
  icon,
  action,
  footnote,
  children,
}: EmptyStateProps): ReactElement {
  return (
    <div
      role="status"
      style={{
        padding: "26px 14px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
        textAlign: "center",
        color: "var(--text-1)",
      }}
    >
      {icon !== undefined && (
        <div
          aria-hidden="true"
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "999px",
            background: "var(--bg-panel-raised)",
            color: "var(--text-3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "20px",
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ fontSize: "13px", fontWeight: 600 }}>{title}</div>
      {children && <div style={{ fontSize: "11px", color: "var(--text-3)" }}>{children}</div>}
      {action}
      {footnote && <div style={{ fontSize: "10px", color: "var(--text-3)" }}>{footnote}</div>}
    </div>
  );
}

export type CalloutTone = "success" | "warning" | "danger" | "neutral";

const TONE_VAR: Readonly<Record<CalloutTone, string>> = {
  success: "var(--success)",
  warning: "var(--accent-hover)",
  danger: "var(--record)",
  neutral: "var(--text-3)",
};

export interface CalloutProps {
  tone: CalloutTone;
  title?: ReactNode;
  role?: "status" | "alert" | "note" | undefined;
  children?: ReactNode;
  style?: CSSProperties | undefined;
}

/** Tinted 12px notice (tracked / no data / unavailable / error). */
export function Callout({ tone, title, role, children, style }: CalloutProps): ReactElement {
  const c = TONE_VAR[tone];
  return (
    <div
      role={role}
      style={{
        padding: "10px 12px",
        borderRadius: "12px",
        background: `color-mix(in srgb, ${c} 13%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 38%, transparent)`,
        color: `color-mix(in srgb, ${c} 45%, var(--text-1))`,
        fontSize: "11px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        ...style,
      }}
    >
      {title && <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{title}</div>}
      {children}
    </div>
  );
}

/** 4px progress bar on a sunken track. `value` in 0–1; `null` = indeterminate. */
export function ProgressBar({
  value,
  label,
  color = "var(--accent)",
}: {
  value: number | null;
  label: string;
  color?: string | undefined;
}): ReactElement {
  const pct = value === null ? 35 : clamp(value, 0, 1) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(value === null ? {} : { "aria-valuenow": Math.round(pct) })}
      style={{ height: "4px", borderRadius: "999px", background: "var(--bg-sunken)" }}
    >
      <div style={{ width: `${pct}%`, height: "100%", borderRadius: "999px", background: color }} />
    </div>
  );
}

/** Circular 26px spinner (analysing states). */
export function Spinner({ size = 26 }: { size?: number | undefined }): ReactElement {
  useInspectorControlStyles();
  return (
    <div
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        boxSizing: "border-box",
        borderRadius: "999px",
        border: "3px solid color-mix(in srgb, var(--accent-hover) 25%, transparent)",
        borderTopColor: "var(--accent-hover)",
        animation: "rf-spin 1s linear infinite",
      }}
    />
  );
}

/** Label-left / value-right read-only row (project info, sync offset). */
export function InfoRow({
  label,
  children,
  mono,
}: {
  label: ReactNode;
  children: ReactNode;
  mono?: boolean | undefined;
}): ReactElement {
  return (
    <div style={{ ...rowStyle, justifyContent: "space-between" }}>
      <span style={{ color: "var(--text-2)" }}>{label}</span>
      <span style={mono ? monoStyle : { color: "var(--text-1)" }}>{children}</span>
    </div>
  );
}

export const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
