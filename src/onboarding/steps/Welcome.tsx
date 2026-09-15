import { Button } from "@design/components";
import { useOnboardingT } from "../i18n";

export interface WelcomeProps {
  onNext: () => void;
  onImportProject?: (() => void) | undefined;
  onOpenTerms?: (() => void) | undefined;
  appVersion?: string | null | undefined;
}

/** S01 — a mini framed recording with a zoom + cursor: the product's promise. */
function PromiseIllustration() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: "280px",
        height: "150px",
        borderRadius: "var(--radius-md)",
        background: "linear-gradient(135deg, var(--accent-soft), var(--bg-panel-raised))",
        display: "grid",
        placeItems: "center",
        position: "relative",
      }}
    >
      <div
        style={{
          width: "200px",
          height: "112px",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-md)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "14px",
            background: "var(--bg-sunken)",
            borderBottom: "1px solid var(--border)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "84px",
            top: "40px",
            width: "72px",
            height: "44px",
            border: "2px solid var(--accent)",
            borderRadius: "var(--radius-xs)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "132px",
            top: "70px",
            width: 0,
            height: 0,
            borderLeft: "7px solid transparent",
            borderRight: "7px solid transparent",
            borderBottom: "14px solid var(--text-1)",
            transform: "rotate(-30deg)",
          }}
        />
      </div>
    </div>
  );
}

export function Welcome({ onNext, onImportProject, onOpenTerms, appVersion }: WelcomeProps) {
  const t = useOnboardingT();
  return (
    <section
      aria-labelledby="onboarding-welcome-title"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-4)",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "var(--radius-md)",
          background: "var(--accent)",
          color: "var(--on-accent)",
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--font-heading)",
          fontSize: "24px",
        }}
      >
        R
      </div>
      <h1
        id="onboarding-welcome-title"
        style={{ fontSize: "28px", fontWeight: 600, color: "var(--text-1)", margin: 0 }}
      >
        {t("onboarding.welcome.title")}
      </h1>
      <p style={{ color: "var(--text-2)", margin: 0 }}>{t("onboarding.welcome.tagline")}</p>
      <PromiseIllustration />
      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <Button variant="primary" onClick={onNext}>
          {t("onboarding.welcome.getStarted")}
        </Button>
        {onImportProject ? (
          <Button variant="ghost" onClick={onImportProject}>
            {t("onboarding.welcome.importProject")}
          </Button>
        ) : null}
      </div>
      <footer
        style={{ display: "flex", gap: "var(--space-3)", color: "var(--text-3)", fontSize: "12px" }}
      >
        {appVersion ? (
          <span>{t("onboarding.welcome.version", { version: appVersion })}</span>
        ) : null}
        {onOpenTerms ? (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: 0, minHeight: 0, fontSize: "inherit" }}
            onClick={onOpenTerms}
          >
            {t("onboarding.welcome.terms")}
          </button>
        ) : null}
      </footer>
    </section>
  );
}
