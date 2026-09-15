import { type OnboardingKey, useOnboardingT } from "./i18n";
import {
  ONBOARDING_STEPS,
  type OnboardingDraft,
  type OnboardingState,
  type OnboardingStep,
} from "./machine";
import { Defaults } from "./steps/Defaults";
import { Done } from "./steps/Done";
import { Permissions } from "./steps/Permissions";
import { Welcome } from "./steps/Welcome";
import type { OsPermissionKind } from "./types";

export interface OnboardingViewProps {
  state: OnboardingState;
  onNext: () => void;
  onBack: () => void;
  onRequest: (kind: OsPermissionKind) => void;
  onOpenSettings: (kind: OsPermissionKind) => void;
  onDraft: (patch: Partial<OnboardingDraft>) => void;
  onChangeFolder?: (() => void) | undefined;
  onSaveDefaults: () => void;
  onFinish: () => void;
  appVersion?: string | null | undefined;
  onImportProject?: (() => void) | undefined;
  onOpenTerms?: (() => void) | undefined;
}

const STEP_NAME_KEY: Record<OnboardingStep, OnboardingKey> = {
  welcome: "onboarding.step.welcome",
  permissions: "onboarding.step.permissions",
  defaults: "onboarding.step.defaults",
  done: "onboarding.step.done",
};

/** 720×520 centered card, no sidebar (S01–S03). */
export function OnboardingView(props: OnboardingViewProps) {
  const t = useOnboardingT();
  const { state } = props;
  const index = ONBOARDING_STEPS.indexOf(state.step);
  const showBack = state.step === "permissions" || state.step === "defaults";

  return (
    <section
      aria-label={t("onboarding.label")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
        maxWidth: "560px",
        margin: "0 auto",
        padding: "var(--space-6)",
        background: "var(--bg-app)",
        color: "var(--text-1)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ minHeight: "300px" }}>
        {state.step === "welcome" ? (
          <Welcome
            onNext={props.onNext}
            onImportProject={props.onImportProject}
            onOpenTerms={props.onOpenTerms}
            appVersion={props.appVersion}
          />
        ) : null}
        {state.step === "permissions" ? (
          <Permissions
            snapshot={state.snapshot}
            unavailable={state.unavailable}
            statusError={state.statusError}
            requesting={state.requesting}
            onRequest={props.onRequest}
            onOpenSettings={props.onOpenSettings}
            onContinue={props.onNext}
          />
        ) : null}
        {state.step === "defaults" ? (
          <Defaults
            draft={state.draft}
            onDraft={props.onDraft}
            onChangeFolder={props.onChangeFolder}
            onFinish={props.onSaveDefaults}
            saving={state.saving}
            saveError={state.saveError}
          />
        ) : null}
        {state.step === "done" ? <Done onFinish={props.onFinish} /> : null}
      </div>

      <nav
        aria-label={t("onboarding.nav.label")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <button
          type="button"
          className="btn btn-ghost"
          onClick={props.onBack}
          disabled={!showBack || state.saving}
          style={{ visibility: showBack ? "visible" : "hidden" }}
        >
          {t("onboarding.nav.back")}
        </button>
        <ol
          aria-label={t("onboarding.nav.stepIndicator")}
          style={{
            listStyle: "none",
            display: "flex",
            gap: "var(--space-2)",
            margin: 0,
            padding: 0,
          }}
        >
          {ONBOARDING_STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === index ? "step" : undefined}
              aria-label={t("onboarding.nav.step", {
                number: i + 1,
                name: t(STEP_NAME_KEY[s]),
              })}
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "var(--radius-full)",
                background: i === index ? "var(--accent)" : "var(--border-strong)",
              }}
            />
          ))}
        </ol>
        <span style={{ width: "64px" }} />
      </nav>
    </section>
  );
}
