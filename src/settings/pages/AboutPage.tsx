import { Button } from "@design/components";
import { useState } from "react";
import { useT } from "../../i18n";
import { Group, Page, Row, StatusText } from "../controls";
import { LICENSES_URL } from "../services";
import type { SettingsProps } from "../types";

type CopyState = "idle" | "copying" | "copied" | "failed";

export function AboutPage({ services }: SettingsProps) {
  const t = useT();
  const [copy, setCopy] = useState<CopyState>("idle");
  const copyDiagnostics = services?.copyDiagnostics;
  const version = services?.updater?.state?.currentVersion ?? services?.appVersion ?? null;

  return (
    <Page title={t("settings.section.about")}>
      <Group title={t("settings.section.about")}>
        <div className="rf-set-row">
          <div aria-hidden="true" className="rf-set-mark">
            R
          </div>
          <div className="rf-set-row-text">
            <div className="rf-set-appname">Reelform</div>
            <div className="rf-set-help rf-set-value">
              {t("settings.about.version", {
                version: version ?? t("settings.about.versionUnknown"),
              })}
            </div>
          </div>
        </div>
        <Row help={t("settings.about.credits")} />
      </Group>

      <Group title={t("settings.about.diagnosticsRow")}>
        <Row label={t("settings.about.licensesRow")} help={t("settings.about.licensesRow.help")}>
          <Button
            variant="ghost"
            disabled={!services?.system}
            onClick={() => void services?.system?.openExternal(LICENSES_URL)}
          >
            {t("settings.about.licenses")}
          </Button>
        </Row>
        <Row
          label={t("settings.about.diagnosticsRow")}
          help={t("settings.about.diagnosticsRow.help")}
        >
          <Button
            disabled={!copyDiagnostics || copy === "copying"}
            onClick={async () => {
              if (!copyDiagnostics) return;
              setCopy("copying");
              const ok = await copyDiagnostics().catch(() => false);
              setCopy(ok ? "copied" : "failed");
            }}
          >
            {copy === "copying" ? t("settings.about.copying") : t("settings.about.copyDiagnostics")}
          </Button>
        </Row>
        {copy === "copied" ? (
          <StatusText tone="success">{t("settings.about.copied")}</StatusText>
        ) : null}
        {copy === "failed" ? (
          <StatusText tone="danger">{t("settings.about.copyFailed")}</StatusText>
        ) : null}
      </Group>
    </Page>
  );
}
