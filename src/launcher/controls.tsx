import { type CSSProperties, useId, useState } from "react";

/** Visually hidden but focusable / clickable native input. */
const hiddenInput: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  margin: 0,
  opacity: 0,
  cursor: "inherit",
};

export interface PillOption<T extends string> {
  value: T;
  label: string;
}

/** Sunken pill track with an accent thumb (component sheet · CONTROLS). */
export function PillSegmented<T extends string>({
  name,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  name: string;
  value: T;
  options: ReadonlyArray<PillOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  const [focused, setFocused] = useState<T | null>(null);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        flex: "none",
        background: "var(--bg-sunken)",
        borderRadius: "var(--radius-full)",
        padding: 3,
        fontSize: 12,
        width: "fit-content",
      }}
    >
      {options.map((opt) => {
        const checked = opt.value === value;
        return (
          <label
            key={opt.value}
            style={{
              position: "relative",
              padding: "6px 14px",
              borderRadius: "var(--radius-full)",
              background: checked ? "var(--accent)" : "transparent",
              color: checked ? "var(--on-accent)" : "var(--text-2)",
              fontWeight: checked ? 600 : 400,
              cursor: "pointer",
              whiteSpace: "nowrap",
              outline: focused === opt.value ? "2px solid var(--accent-hover)" : "none",
              outlineOffset: 2,
            }}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={checked}
              onChange={() => onChange(opt.value)}
              onFocus={() => setFocused(opt.value)}
              onBlur={() => setFocused(null)}
              style={hiddenInput}
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}

/** 36×20 on/off switch; `label` is rendered as the row's visible text. */
export function SwitchRow({
  label,
  checked,
  onChange,
  disabled = false,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Middle content (device select, note). */
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 36 }}>
      <label
        htmlFor={id}
        style={{
          flex: "none",
          width: 104,
          fontSize: 13,
          color: disabled ? "var(--text-3)" : "var(--text-1)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {label}
      </label>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>{children}</div>
      <span
        style={{
          position: "relative",
          flex: "none",
          width: 36,
          height: 20,
          borderRadius: "var(--radius-full)",
          background: checked ? "var(--accent)" : "var(--bg-panel-raised)",
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: "var(--radius-full)",
            background: checked ? "var(--on-accent)" : "var(--text-3)",
          }}
        />
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.currentTarget.checked)}
          style={hiddenInput}
        />
      </span>
    </div>
  );
}

/** 36px sunken pill select with a chevron. */
export function PillSelect({
  ariaLabel,
  value,
  onChange,
  disabled,
  children,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <select
        aria-label={ariaLabel}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={{
          appearance: "none",
          width: "100%",
          height: 36,
          padding: "0 32px 0 14px",
          borderRadius: "var(--radius-full)",
          background: "var(--bg-sunken)",
          border: "1px solid var(--border-strong)",
          color: "var(--text-1)",
          font: "inherit",
          fontSize: 13,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
          textOverflow: "ellipsis",
        }}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          right: 14,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--text-2)",
          pointerEvents: "none",
        }}
      >
        ⌄
      </span>
    </div>
  );
}

/** Small uppercase section label (component sheet headings). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: ".1em",
        textTransform: "uppercase",
        color: "var(--text-3)",
      }}
    >
      {children}
    </span>
  );
}
