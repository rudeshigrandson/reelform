import { Button, Dialog, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useCallback, useEffect, useState } from "react";
import {
  Group,
  PageHeading,
  Row,
  Select,
  type SelectOption,
  StatusText,
  formatBytes,
  helpStyle,
} from "../controls";
import type { CaptureBackend, GpuExport, LogLevel, SettingsProps } from "../types";

const BACKEND_OPTIONS: ReadonlyArray<SegmentedOption<CaptureBackend>> = [
  { value: "auto", label: "Auto" },
  { value: "native", label: "Native" },
  { value: "electron", label: "Fallback" },
];

const GPU_OPTIONS: ReadonlyArray<SegmentedOption<GpuExport>> = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const LOG_OPTIONS: ReadonlyArray<SelectOption<LogLevel>> = [
  { value: "error", label: "Errors only" },
  { value: "warn", label: "Warnings" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
];

/** Placeholder until the export engine reports probed encoders (SPEC §10). */
const ENCODERS = ["H.264", "HEVC", "VP9", "AV1"] as const;

type CacheState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "ready"; bytes: number | null };

export function AdvancedPage({ settings, onChange, services }: SettingsProps) {
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

  const act = async (fn: () => Promise<boolean>, ok: string, fail: string) => {
    setBusy(true);
    try {
      const done = await fn().catch(() => false);
      setMessage(done ? { tone: "success", text: ok } : { tone: "danger", text: fail });
      return done;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeading>Advanced</PageHeading>

      <Row
        label="Capture backend"
        help="Fallback uses Chromium capture when the native helper misbehaves."
      >
        <Segmented<CaptureBackend>
          name="settings-backend"
          value={settings.captureBackend}
          options={BACKEND_OPTIONS}
          onChange={(captureBackend) => onChange({ captureBackend })}
        />
      </Row>

      <Row label="GPU export">
        <Segmented<GpuExport>
          name="settings-gpu-export"
          value={settings.gpuExport}
          options={GPU_OPTIONS}
          onChange={(gpuExport) => onChange({ gpuExport })}
        />
      </Row>

      <Group title="Hardware encoders">
        <ul aria-label="Hardware encoders" style={{ listStyle: "none", margin: 0, padding: 0 }}>
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
              <span style={helpStyle}>Checked when you export</span>
            </li>
          ))}
        </ul>
      </Group>

      <Select
        label="Log level"
        value={settings.logLevel}
        options={LOG_OPTIONS}
        onChange={(logLevel) => onChange({ logLevel })}
      />

      <Group title="Maintenance">
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
                "Opened the logs folder.",
                "Couldn't open the logs folder.",
              )
            }
          >
            Open logs folder
          </Button>
          <Button
            variant="danger"
            disabled={!services?.resetAll || busy}
            onClick={() => setConfirmReset(true)}
          >
            Reset all settings…
          </Button>
        </div>

        <Row label="Cache">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ fontFamily: "var(--font-mono)" }} data-testid="cache-size">
              {cache.status === "unavailable"
                ? "Unavailable"
                : cache.status === "loading"
                  ? "Calculating…"
                  : cache.bytes === null
                    ? "Unknown"
                    : formatBytes(cache.bytes)}
            </span>
            <Button
              disabled={!system || busy || cache.status === "loading"}
              onClick={async () => {
                if (!system) return;
                const ok = await act(
                  system.clearCache,
                  "Cache cleared.",
                  "Couldn't clear the cache.",
                );
                if (ok) await refreshCache();
              }}
            >
              Clear cache
            </Button>
          </div>
        </Row>
        {message ? <StatusText tone={message.tone}>{message.text}</StatusText> : null}
      </Group>

      <Dialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset all settings?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmReset(false);
                const reset = services?.resetAll;
                if (reset)
                  void act(reset, "Settings were reset to defaults.", "Couldn't reset settings.");
              }}
            >
              Reset
            </Button>
          </>
        }
      >
        Every preference, including custom shortcuts, returns to its default. Projects and
        recordings are not touched.
      </Dialog>
    </div>
  );
}
