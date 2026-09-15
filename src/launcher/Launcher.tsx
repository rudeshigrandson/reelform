import { Button, Card, CardMeta, CardTitle, Segmented, Tag } from "@design/components";
import type { SegmentedOption } from "@design/components";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../overlays/reducedMotion";
import { SourcePicker } from "./SourcePicker";
import { effectiveDeviceId, effectiveSourceId, modeForPick, sourceKindFor } from "./selection";
import type {
  Countdown,
  DeviceInfo,
  Fps,
  LauncherNotice,
  LauncherProps,
  RecordOptions,
  SourceItem,
  SourceMode,
} from "./types";

const MODE_OPTIONS: ReadonlyArray<SegmentedOption<SourceMode>> = [
  { value: "screen", label: "Screen" },
  { value: "window", label: "Window" },
  { value: "region", label: "Region" },
];

const FPS_OPTIONS: ReadonlyArray<SegmentedOption<`${Fps}`>> = [
  { value: "30", label: "30" },
  { value: "60", label: "60" },
];

const COUNTDOWN_OPTIONS: ReadonlyArray<SegmentedOption<`${Countdown}`>> = [
  { value: "0", label: "Off" },
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
  { value: "10", label: "10s" },
];

/** Small on/off pill used for mic / webcam / system-audio / hide-cursor. */
function Toggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        color: "var(--text-1)",
        fontFamily: "var(--font-body)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function DeviceSelect({
  ariaLabel,
  devices,
  value,
  onChange,
  disabled,
}: {
  ariaLabel: string;
  devices: ReadonlyArray<DeviceInfo>;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <select
      aria-label={ariaLabel}
      className="input"
      disabled={disabled || devices.length === 0}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      style={{ minWidth: 180 }}
    >
      {devices.length === 0 ? (
        <option value="">No devices</option>
      ) : (
        devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))
      )}
    </select>
  );
}

function SourceCard({
  source,
  selected,
  onSelect,
}: {
  source: SourceItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const reduceMotion = usePrefersReducedMotion();
  return (
    <Card
      elevation={selected ? "md" : "sm"}
      role="button"
      aria-pressed={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        cursor: "pointer",
        padding: "var(--space-2)",
        outline: selected ? "2px solid var(--accent)" : "2px solid transparent",
        borderRadius: "var(--radius-md)",
        transition: reduceMotion ? "none" : "outline-color 120ms ease",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: "var(--radius-sm)",
          background: source.thumbnailUrl
            ? `center / cover no-repeat url(${source.thumbnailUrl})`
            : "var(--bg-sunken)",
          marginBottom: "var(--space-1)",
        }}
      />
      <CardTitle>{source.name}</CardTitle>
      <CardMeta>
        <Tag variant={source.kind === "display" ? "accent" : "neutral"}>{source.kind}</Tag>
        <span style={{ marginLeft: "var(--space-1)" }}>
          {source.width}×{source.height}
        </span>
      </CardMeta>
    </Card>
  );
}

const NOTICE_COLOR: Record<LauncherNotice["tone"], string> = {
  info: "var(--accent)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

function NoticeBanner({ notice }: { notice: LauncherNotice }) {
  return (
    <div
      role={notice.tone === "info" ? "status" : "alert"}
      data-testid={`launcher-notice-${notice.id}`}
      data-tone={notice.tone}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) var(--space-3)",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${NOTICE_COLOR[notice.tone]}`,
        background: "var(--bg-panel-raised)",
        color: "var(--text-1)",
        fontSize: 13,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "var(--radius-full)",
          background: NOTICE_COLOR[notice.tone],
          flex: "none",
        }}
      />
      <span style={{ flex: 1 }}>{notice.message}</span>
      {notice.action ? (
        <Button variant="secondary" onClick={notice.action.onClick}>
          {notice.action.label}
        </Button>
      ) : null}
      {notice.onDismiss ? (
        <Button variant="ghost" onClick={notice.onDismiss} aria-label="Dismiss">
          ✕
        </Button>
      ) : null}
    </div>
  );
}

