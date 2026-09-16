import { Button } from "@design/components";
import { type CSSProperties, type ReactElement, useId } from "react";
import {
  Callout,
  Card,
  EmptyState,
  FieldRow,
  GroupLabel,
  NumberField,
  Slider,
  Switch,
  hintStyle,
  inspectorRootStyle,
  monoStyle,
  useInspectorControlStyles,
} from "../controls";
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
  gap: "8px",
  minHeight: "18px",
  fontSize: "11px",
  color: "var(--text-1)",
  minWidth: 0,
};

const nameStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

interface VolumeSliderProps {
  label: string;
  db: number;
  disabled?: boolean | undefined;
  /** Track colour: panel inside a raised card, raised on the panel. */
  track?: string | undefined;
  onChange: (db: number) => void;
}

/** dB slider: position 0 = −∞, then 0.1 dB steps up to +12 dB. */
function VolumeSlider({
  label,
  db,
  disabled,
  track = "var(--bg-panel)",
  onChange,
}: VolumeSliderProps): ReactElement {
  useInspectorControlStyles();
  const id = useId();
  const text = formatDb(db);
  const pos = dbToSliderPosition(db);
  const pct = (pos / SLIDER_STEPS) * 100;
  return (
    <div style={rowStyle}>
      <label htmlFor={id} style={{ flex: "0 0 auto", color: "var(--text-2)" }}>
        {label}
      </label>
      <input
        id={id}
        className="rf-range"
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={pos}
        aria-valuetext={text}
        disabled={disabled}
        onChange={(e) => onChange(sliderPositionToDb(Number(e.target.value)))}
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}%, ${track} ${pct}%)`,
        }}
      />
      <span style={{ ...monoStyle, flex: "0 0 auto", whiteSpace: "nowrap" }}>{text}</span>
    </div>
  );
}

interface ToggleChipProps {
  label: string;
  short: string;
  pressed: boolean;
  onToggle: () => void;
}

/** Compact M / S text toggle (text-3 idle, accent when active). */
function ToggleChip({ label, short, pressed, onToggle }: ToggleChipProps): ReactElement {
  return (
    <button
      type="button"
      className="rf-choice"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onToggle}
      style={{
        appearance: "none",
        minWidth: "16px",
        height: "16px",
        padding: "0 3px",
        borderRadius: "4px",
        border: 0,
        cursor: "pointer",
        fontSize: "11px",
        fontWeight: pressed ? 700 : 400,
        fontFamily: "var(--font-body)",
        background: "transparent",
        color: pressed ? "var(--accent-hover)" : "var(--text-3)",
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
  height?: number | undefined;
  fill?: string | undefined;
}

function MiniWaveform({
  kind,
  peaks,
  silent,
  height = 22,
  fill = "color-mix(in srgb, var(--text-2) 50%, transparent)",
}: MiniWaveformProps): ReactElement {
  const bars = downsamplePeaks(peaks ?? [], WAVEFORM_BARS);
  const color = silent ? "color-mix(in srgb, var(--text-3) 50%, transparent)" : fill;
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
      style={{ display: "block" }}
    >
      {bars.map((p, i) => {
        const h = Math.max(1, p * height);
        return <rect key={i} x={i * 3} y={(height - h) / 2} width={2.6} height={h} fill={color} />;
      })}
    </svg>
  );
}

const TRACK_WAVE: Readonly<Record<TrackKind, { height: number; fill: string }>> = {
  mic: { height: 22, fill: "color-mix(in srgb, var(--success) 60%, transparent)" },
  system: { height: 18, fill: "color-mix(in srgb, var(--text-2) 50%, transparent)" },
};

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
        <Callout
          key={kind}
          tone="neutral"
          title={t("inspector.audio.notAvailable", { track: label })}
        >
          <span>{missingTrackReason?.[kind] ?? t(DEFAULT_MISSING_REASON[kind])}</span>
        </Callout>
      );
    }
    const track = value.tracks[kind];
    const silent = trackGain(value, kind, availableTracks) === 0;
    const silencedBySolo = soloActive && !track.solo && !track.muted && !value.master.muteAll;
    const set = (patch: Partial<AudioSettings["tracks"][typeof kind]>) =>
      onChange(updateTrack(value, kind, patch, trackDurationMs));
    return (
      <div key={kind} role="group" aria-label={label}>
        <Card>
          <div style={rowStyle}>
            <span style={nameStyle}>{label}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
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
          <MiniWaveform
            kind={kind}
            peaks={waveforms?.[kind]}
            silent={silent}
            height={TRACK_WAVE[kind].height}
            fill={TRACK_WAVE[kind].fill}
          />
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
          <FieldRow>
            <NumberField
              inline
              label={t("inspector.common.fadeIn")}
              unit="ms"
              min={0}
              max={fadeMax}
              step={50}
              value={track.fadeInMs}
              onChange={(fadeInMs) => set({ fadeInMs })}
            />
            <NumberField
              inline
              label={t("inspector.common.fadeOut")}
              unit="ms"
              min={0}
              max={fadeMax}
              step={50}
              value={track.fadeOutMs}
              onChange={(fadeOutMs) => set({ fadeOutMs })}
            />
          </FieldRow>
        </Card>
      </div>
    );
  };

  const renderRegion = (region: AudioRegion): ReactElement => {
    const set = (patch: Parameters<typeof updateRegion>[2]) =>
      onChange(updateRegion(value, region.id, patch));
    const duration = regionDurationMs(region);
    const duckDisabled = !region.duck.enabled || !availableTracks.mic;
    return (
      <div key={region.id} role="group" aria-label={region.fileName}>
        <Card gap="8px" style={{ padding: "10px" }}>
          <div style={rowStyle}>
            <span title={region.path} style={nameStyle}>
              {region.fileName}
            </span>
            <button
              type="button"
              className="rf-choice"
              aria-label={t("inspector.audio.removeFile", { file: region.fileName })}
              title={t("inspector.common.remove")}
              onClick={() => onChange(removeRegion(value, region.id))}
              style={{
                appearance: "none",
                marginLeft: "auto",
                flex: "0 0 auto",
                border: 0,
                borderRadius: "4px",
                padding: "0 4px",
                background: "transparent",
                color: "var(--text-3)",
                fontFamily: "var(--font-body)",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              {t("inspector.common.remove")}
            </button>
          </div>
          {regionWaveforms?.[region.id] && (
            <MiniWaveform
              kind={`region-${region.id}`}
              peaks={regionWaveforms[region.id]}
              silent={region.volumeDb === Number.NEGATIVE_INFINITY}
              height={18}
            />
          )}
          <VolumeSlider
            label={t("inspector.common.volume")}
            db={region.volumeDb}
            onChange={(volumeDb) => set({ volumeDb })}
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
            format={(db) => `−${db} dB`}
            value={region.duck.amountDb}
            disabled={duckDisabled}
            onChange={(amountDb) => set({ duck: { amountDb } })}
          />
          <Switch
            label={t("inspector.common.loop")}
            checked={region.loop}
            onChange={(loop) => set({ loop })}
          />
          <FieldRow>
            <NumberField
              inline
              label={t("inspector.common.fadeIn")}
              unit="ms"
              min={0}
              max={duration}
              step={50}
              value={region.fadeInMs}
              onChange={(fadeInMs) => set({ fadeInMs })}
            />
            <NumberField
              inline
              label={t("inspector.common.fadeOut")}
              unit="ms"
              min={0}
              max={duration}
              step={50}
              value={region.fadeOutMs}
              onChange={(fadeOutMs) => set({ fadeOutMs })}
            />
          </FieldRow>
        </Card>
      </div>
    );
  };

  return (
    <div style={{ ...inspectorRootStyle, gap: "12px" }}>
      {noTracks ? (
        <EmptyState icon="♪" title={t("inspector.audio.noTracks.title")}>
          {t("inspector.audio.noTracks.body")}
        </EmptyState>
      ) : (
        <div
          aria-label={t("inspector.audio.tracks")}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          {TRACK_KINDS.map(renderTrack)}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <GroupLabel>{t("inspector.audio.extra")}</GroupLabel>
        {value.regions.length === 0 ? (
          <div style={{ ...hintStyle, display: "flex", flexDirection: "column" }}>
            <span style={{ color: "var(--text-2)", fontWeight: 600 }}>
              {t("inspector.audio.noExtra.title")}
            </span>
            <span>{t("inspector.audio.noExtra.body")}</span>
          </div>
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
      </div>

      <div
        aria-label={t("inspector.audio.master")}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "9px",
          paddingTop: "8px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <VolumeSlider
          label={t("inspector.audio.outputVolume")}
          db={value.master.volumeDb}
          track="var(--bg-panel-raised)"
          onChange={(volumeDb) => onChange(updateMaster(value, { volumeDb }))}
        />
        <Switch
          label={t("inspector.audio.muteAll")}
          checked={value.master.muteAll}
          onChange={(muteAll) => onChange(updateMaster(value, { muteAll }))}
        />
        <div aria-label={t("inspector.audio.clicks")}>
          <Slider
            label={t("inspector.audio.clickSounds")}
            labelWidth={110}
            min={AUDIO_LIMITS.clickVolume.min}
            max={AUDIO_LIMITS.clickVolume.max}
            unit="%"
            value={value.clickVolume}
            onChange={(v) => onChange(setClickVolume(value, v))}
          />
        </div>
      </div>
    </div>
  );
}
