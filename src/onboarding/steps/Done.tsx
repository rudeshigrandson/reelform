import { Button } from "@design/components";
import type { CSSProperties } from "react";
import { primaryPill } from "../Shell";
import { useOnboardingT } from "../i18n";

export interface DoneProps {
  onFinish: () => void;
}

/** Terminal confirmation after S03 saves; same centred language as S01. */
export function Done({ onFinish }: DoneProps) {
  const t = useOnboardingT();
  return (
    <section
      aria-labelledby="onboarding-done-title"
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "22px",
        padding: "0 64px 66px",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "56px",
          height: "56px",
          borderRadius: "var(--radius-full)",
          background: "color-mix(in srgb, var(--success) 20%, transparent)",
          color: "var(--success)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "24px",
        }}
      >
        ✓
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <h2
          id="onboarding-done-title"
          style={{
            margin: 0,
            fontFamily: "var(--font-heading)",
            fontWeight: "var(--font-heading-weight)" as CSSProperties["fontWeight"],
            fontSize: "28px",
            lineHeight: 1.1,
          }}
        >
          {t("onboarding.done.title")}
        </h2>
        <p style={{ margin: 0, fontSize: "14px", color: "var(--text-2)" }}>
          {t("onboarding.done.body")}
        </p>
      </div>
      <Button variant="primary" onClick={onFinish} style={{ ...primaryPill, padding: "11px 26px" }}>
        {t("onboarding.done.startRecording")}
      </Button>
    </section>
  );
}
