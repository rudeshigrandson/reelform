import { Button, Dialog } from "@design/components";
import { type ReactElement, useMemo, useState } from "react";
import { Slider, clamp } from "../controls";
import { useInspectorT } from "../i18n";
import { detectSilentGaps, formatSilencePreview, summarizeGaps } from "./logic";
import {
  type AudioEnvelope,
  DEFAULT_SILENCE_PARAMS,
  EFFECTS_LIMITS,
  type SilenceParams,
  type TimeRange,
} from "./types";

export interface RemoveSilenceDialogProps {
  open: boolean;
  onClose: () => void;
  /** Analyzed mic (or system) audio; `null` = nothing to analyze. */
  envelope: AudioEnvelope | null;
  initialParams?: SilenceParams | undefined;
  /** Apply as one rippling cut command. */
  onApply: (gaps: TimeRange[], params: SilenceParams) => void;
}

/** Bars in the waveform preview. */
const PREVIEW_BARS = 56;
/** dB floor mapped to an empty bar. */
const FLOOR_DB = -80;

const levelPct = (db: number): number =>
  Number.isFinite(db) ? clamp(((db - FLOOR_DB) / -FLOOR_DB) * 100, 3, 100) : 3;

/** "Remove silence" tool (S20b): waveform preview, threshold + min length, live gap count. */
export function RemoveSilenceDialog({
  open,
  onClose,
  envelope,
  initialParams = DEFAULT_SILENCE_PARAMS,
  onApply,
}: RemoveSilenceDialogProps): ReactElement | null {
  const t = useInspectorT();
  const [params, setParams] = useState<SilenceParams>(initialParams);
  const gaps = useMemo(
    () => (envelope ? detectSilentGaps(envelope.envelopeDb, envelope.sampleRateHz, params) : []),
    [envelope, params],
  );
  const summary = summarizeGaps(gaps);
  const L = EFFECTS_LIMITS;

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={400}
      title={t("inspector.effects.removeSilence")}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("inspector.common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={summary.count === 0}
            onClick={() => {
              onApply(gaps, params);
              onClose();
            }}
          >
            {t("inspector.common.remove")}
          </Button>
        </>
      }
    >
      {envelope && envelope.envelopeDb.length > 0 && (
        <WaveformPreview envelope={envelope} gaps={gaps} thresholdDb={params.thresholdDb} />
      )}

      <Slider
        label={t("inspector.effects.threshold")}
        value={params.thresholdDb}
        min={L.silenceThresholdDb.min}
        max={L.silenceThresholdDb.max}
        unit=" dB"
        labelWidth={80}
        onChange={(thresholdDb) => setParams((p) => ({ ...p, thresholdDb }))}
      />
      <Slider
        label={t("inspector.effects.minSilence")}
        value={params.minSilenceMs}
        min={L.minSilenceMs.min}
        max={L.minSilenceMs.max}
        step={50}
        unit=" ms"
        labelWidth={80}
        onChange={(minSilenceMs) => setParams((p) => ({ ...p, minSilenceMs }))}
      />

      <div
        role="status"
        className="dialog-well"
        style={{ color: summary.count > 0 ? "var(--text-1)" : "var(--text-2)" }}
      >
        {envelope ? formatSilencePreview(summary) : t("inspector.effects.noAudio")}
      </div>
    </Dialog>
  );
}

/** Downsampled level bars: kept audio in sage, would-be-removed gaps in record red. */
function WaveformPreview({
  envelope,
  gaps,
  thresholdDb,
}: {
  envelope: AudioEnvelope;
  gaps: readonly TimeRange[];
  thresholdDb: number;
}): ReactElement {
  const bars = useMemo(() => {
    const db = envelope.envelopeDb;
    const n = Math.min(PREVIEW_BARS, db.length);
    const per = db.length / n;
    const msPerSample = 1000 / (envelope.sampleRateHz > 0 ? envelope.sampleRateHz : 1);
    return Array.from({ length: n }, (_, i) => {
      const from = Math.floor(i * per);
      const to = Math.max(from + 1, Math.floor((i + 1) * per));
      let peak = Number.NEGATIVE_INFINITY;
      for (let j = from; j < to; j++) peak = Math.max(peak, db[j] ?? Number.NEGATIVE_INFINITY);
      const midMs = ((from + to) / 2) * msPerSample;
      return {
        height: levelPct(peak),
        removed: gaps.some((g) => midMs >= g.startMs && midMs < g.endMs),
      };
    });
  }, [envelope, gaps]);
  const lineTop = 50 - levelPct(thresholdDb) / 2;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        height: "56px",
        borderRadius: "12px",
        background: "var(--bg-sunken)",
        display: "flex",
        alignItems: "center",
        gap: "1px",
        padding: "0 8px",
      }}
    >
      {bars.map((b, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size positional bars
          key={i}
          style={{
            flex: "1 1 0",
            height: `${b.height}%`,
            background: b.removed
              ? "color-mix(in srgb, var(--record) 60%, transparent)"
              : "color-mix(in srgb, var(--success) 50%, transparent)",
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: "8px",
          right: "8px",
          top: `${lineTop}%`,
          height: "1px",
          background: "color-mix(in srgb, var(--accent-hover) 70%, transparent)",
        }}
      />
    </div>
  );
}
