import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Icon-only square button (36×36). */
  icon?: boolean;
  /** Full-width. */
  block?: boolean;
  children?: ReactNode;
}

const variantClass: Record<Variant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
};

export function Button({
  variant = "secondary",
  icon = false,
  block = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const classes = ["btn", variantClass[variant]];
  if (icon) classes.push("btn-icon");
  if (block) classes.push("btn-block");
  if (className) classes.push(className);
  return (
    <button type={type} className={classes.join(" ")} {...rest}>
      {children}
    </button>
  );
}
