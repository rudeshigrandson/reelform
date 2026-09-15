import { Button } from "@design/components";
import { useState } from "react";
import { useT } from "../../i18n";
import { PageHeading, StatusText, helpStyle } from "../controls";
import { LICENSES_URL } from "../services";
import type { SettingsProps } from "../types";

type CopyState = "idle" | "copying" | "copied" | "failed";

export function AboutPage({ services }: SettingsProps) {
  const t = useT();
  const [copy, setCopy] = useState<CopyState>("idle");
  const copyDiagnostics = services?.copyDiagnostics;
  const version = services?.updater?.state?.currentVersion ?? services?.appVersion ?? null;

  return (
    <div>
      <PageHeading>{t("settings.section.about")}</PageHeading>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-4)",
          marginBottom: "var(--space-5)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "var(--radius-md)",
            background: "var(--accent)",
            color: "var(--on-accent)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-heading)",
            fontSize: "28px",
          }}
        >
          R
        </div>
        <div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: "1.3rem" }}>Reelform</div>
          <div style={{ ...helpStyle, fontFamily: "var(--font-mono)" }}>
            {t("settings.about.version", {
              version: version ?? t("settings.about.versionUnknown"),
            })}
          </div>
        </div>
      </div>

      <p style={{ color: "var(--text-2)", maxWidth: "520px" }}>{t("settings.about.credits")}</p>

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        <Button
          variant="ghost"
          disabled={!services?.system}
          onClick={() => void services?.system?.openExternal(LICENSES_URL)}
        >
          {t("settings.about.licenses")}
        </Button>
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
      </div>
      {copy === "copied" ? (
        <StatusText tone="success">{t("settings.about.copied")}</StatusText>
      ) : null}
      {copy === "failed" ? (
        <StatusText tone="danger">{t("settings.about.copyFailed")}</StatusText>
      ) : null}
    </div>
  );
}
