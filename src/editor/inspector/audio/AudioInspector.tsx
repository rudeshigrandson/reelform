import { Button } from "@design/components";
import { type CSSProperties, type ReactElement, useId } from "react";
import { EmptyState, NumberField, Section, Slider, Switch } from "../controls";
import { type InspectorMessageKey, useInspectorT } from "../i18n";
import {
  SLIDER_STEPS,
  anySolo,
  dbToSliderPosition,
  downsamplePeaks,
  formatDb,
  regionDurationMs,
  removeRegion,
  setClickVolume,
  sliderPositionToDb,
  trackGain,
  updateMaster,
  updateRegion,
  updateTrack,
} from "./audio";
import {
  AUDIO_LIMITS,
  type AudioRegion,
  type AudioSettings,
  type AvailableTracks,
  TRACK_KINDS,
  TRACK_LABEL_KEYS,
  type TrackKind,
} from "./types";

/** Inspector tab S17 — Audio. Presentational: all state flows through `value` / `onChange`. */
export interface AudioInspectorProps {
  value: AudioSettings;
  onChange: (next: AudioSettings) => void;
  /** Which recorded tracks exist in this project. */
  availableTracks: AvailableTracks;
  /** Normalized (0–1) peaks per track for the mini waveform. */
  waveforms?: Partial<Record<TrackKind, number[]>> | undefined;
  /** Recording duration; bounds track fades. */
  trackDurationMs?: number | undefined;
  /** Overrides the default "track missing" explanation per track. */
  missingTrackReason?: Partial<Record<TrackKind, string>> | undefined;
  /** Opens the host's "Add audio…" file picker. */
  onAddAudio: () => void;
  /** Decoded peaks (0..1) per extra audio region id. */
  regionWaveforms?: Readonly<Record<string, number[]>> | undefined;
  /** Inline error from the last "Add audio…". */
  addAudioError?: string | null | undefined;
  /** True while a picked file is being imported/decoded. */
  addingAudio?: boolean | undefined;
}

export const WAVEFORM_BARS = 48;

const DEFAULT_MISSING_REASON: Readonly<Record<TrackKind, InspectorMessageKey>> = {
  mic: "inspector.audio.missing.mic",
  system: "inspector.audio.missing.system",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  minHeight: "28px",
  fontSize: "13px",
  color: "var(--text-1)",
};

const labelStyle: CSSProperties = { flex: "0 0 96px", color: "var(--text-2)" };

const monoStyle: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "12px",
  color: "var(--text-2)",
  minWidth: "64px",
  textAlign: "right",
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-1)",
  padding: "var(--space-2)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--bg-sunken)",
};

const hintStyle: CSSProperties = { fontSize: "11px", color: "var(--text-3)" };

interface VolumeSliderProps {
  label: string;
  db: number;
  disabled?: boolean | undefined;
  onChange: (db: number) => void;
}

/** dB slider: position 0 = −∞, then 0.1 dB steps up to +12 dB. */
function VolumeSlider({ label, db, disabled, onChange }: VolumeSliderProps): ReactElement {
  const id = useId();
  const text = formatDb(db);
  return (
    <div style={rowStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={dbToSliderPosition(db)}
        aria-valuetext={text}
        disabled={disabled}
        onChange={(e) => onChange(sliderPositionToDb(Number(e.target.value)))}
        style={{ flex: "1 1 auto", accentColor: "var(--accent)" }}
      />
      <span style={monoStyle}>{text}</span>
    </div>
  );
}

interface ToggleChipProps {
  label: string;
  short: string;
  pressed: boolean;
  onToggle: () => void;
}

/** Compact M / S toggle. */
function ToggleChip({ label, short, pressed, onToggle }: ToggleChipProps): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onToggle}
      style={{
        appearance: "none",
        width: "22px",
        height: "22px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border-strong)",
        cursor: "pointer",
        fontSize: "11px",
        fontWeight: 600,
        fontFamily: "var(--font-body)",
        background: pressed ? "var(--accent)" : "var(--bg-sunken)",
        color: pressed ? "var(--on-accent)" : "var(--text-2)",
      }}
    >
      {short}
    </button>
  );
}

interface MiniWaveformProps {
  /** Track kind or `region-<id>`; used for the test id. */
  kind: string;
  peaks: number[] | undefined;
  silent: boolean;
}

