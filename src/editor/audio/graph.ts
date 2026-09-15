import type {
  AudioRegion,
  AudioSettings,
  AvailableTracks,
  TrackKind,
} from "../inspector/audio/types";
import type { Clip } from "../model/schema";
import {
  type DbEnvelope,
  type FadeCurve,
  LIMITER_SETTINGS,
  dbToLinear,
  duckingGainCurve,
  fadeGainAt,
} from "./dsp";
import { normalizeGainDb } from "./loudness";
import { audibility, clickBusGain, masterGain } from "./mix";
import { type AudioSpeedRegion, SpeedMap, sourceSegments } from "./speedMap";

/**
 * Web Audio graph builder (ENGINEERING_SPEC §9.5 / §10.5):
 *
 *   mic/system segments ─▶ track gain (volume·mute/solo·fades) ─▶ [noise reduction] ─▶ normalize ─┐
 *   extra regions ─▶ region gain (volume·fades·duck) ────────────────────────────────────────────┤
 *   click sounds ─▶ click gain ──────────────────────────────────────────────────────────────────┤
 *                                                   master gain ◀────────────────────────────────┘
 *                                                   ─▶ DynamicsCompressor limiter ─▶ destination
 *
 * The context is injected (structural `*Like` types) so it works with a real
 * AudioContext / OfflineAudioContext and with a recording fake in tests.
 * Times: output ms (after speed regions). `range` selects the window rendered;
 * context time 0 corresponds to `range.startMs` so export can render in blocks.
 */

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  setValueCurveAtTime(values: Float32Array, startTime: number, duration: number): unknown;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface AudioBufferLike {
  readonly duration: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParamLike;
  start(when?: number, offset?: number, duration?: number): void;
}

export interface CompressorLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
}

export interface AudioContextLike {
  readonly sampleRate: number;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createBufferSource(): BufferSourceLike;
  createDynamicsCompressor(): CompressorLike;
}

/** Placeholder slot for an AudioWorklet processor (RNNoise on the mic track). */
export interface ProcessorSlot {
  input: AudioNodeLike;
  output: AudioNodeLike;
}

export type ProcessorFactory = (ctx: AudioContextLike) => ProcessorSlot;

/** Extra region with the §4 source offset (ms into the file at startMs). */
export type GraphAudioRegion = AudioRegion & { offsetMs?: number | undefined };

export interface AudioGraphSources {
  mic?: AudioBufferLike | undefined;
  system?: AudioBufferLike | undefined;
  /** Decoded buffers keyed by region id; regions without a buffer are skipped. */
  regions?: Readonly<Record<string, AudioBufferLike>> | undefined;
  clickSound?: AudioBufferLike | undefined;
}

export interface ClickEvent {
  /** Timeline ms of the click. */
  tMs: number;
}

export interface BuildAudioGraphInput {
  ctx: AudioContextLike;
  settings: AudioSettings;
  sources: AudioGraphSources;
  /** Extra regions (defaults to `settings.regions`). */
  regions?: readonly GraphAudioRegion[] | undefined;
  clickEvents?: readonly ClickEvent[] | undefined;
  /** Clips mapping timeline → source for mic/system. Default: one clip = whole source. */
  clips?: readonly Clip[] | undefined;
  speeds?: readonly AudioSpeedRegion[] | undefined;
  /**
   * Context time (seconds) at which `range.startMs` plays. 0 for a fresh
   * OfflineAudioContext; `ctx.currentTime` (plus a small lead) for a live
   * preview AudioContext, whose clock is already running.
   */
  startAtS?: number | undefined;
  /** Output window to schedule; default `[0, total output duration)`. */
  range?: { startMs: number; endMs: number } | undefined;
  available?: AvailableTracks | undefined;
  /** Integrated loudness per recorded track (measured once, e.g. in a worker). */
  loudnessLufs?: Partial<Record<TrackKind, number>> | undefined;
  processors?: { noiseReduction?: ProcessorFactory | undefined } | undefined;
  /** Mic RMS envelope over output time, drives ducking of extra regions. */
  micEnvelope?: DbEnvelope | undefined;
  duckThresholdDb?: number | undefined;
  fadeCurve?: FadeCurve | undefined;
  /** Automation sampling step for fades / ducking curves. */
  automationStepMs?: number | undefined;
}

export interface AudioGraph {
  master: GainNodeLike;
  limiter: CompressorLike;
  tracks: Partial<Record<TrackKind, GainNodeLike>>;
  regions: Record<string, GainNodeLike>;
  clicks: GainNodeLike | null;
  sources: BufferSourceLike[];
  /** Total output duration (ms) implied by clips + speeds. */
  outputDurationMs: number;
  /** Output end of all content (recorded tracks and extra regions), ms. */
  extentMs: number;
}

const EPS_S = 1e-9;

