import { Button, Segmented } from "@design/components";
import { useState } from "react";
import { type MessageKey, type Translate, createTranslator, useT } from "../../i18n";
import { Page, StatusText } from "../controls";
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
    <details className="rf-set-card rf-set-details">
      <summary className="rf-set-row">{t("settings.updates.releaseNotes", { version })}</summary>
      <div className="rf-set-notes">
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static text lines, never reordered
          <p key={i}>· {line}</p>
        ))}
      </div>
    </details>
  );
}

/** S24/06 — compact panel: version + status line, channel track, restart pill. */
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
    <Page title={t("settings.section.updates")}>
      <section aria-label={t("settings.section.updates")} className="rf-set-panel">
        <div className="rf-set-panel-title">
          <span>{t("settings.updates.currentVersion")}</span>
          <span className="rf-set-value">{version ?? t("common.unknown")}</span>
        </div>

        {!updater ? (
          <StatusText>{t("settings.updates.unavailable")}</StatusText>
        ) : state === null ? (
          <StatusText>{t("settings.updates.loading")}</StatusText>
        ) : (
          <>
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
                className="rf-set-progress"
                max={100}
                value={state.progress?.percent ?? 0}
                aria-label={t("settings.updates.downloadProgress")}
              />
            ) : null}
          </>
        )}

        <div className="rf-set-fit">
          <Segmented<UpdateChannel>
            name="settings-update-channel"
            className="rf-seg-fit"
            value={settings.updateChannel}
            options={CHANNEL_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(updateChannel) => onChange({ updateChannel })}
          />
        </div>
        <p className="rf-set-help">
          {t("settings.updates.channel")} · {t("settings.updates.channel.help")}
        </p>

        {updater && state !== null ? (
          <>
            <Button
              className="rf-set-btn-sm rf-set-fit"
              disabled={busy !== null || inFlight}
              onClick={() => void run("check", updater.check)}
            >
              {state.phase === "checking" || busy === "check"
                ? t("settings.updates.checking")
                : t("settings.updates.checkNow")}
            </Button>
            {state.phase === "downloaded" ? (
              <Button
                className="rf-set-restart"
                disabled={busy !== null}
                onClick={() => void run("restart", updater.restart)}
              >
                {t("settings.updates.restart")}
              </Button>
            ) : null}
            {actionError ? <StatusText tone="danger">{actionError}</StatusText> : null}
          </>
        ) : null}
      </section>

      {state?.info ? (
        <ReleaseNotes html={state.info.releaseNotes} version={state.info.version} />
      ) : null}
    </Page>
  );
}
