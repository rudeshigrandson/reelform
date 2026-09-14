import { dbToLinear } from "./dsp";

/**
 * EBU R128 / ITU-R BS.1770-4 integrated loudness (ENGINEERING_SPEC §9.5).
 * K-weighting (high-shelf + RLB high-pass biquads), 400ms gating blocks with
 * 75% overlap, absolute −70 LUFS gate and relative −10 LU gate.
 *
 * Streaming: the meter keeps only per-100ms energy sums, so it can be fed
 * arbitrarily long audio in chunks from a worker.
 */

export interface Biquad {
  b: [number, number, number];
  a: [number, number, number];
}

export const NORMALIZE_TARGET_LUFS = -16;
export const ABSOLUTE_GATE_LUFS = -70;
export const RELATIVE_GATE_LU = -10;

/**
 * K-weighting filter coefficients for any sample rate (bilinear-transform form
 * used by libebur128; at 48 kHz this reproduces the BS.1770 table).
 */
export function kWeightingCoefficients(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b: [
      (Vh + (Vb * K) / Q + K * K) / a0,
      (2 * (K * K - Vh)) / a0,
      (Vh - (Vb * K) / Q + K * K) / a0,
    ],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = {
    b: [1, -2, 1],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  return [shelf, highpass];
}

/** BS.1770 channel weights: L/R/C = 1.0, surrounds (index ≥ 3, skipping LFE) = 1.41. */
function channelWeight(index: number): number {
  return index >= 4 ? 1.41 : index === 3 ? 0 : 1;
}

class BiquadState {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private readonly f: Biquad) {}
  process(x: number): number {
    const { b, a } = this.f;
    const y = b[0] * x + b[1] * this.x1 + b[2] * this.x2 - a[1] * this.y1 - a[2] * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export class LoudnessMeter {
  private readonly filters: Array<[BiquadState, BiquadState]>;
  private readonly hopSamples: number;
  /** Weighted mean-square sum per 100ms hop (summed over channels). */
  private readonly hops: number[] = [];
  private hopAcc = 0;
  private hopFill = 0;

  constructor(
    readonly sampleRate: number,
    readonly channelCount: number,
  ) {
    if (!(sampleRate > 0) || !(channelCount > 0)) throw new Error("invalid loudness meter config");
    const [shelf, hp] = kWeightingCoefficients(sampleRate);
    this.filters = Array.from({ length: channelCount }, () => [
      new BiquadState(shelf),
      new BiquadState(hp),
    ]);
    this.hopSamples = Math.round(sampleRate * 0.1);
  }

  /** Feed one chunk; all channels must be the same length. */
  push(channels: readonly Float32Array[]): void {
    // Empty input: Math.min() of nothing is Infinity — would never terminate.
    if (channels.length === 0) return;
    const n = Math.min(...channels.map((c) => c.length));
    for (let i = 0; i < n; i++) {
      let e = 0;
      for (let c = 0; c < this.channelCount; c++) {
        const ch = channels[c];
        const f = this.filters[c];
        if (!ch || !f) continue;
        const w = channelWeight(c);
        if (w === 0) continue;
        const y = f[1].process(f[0].process(ch[i] as number));
        e += w * y * y;
      }
      this.hopAcc += e;
      if (++this.hopFill === this.hopSamples) {
        this.hops.push(this.hopAcc);
        this.hopAcc = 0;
        this.hopFill = 0;
      }
    }
  }

  /** Loudness (LUFS) of each 400ms gating block, 100ms step. */
  blockLoudness(): number[] {
    const out: number[] = [];
    const blockSamples = this.hopSamples * 4;
    for (let j = 0; j + 4 <= this.hops.length; j++) {
      const sum =
        (this.hops[j] as number) +
        (this.hops[j + 1] as number) +
        (this.hops[j + 2] as number) +
        (this.hops[j + 3] as number);
      out.push(energyToLufs(sum / blockSamples));
    }
    return out;
  }

  /** Integrated loudness in LUFS; −∞ when no block passes the gates. */
  integrated(): number {
    return gatedIntegratedLoudness(this.blockLoudness());
  }
}

function energyToLufs(meanSquare: number): number {
  return meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : Number.NEGATIVE_INFINITY;
}

const lufsToEnergy = (l: number): number => 10 ** ((l + 0.691) / 10);

/** Two-stage gating over block loudness values (LUFS). */
export function gatedIntegratedLoudness(blocks: readonly number[]): number {
  const abs = blocks.filter((l) => l > ABSOLUTE_GATE_LUFS);
  if (abs.length === 0) return Number.NEGATIVE_INFINITY;
  const absMean = abs.reduce((s, l) => s + lufsToEnergy(l), 0) / abs.length;
  const relGate = energyToLufs(absMean) + RELATIVE_GATE_LU;
  const rel = abs.filter((l) => l > relGate);
  if (rel.length === 0) return Number.NEGATIVE_INFINITY;
  return energyToLufs(rel.reduce((s, l) => s + lufsToEnergy(l), 0) / rel.length);
}

/** One-shot integrated loudness of a whole signal. */
export function integratedLoudness(channels: readonly Float32Array[], sampleRate: number): number {
  if (channels.length === 0) return Number.NEGATIVE_INFINITY;
  const m = new LoudnessMeter(sampleRate, channels.length);
  m.push(channels);
  return m.integrated();
}

/**
 * Gain (dB) that brings `measuredLufs` to `targetLufs`. Unmeasurable (−∞/NaN,
 * e.g. silence) → 0 dB so silence is never boosted. Optionally capped.
 */
export function normalizeGainDb(
  measuredLufs: number,
  targetLufs = NORMALIZE_TARGET_LUFS,
  maxGainDb = Number.POSITIVE_INFINITY,
): number {
  if (!Number.isFinite(measuredLufs)) return 0;
  return Math.min(maxGainDb, targetLufs - measuredLufs);
}

/** Linear form of {@link normalizeGainDb}. */
export function normalizeGain(measuredLufs: number, targetLufs = NORMALIZE_TARGET_LUFS): number {
  return dbToLinear(normalizeGainDb(measuredLufs, targetLufs));
}
