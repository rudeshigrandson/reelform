import { Button, Input } from "@design/components";
import {
  Group,
  NumberField,
  PageHeading,
  Row,
  Select,
  type SelectOption,
  Switch,
} from "../controls";
import { PRIVACY_URL } from "../services";
import type { SettingsProps } from "../types";

const LANGUAGES: ReadonlyArray<SelectOption<string>> = [
  { value: "system", label: "System default" },
  { value: "en", label: "English" },
];

export function GeneralPage({
  settings,
  onChange,
  onChangeRecordingsFolder,
  services,
}: SettingsProps) {
  const isMac = (services?.platform ?? "mac") === "mac";
  const languageOptions = LANGUAGES.some((l) => l.value === settings.language)
    ? LANGUAGES
    : [...LANGUAGES, { value: settings.language, label: settings.language }];
  return (
    <div>
      <PageHeading>General</PageHeading>

      <Select
        label="Language"
        value={settings.language}
        options={languageOptions}
        onChange={(language) => onChange({ language })}
      />

      <Row>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-2)" }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Save recordings to"
              value={settings.recordingsFolder}
              readOnly
              style={{ fontFamily: "var(--font-mono)" }}
            />
          </div>
          <Button onClick={onChangeRecordingsFolder} disabled={!onChangeRecordingsFolder}>
            Change…
          </Button>
        </div>
      </Row>

      <Switch
        checked={settings.openEditorAfterRecording}
        onChange={(openEditorAfterRecording) => onChange({ openEditorAfterRecording })}
        label="Open editor after recording"
      />
      <Switch
        checked={settings.launchAtLogin}
        onChange={(launchAtLogin) => onChange({ launchAtLogin })}
        label="Launch at login"
      />
      <Switch
        checked={settings.showInTray}
        onChange={(showInTray) => onChange({ showInTray })}
        label={isMac ? "Show in menu bar" : "Show in tray"}
      />
      <Switch
        checked={settings.sendUsageStats}
        onChange={(sendUsageStats) => onChange({ sendUsageStats })}
        label="Send anonymous usage stats"
        help={
          <>
            Off by default. No recordings, filenames or keystrokes are ever sent.{" "}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: 0, minHeight: 0, fontSize: "inherit" }}
              onClick={() => void services?.system?.openExternal(PRIVACY_URL)}
              disabled={!services?.system}
            >
              Privacy policy
            </button>
          </>
        }
      />
      <Switch
        checked={settings.checkUpdates}
        onChange={(checkUpdates) => onChange({ checkUpdates })}
        label="Check for updates automatically"
      />

      <Group title="Storage">
        <Switch
          checked={settings.autoPrune}
          onChange={(autoPrune) => onChange({ autoPrune })}
          label="Auto-prune old recordings"
        />
        <NumberField
          label="Prune after (days)"
          value={settings.autoPruneDays}
          min={1}
          max={365}
          integer
          disabled={!settings.autoPrune}
          onChange={(autoPruneDays) => onChange({ autoPruneDays })}
        />
      </Group>

      {services?.runOnboarding ? (
        <Group title="Setup">
          <Button onClick={services.runOnboarding}>Run setup again…</Button>
        </Group>
      ) : null}
    </div>
  );
}
