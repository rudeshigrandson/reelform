import { Button } from "@design/components";
import { useId } from "react";
import { type MessageKey, useT } from "../../i18n";
import {
  ExternalLink,
  Group,
  NumberField,
  Page,
  Row,
  Select,
  type SelectOption,
  Switch,
} from "../controls";
import { PRIVACY_URL } from "../services";
import type { SettingsProps } from "../types";

const LANGUAGES: ReadonlyArray<{ value: string; labelKey: MessageKey }> = [
  { value: "system", labelKey: "settings.general.language.system" },
  { value: "en", labelKey: "settings.general.language.en" },
];

export function GeneralPage({
  settings,
  onChange,
  onChangeRecordingsFolder,
  services,
}: SettingsProps) {
  const t = useT();
  const folderId = useId();
  const isMac = (services?.platform ?? "mac") === "mac";
  const known: SelectOption<string>[] = LANGUAGES.map((l) => ({
    value: l.value,
    label: t(l.labelKey),
  }));
  const languageOptions = known.some((l) => l.value === settings.language)
    ? known
    : [...known, { value: settings.language, label: settings.language }];
  return (
    <Page title={t("settings.section.general")}>
      <Group title={t("settings.section.general")}>
        <Select
          label={t("settings.general.language")}
          value={settings.language}
          options={languageOptions}
          onChange={(language) => onChange({ language })}
        />
        <Row label={t("settings.general.recordingsFolder")} htmlFor={folderId}>
          <input
            id={folderId}
            className="rf-set-path"
            value={settings.recordingsFolder}
            title={settings.recordingsFolder}
            readOnly
          />
          <Button onClick={onChangeRecordingsFolder} disabled={!onChangeRecordingsFolder}>
            {t("settings.general.changeFolder")}
          </Button>
        </Row>
      </Group>

      <Group title={t("settings.general.behavior")}>
        <Switch
          checked={settings.openEditorAfterRecording}
          onChange={(openEditorAfterRecording) => onChange({ openEditorAfterRecording })}
          label={t("settings.general.openEditorAfterRecording")}
        />
        <Switch
          checked={settings.launchAtLogin}
          onChange={(launchAtLogin) => onChange({ launchAtLogin })}
          label={t("settings.general.launchAtLogin")}
        />
        <Switch
          checked={settings.showInTray}
          onChange={(showInTray) => onChange({ showInTray })}
          label={t(isMac ? "settings.general.showInMenuBar" : "settings.general.showInTray")}
        />
        <Switch
          checked={settings.sendUsageStats}
          onChange={(sendUsageStats) => onChange({ sendUsageStats })}
          label={t("settings.general.usageStats")}
          help={
            <>
              {t("settings.general.usageStats.help")}{" "}
              <ExternalLink url={PRIVACY_URL} system={services?.system}>
                {t("common.privacyPolicy")}
              </ExternalLink>
            </>
          }
        />
        <Switch
          checked={settings.checkUpdates}
          onChange={(checkUpdates) => onChange({ checkUpdates })}
          label={t("settings.general.checkUpdates")}
        />
      </Group>

      <Group title={t("settings.general.storage")}>
        <Switch
          checked={settings.autoPrune}
          onChange={(autoPrune) => onChange({ autoPrune })}
          label={t("settings.general.autoPrune")}
        />
        <NumberField
          label={t("settings.general.pruneAfterDays")}
          value={settings.autoPruneDays}
          min={1}
          max={365}
          integer
          disabled={!settings.autoPrune}
          onChange={(autoPruneDays) => onChange({ autoPruneDays })}
        />
      </Group>

      {services?.runOnboarding ? (
        <Group title={t("settings.general.setup")}>
          <Row label={t("settings.general.setup")} help={t("settings.general.setup.help")}>
            <Button onClick={services.runOnboarding}>{t("settings.general.runSetupAgain")}</Button>
          </Row>
        </Group>
      ) : null}
    </Page>
  );
}
