import { Button } from "@design/components";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../overlays/reducedMotion";
import { ProjectShelf, type ShelfView } from "./ProjectShelf";
import { SourcePicker } from "./SourcePicker";
import { PillSegmented, PillSelect, SectionLabel, SwitchRow } from "./controls";
import { type LauncherKey, useLauncherT } from "./i18n";
import { effectiveDeviceId, effectiveSourceId, modeForPick, sourceKindFor } from "./selection";
import type {
  Countdown,
  DeviceInfo,
  Fps,
  LauncherNotice,
  LauncherProject,
  LauncherProps,
  RecordOptions,
  SourceItem,
  SourceMode,
} from "./types";

const MODE_OPTIONS: ReadonlyArray<{ value: SourceMode; labelKey: LauncherKey }> = [
  { value: "screen", labelKey: "launcher.mode.screen" },
  { value: "window", labelKey: "launcher.mode.window" },
  { value: "region", labelKey: "launcher.mode.region" },
];

const FPS_VALUES: ReadonlyArray<Fps> = [30, 60];

const COUNTDOWN_VALUES: ReadonlyArray<Countdown> = [0, 3, 5, 10];

type PaneView = ShelfView | "capture";

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
  const t = useLauncherT();
  return (
    <PillSelect
      ariaLabel={ariaLabel}
      disabled={disabled || devices.length === 0}
      value={value}
      onChange={onChange}
    >
      {devices.length === 0 ? (
        <option value="">{t("launcher.devices.none")}</option>
      ) : (
        devices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))
      )}
    </PillSelect>
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
  const t = useLauncherT();
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        color: "inherit",
        font: "inherit",
        cursor: "pointer",
        padding: 8,
        borderRadius: 16,
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        outline: selected ? "2px solid var(--accent)" : "2px solid transparent",
        outlineOffset: -1,
        transition: reduceMotion ? "none" : "outline-color 120ms ease",
        minWidth: 0,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          borderRadius: 8,
          background: source.thumbnailUrl
            ? `center / cover no-repeat url(${source.thumbnailUrl})`
            : "var(--bg-sunken)",
          marginBottom: 6,
        }}
      />
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {source.name}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)" }}>
        <span style={{ color: selected ? "var(--accent-hover)" : undefined }}>
          {t(source.kind === "display" ? "launcher.kind.display" : "launcher.kind.window")}
        </span>{" "}
        ·{" "}
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {source.width}×{source.height}
        </span>
      </div>
    </button>
  );
}

const NOTICE_TINT: Record<LauncherNotice["tone"], { color: string; fill: number; line: number }> = {
  info: { color: "var(--accent)", fill: 16, line: 35 },
  warning: { color: "var(--warning)", fill: 14, line: 40 },
  danger: { color: "var(--danger)", fill: 16, line: 40 },
};

const linkButton: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  font: "inherit",
  cursor: "pointer",
};

/** Electron window-drag regions (not in React's CSS typings). */
const dragRegion = { WebkitAppRegion: "drag" } as CSSProperties;
const noDragRegion = { WebkitAppRegion: "no-drag" } as CSSProperties;

/** Space the macOS traffic lights take in a `hiddenInset` title bar. */
export const TRAFFIC_LIGHTS_INSET = 80;
/** Top strip height the traffic lights (x=16, y=14) are positioned for; matches Settings. */
export const TITLE_BAR_HEIGHT = 40;

