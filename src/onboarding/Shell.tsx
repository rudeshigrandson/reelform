import type { CSSProperties, ReactNode } from "react";
import { type OnboardingKey, useOnboardingT } from "./i18n";
import { ONBOARDING_STEPS, type OnboardingStep } from "./machine";

/** The counted steps ("Step 2 of 3"); done is a terminal confirmation. */
const COUNTED: readonly OnboardingStep[] = ONBOARDING_STEPS.filter((s) => s !== "done");

const STEP_NAME_KEY: Record<OnboardingStep, OnboardingKey> = {
  welcome: "onboarding.step.welcome",
  permissions: "onboarding.step.permissions",
  defaults: "onboarding.step.defaults",
  done: "onboarding.step.done",
};

const srOnly: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Primary pill (S01–S03 CTA): Figtree 600, not the heading face. */
export const primaryPill: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 600,
  fontSize: "14px",
  padding: "10px 24px",
};

/** Accent text link ("Import existing project", "Skip for now"). */
export const ghostLink: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  color: "var(--accent-hover)",
};

export const secondaryPill: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  fontSize: "13px",
  background: "var(--bg-panel-raised)",
  borderColor: "var(--border-strong)",
  color: "var(--text-1)",
};

export function StepTitle({
  id,
  title,
  subtitle,
}: { id: string; title: string; subtitle: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <h2
        id={id}
        style={{
          margin: 0,
          fontFamily: "var(--font-heading)",
          fontWeight: "var(--font-heading-weight)" as CSSProperties["fontWeight"],
          fontSize: "24px",
          lineHeight: 1.2,
          color: "var(--text-1)",
        }}
      >
        {title}
      </h2>
      <p style={{ margin: 0, fontSize: "13px", color: "var(--text-2)" }}>{subtitle}</p>
    </div>
  );
}

/** 64px footer bar: back/skip on the left, "Step N of 3" + CTA on the right. */
export function StepFooter({
  step,
  leading,
  children,
}: {
  step: OnboardingStep;
  leading?: ReactNode;
  children: ReactNode;
}) {
  const t = useOnboardingT();
  const index = COUNTED.indexOf(step);
  return (
    <div
      style={{
        height: "64px",
        flex: "none",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        padding: "0 40px",
      }}
    >
      <nav
        aria-label={t("onboarding.nav.label")}
        style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}
      >
        {leading}
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {index >= 0 ? (
          <>
            <span aria-hidden="true" style={{ fontSize: "11px", color: "var(--text-3)" }}>
              {t("onboarding.nav.stepOf", { number: index + 1, total: COUNTED.length })}
            </span>
            <ol aria-label={t("onboarding.nav.stepIndicator")} style={srOnly}>
              {COUNTED.map((s, i) => (
                <li
                  key={s}
                  aria-current={i === index ? "step" : undefined}
                  aria-label={t("onboarding.nav.step", {
                    number: i + 1,
                    name: t(STEP_NAME_KEY[s]),
                  })}
                />
              ))}
            </ol>
          </>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** Scrollable step body; padding follows the mockup per step. */
export function StepBody({
  padding,
  gap,
  children,
}: { padding: string; gap: string; children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap,
        padding,
      }}
    >
      {children}
    </div>
  );
}
