import type { ReactNode } from "react";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string | number> {
  /** Radio-group name; defaults are fine when only one group is on screen. */
  name: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  className?: string;
}

/** Segmented (pill) control — a styled radio group, one option selected. */
export function Segmented<T extends string | number>({
  name,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div className={["seg", className].filter(Boolean).join(" ")} role="radiogroup">
      {options.map((opt) => (
        <label key={opt.value} className="seg-opt">
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={opt.value === value}
            onChange={() => onChange(opt.value)}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}
