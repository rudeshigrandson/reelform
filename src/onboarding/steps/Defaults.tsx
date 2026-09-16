import { Button } from "@design/components";
import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { StepBody, StepFooter, StepTitle, primaryPill, secondaryPill } from "../Shell";
import { useOnboardingT } from "../i18n";
import type { OnboardingDraft } from "../machine";
import type { Fps } from "../types";

export interface DefaultsProps {
  draft: OnboardingDraft;
  onDraft: (patch: Partial<OnboardingDraft>) => void;
  onChangeFolder: (() => void) | undefined;
  onFinish: () => void;
  saving: boolean;
  saveError: string | null;
  /** Back control rendered in the footer. */
  back?: ReactNode;
}

const FPS_OPTIONS: readonly Fps[] = [30, 60];

const rowCard: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-4)",
  padding: "12px 16px",
  borderRadius: "var(--radius-md)",
  background: "var(--bg-panel)",
};

function SwitchRow({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  const id = useId();
  return (
    <div style={rowCard}>
      <div>
        <div id={`${id}-label`} style={{ fontSize: "13px", fontWeight: 600 }}>
          {label}
        </div>
        <div id={`${id}-desc`} style={{ fontSize: "11px", color: "var(--text-3)" }}>
          {description}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-desc`}
        onClick={() => onChange(!checked)}
        style={{
          position: "relative",
          flex: "none",
          width: "36px",
          height: "20px",
          padding: 0,
          border: 0,
          borderRadius: "var(--radius-full)",
          background: checked ? "var(--accent)" : "var(--bg-panel-raised)",
          cursor: "pointer",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "2px",
            left: checked ? "18px" : "2px",
            width: "16px",
            height: "16px",
            borderRadius: "var(--radius-full)",
            background: checked ? "var(--on-accent)" : "var(--text-3)",
            transition: "left 120ms ease",
          }}
        />
      </button>
    </div>
  );
}

function FpsControl({ value, onChange }: { value: Fps; onChange: (v: Fps) => void }) {
  const [focused, setFocused] = useState<Fps | null>(null);
  return (
    <div
      role="radiogroup"
      style={{
        display: "flex",
        flex: "none",
        background: "var(--bg-sunken)",
        borderRadius: "var(--radius-full)",
        padding: "3px",
        fontSize: "12px",
      }}
    >
      {FPS_OPTIONS.map((fps) => {
        const on = fps === value;
        return (
          <label
            key={fps}
            style={{
              position: "relative",
              padding: "5px 16px",
              borderRadius: "var(--radius-full)",
              background: on ? "var(--accent)" : "transparent",
              color: on ? "var(--on-accent)" : "var(--text-2)",
              fontWeight: on ? 600 : 400,
              cursor: "pointer",
              outline: focused === fps ? "2px solid var(--focus-ring)" : "none",
              outlineOffset: "1px",
            }}
          >
            <input
              type="radio"
              name="onboarding-fps"
              value={fps}
              checked={on}
              onChange={() => onChange(fps)}
              onFocus={(e) => {
                if (e.currentTarget.matches?.(":focus-visible") ?? true) setFocused(fps);
              }}
              onBlur={() => setFocused(null)}
              style={{ position: "absolute", opacity: 0, width: 0, height: 0, margin: 0 }}
            />
            {fps}
          </label>
        );
      })}
    </div>
  );
}

/** S03 — save location & defaults; "Finish" writes them to settings. */
export function Defaults({
  draft,
  onDraft,
  onChangeFolder,
  onFinish,
  saving,
  saveError,
  back,
}: DefaultsProps) {
  const t = useOnboardingT();
  return (
    <section
      aria-labelledby="onboarding-defaults-title"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <StepBody padding="26px 40px 12px" gap="18px">
        <StepTitle
          id="onboarding-defaults-title"
          title={t("onboarding.defaults.title")}
          subtitle={t("onboarding.defaults.subtitle")}
        />

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span id="onboarding-folder-label" style={{ fontSize: "12px", color: "var(--text-2)" }}>
            {t("onboarding.defaults.folderLabel")}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <code
              aria-labelledby="onboarding-folder-label"
              style={{
                flex: 1,
                minWidth: 0,
                height: "36px",
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                padding: "0 16px",
                borderRadius: "var(--radius-full)",
                background: "var(--bg-sunken)",
                border: "1px solid var(--border-strong)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--text-2)",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {draft.recordingsFolder}
              </span>
            </code>
            <Button
              variant="secondary"
              onClick={onChangeFolder}
              disabled={!onChangeFolder || saving}
              style={{ ...secondaryPill, padding: "8px 18px" }}
            >
              {t("onboarding.defaults.changeFolder")}
            </Button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <SwitchRow
            checked={draft.autoDeleteRawAfterExport}
            onChange={(autoDeleteRawAfterExport) => onDraft({ autoDeleteRawAfterExport })}
            label={t("onboarding.defaults.autoDeleteRaw")}
            description={t("onboarding.defaults.autoDeleteRaw.description")}
          />
          <SwitchRow
            checked={draft.openEditorAfterRecording}
            onChange={(openEditorAfterRecording) => onDraft({ openEditorAfterRecording })}
            label={t("onboarding.defaults.openEditor")}
            description={t("onboarding.defaults.openEditor.description")}
          />
          <div style={rowCard}>
            <span style={{ fontSize: "13px", fontWeight: 600 }}>
              {t("onboarding.defaults.frameRate")}
            </span>
            <FpsControl
              value={draft.defaultFps}
              onChange={(defaultFps) => onDraft({ defaultFps })}
            />
          </div>
        </div>

        {saveError ? (
          <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "13px" }}>
            {saveError}
          </p>
        ) : null}
      </StepBody>

      <StepFooter step="defaults" leading={back}>
        <Button
          variant="primary"
          onClick={onFinish}
          disabled={saving}
          style={{ ...primaryPill, padding: "10px 26px" }}
        >
          {saving ? t("onboarding.defaults.saving") : t("onboarding.defaults.finish")}
        </Button>
      </StepFooter>
    </section>
  );
}
