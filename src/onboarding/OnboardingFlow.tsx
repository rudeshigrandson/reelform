import { useCallback, useState } from "react";
import { Defaults } from "./steps/Defaults";
import { Done } from "./steps/Done";
import { Permissions } from "./steps/Permissions";
import { Welcome } from "./steps/Welcome";
import type { OnboardingProps } from "./types";

export { sampleOnboardingProps } from "./types";
export type { OnboardingProps } from "./types";

const STEPS = ["welcome", "permissions", "defaults", "done"] as const;
type Step = (typeof STEPS)[number];

export function OnboardingFlow({
  permissions,
  onRequestPermission,
  defaults,
  onDefaultsChange,
  onFinish,
}: OnboardingProps) {
  const [index, setIndex] = useState(0);
  const step: Step = STEPS[index] ?? "welcome";

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }, []);
  const goBack = useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  // No dedicated folder-picker prop in the contract; the picker is host-driven.
  // Kept as a local no-op so the "Change…" affordance is present in the flow.
  const handleChangeFolder = useCallback(() => {}, []);

  return (
    <section
      aria-label="Onboarding"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        maxWidth: "560px",
        margin: "0 auto",
        padding: "var(--space-6)",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ minHeight: "260px" }}>
        {step === "welcome" ? <Welcome onNext={goNext} /> : null}
        {step === "permissions" ? (
          <Permissions
            permissions={permissions}
            onRequestPermission={onRequestPermission}
            onContinue={goNext}
          />
        ) : null}
        {step === "defaults" ? (
          <Defaults
            defaults={defaults}
            onDefaultsChange={onDefaultsChange}
            onChangeFolder={handleChangeFolder}
            onContinue={goNext}
          />
        ) : null}
        {step === "done" ? <Done onFinish={onFinish} /> : null}
      </div>

      <nav
        aria-label="Onboarding navigation"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <button type="button" className="btn btn-ghost" onClick={goBack} disabled={index === 0}>
          Back
        </button>

        <ol
          aria-label="Step indicator"
          style={{
            listStyle: "none",
            display: "flex",
            gap: "var(--space-2)",
            margin: 0,
            padding: 0,
          }}
        >
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === index ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${s}`}
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "999px",
                background: i === index ? "var(--color-accent)" : "var(--color-neutral-300)",
              }}
            />
          ))}
        </ol>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={goNext}
          disabled={index === STEPS.length - 1}
        >
          Next
        </button>
      </nav>
    </section>
  );
}
