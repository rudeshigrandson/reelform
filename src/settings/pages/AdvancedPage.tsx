import { Button, Dialog, Segmented } from "@design/components";
import { useCallback, useEffect, useState } from "react";
import { type MessageKey, useT } from "../../i18n";
import { Group, PageHeading, Row, Select, StatusText, formatBytes, helpStyle } from "../controls";
import type { CaptureBackend, GpuExport, LogLevel, SettingsProps } from "../types";

const BACKEND_OPTIONS: ReadonlyArray<{ value: CaptureBackend; labelKey: MessageKey }> = [
  { value: "auto", labelKey: "settings.advanced.backend.auto" },
  { value: "native", labelKey: "settings.advanced.backend.native" },
  { value: "electron", labelKey: "settings.advanced.backend.electron" },
];

const GPU_OPTIONS: ReadonlyArray<{ value: GpuExport; labelKey: MessageKey }> = [
  { value: "auto", labelKey: "settings.advanced.gpu.auto" },
  { value: "on", labelKey: "settings.advanced.gpu.on" },
  { value: "off", labelKey: "settings.advanced.gpu.off" },
];

const LOG_OPTIONS: ReadonlyArray<{ value: LogLevel; labelKey: MessageKey }> = [
  { value: "error", labelKey: "settings.advanced.log.error" },
  { value: "warn", labelKey: "settings.advanced.log.warn" },
  { value: "info", labelKey: "settings.advanced.log.info" },
  { value: "debug", labelKey: "settings.advanced.log.debug" },
];

/** Placeholder until the export engine reports probed encoders (SPEC §10). */
const ENCODERS = ["H.264", "HEVC", "VP9", "AV1"] as const;

type CacheState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "ready"; bytes: number | null };

export function AdvancedPage({ settings, onChange, services }: SettingsProps) {
  const t = useT();
  const system = services?.system;
  const [cache, setCache] = useState<CacheState>(
    system ? { status: "loading" } : { status: "unavailable" },
  );
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshCache = useCallback(async () => {
    if (!system) return;
    setCache({ status: "loading" });
    try {
      setCache({ status: "ready", bytes: await system.getCacheSize() });
    } catch {
      setCache({ status: "ready", bytes: null });
    }
  }, [system]);

  useEffect(() => {
    void refreshCache();
  }, [refreshCache]);

  const act = async (fn: () => Promise<boolean>, ok: MessageKey, fail: MessageKey) => {
    setBusy(true);
    try {
      const done = await fn().catch(() => false);
      setMessage(done ? { tone: "success", text: t(ok) } : { tone: "danger", text: t(fail) });
      return done;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeading>{t("settings.section.advanced")}</PageHeading>

      <Row label={t("settings.advanced.backend")} help={t("settings.advanced.backend.help")}>
        <Segmented<CaptureBackend>
          name="settings-backend"
          value={settings.captureBackend}
          options={BACKEND_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={(captureBackend) => onChange({ captureBackend })}
        />
      </Row>

      <Row label={t("settings.advanced.gpuExport")}>
        <Segmented<GpuExport>
          name="settings-gpu-export"
          value={settings.gpuExport}
          options={GPU_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          onChange={(gpuExport) => onChange({ gpuExport })}
        />
      </Row>

      <Group title={t("settings.advanced.encoders")}>
        <ul
          aria-label={t("settings.advanced.encoders")}
          style={{ listStyle: "none", margin: 0, padding: 0 }}
        >
          {ENCODERS.map((name) => (
            <li
              key={name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "var(--space-1) 0",
                borderBottom: "1px solid var(--border)",
                maxWidth: "420px",
              }}
            >
              <span>{name}</span>
              <span style={helpStyle}>{t("settings.advanced.encoders.checkedOnExport")}</span>
            </li>
          ))}
        </ul>
      </Group>

      <Select
        label={t("settings.advanced.logLevel")}
        value={settings.logLevel}
        options={LOG_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
        onChange={(logLevel) => onChange({ logLevel })}
      />

      <Group title={t("settings.advanced.maintenance")}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-2)",
            marginBottom: "var(--space-3)",
          }}
        >
          <Button
            disabled={!system || busy}
            onClick={() =>
              system &&
              void act(
                system.openLogsFolder,
                "settings.advanced.openLogs.ok",
                "settings.advanced.openLogs.fail",
              )
            }
          >
            {t("settings.advanced.openLogs")}
          </Button>
          <Button
            variant="danger"
            disabled={!services?.resetAll || busy}
            onClick={() => setConfirmReset(true)}
          >
            {t("settings.advanced.resetAll")}
          </Button>
        </div>

        <Row label={t("settings.advanced.cache")}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ fontFamily: "var(--font-mono)" }} data-testid="cache-size">
              {cache.status === "unavailable"
                ? t("settings.advanced.cache.unavailable")
                : cache.status === "loading"
                  ? t("settings.advanced.cache.calculating")
                  : cache.bytes === null
                    ? t("common.unknown")
                    : formatBytes(cache.bytes)}
            </span>
            <Button
              disabled={!system || busy || cache.status === "loading"}
              onClick={async () => {
                if (!system) return;
                const ok = await act(
                  system.clearCache,
                  "settings.advanced.clearCache.ok",
                  "settings.advanced.clearCache.fail",
                );
                if (ok) await refreshCache();
              }}
            >
              {t("settings.advanced.clearCache")}
            </Button>
          </div>
        </Row>
        {message ? <StatusText tone={message.tone}>{message.text}</StatusText> : null}
      </Group>

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t("settings.advanced.reset.title")}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmReset(false);
                const reset = services?.resetAll;
                if (reset)
                  void act(reset, "settings.advanced.reset.ok", "settings.advanced.reset.fail");
              }}
            >
              {t("settings.advanced.reset.confirm")}
            </Button>
          </>
        }
      >
        {t("settings.advanced.reset.body")}
      </Dialog>
    </div>
  );
}
