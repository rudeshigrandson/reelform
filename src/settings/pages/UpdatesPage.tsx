import { Button, Segmented } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useState } from "react";
import { PageHeading, Row, StatusText } from "../controls";
import { releaseNotesToText } from "../releaseNotes";
import type { SettingsProps, UpdateChannel, UpdaterState } from "../types";

const CHANNEL_OPTIONS: ReadonlyArray<SegmentedOption<UpdateChannel>> = [
  { value: "stable", label: "Stable" },
  { value: "beta", label: "Beta" },
];

export function updateStatusText(state: UpdaterState, formatTime: (ms: number) => string): string {
  const v = state.info?.version ?? "";
  switch (state.phase) {
    case "idle":
      return state.lastCheckedAt === null
        ? "Not checked yet."
        : `Reelform is up to date. Last checked ${formatTime(state.lastCheckedAt)}.`;
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Reelform ${v} is available. Downloading in the background…`;
    case "downloading":
      return `Downloading Reelform ${v} — ${Math.round(state.progress?.percent ?? 0)}%`;
    case "downloaded":
      return `Reelform ${v} is ready. Restart to update.`;
    case "error":
      return `Update check failed: ${state.error ?? "unknown error"}`;
  }
}

export function ReleaseNotes({ html, version }: { html: string | null; version: string }) {
  const lines = releaseNotesToText(html);
  if (lines.length === 0) return null;
  return (
    <details style={{ marginBottom: "var(--space-5)" }}>
      <summary style={{ cursor: "pointer", color: "var(--text-2)" }}>
        Release notes for {version}
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
      <PageHeading>Updates</PageHeading>

      <Row label="Current version">
        <span style={{ fontFamily: "var(--font-mono)" }}>{version ?? "Unknown"}</span>
      </Row>

      <Row
        label="Channel"
        help="Beta gets new features about a week early. Switching to Stable never downgrades."
      >
        <Segmented<UpdateChannel>
          name="settings-update-channel"
          value={settings.updateChannel}
          options={CHANNEL_OPTIONS}
          onChange={(updateChannel) => onChange({ updateChannel })}
        />
      </Row>

      {!updater ? (
        <StatusText>Updates are unavailable in this build.</StatusText>
      ) : state === null ? (
        <StatusText>Loading update status…</StatusText>
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
              {updateStatusText(state, formatTime)}
            </StatusText>
            {state.phase === "downloading" ? (
              <progress
                max={100}
                value={state.progress?.percent ?? 0}
                aria-label="Download progress"
                style={{ width: "100%", maxWidth: "320px", accentColor: "var(--accent)" }}
              />
            ) : null}
          </Row>
          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-5)" }}>
            <Button
              disabled={busy !== null || inFlight}
              onClick={() => void run("check", updater.check)}
            >
              {state.phase === "checking" || busy === "check" ? "Checking…" : "Check now"}
            </Button>
            {state.phase === "downloaded" ? (
              <Button
                variant="primary"
                disabled={busy !== null}
                onClick={() => void run("restart", updater.restart)}
              >
                Restart to update
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
