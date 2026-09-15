import { Button, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
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
}

const FPS_OPTIONS: ReadonlyArray<SegmentedOption<Fps>> = [
  { value: 30, label: "30" },
  { value: 60, label: "60" },
];

function SwitchRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer" }}
    >
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)" }}
      />
      <span>{label}</span>
    </label>
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
}: DefaultsProps) {
  const t = useOnboardingT();
  return (
    <section
      aria-labelledby="onboarding-defaults-title"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", textAlign: "left" }}
    >
      <h2 id="onboarding-defaults-title" style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>
        {t("onboarding.defaults.title")}
      </h2>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <code
          aria-label={t("onboarding.defaults.folderLabel")}
          style={{
            flex: 1,
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            padding: "var(--space-2) var(--space-3)",
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {draft.recordingsFolder}
        </code>
        <Button variant="secondary" onClick={onChangeFolder} disabled={!onChangeFolder || saving}>
          {t("onboarding.defaults.changeFolder")}
        </Button>
      </div>

      <SwitchRow
        checked={draft.autoDeleteRawAfterExport}
        onChange={(autoDeleteRawAfterExport) => onDraft({ autoDeleteRawAfterExport })}
        label={t("onboarding.defaults.autoDeleteRaw")}
      />

      <div className="field">
        <span
          style={{
            display: "block",
            fontSize: "12px",
            color: "var(--text-2)",
            marginBottom: "5px",
          }}
        >
          {t("onboarding.defaults.frameRate")}
        </span>
        <Segmented<Fps>
          name="onboarding-fps"
          value={draft.defaultFps}
          options={FPS_OPTIONS}
          onChange={(defaultFps) => onDraft({ defaultFps })}
        />
      </div>

      <SwitchRow
        checked={draft.openEditorAfterRecording}
        onChange={(openEditorAfterRecording) => onDraft({ openEditorAfterRecording })}
        label={t("onboarding.defaults.openEditor")}
      />

      {saveError ? (
        <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "13px" }}>
          {saveError}
        </p>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="primary" onClick={onFinish} disabled={saving}>
          {saving ? t("onboarding.defaults.saving") : t("onboarding.defaults.finish")}
        </Button>
      </div>
    </section>
  );
}
