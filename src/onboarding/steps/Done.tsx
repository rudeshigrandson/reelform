import { Button } from "@design/components";
import { useOnboardingT } from "../i18n";

export interface DoneProps {
  onFinish: () => void;
}

export function Done({ onFinish }: DoneProps) {
  const t = useOnboardingT();
  return (
    <section
      aria-labelledby="onboarding-done-title"
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
          width: "64px",
          height: "64px",
          borderRadius: "var(--radius-full)",
          background: "var(--success)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "2rem",
          color: "var(--on-accent)",
        }}
      >
        ✓
      </div>
      <h2 id="onboarding-done-title" style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>
        {t("onboarding.done.title")}
      </h2>
      <p style={{ color: "var(--text-2)", margin: 0 }}>{t("onboarding.done.body")}</p>
      <Button variant="primary" onClick={onFinish}>
        {t("onboarding.done.startRecording")}
      </Button>
    </section>
  );
}
