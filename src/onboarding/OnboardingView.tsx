import { Button } from "@design/components";
import type { CSSProperties } from "react";
import { useOnboardingT } from "./i18n";
import type { OnboardingDraft, OnboardingState } from "./machine";
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
  onOpenPrivacy?: (() => void) | undefined;
}

const backStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 400,
  fontSize: "13px",
  color: "var(--text-2)",
  padding: "6px 10px",
};

/** 720×520 window (S01–S03): 40px title-bar gutter, step body, footer bar. */
export function OnboardingView(props: OnboardingViewProps) {
  const t = useOnboardingT();
  const { state } = props;

  const back = (
    <Button variant="ghost" onClick={props.onBack} disabled={state.saving} style={backStyle}>
      {t("onboarding.nav.back")}
    </Button>
  );

  return (
    <section
      aria-label={t("onboarding.label")}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        height: "100%",
        background: "var(--bg-app)",
        color: "var(--text-1)",
        fontFamily: "var(--font-body)",
      }}
    >
      {/* Native traffic lights / title bar sit here. */}
      <div
        aria-hidden="true"
        style={{ height: "40px", flex: "none", WebkitAppRegion: "drag" } as CSSProperties}
      />
      {state.step === "welcome" ? (
        <Welcome
          onNext={props.onNext}
          onImportProject={props.onImportProject}
          onOpenTerms={props.onOpenTerms}
          onOpenPrivacy={props.onOpenPrivacy}
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
          back={back}
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
          back={back}
        />
      ) : null}
      {state.step === "done" ? <Done onFinish={props.onFinish} /> : null}
    </section>
  );
}
