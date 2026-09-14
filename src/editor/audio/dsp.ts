/**
 * Pure audio math (ENGINEERING_SPEC §9.5): dB ↔ gain, fade curves, RMS envelopes,
 * the ducking sidechain envelope follower and peak-limiter gain. No Web Audio,
 * no clocks — identical in preview, export and tests.
 */

export type FadeCurve = "linear" | "equal-power";

/** dB → linear gain, uncapped. −∞ / NaN → 0. */
export function dbToLinear(db: number): number {
  if (Number.isNaN(db) || db === Number.NEGATIVE_INFINITY) return 0;
  return 10 ** (db / 20);
}

/** Linear gain (or amplitude) → dB, uncapped. ≤ 0 / NaN → −∞. */
export function linearToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : Number.NEGATIVE_INFINITY;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Fade-in gain at progress `p` ∈ [0, 1] (0 = silent, 1 = full). Equal-power uses
 * sin(pπ/2) so a crossfade with the matching fade-out keeps constant power.
 */
export function fadeInGain(p: number, curve: FadeCurve = "linear"): number {
  const x = clamp01(p);
  return curve === "equal-power" ? Math.sin((x * Math.PI) / 2) : x;
}

/** Fade-out gain at progress `p` ∈ [0, 1] (0 = full, 1 = silent). */
export function fadeOutGain(p: number, curve: FadeCurve = "linear"): number {
  return fadeInGain(1 - clamp01(p), curve);
}

/**
 * Combined fade gain at `tMs` into a clip of `durationMs`. Fades are shrunk
 * proportionally when they overlap (fadeIn + fadeOut > duration). Outside
 * `[0, durationMs]` the gain is 0.
 */
export function fadeGainAt(
  tMs: number,
  durationMs: number,
  fadeInMs: number,
  fadeOutMs: number,
  curve: FadeCurve = "linear",
): number {
  if (!(durationMs > 0) || !Number.isFinite(tMs) || tMs < 0 || tMs > durationMs) return 0;
  let fi = Number.isFinite(fadeInMs) ? Math.max(0, fadeInMs) : 0;
  let fo = Number.isFinite(fadeOutMs) ? Math.max(0, fadeOutMs) : 0;
  if (fi + fo > durationMs) {
    const s = durationMs / (fi + fo);
    fi *= s;
    fo *= s;
  }
  let g = 1;
  if (fi > 0 && tMs < fi) g *= fadeInGain(tMs / fi, curve);
  const outStart = durationMs - fo;
  if (fo > 0 && tMs > outStart) g *= fadeOutGain((tMs - outStart) / fo, curve);
  return g;
}

/** Average all channels into one (shortest channel wins on length mismatch). */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const ch of channels)
    for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (ch[i] as number);
  for (let i = 0; i < n; i++) out[i] = (out[i] as number) / channels.length;
  return out;
}

/** A dB envelope (one value per window) at `sampleRateHz` windows per second. */
export interface DbEnvelope {
  envelopeDb: number[];
  sampleRateHz: number;
}

/**
 * RMS envelope in dBFS over consecutive non-overlapping windows of `windowMs`.
 * The last partial window is measured over the samples it has. Silence → −∞.
 */
export function rmsEnvelope(samples: Float32Array, sampleRate: number, windowMs = 10): DbEnvelope {
  const win = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const envelopeDb: number[] = [];
  for (let start = 0; start < samples.length; start += win) {
    const end = Math.min(samples.length, start + win);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i] as number;
      sum += s * s;
    }
    envelopeDb.push(linearToDb(Math.sqrt(sum / (end - start))));
  }
  return { envelopeDb, sampleRateHz: sampleRate / win };
}

export interface DuckParams {
  /** Gain reduction while the voice is active, dB (positive). */
  amountDb: number;
  /** Mic RMS level (dBFS) above which the voice counts as active. */
  thresholdDb: number;
  attackMs: number;
  releaseMs: number;
}

export const DEFAULT_DUCK_PARAMS: DuckParams = {
  amountDb: 12,
  thresholdDb: -40,
  attackMs: 50,
  releaseMs: 400,
};

/**
 * Sidechain envelope follower → linear music gain per envelope window. The duck
 * depth slews linearly toward 1 while mic RMS > threshold (reaching full
 * reduction `attackMs` after onset) and back toward 0 otherwise (full recovery
 * `releaseMs` after the voice stops). Reduction is interpolated in dB.
 */
export function duckingGainCurve(
  micEnvelopeDb: readonly number[],
  envelopeRateHz: number,
  params: Partial<DuckParams> = {},
): Float32Array {
  const p = { ...DEFAULT_DUCK_PARAMS, ...params };
  const out = new Float32Array(micEnvelopeDb.length);
  if (!(envelopeRateHz > 0)) return out.fill(1);
  const dtMs = 1000 / envelopeRateHz;
  const up = p.attackMs > 0 ? dtMs / p.attackMs : 1;
  const down = p.releaseMs > 0 ? dtMs / p.releaseMs : 1;
  const amount = Math.max(0, Number.isFinite(p.amountDb) ? p.amountDb : 0);
  let depth = 0;
  for (let i = 0; i < micEnvelopeDb.length; i++) {
    const active = (micEnvelopeDb[i] as number) > p.thresholdDb;
    depth = active ? Math.min(1, depth + up) : Math.max(0, depth - down);
    out[i] = dbToLinear(-amount * depth);
  }
  return out;
}

/** Sample peak (max |x|) across channels. */
export function samplePeak(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i] as number);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/** Static gain (≤ 1) that keeps `peak` at or below `ceilingDb`. */
export function peakLimiterGain(peak: number, ceilingDb = -1): number {
  const ceiling = dbToLinear(ceilingDb);
  if (!(peak > ceiling)) return 1;
  return ceiling / peak;
}

/**
 * Per-sample limiter gain: instant attack (never lets |x·g| exceed the ceiling),
 * linear release back toward 1 over `releaseMs`. Input is mono/linked peak.
 */
export function limiterGainCurve(
  samples: Float32Array,
  sampleRate: number,
  ceilingDb = -1,
  releaseMs = 250,
): Float32Array {
  const ceiling = dbToLinear(ceilingDb);
  const step = releaseMs > 0 && sampleRate > 0 ? 1000 / (releaseMs * sampleRate) : 1;
  const out = new Float32Array(samples.length);
  let g = 1;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i] as number);
    g = Math.min(1, g + step);
    if (a * g > ceiling) g = ceiling / a;
    out[i] = g;
  }
  return out;
}

/** DynamicsCompressor settings used as the master brick-wall limiter (hard knee). */
export const LIMITER_SETTINGS = {
  thresholdDb: -1,
  kneeDb: 0,
  ratio: 20,
  attackS: 0.003,
  releaseS: 0.25,
} as const;
