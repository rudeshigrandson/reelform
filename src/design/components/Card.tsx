import type { HTMLAttributes, ReactNode } from "react";

type Elevation = "none" | "sm" | "md" | "lg";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: Elevation;
  children?: ReactNode;
}

const elevClass: Record<Elevation, string> = {
  none: "",
  sm: "elev-sm",
  md: "elev-md",
  lg: "elev-lg",
};

export function Card({ elevation = "none", className, children, ...rest }: CardProps) {
  const classes = ["card", elevClass[elevation], className].filter(Boolean).join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export const CardKicker = ({ children }: { children: ReactNode }) => (
  <div className="card-kicker">{children}</div>
);
export const CardTitle = ({ children }: { children: ReactNode }) => (
  <div className="card-title">{children}</div>
);
export const CardBody = ({ children }: { children: ReactNode }) => (
  <p className="card-body">{children}</p>
);
export const CardMeta = ({ children }: { children: ReactNode }) => (
  <div className="card-meta">{children}</div>
);
