import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";

/** Shared building blocks for Settings pages (semantic tokens only). */

export const headingStyle: CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: "1.4rem",
  margin: "0 0 var(--space-5)",
};

export const labelStyle: CSSProperties = {
  fontSize: "0.85rem",
  fontWeight: 600,
  color: "var(--text-2)",
};

export const helpStyle: CSSProperties = {
  fontSize: "0.8rem",
  color: "var(--text-3)",
  margin: 0,
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  marginBottom: "var(--space-5)",
};

export function PageHeading({ children }: { children: ReactNode }) {
  return <h2 style={headingStyle}>{children}</h2>;
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ marginBottom: "var(--space-6)" }}>
      <h3
        style={{
          ...labelStyle,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontSize: "0.72rem",
          color: "var(--text-3)",
          margin: "0 0 var(--space-3)",
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Label + control stacked. `label` is a plain caption; wire a11y on the control. */
export function Row({
  label,
  help,
  children,
}: {
  label?: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={rowStyle}>
      {label ? <span style={labelStyle}>{label}</span> : null}
      {children}
      {help ? <p style={helpStyle}>{help}</p> : null}
    </div>
  );
}

/** Checkbox-backed switch; the visible label is the accessible name. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  help,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean | undefined;
  help?: ReactNode;
}) {
  return (
    <div style={rowStyle}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          cursor: disabled ? "default" : "pointer",
          color: disabled ? "var(--text-3)" : "var(--text-1)",
        }}
      >
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: "var(--accent)" }}
        />
        <span>{label}</span>
      </label>
      {help ? <p style={helpStyle}>{help}</p> : null}
    </div>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  help,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean | undefined;
  help?: ReactNode;
}) {
  const id = useId();
  return (
    <div style={rowStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <select
        id={id}
        className="input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        style={{ maxWidth: "320px" }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help ? <p style={helpStyle}>{help}</p> : null}
    </div>
  );
}

/**
 * Number field that only reports valid values: parses, checks the range and
 * (optionally) integrality, and otherwise flags the input invalid without
 * patching — main would reject it as INVALID_PATCH anyway.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step,
  integer,
  onChange,
  disabled,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number | undefined;
  integer?: boolean | undefined;
  onChange: (value: number) => void;
  disabled?: boolean | undefined;
  suffix?: string | undefined;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  // Follow external changes (rollback, other windows) unless the user is typing.
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const parsed = parseSettingNumber(text, { min, max, integer });
  return (
    <div style={rowStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <input
          id={id}
          className="input"
          type="number"
          min={min}
          max={max}
          step={step ?? (integer ? 1 : "any")}
          value={text}
          aria-invalid={parsed === null}
          disabled={disabled}
          style={{ maxWidth: "140px" }}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            if (parseSettingNumber(text, { min, max, integer }) === null) setText(String(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseSettingNumber(e.target.value, { min, max, integer });
            if (n !== null && n !== value) onChange(n);
          }}
        />
        {suffix ? <span style={helpStyle}>{suffix}</span> : null}
      </div>
      {parsed === null ? (
        <p role="alert" style={{ ...helpStyle, color: "var(--danger)" }}>
          Enter {integer ? "a whole number" : "a number"} from {min} to {max}.
        </p>
      ) : null}
    </div>
  );
}

export function parseSettingNumber(
  raw: string,
  opts: { min: number; max: number; integer?: boolean | undefined },
): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < opts.min || n > opts.max) return null;
  if (opts.integer && !Number.isInteger(n)) return null;
  return n;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** Inline status line (loading / error / success). */
export function StatusText({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "danger" | "success" | "warning";
  children: ReactNode;
}) {
  const color =
    tone === "danger"
      ? "var(--danger)"
      : tone === "success"
        ? "var(--success)"
        : tone === "warning"
          ? "var(--warning)"
          : "var(--text-3)";
  return (
    <p role={tone === "danger" ? "alert" : "status"} style={{ ...helpStyle, color }}>
      {children}
    </p>
  );
}
