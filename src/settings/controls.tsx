import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n";
import type { SystemPort } from "./services";

/**
 * Shared building blocks for Settings pages (classes in `./styles.ts`,
 * semantic tokens only). Row grammar: label + helper line, control on the right.
 */

export const headingStyle: CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontWeight: "var(--font-heading-weight)" as CSSProperties["fontWeight"],
  fontSize: "20px",
  margin: 0,
};

export const labelStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--text-1)",
};

export const helpStyle: CSSProperties = {
  fontSize: "11px",
  color: "var(--text-3)",
  margin: 0,
};

export function PageHeading({ children }: { children: ReactNode }) {
  return <h2 className="rf-set-title">{children}</h2>;
}

/** A settings page: Caprasimo title (optional actions on the right) over stacked cards. */
export function Page({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rf-set-stack">
      <div className="rf-set-head">
        <PageHeading>{title}</PageHeading>
        {actions}
      </div>
      {children}
    </div>
  );
}

/** A 16px-radius panel card of rows; `title` names the region for assistive tech. */
export function Group({
  title,
  dense,
  children,
}: {
  title: string;
  /** Toggle-list cards use 9px row padding after the first row. */
  dense?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className={dense ? "rf-set-card rf-set-card-dense" : "rf-set-card"}>
      {children}
    </section>
  );
}

/** The bare switch control (checkbox with role="switch"); label it via `id`. */
export function Toggle({
  id,
  checked,
  onChange,
  disabled,
  describedBy,
  size = "md",
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean | undefined;
  describedBy?: string | undefined;
  size?: "md" | "sm";
}) {
  return (
    <span className={size === "sm" ? "rf-set-switch rf-set-switch-sm" : "rf-set-switch"}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-describedby={describedBy}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="rf-set-switch-track" aria-hidden="true" />
      <span className="rf-set-switch-thumb" aria-hidden="true" />
    </span>
  );
}

/** Compact-panel line: muted 11px caption left, control right. */
export function Line({
  label,
  htmlFor,
  children,
}: {
  label: ReactNode;
  htmlFor?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="rf-set-line">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="rf-set-line-label">
          {label}
        </label>
      ) : (
        <span className="rf-set-line-label">{label}</span>
      )}
      {children}
    </div>
  );
}

/** Inline "Value ⌄" select for compact panels. */
export function MiniSelect<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <span className="rf-set-mini-select">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="rf-set-chevron" aria-hidden="true">
        ⌄
      </span>
    </span>
  );
}

/**
 * One settings row. `htmlFor` renders the caption as a `<label>` for that
 * control; without it the caption is plain text (wire a11y on the control).
 */
export function Row({
  label,
  help,
  htmlFor,
  notice,
  disabled,
  children,
}: {
  label?: ReactNode;
  help?: ReactNode;
  htmlFor?: string | undefined;
  /** Extra lines under the caption (validation, status). */
  notice?: ReactNode;
  disabled?: boolean | undefined;
  children?: ReactNode;
}) {
  const hasText = Boolean(label || help || notice);
  return (
    <div className="rf-set-row" data-disabled={disabled ? "true" : undefined}>
      {hasText ? (
        <div className="rf-set-row-text">
          {label ? (
            htmlFor ? (
              <label htmlFor={htmlFor} className="rf-set-label">
                {label}
              </label>
            ) : (
              <span className="rf-set-label">{label}</span>
            )
          ) : null}
          {help ? <p className="rf-set-help">{help}</p> : null}
          {notice}
        </div>
      ) : null}
      {children ? <div className="rf-set-control">{children}</div> : null}
    </div>
  );
}

/** Checkbox-backed 34×19 switch on the right; the caption is the accessible name. */
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
  const id = useId();
  const helpId = useId();
  return (
    <div className="rf-set-row" data-disabled={disabled ? "true" : undefined}>
      <div className="rf-set-row-text">
        <label htmlFor={id} className="rf-set-label">
          {label}
        </label>
        {help ? (
          <p id={helpId} className="rf-set-help">
            {help}
          </p>
        ) : null}
      </div>
      <Toggle
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        describedBy={help ? helpId : undefined}
      />
    </div>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/** Native select dressed as the 250px sunken pill. */
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
    <Row label={label} htmlFor={id} help={help} disabled={disabled}>
      <span className="rf-set-select">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value as T)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="rf-set-chevron" aria-hidden="true">
          ⌄
        </span>
      </span>
    </Row>
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
  const t = useT();
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  // Follow external changes (rollback, other windows) unless the user is typing.
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const parsed = parseSettingNumber(text, { min, max, integer });
  return (
    <Row
      label={label}
      htmlFor={id}
      disabled={disabled}
      notice={
        parsed === null ? (
          <p role="alert" className="rf-set-status" style={{ color: "var(--danger)" }}>
            {t(integer ? "settings.number.invalidInteger" : "settings.number.invalid", {
              min: String(min),
              max: String(max),
            })}
          </p>
        ) : null
      }
    >
      <input
        id={id}
        className="rf-set-number"
        type="number"
        min={min}
        max={max}
        step={step ?? (integer ? 1 : "any")}
        value={text}
        aria-invalid={parsed === null}
        disabled={disabled}
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
      {suffix ? <span className="rf-set-suffix">{suffix}</span> : null}
    </Row>
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

/** Inline accent text button that opens a URL in the browser (disabled without `system`). */
export function ExternalLink({
  url,
  system,
  children,
}: {
  url: string;
  system: SystemPort | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="rf-set-link"
      onClick={() => void system?.openExternal(url)}
      disabled={!system}
    >
      {children}
    </button>
  );
}

/** Inline status line (loading / error / success); padded as a row when directly in a card. */
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
    <p role={tone === "danger" ? "alert" : "status"} className="rf-set-status" style={{ color }}>
      {children}
    </p>
  );
}
