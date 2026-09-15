import { Button, Dialog } from "@design/components";
import { type ReactElement, useMemo, useState } from "react";
import { NumberField, Slider } from "../controls";
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

/** "Remove silence" tool: threshold + min length with live preview count. */
export function RemoveSilenceDialog({
  open,
  onClose,
  envelope,
  initialParams = DEFAULT_SILENCE_PARAMS,
  onApply,
}: RemoveSilenceDialogProps): ReactElement {
  const t = useInspectorT();
  const [params, setParams] = useState<SilenceParams>(initialParams);
  const gaps = useMemo(
    () => (envelope ? detectSilentGaps(envelope.envelopeDb, envelope.sampleRateHz, params) : []),
    [envelope, params],
  );
  const summary = summarizeGaps(gaps);
  const L = EFFECTS_LIMITS;

  return (
    <Dialog
      open={open}
      onClose={onClose}
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          minWidth: "320px",
        }}
      >
        <Slider
          label={t("inspector.effects.threshold")}
          value={params.thresholdDb}
          min={L.silenceThresholdDb.min}
          max={L.silenceThresholdDb.max}
          unit=" dB"
          onChange={(thresholdDb) => setParams((p) => ({ ...p, thresholdDb }))}
        />
        <NumberField
          label={t("inspector.effects.minSilence")}
          value={params.minSilenceMs}
          min={L.minSilenceMs.min}
          max={L.minSilenceMs.max}
          step={50}
          unit="ms"
          onChange={(minSilenceMs) => setParams((p) => ({ ...p, minSilenceMs }))}
        />
        <div
          role="status"
          style={{
            fontSize: "13px",
            color: summary.count > 0 ? "var(--text-1)" : "var(--text-2)",
            paddingTop: "var(--space-1)",
          }}
        >
          {envelope ? formatSilencePreview(summary) : t("inspector.effects.noAudio")}
        </div>
      </div>
    </Dialog>
  );
}
