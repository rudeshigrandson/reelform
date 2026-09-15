import { Button, Segmented } from "@design/components";
import { useState } from "react";
import { type MessageKey, type Translate, createTranslator, useT } from "../../i18n";
import { PageHeading, Row, StatusText } from "../controls";
import { releaseNotesToText } from "../releaseNotes";
import type { SettingsProps, UpdateChannel, UpdaterState } from "../types";

const CHANNEL_OPTIONS: ReadonlyArray<{ value: UpdateChannel; labelKey: MessageKey }> = [
  { value: "stable", labelKey: "settings.updates.channel.stable" },
  { value: "beta", labelKey: "settings.updates.channel.beta" },
];

const english = createTranslator("en");

export function updateStatusText(
  state: UpdaterState,
  formatTime: (ms: number) => string,
  t: Translate = english,
): string {
  const version = state.info?.version ?? "";
  switch (state.phase) {
    case "idle":
      return state.lastCheckedAt === null
        ? t("settings.updates.status.notChecked")
        : t("settings.updates.status.upToDate", { time: formatTime(state.lastCheckedAt) });
    case "checking":
      return t("settings.updates.status.checking");
    case "available":
      return t("settings.updates.status.available", { version });
    case "downloading":
      return t("settings.updates.status.downloading", {
        version,
        percent: String(Math.round(state.progress?.percent ?? 0)),
      });
    case "downloaded":
      return t("settings.updates.status.downloaded", { version });
    case "error":
      return t("settings.updates.status.error", {
        error: state.error ?? t("settings.updates.status.unknownError"),
      });
  }
}

export function ReleaseNotes({ html, version }: { html: string | null; version: string }) {
  const t = useT();
  const lines = releaseNotesToText(html);
  if (lines.length === 0) return null;
  return (
    <details style={{ marginBottom: "var(--space-5)" }}>
      <summary style={{ cursor: "pointer", color: "var(--text-2)" }}>
        {t("settings.updates.releaseNotes", { version })}
      </summary>
      <div
        style={{
          marginTop: "var(--space-2)",
          padding: "var(--space-3)",
          background: "var(--bg-sunken)",
          borderRadius: "var(--radius-md)",
          maxHeight: "220px",
          overflowY: "auto",
        }}
      >
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static text lines, never reordered
          <p key={i} style={{ margin: "0 0 var(--space-1)", fontSize: "0.85rem" }}>
            {line}
          </p>
        ))}
      </div>
    </details>
  );
}

export function UpdatesPage({
  settings,
  onChange,
  services,
  formatTime = (ms) => new Date(ms).toLocaleString(),
}: SettingsProps & { formatTime?: ((ms: number) => string) | undefined }) {
  const t = useT();
  const updater = services?.updater;
  const state = updater?.state ?? null;
  const [busy, setBusy] = useState<"check" | "restart" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run = async (kind: "check" | "restart", fn: () => Promise<void>) => {
    setBusy(kind);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const version = state?.currentVersion ?? services?.appVersion ?? null;
  const inFlight = state?.phase === "checking" || state?.phase === "downloading";

  return (
    <div>
      <PageHeading>{t("settings.section.updates")}</PageHeading>

      <Row label={t("settings.updates.currentVersion")}>
        <span style={{ fontFamily: "var(--font-mono)" }}>{version ?? t("common.unknown")}</span>
      </Row>

      <Row label={t("settings.updates.channel")} help={t("settings.updates.channel.help")}>
        <Segmented<UpdateChannel>
          name="settings-update-channel"
          value={settings.updateChannel}
          options={CHANNEL_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={(updateChannel) => onChange({ updateChannel })}
        />
      </Row>

      {!updater ? (
        <StatusText>{t("settings.updates.unavailable")}</StatusText>
      ) : state === null ? (
        <StatusText>{t("settings.updates.loading")}</StatusText>
      ) : (
        <>
          <Row>
            <StatusText
              tone={
                state.phase === "error"
                  ? "danger"
                  : state.phase === "downloaded"
                    ? "success"
                    : "muted"
              }
            >
              {updateStatusText(state, formatTime, t)}
            </StatusText>
            {state.phase === "downloading" ? (
              <progress
                max={100}
                value={state.progress?.percent ?? 0}
                aria-label={t("settings.updates.downloadProgress")}
                style={{ width: "100%", maxWidth: "320px", accentColor: "var(--accent)" }}
              />
            ) : null}
          </Row>
          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-5)" }}>
            <Button
              disabled={busy !== null || inFlight}
              onClick={() => void run("check", updater.check)}
            >
              {state.phase === "checking" || busy === "check"
                ? t("settings.updates.checking")
                : t("settings.updates.checkNow")}
            </Button>
            {state.phase === "downloaded" ? (
              <Button
                variant="primary"
                disabled={busy !== null}
                onClick={() => void run("restart", updater.restart)}
              >
                {t("settings.updates.restart")}
              </Button>
            ) : null}
          </div>
          {actionError ? <StatusText tone="danger">{actionError}</StatusText> : null}
          {state.info ? (
            <ReleaseNotes html={state.info.releaseNotes} version={state.info.version} />
          ) : null}
        </>
      )}
    </div>
  );
}
