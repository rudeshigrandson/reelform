/**
 * Export surface primitives (guide S22): pill buttons, pill segmented track,
 * chip group, pill select, switch and labelled option row. Inline token styles
 * only; every control keeps native semantics (radio / select / checkbox switch).
 */

import { useState } from "react";
import type { CSSProperties, FocusEvent, ReactNode } from "react";

/** Monospace + tabular numerals for sizes, durations and timecodes. */
export const mono: CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  fontVariantNumeric: "tabular-nums",
};

/** `00:42.180` (or `1:02:03.400` past an hour). */
export function formatTimecode(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

/** Focus ring only for keyboard focus (falls back to always when unsupported). */
function isKeyboardFocus(e: FocusEvent<HTMLElement>): boolean {
  try {
    return e.currentTarget.matches(":focus-visible");
  } catch {
    return true;
  }
}

const focusRing: CSSProperties = {
  outline: "2px solid var(--focus-ring)",
  outlineOffset: "1px",
};

const hiddenInput: CSSProperties = {
  position: "absolute",
  opacity: 0,
  width: 0,
  height: 0,
  margin: 0,
  pointerEvents: "none",
};

// ── Pill segmented track ───────────────────────────────────────────────────

export interface ChoiceOption<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** Tooltip (e.g. why a codec is unavailable). */
  title?: string;
}

interface ChoiceProps<T extends string | number> {
  name: string;
  value: T;
  options: ReadonlyArray<ChoiceOption<T>>;
  onChange: (value: T) => void;
  /** id of the visible row label. */
  labelledBy?: string;
  ariaLabel?: string;
  fontSize?: string;
}

function ChoiceItem<T extends string | number>(props: {
  name: string;
  option: ChoiceOption<T>;
  checked: boolean;
  onChange: (value: T) => void;
  style: (checked: boolean, disabled: boolean) => CSSProperties;
}) {
  const [ring, setRing] = useState(false);
  const { option, checked } = props;
  const disabled = option.disabled === true;
  return (
    <label
      title={option.title}
      style={{ ...props.style(checked, disabled), ...(ring ? focusRing : null) }}
    >
      <input
        type="radio"
        name={props.name}
        value={option.value}
        checked={checked}
        disabled={disabled}
        onChange={() => props.onChange(option.value)}
        onFocus={(e) => setRing(isKeyboardFocus(e))}
        onBlur={() => setRing(false)}
        style={hiddenInput}
      />
      {option.label}
    </label>
  );
}

/** Sunken pill track; the selected option fills with accent. */
export function PillSegmented<T extends string | number>(
  props: ChoiceProps<T> & { fill?: boolean; padding?: string },
): React.JSX.Element {
  const fill = props.fill ?? true;
  return (
    <div
      role="radiogroup"
      aria-labelledby={props.labelledBy}
      aria-label={props.ariaLabel}
      style={{
        display: fill ? "flex" : "inline-flex",
        flex: fill ? "1 1 auto" : "none",
        minWidth: 0,
        background: "var(--bg-sunken)",
        borderRadius: "999px",
        padding: "3px",
        fontSize: props.fontSize ?? "11px",
      }}
    >
      {props.options.map((option) => (
        <ChoiceItem
          key={option.value}
          name={props.name}
          option={option}
          checked={option.value === props.value}
          onChange={props.onChange}
          style={(checked, disabled) => ({
            position: "relative",
            flex: fill ? "1 1 0" : "none",
            minWidth: 0,
            padding: props.padding ?? "5px",
            borderRadius: "999px",
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            cursor: disabled ? "default" : "pointer",
            background: checked ? "var(--accent)" : "transparent",
            color: checked ? "var(--on-accent)" : disabled ? "var(--text-3)" : "var(--text-2)",
            fontWeight: checked ? 600 : 400,
          })}
        />
      ))}
    </div>
  );
}

/** 8px-radius chips on raised fill (codec / GIF size / fps / dither). */
export function ChipGroup<T extends string | number>(props: ChoiceProps<T>): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-labelledby={props.labelledBy}
      aria-label={props.ariaLabel}
      style={{
        flex: "1 1 auto",
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        fontSize: props.fontSize ?? "11px",
      }}
    >
      {props.options.map((option) => (
        <ChoiceItem
          key={option.value}
          name={props.name}
          option={option}
          checked={option.value === props.value}
          onChange={props.onChange}
          style={(checked, disabled) => ({
            position: "relative",
            padding: "5px 12px",
            borderRadius: "8px",
            whiteSpace: "nowrap",
            cursor: disabled ? "default" : "pointer",
            background: checked ? "var(--accent)" : "var(--bg-panel-raised)",
            color: checked ? "var(--on-accent)" : disabled ? "var(--text-3)" : "var(--text-2)",
            fontWeight: checked ? 600 : 400,
          })}
        />
      ))}
    </div>
  );
}

// ── Pill select, switch, rows ──────────────────────────────────────────────

export const pillField: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "6px 10px",
  borderRadius: "999px",
  background: "var(--bg-sunken)",
  border: "1px solid var(--border-strong)",
  color: "var(--text-1)",
  font: "inherit",
  fontSize: "11px",
  lineHeight: 1.3,
};

