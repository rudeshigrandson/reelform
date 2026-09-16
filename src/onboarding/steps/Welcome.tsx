import { Button } from "@design/components";
import type { CSSProperties } from "react";
import { ghostLink, primaryPill } from "../Shell";
import { useOnboardingT } from "../i18n";

export interface WelcomeProps {
  onNext: () => void;
  onImportProject?: (() => void) | undefined;
  onOpenTerms?: (() => void) | undefined;
  onOpenPrivacy?: (() => void) | undefined;
  appVersion?: string | null | undefined;
}

const line = (pct: number): string => `color-mix(in srgb, var(--text-1) ${pct}%, var(--text-3))`;

/** S01 — a framed recording with a zoom ring + cursor: the product's promise. */
function PromiseIllustration() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: "220px",
        height: "132px",
        flex: "none",
        boxSizing: "border-box",
        borderRadius: "var(--radius-md)",
        background: "linear-gradient(145deg, var(--color-accent-2-600), var(--accent))",
        padding: "14px",
        boxShadow: "0 12px 32px color-mix(in srgb, var(--bg-sunken) 60%, transparent)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "10px",
          background: "var(--text-1)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: "10px 10px auto",
            height: "8px",
            borderRadius: "var(--radius-full)",
            background: line(70),
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "10px",
            top: "28px",
            width: "52%",
            height: "6px",
            borderRadius: "var(--radius-full)",
            background: line(88),
          }}
        />
        <div
          style={{
            position: "absolute",
            right: "22px",
            bottom: "20px",
            width: "46px",
            height: "46px",
            boxSizing: "border-box",
            borderRadius: "var(--radius-full)",
            border: "2px solid var(--accent)",
            background: "var(--accent-soft)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: "38px",
            bottom: "34px",
            width: 0,
            height: 0,
            borderLeft: "8px solid var(--on-accent)",
            borderBottom: "12px solid transparent",
            borderTop: "4px solid transparent",
            transform: "rotate(-20deg)",
          }}
        />
      </div>
    </div>
  );
}

const footerLink: CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
};

export function Welcome({
  onNext,
  onImportProject,
  onOpenTerms,
  onOpenPrivacy,
  appVersion,
}: WelcomeProps) {
  const t = useOnboardingT();
  return (
    <section
      aria-labelledby="onboarding-welcome-title"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "22px",
          padding: "0 64px 20px",
          textAlign: "center",
        }}
      >
        <PromiseIllustration />
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h1
            id="onboarding-welcome-title"
            style={{
              margin: 0,
              fontFamily: "var(--font-heading)",
              fontWeight: "var(--font-heading-weight)" as CSSProperties["fontWeight"],
              fontSize: "28px",
              lineHeight: 1.1,
              color: "var(--text-1)",
            }}
          >
            {t("onboarding.welcome.title")}
          </h1>
          <p style={{ margin: 0, fontSize: "14px", color: "var(--text-2)" }}>
            {t("onboarding.welcome.tagline")}
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <Button
            variant="primary"
            onClick={onNext}
            style={{ ...primaryPill, padding: "11px 26px" }}
          >
            {t("onboarding.welcome.getStarted")}
          </Button>
          {onImportProject ? (
            <Button
              variant="ghost"
              onClick={onImportProject}
              style={{ ...ghostLink, fontSize: "14px", padding: "11px 18px" }}
            >
              {t("onboarding.welcome.importProject")}
            </Button>
          ) : null}
        </div>
      </div>
      <footer
        style={{
          height: "46px",
          flex: "none",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          fontSize: "11px",
          color: "var(--text-3)",
        }}
      >
        <span
          title={appVersion ? t("onboarding.welcome.version", { version: appVersion }) : undefined}
          style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
        >
          {appVersion ?? ""}
        </span>
        <span style={{ display: "flex", gap: "4px" }}>
          {onOpenTerms ? (
            <button type="button" style={footerLink} onClick={onOpenTerms}>
              {t("onboarding.welcome.terms")}
            </button>
          ) : null}
          {onOpenTerms && onOpenPrivacy ? <span aria-hidden="true">·</span> : null}
          {onOpenPrivacy ? (
            <button type="button" style={footerLink} onClick={onOpenPrivacy}>
              {t("onboarding.welcome.privacy")}
            </button>
          ) : null}
        </span>
      </footer>
    </section>
  );
}
