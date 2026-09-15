import { Button, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
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
  return (
    <section
      aria-labelledby="onboarding-defaults-title"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", textAlign: "left" }}
    >
      <h2 id="onboarding-defaults-title" style={{ fontSize: "22px", fontWeight: 600, margin: 0 }}>
        Where should recordings go?
      </h2>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <code
          aria-label="Recordings folder"
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
          Change…
        </Button>
      </div>

      <SwitchRow
        checked={draft.autoDeleteRawAfterExport}
        onChange={(autoDeleteRawAfterExport) => onDraft({ autoDeleteRawAfterExport })}
        label="Auto-delete raw recordings after export (keep project)"
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
          Default frame rate
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
        label="Open editor automatically after recording"
      />

      {saveError ? (
        <p role="alert" style={{ margin: 0, color: "var(--danger)", fontSize: "13px" }}>
          {saveError}
        </p>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant="primary" onClick={onFinish} disabled={saving}>
          {saving ? "Saving…" : "Finish"}
        </Button>
      </div>
    </section>
  );
}
