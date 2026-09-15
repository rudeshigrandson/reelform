/**
 * Webcam ↔ mic auto-sync (SPEC §9.4): cross-correlate energy envelopes of the
 * first 30s. Envelopes (mean |x| per bin) are robust to the two microphones'
 * different gain/EQ and make the lag search cheap enough for the renderer.
 *
 * Sign: `syncOffsetMs` is added to timeline time when sampling the webcam, so
 * if an event happens L ms later in the webcam file than in the mic, the
 * offset is +L.
 */

export const SYNC_WINDOW_MS = 30_000;
export const SYNC_ENVELOPE_HZ = 200;

export interface SyncOptions {
  windowMs?: number | undefined;
  maxLagMs?: number | undefined;
  envelopeHz?: number | undefined;
  /** Normalized correlation below this → no confident match. */
  minCorrelation?: number | undefined;
}

export interface SyncResult {
  offsetMs: number;
  /** Peak normalized correlation, −1..1. */
  correlation: number;
}

/** Mean absolute amplitude per bin over the first `windowMs`, mean-removed. */
export function energyEnvelope(
  samples: Float32Array,
  sampleRate: number,
  envelopeHz: number,
  windowMs: number,
): Float64Array {
  if (!(sampleRate > 0) || !(envelopeHz > 0)) return new Float64Array(0);
  const bin = Math.max(1, Math.round(sampleRate / envelopeHz));
  const limit = Math.min(samples.length, Math.floor((sampleRate * windowMs) / 1000));
  const n = Math.floor(limit / bin);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const start = i * bin;
    for (let j = start; j < start + bin; j++) s += Math.abs(samples[j] as number);
    env[i] = s / bin;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i] as number;
  mean = n > 0 ? mean / n : 0;
  for (let i = 0; i < n; i++) env[i] = (env[i] as number) - mean;
  return env;
}

/**
 * Lag (in bins) maximizing normalized cross-correlation of `target` against
 * `ref`: target[i + lag] ≈ ref[i].
 */
export function bestLag(
  ref: Float64Array,
  target: Float64Array,
  maxLag: number,
): { lag: number; correlation: number } {
  let best = { lag: 0, correlation: Number.NEGATIVE_INFINITY };
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0;
    let er = 0;
    let et = 0;
    const i0 = Math.max(0, -lag);
    const i1 = Math.min(ref.length, target.length - lag);
    for (let i = i0; i < i1; i++) {
      const a = ref[i] as number;
      const b = target[i + lag] as number;
      dot += a * b;
      er += a * a;
      et += b * b;
    }
    const denom = Math.sqrt(er * et);
    const c = denom > 0 ? dot / denom : 0;
    // Prefer the smaller |lag| on ties so silence doesn't wander.
    if (
      c > best.correlation + 1e-12 ||
      (Math.abs(c - best.correlation) <= 1e-12 && Math.abs(lag) < Math.abs(best.lag))
    ) {
      best = { lag, correlation: c };
    }
  }
  return best;
}

/** Downmix to mono. */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  for (const ch of channels) {
    for (let i = 0; i < out.length && i < ch.length; i++)
      out[i] = (out[i] as number) + (ch[i] as number) / channels.length;
  }
  return out;
}

/** Null when either track is silent or no lag correlates confidently. */
export function estimateSyncOffsetMs(
  mic: { samples: Float32Array; sampleRate: number },
  webcam: { samples: Float32Array; sampleRate: number },
  opts: SyncOptions = {},
): SyncResult | null {
  const hz = opts.envelopeHz ?? SYNC_ENVELOPE_HZ;
  const windowMs = opts.windowMs ?? SYNC_WINDOW_MS;
  const maxLagMs = opts.maxLagMs ?? 5000;
  const minC = opts.minCorrelation ?? 0.3;
  // Take extra webcam audio so positive lags still overlap the whole window.
  const ref = energyEnvelope(mic.samples, mic.sampleRate, hz, windowMs);
  const target = energyEnvelope(webcam.samples, webcam.sampleRate, hz, windowMs + maxLagMs);
  if (ref.length < 2 || target.length < 2) return null;
  const maxLag = Math.round((maxLagMs * hz) / 1000);
  const { lag, correlation } = bestLag(ref, target, maxLag);
  if (!Number.isFinite(correlation) || correlation < minC) return null;
  return { offsetMs: Math.round((lag * 1000) / hz), correlation };
}