function MiniWaveform({ kind, peaks, silent }: MiniWaveformProps): ReactElement {
  const bars = downsamplePeaks(peaks ?? [], WAVEFORM_BARS);
  const height = 24;
  const fill = silent ? "var(--text-3)" : "var(--accent)";
  if (bars.length === 0) {
    return (
      <div
        data-testid={`waveform-${kind}`}
        data-empty="true"
        aria-hidden="true"
        style={{ height: `${height}px`, display: "flex", alignItems: "center" }}
      >
        <div style={{ width: "100%", height: "1px", background: "var(--border-strong)" }} />
      </div>
    );
  }
  return (
    <svg
      data-testid={`waveform-${kind}`}
      aria-hidden="true"
      width="100%"
      height={height}
      viewBox={`0 0 ${bars.length * 3} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block", opacity: silent ? 0.6 : 1 }}
    >
      {bars.map((p, i) => {
        const h = Math.max(1, p * height);
        return (
          <rect key={i} x={i * 3} y={(height - h) / 2} width={2} height={h} rx={0.5} fill={fill} />
        );
      })}
    </svg>
  );
}

export function AudioInspector({
  value,
  onChange,
  availableTracks,
  waveforms,
  trackDurationMs,
  missingTrackReason,
  onAddAudio,
  regionWaveforms,
  addAudioError,
  addingAudio,
}: AudioInspectorProps): ReactElement {
  const t = useInspectorT();
  const noTracks = !availableTracks.mic && !availableTracks.system;
  const soloActive = anySolo(value, availableTracks);
  const fadeMax = trackDurationMs ?? AUDIO_LIMITS.fadeMaxMs;

  const renderTrack = (kind: TrackKind): ReactElement => {
    const label = t(TRACK_LABEL_KEYS[kind]);
    if (!availableTracks[kind]) {
      return (
        <EmptyState key={kind} title={t("inspector.audio.notAvailable", { track: label })}>
          {missingTrackReason?.[kind] ?? t(DEFAULT_MISSING_REASON[kind])}
        </EmptyState>
      );
    }
    const track = value.tracks[kind];
    const silent = trackGain(value, kind, availableTracks) === 0;
    const silencedBySolo = soloActive && !track.solo && !track.muted && !value.master.muteAll;
    const set = (patch: Partial<AudioSettings["tracks"][typeof kind]>) =>
      onChange(updateTrack(value, kind, patch, trackDurationMs));
    return (
      <div key={kind} role="group" aria-label={label} style={cardStyle}>
        <div style={{ ...rowStyle, justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600 }}>{label}</span>
          <span style={{ display: "flex", gap: "var(--space-1)" }}>
            <ToggleChip
              label={t("inspector.audio.mute", { track: label })}
              short={t("inspector.audio.muteShort")}
              pressed={track.muted}
              onToggle={() => set({ muted: !track.muted })}
            />
            <ToggleChip
              label={t("inspector.audio.solo", { track: label })}
              short={t("inspector.audio.soloShort")}
              pressed={track.solo}
              onToggle={() => set({ solo: !track.solo })}
            />
          </span>
        </div>
        <MiniWaveform kind={kind} peaks={waveforms?.[kind]} silent={silent} />
        {silencedBySolo && <span style={hintStyle}>{t("inspector.audio.silencedBySolo")}</span>}
        <VolumeSlider
          label={t("inspector.common.volume")}
          db={track.volumeDb}
          onChange={(volumeDb) => set({ volumeDb })}
        />
        {kind === "mic" && (
          <Switch
            label={t("inspector.audio.noiseReduction")}
            checked={value.tracks.mic.noiseReduction}
            onChange={(noiseReduction) =>
              onChange(updateTrack(value, "mic", { noiseReduction }, trackDurationMs))
            }
          />
        )}
        <Switch
          label={t("inspector.audio.normalize")}
          hint="−16 LUFS"
          checked={track.normalize}
          onChange={(normalize) => set({ normalize })}
        />
        <NumberField
          label={t("inspector.common.fadeIn")}
          unit="ms"
          min={0}
          max={fadeMax}
          step={50}
          value={track.fadeInMs}
          onChange={(fadeInMs) => set({ fadeInMs })}
        />
        <NumberField
          label={t("inspector.common.fadeOut")}
          unit="ms"
          min={0}
          max={fadeMax}
          step={50}
          value={track.fadeOutMs}
          onChange={(fadeOutMs) => set({ fadeOutMs })}
        />
      </div>
    );
  };

  const renderRegion = (region: AudioRegion): ReactElement => {
    const set = (patch: Parameters<typeof updateRegion>[2]) =>
      onChange(updateRegion(value, region.id, patch));
    const duration = regionDurationMs(region);
    return (
      <div key={region.id} role="group" aria-label={region.fileName} style={cardStyle}>
        <div style={{ ...rowStyle, justifyContent: "space-between" }}>
          <span
            title={region.path}
            style={{
              ...monoStyle,
              textAlign: "left",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {region.fileName}
          </span>
          <Button
            variant="ghost"
            aria-label={t("inspector.audio.removeFile", { file: region.fileName })}
            onClick={() => onChange(removeRegion(value, region.id))}
          >
            {t("inspector.common.remove")}
          </Button>
        </div>
        {regionWaveforms?.[region.id] && (
          <MiniWaveform
            kind={`region-${region.id}`}
            peaks={regionWaveforms[region.id]}
            silent={region.volumeDb === Number.NEGATIVE_INFINITY}
          />
        )}
        <VolumeSlider
          label={t("inspector.common.volume")}
          db={region.volumeDb}
          onChange={(volumeDb) => set({ volumeDb })}
        />
        <NumberField
          label={t("inspector.common.fadeIn")}
          unit="ms"
          min={0}
          max={duration}
          step={50}
          value={region.fadeInMs}
          onChange={(fadeInMs) => set({ fadeInMs })}
        />
        <NumberField
          label={t("inspector.common.fadeOut")}
          unit="ms"
          min={0}
          max={duration}
          step={50}
          value={region.fadeOutMs}
          onChange={(fadeOutMs) => set({ fadeOutMs })}
        />
        <Switch
          label={t("inspector.common.loop")}
          checked={region.loop}
          onChange={(loop) => set({ loop })}
        />
        <Switch
          label={t("inspector.audio.duck")}
          hint={availableTracks.mic ? undefined : t("inspector.audio.duck.needsMic")}
          disabled={!availableTracks.mic}
          checked={region.duck.enabled}
          onChange={(enabled) => set({ duck: { enabled } })}
        />
        <Slider
          label={t("inspector.audio.duckAmount")}
          min={AUDIO_LIMITS.duckAmountDb.min}
          max={AUDIO_LIMITS.duckAmountDb.max}
          unit=" dB"
          value={region.duck.amountDb}
          disabled={!region.duck.enabled || !availableTracks.mic}
          onChange={(amountDb) => set({ duck: { amountDb } })}
        />
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-body)",
        color: "var(--text-1)",
      }}
    >
      <Section title={t("inspector.audio.tracks")}>
        {noTracks ? (
          <EmptyState title={t("inspector.audio.noTracks.title")}>
            {t("inspector.audio.noTracks.body")}
          </EmptyState>
        ) : (
          TRACK_KINDS.map(renderTrack)
        )}
      </Section>

      <Section title={t("inspector.audio.extra")}>
        {value.regions.length === 0 ? (
          <EmptyState title={t("inspector.audio.noExtra.title")}>
            {t("inspector.audio.noExtra.body")}
          </EmptyState>
        ) : (
          value.regions.map(renderRegion)
        )}
        <Button
          variant="secondary"
          block
          disabled={addingAudio === true}
          aria-busy={addingAudio === true}
          onClick={onAddAudio}
        >
          {addingAudio === true ? t("inspector.audio.adding") : t("inspector.audio.addButton")}
        </Button>
        {addAudioError ? (
          <span role="alert" style={{ ...hintStyle, color: "var(--danger)" }}>
            {addAudioError}
          </span>
        ) : null}
      </Section>

      <Section title={t("inspector.audio.master")}>
        <VolumeSlider
          label={t("inspector.audio.outputVolume")}
          db={value.master.volumeDb}
          onChange={(volumeDb) => onChange(updateMaster(value, { volumeDb }))}
        />
        <Switch
          label={t("inspector.audio.muteAll")}
          checked={value.master.muteAll}
          onChange={(muteAll) => onChange(updateMaster(value, { muteAll }))}
        />
      </Section>

      <Section title={t("inspector.audio.clicks")}>
        <Slider
          label={t("inspector.audio.clickSounds")}
          min={AUDIO_LIMITS.clickVolume.min}
          max={AUDIO_LIMITS.clickVolume.max}
          unit="%"
          value={value.clickVolume}
          onChange={(v) => onChange(setClickVolume(value, v))}
        />
      </Section>
    </div>
  );
}
