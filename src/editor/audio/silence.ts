import { detectSilentGaps, formatSilencePreview, summarizeGaps } from "../inspector/effects/logic";
import type { SilenceParams, SilencePreview, TimeRange } from "../inspector/effects/types";
import { type DbEnvelope, mixToMono, rmsEnvelope } from "./dsp";

/**
 * Remove-silence analysis (ENGINEERING_SPEC §9.8): RMS envelope of the mic (or
 * system) track → gaps below `thresholdDb` lasting ≥ `minSilenceMs` → the
 * "Would remove N gaps (mm:ss total)" preview used by the Effects tab.
 */

export const SILENCE_WINDOW_MS = 10;

export interface SilenceAnalysis {
  envelope: DbEnvelope;
  gaps: TimeRange[];
  summary: SilencePreview;
  label: string;
}

/** Gaps from an already-computed envelope (the Effects tab caches envelopes). */
export function analyzeSilenceEnvelope(
  envelope: DbEnvelope,
  params: SilenceParams,
): SilenceAnalysis {
  const gaps = detectSilentGaps(envelope.envelopeDb, envelope.sampleRateHz, params);
  const summary = summarizeGaps(gaps);
  return { envelope, gaps, summary, label: formatSilencePreview(summary) };
}

/** Full analysis from raw PCM (multichannel input is mixed to mono first). */
export function analyzeSilence(
  channels: readonly Float32Array[],
  sampleRate: number,
  params: SilenceParams,
  windowMs = SILENCE_WINDOW_MS,
): SilenceAnalysis {
  return analyzeSilenceEnvelope(rmsEnvelope(mixToMono(channels), sampleRate, windowMs), params);
}