function defaultClips(sources: AudioGraphSources): Clip[] {
  const ms = Math.max(sources.mic?.duration ?? 0, sources.system?.duration ?? 0) * 1000;
  return ms > 0 ? [{ id: "source", sourceStartMs: 0, sourceEndMs: ms, timelineStartMs: 0 }] : [];
}

/**
 * Schedule `fn(outputMs)` on a gain param over `[r0, r1)`. Constant functions
 * get a single setValueAtTime; otherwise a sampled value curve.
 */
function scheduleGain(
  param: AudioParamLike,
  fn: (uMs: number) => number,
  from: number,
  to: number,
  blockStartMs: number,
  stepMs: number,
  varies: boolean,
  startAtS: number,
): void {
  const at = startAtS + Math.max(0, from - blockStartMs) / 1000;
  if (!varies || !(to > from)) {
    const v = fn(from);
    param.value = v;
    param.setValueAtTime(v, at);
    return;
  }
  const n = Math.max(2, Math.ceil((to - from) / Math.max(1, stepMs)) + 1);
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) values[i] = fn(from + ((to - from) * i) / (n - 1));
  param.value = values[0] as number;
  param.setValueCurveAtTime(values, at, (to - from) / 1000);
}

function sampleCurve(curve: Float32Array, rateHz: number, uMs: number): number {
  if (curve.length === 0) return 1;
  const x = (uMs / 1000) * rateHz;
  const i = Math.floor(x);
  if (i < 0) return curve[0] as number;
  if (i >= curve.length - 1) return curve[curve.length - 1] as number;
  const a = curve[i] as number;
  const b = curve[i + 1] as number;
  return a + (b - a) * (x - i);
}