export function PillSelect(props: {
  id?: string;
  ariaLabel?: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [ring, setRing] = useState(false);
  return (
    <div style={{ position: "relative", flex: "1 1 auto", minWidth: 0, display: "flex" }}>
      <select
        id={props.id}
        aria-label={props.ariaLabel}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        onFocus={(e) => setRing(isKeyboardFocus(e))}
        onBlur={() => setRing(false)}
        style={{
          ...pillField,
          appearance: "none",
          WebkitAppearance: "none",
          paddingRight: "26px",
          cursor: "pointer",
          ...(ring ? focusRing : null),
        }}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          right: "10px",
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--text-3)",
          pointerEvents: "none",
        }}
      >
        ⌄
      </span>
    </div>
  );
}

/** 32×18 pill switch around a native checkbox with role="switch". */
export function Switch(props: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** "between" puts the label left and the switch at the far right. */
  layout?: "between" | "inline";
}): React.JSX.Element {
  const [ring, setRing] = useState(false);
  const between = props.layout !== "inline";
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: between ? "space-between" : "flex-start",
        gap: "7px",
        color: "var(--text-2)",
        cursor: "pointer",
        position: "relative",
      }}
    >
      <span>{props.label}</span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={props.checked}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        onFocus={(e) => setRing(isKeyboardFocus(e))}
        onBlur={() => setRing(false)}
        style={hiddenInput}
      />
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          flex: "none",
          width: "32px",
          height: "18px",
          borderRadius: "999px",
          background: props.checked ? "var(--accent)" : "var(--bg-panel-raised)",
          ...(ring ? focusRing : null),
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "2px",
            left: props.checked ? "16px" : "2px",
            width: "14px",
            height: "14px",
            borderRadius: "999px",
            background: props.checked ? "var(--bg-app)" : "var(--text-3)",
            transition: "left 120ms ease",
          }}
        />
      </span>
    </label>
  );
}

/** Label column (76px, text-2) + control. Pass `htmlFor` for a single field. */
export function OptionRow(props: {
  label: ReactNode;
  labelId?: string;
  htmlFor?: string;
  labelWidth?: number;
  children: ReactNode;
}): React.JSX.Element {
  const labelStyle: CSSProperties = {
    width: `${props.labelWidth ?? 76}px`,
    flex: "none",
    color: "var(--text-2)",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
      {props.htmlFor ? (
        <label id={props.labelId} htmlFor={props.htmlFor} style={labelStyle}>
          {props.label}
        </label>
      ) : (
        <span id={props.labelId} style={labelStyle}>
          {props.label}
        </span>
      )}
      {props.children}
    </div>
  );
}

/** Hint under a row, aligned with the controls column. */
export function RowHint(props: {
  children: ReactNode;
  mono?: boolean;
  tone?: "muted" | "warning";
  testId?: string;
}): React.JSX.Element {
  return (
    <div
      data-testid={props.testId}
      style={{
        paddingLeft: "86px",
        color: props.tone === "warning" ? "var(--warning)" : "var(--text-3)",
        ...(props.mono ? mono : null),
      }}
    >
      {props.children}
    </div>
  );
}

/** 28px tinted status circle (✓ success / ! danger). */
export function StatusGlyph(props: { tone: "success" | "danger"; size?: number }) {
  const size = props.size ?? 28;
  const color = props.tone === "success" ? "var(--success)" : "var(--record)";
  return (
    <span
      aria-hidden="true"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        flex: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "999px",
        background: `color-mix(in srgb, ${color} 20%, transparent)`,
        color:
          props.tone === "success"
            ? "var(--success)"
            : "color-mix(in srgb, var(--record) 70%, var(--text-1))",
        fontSize: size < 28 ? "13px" : "14px",
        fontWeight: 700,
      }}
    >
      {props.tone === "success" ? "✓" : "!"}
    </span>
  );
}

/** 6px (or 4px) sunken bar with an accent fill. */
export function ProgressTrack(props: {
  fraction: number;
  label?: string;
  height?: number;
}): React.JSX.Element {
  const f = Number.isFinite(props.fraction) ? props.fraction : 0;
  const pct = Math.round(Math.min(1, Math.max(0, f)) * 100);
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: read-only progress indicator
    <div
      role="progressbar"
      aria-label={props.label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: `${props.height ?? 6}px`,
        borderRadius: "999px",
        background: "var(--bg-sunken)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: "999px",
          background: "var(--accent)",
          transition: "width 160ms linear",
        }}
      />
    </div>
  );
}

/** Warm gradient placeholder with an inner "screen" (brand ramps only). */
export function ThumbPlaceholder(props: {
  width?: string;
  height: string;
  radius?: string;
  inner?: boolean;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div
      aria-hidden={props.children ? undefined : "true"}
      style={{
        position: "relative",
        width: props.width ?? "100%",
        height: props.height,
        flex: "none",
        borderRadius: props.radius ?? "12px",
        background: "linear-gradient(145deg, var(--color-accent-2-500), var(--color-accent-600))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {props.inner ? (
        <div
          style={{
            width: "78%",
            height: "70%",
            borderRadius: "6px",
            background: "var(--color-neutral-100)",
          }}
        />
      ) : null}
      {props.children}
    </div>
  );
}
