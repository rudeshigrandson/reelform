import type { AudioContextFactory, AudioContextLike, MediaStreamLike } from "./media";

/**
 * Mic level meter for the recording pill (§5.7): RMS from an AnalyserNode,
 * mapped to a perceptual 0..1 scale and smoothed with fast attack / slow release.
 * Frame scheduling is injected (requestAnimationFrame in the app, manual in tests).
 */

/** Floor of the meter in dBFS; RMS at or below maps to 0. */
export const METER_FLOOR_DB = -60;
export const DEFAULT_ATTACK = 0.6;
export const DEFAULT_RELEASE = 0.15;
export const ANALYSER_FFT_SIZE = 1024;

/** Root mean square of PCM samples, clamped to [0, 1]; non-finite samples count as 0. */
export function computeRms(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] ?? 0;
    if (Number.isFinite(v)) sum += v * v;
  }
  const rms = Math.sqrt(sum / n);
  return Math.min(1, Math.max(0, rms));
}

/** RMS → 0..1 on a dB scale between METER_FLOOR_DB and 0 dBFS. */
export function rmsToLevel(rms: number, floorDb = METER_FLOOR_DB): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const db = 20 * Math.log10(Math.min(1, rms));
  const level = (db - floorDb) / -floorDb;
  return Math.min(1, Math.max(0, level));
}

/** One smoothing step: rise with `attack`, fall with `release` (both in (0,1]). */
export function smoothLevel(
  prev: number,
  target: number,
  attack = DEFAULT_ATTACK,
  release = DEFAULT_RELEASE,
): number {
  const p = Number.isFinite(prev) ? Math.min(1, Math.max(0, prev)) : 0;
  const t = Number.isFinite(target) ? Math.min(1, Math.max(0, target)) : 0;
  const k = t > p ? attack : release;
  return p + (t - p) * Math.min(1, Math.max(0, k));
}

/** Schedule `cb` for the next frame; returns a cancel function. */
export type FrameScheduler = (cb: () => void) => () => void;

export interface MicMeterOptions {
  stream: MediaStreamLike;
  createAudioContext: AudioContextFactory;
  schedule: FrameScheduler;
  onLevel: (level: number) => void;
  attack?: number | undefined;
  release?: number | undefined;
}

export interface MicMeter {
  readonly level: number;
  /** Paused meters report 0 (mic is not being recorded). */
  setPaused(paused: boolean): void;
  stop(): Promise<void>;
}

export function createMicMeter(opts: MicMeterOptions): MicMeter {
  const ctx = opts.createAudioContext();
  let source: ReturnType<AudioContextLike["createMediaStreamSource"]>;
  let analyser: ReturnType<AudioContextLike["createAnalyser"]>;
  try {
    source = ctx.createMediaStreamSource(opts.stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = ANALYSER_FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
  } catch (err) {
    // Don't leak the AudioContext when the graph can't be built.
    void ctx.close().catch(() => {});
    throw err;
  }
  const buffer = new Float32Array(ANALYSER_FFT_SIZE);

  let level = 0;
  let paused = false;
  let stopped = false;
  let cancel: (() => void) | null = null;

  const frame = (): void => {
    cancel = null;
    if (stopped) return;
    let target = 0;
    if (!paused) {
      analyser.getFloatTimeDomainData(buffer);
      target = rmsToLevel(computeRms(buffer));
    }
    const next = smoothLevel(level, target, opts.attack, opts.release);
    if (next !== level) {
      level = next;
      opts.onLevel(level);
    }
    cancel = opts.schedule(frame);
  };
  cancel = opts.schedule(frame);

  return {
    get level() {
      return level;
    },
    setPaused: (p) => {
      paused = p;
    },
    stop: async () => {
      if (stopped) return;
      stopped = true;
      cancel?.();
      cancel = null;
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
      await ctx.close();
    },
  };
}
