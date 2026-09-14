import type { InputHTMLAttributes, ReactNode } from "react";

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  children?: ReactNode;
}

/** Single radio with the Organic dot styling. */
export function Radio({ children, className, ...rest }: RadioProps) {
  return (
    <label className={["radio", className].filter(Boolean).join(" ")}>
      <input type="radio" {...rest} />
      <span className="dot" />
      {children}
    </label>
  );
}
