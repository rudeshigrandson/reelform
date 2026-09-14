import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
}

/** Labelled text input. Wrap in `.field` so the label sits above the control. */
export function Input({ label, id, className, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const input = (
    <input id={inputId} className={["input", className].filter(Boolean).join(" ")} {...rest} />
  );
  if (!label) return input;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      {input}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
}

export function Textarea({ label, id, className, ...rest }: TextareaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const area = (
    <textarea id={areaId} className={["input", className].filter(Boolean).join(" ")} {...rest} />
  );
  if (!label) return area;
  return (
    <div className="field">
      <label htmlFor={areaId}>{label}</label>
      {area}
    </div>
  );
}
