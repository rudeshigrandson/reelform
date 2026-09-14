import type { HTMLAttributes, ReactNode } from "react";

type TagVariant = "accent" | "accent-2" | "neutral" | "outline";

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: TagVariant;
  children?: ReactNode;
}

const variantClass: Record<TagVariant, string> = {
  accent: "tag-accent",
  "accent-2": "tag-accent-2",
  neutral: "tag-neutral",
  outline: "tag-outline",
};

export function Tag({ variant = "neutral", className, children, ...rest }: TagProps) {
  const classes = ["tag", variantClass[variant], className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