function SourcesPlaceholder({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        gridColumn: "1 / -1",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "var(--space-5)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-sunken)",
        color: "var(--text-2)",
        fontSize: 13,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

const EMPTY_COPY: Record<SourceMode, string> = {
  screen: "No displays found. Check that a screen is connected.",
  region: "No displays found. Check that a screen is connected.",
  window: "No windows to record. Open the app you want to capture.",
};

/**
 * Launcher — the "Record something great" window (720×520).
 * Presentational: all data arrives via props, ephemeral selection lives in
 * local state, and the chosen `RecordOptions` are emitted through `onStart`.
 */
export function Launcher({
  sources,
  micDevices,
  webcamDevices,
  systemAudioSupported,
  systemAudioNote,
  onStart,
  onOpenSettings,
  sourcesStatus = "ready",
  sourcesError,
  onRetrySources,
  notices,
  busy = false,
  busyLabel,
  defaults,
  pickerSources,
}: LauncherProps) {
  const [mode, setMode] = useState<SourceMode>(defaults?.mode ?? "screen");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mic, setMic] = useState(defaults?.mic ?? false);
  const [micPick, setMicDeviceId] = useState<string>(defaults?.micDeviceId ?? "");
  const [systemAudio, setSystemAudio] = useState(defaults?.systemAudio ?? false);
  const [webcam, setWebcam] = useState(defaults?.webcam ?? false);
  const [webcamPick, setWebcamDeviceId] = useState<string>(defaults?.webcamDeviceId ?? "");
  const [fps, setFps] = useState<Fps>(defaults?.fps ?? 30);
  const [countdown, setCountdown] = useState<Countdown>(defaults?.countdown ?? 3);
  const [hideCursor, setHideCursor] = useState(defaults?.hideCursor ?? false);

  // Settings defaults load async and can change while the launcher is open.
  const defaultsKey = defaults ? JSON.stringify(Object.entries(defaults).sort()) : "";
  const appliedDefaults = useRef(defaultsKey);
  const latestDefaults = useRef(defaults);
  latestDefaults.current = defaults;
  useEffect(() => {
    if (appliedDefaults.current === defaultsKey) return;
    appliedDefaults.current = defaultsKey;
    const d = latestDefaults.current ?? {};
    if (d.mode) setMode(d.mode);
    if (d.mic !== undefined) {
      setMic(d.mic);
      setMicDeviceId(d.micDeviceId ?? "");
    }
    if (d.systemAudio !== undefined) setSystemAudio(d.systemAudio);
    if (d.webcam !== undefined) {
      setWebcam(d.webcam);
      setWebcamDeviceId(d.webcamDeviceId ?? "");
    }
    if (d.fps !== undefined) setFps(d.fps);
    if (d.countdown !== undefined) setCountdown(d.countdown);
    if (d.hideCursor !== undefined) setHideCursor(d.hideCursor);
  }, [defaultsKey]);

  // Screen and region capture displays; window mode lists windows. The list
  // refreshes while open, so keep the selection only while it still exists.
  const wantKind = sourceKindFor(mode);
  const visibleSources = sources.filter((s) => s.kind === wantKind);
  const effectiveId = effectiveSourceId(sources, mode, selectedId);
  const micDeviceId = effectiveDeviceId(micDevices, micPick);
  const webcamDeviceId = effectiveDeviceId(webcamDevices, webcamPick);
  const [pickerOpen, setPickerOpen] = useState(false);

  const canRecord = effectiveId !== null && !busy && sourcesStatus === "ready";

  function handleStart() {
    if (effectiveId === null || !canRecord) return;
    const options: RecordOptions = {
      sourceId: effectiveId,
      mode,
      mic,
      systemAudio: systemAudioSupported && systemAudio,
      webcam,
      fps,
      countdown,
      hideCursor,
      // exactOptionalPropertyTypes: only include the optional keys when set.
      ...(mic && micDeviceId ? { micDeviceId } : {}),
      ...(webcam && webcamDeviceId ? { webcamDeviceId } : {}),
    };
    onStart(options);
  }

  const sectionStyle = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  } as const;

  const labelStyle = {
    fontFamily: "var(--font-heading)",
    fontSize: 13,
    color: "var(--text-2)",
  } as const;

  const rowStyle = {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    flexWrap: "wrap",
  } as const;

  return (
    <div
      style={{
        // Fills the 720×520 launcher window; centred when hosted in a wider one.
        width: "100%",
        maxWidth: 720,
        minHeight: 520,
        margin: "0 auto",
        boxSizing: "border-box",
        background: "var(--bg-app)",
        color: "var(--text-1)",
        fontFamily: "var(--font-body)",
        padding: "var(--space-5)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 24,
            color: "var(--accent)",
          }}
        >
          Reelform
        </span>
        <Button icon aria-label="Settings" onClick={onOpenSettings}>
          ⚙
        </Button>
      </header>

      {notices && notices.length > 0 ? (
        <section style={{ ...sectionStyle, gap: "var(--space-2)" }}>
          {notices.map((n) => (
            <NoticeBanner key={n.id} notice={n} />
          ))}
        </section>
      ) : null}

      {/* Source mode */}
      <section style={sectionStyle}>
        <span style={labelStyle}>Capture</span>
        <Segmented<SourceMode>
          name="launcher-mode"
          value={mode}
          options={MODE_OPTIONS}
          onChange={setMode}
        />
      </section>

      {/* Sources grid */}
      <section style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={labelStyle}>Sources</span>
          {pickerSources ? (
            <Button variant="ghost" onClick={() => setPickerOpen(true)}>
              Browse…
            </Button>
          ) : null}
        </div>
        {pickerSources && pickerOpen ? (
          <div
            data-testid="launcher-picker-backdrop"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 10,
              display: "grid",
              placeItems: "center",
              background: "color-mix(in srgb, var(--bg-sunken) 60%, transparent)",
            }}
          >
            <SourcePicker
              sources={pickerSources}
              status={sourcesStatus}
              error={sourcesError}
              selectedId={effectiveId}
              initialTab={mode === "window" ? "windows" : "displays"}
              onCancel={() => setPickerOpen(false)}
              onSelect={(source) => {
                setMode(modeForPick(mode, source.kind));
                setSelectedId(source.id);
                setPickerOpen(false);
              }}
            />
          </div>
        ) : null}
        <div
          role="listbox"
          aria-label="Capturable sources"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "var(--space-3)",
          }}
        >
          {sourcesStatus === "loading" && visibleSources.length === 0 ? (
            <SourcesPlaceholder testId="launcher-sources-loading">
              <output>Looking for screens and windows…</output>
            </SourcesPlaceholder>
          ) : sourcesStatus === "error" ? (
            <SourcesPlaceholder testId="launcher-sources-error">
              <span role="alert">{sourcesError ?? "Couldn't list screens and windows."}</span>
              {onRetrySources ? (
                <Button variant="secondary" onClick={onRetrySources}>
                  Retry
                </Button>
              ) : null}
            </SourcesPlaceholder>
          ) : visibleSources.length === 0 ? (
            <SourcesPlaceholder testId="launcher-sources-empty">
              {EMPTY_COPY[mode]}
            </SourcesPlaceholder>
          ) : (
            visibleSources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                selected={source.id === effectiveId}
                onSelect={() => setSelectedId(source.id)}
              />
            ))
          )}
        </div>
      </section>

      {/* Audio */}
      <section style={sectionStyle}>
        <span style={labelStyle}>Audio</span>
        <div style={rowStyle}>
          <Toggle label="Microphone" checked={mic} onChange={setMic} />
          <DeviceSelect
            ariaLabel="Microphone device"
            devices={micDevices}
            value={micDeviceId}
            onChange={setMicDeviceId}
            disabled={!mic}
          />
        </div>
        <div style={rowStyle}>
          <Toggle
            label="System audio"
            checked={systemAudio}
            onChange={setSystemAudio}
            disabled={!systemAudioSupported}
          />
          {!systemAudioSupported && (
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
              {systemAudioNote ?? "Unavailable on macOS"}
            </span>
          )}
        </div>
      </section>

      {/* Webcam */}
      <section style={sectionStyle}>
        <span style={labelStyle}>Webcam</span>
        <div style={rowStyle}>
          <Toggle label="Webcam" checked={webcam} onChange={setWebcam} />
          <DeviceSelect
            ariaLabel="Webcam device"
            devices={webcamDevices}
            value={webcamDeviceId}
            onChange={setWebcamDeviceId}
            disabled={!webcam}
          />
        </div>
      </section>

      {/* Options */}
      <section style={sectionStyle}>
        <span style={labelStyle}>Options</span>
        <div style={rowStyle}>
          <span style={labelStyle}>FPS</span>
          <Segmented<`${Fps}`>
            name="launcher-fps"
            value={`${fps}`}
            options={FPS_OPTIONS}
            onChange={(v) => setFps(Number(v) as Fps)}
          />
          <span style={labelStyle}>Countdown</span>
          <Segmented<`${Countdown}`>
            name="launcher-countdown"
            value={`${countdown}`}
            options={COUNTDOWN_OPTIONS}
            onChange={(v) => setCountdown(Number(v) as Countdown)}
          />
          <Toggle label="Hide cursor" checked={hideCursor} onChange={setHideCursor} />
        </div>
      </section>

      {/* Record */}
      <Button variant="primary" block disabled={!canRecord} onClick={handleStart}>
        {busy ? (busyLabel ?? "Starting…") : mode === "region" ? "Select region" : "Record"}
      </Button>

      {/* Recent projects */}
      <footer style={{ display: "flex", justifyContent: "center" }}>
        <Button variant="ghost">Recent projects</Button>
      </footer>
    </div>
  );
}

/** Fixture so tests (and stories) can mount the Launcher without real IPC data. */
export const sampleLauncherProps: LauncherProps = {
  sources: [
    { id: "disp-1", kind: "display", name: "Built-in Retina Display", width: 3024, height: 1964 },
    { id: "disp-2", kind: "display", name: "LG UltraFine", width: 3840, height: 2160 },
    { id: "win-1", kind: "window", name: "Safari — Reelform", width: 1440, height: 900 },
  ],
  micDevices: [
    { id: "mic-default", label: "MacBook Pro Microphone" },
    { id: "mic-usb", label: "Shure MV7" },
  ],
  webcamDevices: [
    { id: "cam-default", label: "FaceTime HD Camera" },
    { id: "cam-usb", label: "Logitech Brio" },
  ],
  systemAudioSupported: false,
  onStart: () => {},
};