export function buildAudioGraph(input: BuildAudioGraphInput): AudioGraph {
  const { ctx, settings, sources } = input;
  const available: AvailableTracks = input.available ?? {
    mic: sources.mic !== undefined,
    system: sources.system !== undefined,
  };
  const curve = input.fadeCurve ?? "linear";
  const stepMs = input.automationStepMs ?? 10;
  const speedMap = new SpeedMap(input.speeds ?? []);
  const clips = input.clips ?? defaultClips(sources);
  const segments = sourceSegments(clips, speedMap);
  const timelineEnd = clips.reduce(
    (m, c) => Math.max(m, c.timelineStartMs + c.sourceEndMs - c.sourceStartMs),
    0,
  );
  const outputDurationMs = speedMap.timelineToOutput(timelineEnd);
  const r0 = Math.max(0, input.range?.startMs ?? 0);
  const t0 = Number.isFinite(input.startAtS) ? Math.max(0, input.startAtS as number) : 0;
  const regionList: readonly GraphAudioRegion[] = input.regions ?? settings.regions;
  const extentMs = regionList.reduce(
    (m, r) => Math.max(m, speedMap.timelineToOutput(r.endMs)),
    outputDurationMs,
  );
  const r1 = input.range?.endMs ?? extentMs;
  const aud = audibility(settings, available);
  const graphSources: BufferSourceLike[] = [];

  // master → limiter → destination
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER_SETTINGS.thresholdDb;
  limiter.knee.value = LIMITER_SETTINGS.kneeDb;
  limiter.ratio.value = LIMITER_SETTINGS.ratio;
  limiter.attack.value = LIMITER_SETTINGS.attackS;
  limiter.release.value = LIMITER_SETTINGS.releaseS;
  const master = ctx.createGain();
  master.gain.value = masterGain(settings);
  master.gain.setValueAtTime(master.gain.value, t0);
  master.connect(limiter);
  limiter.connect(ctx.destination);

  const play = (
    buffer: AudioBufferLike,
    dest: AudioNodeLike,
    whenMs: number,
    offsetS: number,
    durationS: number,
    rate = 1,
    loop = false,
  ): void => {
    if (!(durationS > EPS_S)) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    if (loop) {
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = buffer.duration;
    }
    src.connect(dest);
    src.start(t0 + Math.max(0, whenMs - r0) / 1000, offsetS, durationS);
    graphSources.push(src);
  };

  // Recorded tracks.
  const tracks: Partial<Record<TrackKind, GainNodeLike>> = {};
  for (const kind of ["mic", "system"] as const) {
    const buffer = sources[kind];
    if (!buffer || !available[kind]) continue;
    const t = settings.tracks[kind];
    const gainNode = ctx.createGain();
    const base = aud[kind] ? dbToLinear(t.volumeDb) : 0;
    const hasFades = t.fadeInMs > 0 || t.fadeOutMs > 0;
    scheduleGain(
      gainNode.gain,
      (u) =>
        base * (hasFades ? fadeGainAt(u, outputDurationMs, t.fadeInMs, t.fadeOutMs, curve) : 1),
      r0,
      r1,
      r0,
      stepMs,
      hasFades && base > 0,
      t0,
    );
    tracks[kind] = gainNode;

    let tail: AudioNodeLike = gainNode;
    const nr = input.processors?.noiseReduction;
    if (kind === "mic" && settings.tracks.mic.noiseReduction && nr) {
      const slot = nr(ctx);
      tail.connect(slot.input);
      tail = slot.output;
    }
    if (t.normalize) {
      const norm = ctx.createGain();
      norm.gain.value = dbToLinear(normalizeGainDb(input.loudnessLufs?.[kind] ?? Number.NaN));
      tail.connect(norm);
      tail = norm;
    }
    tail.connect(master);

    if (base === 0) continue; // silent bus: no need to schedule sources
    for (const s of segments) {
      const a = Math.max(s.outputStartMs, r0);
      const b = Math.min(s.outputEndMs, r1);
      if (!(b > a)) continue;
      const srcStartMs = s.sourceStartMs + (a - s.outputStartMs) * s.rate;
      const srcEndMs = Math.min(
        s.sourceStartMs + (b - s.outputStartMs) * s.rate,
        buffer.duration * 1000,
      );
      if (!(srcEndMs > srcStartMs)) continue;
      play(buffer, gainNode, a, srcStartMs / 1000, (srcEndMs - srcStartMs) / 1000, s.rate);
    }
  }

  // Extra regions (music / voiceover) at 1× in output time.
  const regionNodes: Record<string, GainNodeLike> = {};
  const duckCurve = input.micEnvelope && aud.mic ? input.micEnvelope : undefined;
  for (const region of regionList) {
    const buffer = sources.regions?.[region.id];
    if (!buffer || !(buffer.duration > 0)) continue;
    const u0 = speedMap.timelineToOutput(region.startMs);
    const u1 = speedMap.timelineToOutput(region.endMs);
    if (!(u1 > u0)) continue;
    const dur = u1 - u0;
    const base = aud.extras ? dbToLinear(region.volumeDb) : 0;
    const duck =
      duckCurve && region.duck.enabled && region.duck.amountDb > 0
        ? duckingGainCurve(duckCurve.envelopeDb, duckCurve.sampleRateHz, {
            amountDb: region.duck.amountDb,
            ...(input.duckThresholdDb !== undefined ? { thresholdDb: input.duckThresholdDb } : {}),
          })
        : undefined;
    const hasFades = region.fadeInMs > 0 || region.fadeOutMs > 0;
    const g = ctx.createGain();
    const a = Math.max(u0, r0);
    const b = Math.min(u1, r1);
    scheduleGain(
      g.gain,
      (u) =>
        base *
        (hasFades ? fadeGainAt(u - u0, dur, region.fadeInMs, region.fadeOutMs, curve) : 1) *
        (duck && duckCurve ? sampleCurve(duck, duckCurve.sampleRateHz, u) : 1),
      b > a ? a : r0,
      b > a ? b : r0,
      r0,
      stepMs,
      base > 0 && (hasFades || duck !== undefined) && b > a,
      t0,
    );
    g.connect(master);
    regionNodes[region.id] = g;
    if (base === 0 || !(b > a)) continue;
    const offsetMs = Math.max(0, region.offsetMs ?? 0) + (a - u0);
    const bufMs = buffer.duration * 1000;
    if (region.loop) {
      play(buffer, g, a, (offsetMs % bufMs) / 1000, (b - a) / 1000, 1, true);
    } else if (offsetMs < bufMs) {
      play(buffer, g, a, offsetMs / 1000, Math.min(b - a, bufMs - offsetMs) / 1000);
    }
  }

  // Click sounds, scheduled at each click's output time.
  let clicks: GainNodeLike | null = null;
  const clickBuf = sources.clickSound;
  const events = input.clickEvents ?? [];
  if (clickBuf && events.length > 0) {
    clicks = ctx.createGain();
    clicks.gain.value = clickBusGain(settings, available);
    clicks.connect(master);
    if (clicks.gain.value > 0) {
      const lenMs = clickBuf.duration * 1000;
      for (const e of events) {
        if (!Number.isFinite(e.tMs) || e.tMs < 0) continue;
        const u = speedMap.timelineToOutput(e.tMs);
        const a = Math.max(u, r0);
        const b = Math.min(u + lenMs, r1);
        if (!(b > a) || u >= extentMs) continue;
        play(clickBuf, clicks, a, (a - u) / 1000, (b - a) / 1000);
      }
    }
  }

  return {
    master,
    limiter,
    tracks,
    regions: regionNodes,
    clicks,
    sources: graphSources,
    outputDurationMs,
    extentMs,
  };
}

/** Compile-time proof that a real Web Audio context satisfies {@link AudioContextLike}. */
export type RealContextIsCompatible = AssertTrue<
  BaseAudioContext extends AudioContextLike ? true : false
>;
/** Fails to compile unless `T` is `true`. */
export type AssertTrue<T extends true> = T;