/** Full-width 34px strip above both columns (update, permission revoked…). */
function NoticeBanner({ notice }: { notice: LauncherNotice }) {
  const t = useLauncherT();
  const tint = NOTICE_TINT[notice.tone];
  return (
    <div
      role={notice.tone === "info" ? "status" : "alert"}
      data-testid={`launcher-notice-${notice.id}`}
      data-tone={notice.tone}
      style={{
        minHeight: 34,
        flex: "none",
        boxSizing: "border-box",
        background: `color-mix(in srgb, ${tint.color} ${tint.fill}%, transparent)`,
        borderBottom: `1px solid color-mix(in srgb, ${tint.color} ${tint.line}%, transparent)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "6px 14px",
        fontSize: 12,
        color: "var(--text-1)",
      }}
    >
      <span style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
        {notice.tone === "info" ? null : <span aria-hidden="true">⚠</span>}
        <span>{notice.message}</span>
      </span>
      <span
        data-app-region="no-drag"
        style={{ display: "flex", gap: 12, alignItems: "center", flex: "none", ...noDragRegion }}
      >
        {notice.action ? (
          <button
            type="button"
            onClick={notice.action.onClick}
            style={{ ...linkButton, color: "var(--accent-hover)", fontWeight: 600 }}
          >
            {notice.action.label}
          </button>
        ) : null}
        {notice.onDismiss ? (
          <button
            type="button"
            onClick={notice.onDismiss}
            aria-label={t("launcher.notice.dismiss")}
            style={{ ...linkButton, color: "var(--text-3)" }}
          >
            ✕
          </button>
        ) : null}
      </span>
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
        borderRadius: 16,
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

const EMPTY_COPY: Record<SourceMode, LauncherKey> = {
  screen: "launcher.sources.noDisplays",
  region: "launcher.sources.noDisplays",
  window: "launcher.sources.noWindows",
};

function NavItem({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "9px 12px",
        border: "none",
        borderRadius: "var(--radius-full)",
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent-hover)" : "var(--text-2)",
        font: "inherit",
        fontSize: 13,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          flex: "none",
          borderRadius: "var(--radius-full)",
          background: active ? "var(--accent-hover)" : "var(--text-3)",
        }}
      />
      <span style={{ fontWeight: active ? 600 : 400 }}>{label}</span>
      {count ? (
        <span style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 11 }}>{count}</span>
      ) : null}
    </button>
  );
}

const optionRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  minHeight: 36,
  fontSize: 13,
};

/**
 * Launcher — S04 (720×520). A fixed 240px left column (brand, New recording,
 * Open project…, Recent / All projects / Trash, Settings · Help · version)
 * and a right pane that shows either the project shelf or the New recording
 * setup (mode, sources, audio, webcam, options → Record).
 * Presentational: data arrives via props and `RecordOptions` leave via `onStart`.
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
  projects,
  projectsStatus = "ready",
  trashedProjects,
  onOpenProject,
  onProjectMenu,
  canRevealProjects,
  platform,
  insetTitleBar = false,
  onOpenProjectFile,
  onOpenHelp,
  version,
  newRecordingDisabled = false,
}: LauncherProps) {
  const t = useLauncherT();
  const modeOptions = MODE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
  const fpsOptions = FPS_VALUES.map((v) => ({ value: `${v}` as `${Fps}`, label: `${v}` }));
  const countdownOptions = COUNTDOWN_VALUES.map((seconds) => ({
    value: `${seconds}` as `${Countdown}`,
    label:
      seconds === 0
        ? t("launcher.options.countdownOff")
        : t("launcher.options.countdownSeconds", { seconds }),
  }));
  const hasShelf = projects !== undefined;
  const [view, setView] = useState<PaneView>(hasShelf ? "recent" : "capture");
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

  const canRecord =
    effectiveId !== null && !busy && sourcesStatus === "ready" && !newRecordingDisabled;

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

  const openCapture = () => {
    if (!newRecordingDisabled) setView("capture");
  };

  const shelfProjects: ReadonlyArray<LauncherProject> =
    view === "trash" ? (trashedProjects ?? []) : (projects ?? []);

  const footerLink: CSSProperties = { ...linkButton, color: "var(--text-3)", fontSize: 12 };

  const sidebar = (
    <aside
      style={{
        width: 240,
        flex: "none",
        boxSizing: "border-box",
        background: "var(--bg-panel)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        padding: "18px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        <div
          aria-hidden="true"
          style={{
            width: 26,
            height: 26,
            borderRadius: "var(--radius-full)",
            background: "var(--bg-app)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "var(--radius-full)",
              background: "var(--accent)",
            }}
          />
        </div>
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>Reelform</span>
      </div>

      <button
        type="button"
        aria-pressed={view === "capture"}
        disabled={newRecordingDisabled}
        onClick={openCapture}
        style={{
          height: 46,
          flex: "none",
          border: "none",
          borderRadius: "var(--radius-full)",
          background: "var(--accent)",
          color: "var(--on-accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          font: "inherit",
          fontWeight: 600,
          fontSize: 14,
          boxShadow: newRecordingDisabled
            ? "none"
            : "0 6px 18px color-mix(in srgb, var(--accent) 30%, transparent)",
          opacity: newRecordingDisabled ? 0.45 : 1,
          cursor: newRecordingDisabled ? "not-allowed" : "pointer",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 14,
            height: 14,
            boxSizing: "border-box",
            borderRadius: "var(--radius-full)",
            border: "3px solid var(--on-accent)",
          }}
        />
        {t("launcher.newRecording")}
      </button>

      {onOpenProjectFile ? (
        <button
          type="button"
          onClick={onOpenProjectFile}
          style={{
            height: 38,
            flex: "none",
            marginTop: 10,
            borderRadius: "var(--radius-full)",
            background: "var(--bg-panel-raised)",
            border: "1px solid var(--border-strong)",
            color: "var(--text-1)",
            font: "inherit",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {t("launcher.openProject")}
        </button>
      ) : null}

      {hasShelf ? (
        <nav
          aria-label={t("launcher.nav.label")}
          style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 2 }}
        >
          <NavItem
            label={t("launcher.nav.recent")}
            active={view === "recent"}
            onClick={() => setView("recent")}
          />
          <NavItem
            label={t("launcher.nav.all")}
            active={view === "all"}
            count={projectsStatus === "ready" ? projects.length : undefined}
            onClick={() => setView("all")}
          />
          {trashedProjects ? (
            <NavItem
              label={t("launcher.nav.trash")}
              active={view === "trash"}
              count={trashedProjects.length}
              onClick={() => setView("trash")}
            />
          ) : null}
        </nav>
      ) : null}

      <div
        style={{
          marginTop: "auto",
          paddingTop: 12,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 12,
          color: "var(--text-3)",
        }}
      >
        {onOpenSettings ? (
          <button type="button" onClick={onOpenSettings} style={footerLink}>
            <span aria-hidden="true">⚙ </span>
            {t("launcher.openSettings")}
          </button>
        ) : null}
        {onOpenHelp ? (
          <button type="button" onClick={onOpenHelp} style={footerLink}>
            <span aria-hidden="true">? </span>
            {t("launcher.help")}
          </button>
        ) : null}
        {version ? (
          <span
            data-testid="launcher-version"
            style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {version}
          </span>
        ) : null}
      </div>
    </aside>
  );

  const capture = (
    <section
      aria-label={t("launcher.newRecording")}
      style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 18px 12px",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 19,
            margin: 0,
            fontWeight: "normal",
          }}
        >
          {t("launcher.newRecording")}
        </h2>
        {hasShelf ? (
          <button
            type="button"
            aria-label={t("launcher.capture.close")}
            onClick={() => setView("recent")}
            style={{
              width: 32,
              height: 32,
              border: "none",
              borderRadius: 10,
              background: "transparent",
              color: "var(--text-2)",
              font: "inherit",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 18px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>{t("launcher.section.capture")}</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <PillSegmented<SourceMode>
              name="launcher-mode"
              value={mode}
              options={modeOptions}
              onChange={setMode}
            />
            {pickerSources ? (
              <Button
                variant="ghost"
                onClick={() => setPickerOpen(true)}
                style={{
                  color: "var(--accent-hover)",
                  fontFamily: "var(--font-body)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {t("launcher.browse")}
              </Button>
            ) : null}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>{t("launcher.section.sources")}</SectionLabel>
          <fieldset
            aria-label={t("launcher.sources.label")}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              margin: 0,
              padding: 0,
              border: "none",
              minWidth: 0,
            }}
          >
            {sourcesStatus === "loading" && visibleSources.length === 0 ? (
              <SourcesPlaceholder testId="launcher-sources-loading">
                <output>{t("launcher.sources.loading")}</output>
              </SourcesPlaceholder>
            ) : sourcesStatus === "error" ? (
              <SourcesPlaceholder testId="launcher-sources-error">
                <span role="alert">{sourcesError ?? t("launcher.sources.error")}</span>
                {onRetrySources ? (
                  <Button variant="secondary" onClick={onRetrySources}>
                    {t("launcher.sources.retry")}
                  </Button>
                ) : null}
              </SourcesPlaceholder>
            ) : visibleSources.length === 0 ? (
              <SourcesPlaceholder testId="launcher-sources-empty">
                {t(EMPTY_COPY[mode])}
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
          </fieldset>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionLabel>{t("launcher.section.audio")}</SectionLabel>
          <SwitchRow label={t("launcher.audio.microphone")} checked={mic} onChange={setMic}>
            <DeviceSelect
              ariaLabel={t("launcher.audio.microphoneDevice")}
              devices={micDevices}
              value={micDeviceId}
              onChange={setMicDeviceId}
              disabled={!mic}
            />
          </SwitchRow>
          <SwitchRow
            label={t("launcher.audio.systemAudio")}
            checked={systemAudio}
            onChange={setSystemAudio}
            disabled={!systemAudioSupported}
          >
            {!systemAudioSupported ? (
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                {systemAudioNote ?? t("launcher.audio.systemAudioUnavailable")}
              </span>
            ) : null}
          </SwitchRow>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionLabel>{t("launcher.section.webcam")}</SectionLabel>
          <SwitchRow label={t("launcher.webcam.toggle")} checked={webcam} onChange={setWebcam}>
            <DeviceSelect
              ariaLabel={t("launcher.webcam.device")}
              devices={webcamDevices}
              value={webcamDeviceId}
              onChange={setWebcamDeviceId}
              disabled={!webcam}
            />
          </SwitchRow>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionLabel>{t("launcher.section.options")}</SectionLabel>
          <div style={optionRow}>
            <span>{t("launcher.options.fps")}</span>
            <PillSegmented<`${Fps}`>
              name="launcher-fps"
              value={`${fps}`}
              options={fpsOptions}
              onChange={(v) => setFps(Number(v) as Fps)}
            />
          </div>
          <div style={optionRow}>
            <span>{t("launcher.options.countdown")}</span>
            <PillSegmented<`${Countdown}`>
              name="launcher-countdown"
              value={`${countdown}`}
              options={countdownOptions}
              onChange={(v) => setCountdown(Number(v) as Countdown)}
            />
          </div>
          <SwitchRow
            label={t("launcher.options.hideCursor")}
            checked={hideCursor}
            onChange={setHideCursor}
          />
        </div>
      </div>

      <div
        style={{
          flex: "none",
          padding: "12px 18px 18px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          disabled={!canRecord}
          onClick={handleStart}
          style={{
            width: "100%",
            height: 40,
            border: "none",
            borderRadius: "var(--radius-full)",
            background: "var(--accent)",
            color: "var(--on-accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            font: "inherit",
            fontWeight: 600,
            fontSize: 14,
            opacity: canRecord ? 1 : 0.45,
            cursor: canRecord ? "pointer" : "not-allowed",
          }}
        >
          {busy
            ? (busyLabel ?? t("launcher.record.starting"))
            : mode === "region"
              ? t("launcher.record.selectRegion")
              : t("launcher.record")}
        </button>
      </div>
    </section>
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        minHeight: 480,
        boxSizing: "border-box",
        overflow: "hidden",
        background: "var(--bg-app)",
        color: "var(--text-1)",
        fontFamily: "var(--font-body)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {insetTitleBar ? (
        // hiddenInset title bar: drag strip clearing the traffic lights; notices sit inside it.
        <div
          data-testid="launcher-titlebar"
          data-app-region="drag"
          style={{
            ...dragRegion,
            flex: "none",
            minHeight: TITLE_BAR_HEIGHT,
            boxSizing: "border-box",
            paddingLeft: TRAFFIC_LIGHTS_INSET,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {notices?.map((n) => (
            <NoticeBanner key={n.id} notice={n} />
          ))}
        </div>
      ) : (
        notices?.map((n) => <NoticeBanner key={n.id} notice={n} />)
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {sidebar}
        <main
          style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
        >
          {view === "capture" ? (
            capture
          ) : (
            <ProjectShelf
              key={view}
              view={view}
              projects={shelfProjects}
              status={projectsStatus}
              onOpenProject={onOpenProject}
              onProjectMenu={onProjectMenu}
              canRevealProjects={canRevealProjects}
              platform={platform}
              onRecord={openCapture}
              recordDisabled={newRecordingDisabled}
            />
          )}
        </main>
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

/** Shelf fixture for tests / stories. */
export const sampleLauncherProjects: ReadonlyArray<LauncherProject> = [
  {
    id: "p1",
    name: "Onboarding flow walkthrough",
    modifiedAt: "2026-09-14T09:30:00.000Z",
    durationMs: 42_180,
  },
  {
    id: "p2",
    name: "CLI release demo",
    modifiedAt: "2026-09-13T18:05:00.000Z",
    durationMs: 131_400,
  },
  {
    id: "p3",
    name: "Ticket 3491 — how to invite",
    modifiedAt: "2026-09-11T11:20:00.000Z",
    durationMs: 18_020,
  },
  {
    id: "p4",
    name: "Vertical teaser — Product Hunt",
    modifiedAt: "2026-09-07T08:00:00.000Z",
    durationMs: 29_900,
  },
];
