import type { Telemetry } from "../autozoom/types";
import type { AudioSettings, TrackKind } from "../inspector/audio/types";
import type { Clip } from "../model/schema";
import { micDuckEnvelope } from "./envelope";
import {
  type AudioBufferLike,
  type AudioContextLike,
  type AudioGraph,
  type AudioGraphSources,
  type ClickEvent,
  type ProcessorFactory,
  buildAudioGraph,
  prepareProcessor,
} from "./graph";
import {
  type ClickSoundSettings,
  clickEventsFromTelemetry,
  clickSoundUrl,
  regionSourceUrls,
} from "./sourceUrls";
import { type AudioSpeedRegion, SpeedMap } from "./speedMap";

/**
 * Live editor audio (ENGINEERING_SPEC §6.3, §6.6, §9.5). The preview <video> is
 * muted; this player owns one AudioContext, decodes the mic, system, extra
 * regions and the click-sound pack (cached per URL), and on play / seek builds
 * the same graph the export renders, scheduled from the playhead to the end:
 * `startAtS = ctx.currentTime + lead`, `range = [playhead output ms, end)`.
 *
 * Pause stops every scheduled source. Settings, loudness and shuttle-rate
 * changes rebuild after a short debounce; a playhead that drifts from the
 * audio clock (seek, loop wrap) rebuilds immediately.
 */

export interface PreviewAudioArgs {
  micUrl: string | null;
  systemAudioUrl: string | null;
  /** `reelform-media://` base for project-relative region / custom click files. */
  mediaBaseUrl: string | null;
  audio: AudioSettings;
  /** Cursor click-sound setting (S14). */
  clickSound: ClickSoundSettings;
  /** Recorded clicks (source ms); null when the recording has no telemetry. */
  telemetry: Pick<Telemetry, "clicks"> | null;
  clips: readonly Clip[];
  speeds: readonly AudioSpeedRegion[];
  /** Timeline duration (ms). */
  durationMs: number;
}

/** A running (real-time) context: `AudioContext` satisfies it. */
export interface LiveAudioContextLike extends AudioContextLike {
  readonly currentTime: number;
  resume(): Promise<void>;
  close(): Promise<void>;
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBufferLike>;
}

export interface PreviewTransport {
  isPlaying: boolean;
  /** Playhead, timeline ms. */
  currentMs: number;
  /** J/K/L shuttle multiplier on top of speed regions (1 at normal speed). */
  rate: number;
}

export type LoudnessLufs = Partial<Record<TrackKind, number>>;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface PreviewAudioPlayerDeps {
  createContext(): LiveAudioContextLike;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  /** RNNoise worklet factory, used when mic noise reduction is on. */
  noiseReduction?: ProcessorFactory | null | undefined;
  /** Scheduling lead so the first samples aren't in the past (s). */
  leadS?: number | undefined;
  /** Debounce for settings / rate rebuilds (ms). */
  debounceMs?: number | undefined;
  /** Playhead vs audio clock drift that forces a rebuild (ms). */
  driftToleranceMs?: number | undefined;
  setTimer?: ((fn: () => void, ms: number) => TimerHandle) | undefined;
  clearTimer?: ((handle: TimerHandle) => void) | undefined;
}

export interface PreviewAudioPlayer {
  setArgs(args: PreviewAudioArgs): void;
  setLoudness(lufs: LoudnessLufs): void;
  setNoiseReduction(factory: ProcessorFactory | null): void;
  /** Push the playback store state (called on every store change). */
  sync(transport: PreviewTransport): void;
  /** The graph currently scheduled, or null when silent / paused. */
  graph(): AudioGraph | null;
  /** Resolves once every pending decode has settled. */
  idle(): Promise<void>;
  dispose(): void;
}

export const PREVIEW_LEAD_S = 0.03;
export const PREVIEW_DEBOUNCE_MS = 120;
export const PREVIEW_DRIFT_TOLERANCE_MS = 250;

/**
 * Speed regions with a shuttle multiplier folded in, so the graph's output time
 * advances at wall-clock speed while the playhead runs at `factor`×. Ramps keep
 * their shape, scaled by the same factor.
 */
export function shuttleSpeeds(
  speeds: readonly AudioSpeedRegion[],
  factor: number,
  endMs: number,
): AudioSpeedRegion[] {
  if (!(Number.isFinite(factor) && factor > 0) || factor === 1) return [...speeds];
  const sorted = speeds
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const out: AudioSpeedRegion[] = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.endMs <= cursor) continue;
    const startMs = Math.max(s.startMs, cursor);
    if (startMs > cursor) out.push({ startMs: cursor, endMs: startMs, rate: factor });
    const rate = Number.isFinite(s.rate) && s.rate > 0 ? s.rate : 1;
    out.push({ ...s, startMs, rate: rate * factor });
    cursor = s.endMs;
  }
  if (endMs > cursor) out.push({ startMs: cursor, endMs, rate: factor });
  return out;
}

/** Shallow field equality for plain records (clips, speed regions, settings). */
function sameRecord(a: object | null | undefined, b: object | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) =>
    Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

function sameItems(a: readonly object[], b: readonly object[]): boolean {
  return a === b || (a.length === b.length && a.every((x, i) => sameRecord(x, b[i])));
}

const sameClickSound = (a: ClickSoundSettings, b: ClickSoundSettings): boolean =>
  a === b ||
  (a.type === b.type &&
    a.volume === b.volume &&
    (a.customSound?.path ?? null) === (b.customSound?.path ?? null));

/**
 * Hosts often derive `clips` / `speeds` per render (e.g. `timelineClips` copies
 * the array), so structurally equal inputs keep the previous references: no
 * rebuild, and the click / envelope memos stay warm.
 */
function stabilizeArgs(prev: PreviewAudioArgs | null, next: PreviewAudioArgs): PreviewAudioArgs {
  if (!prev) return next;
  return {
    ...next,
    clips: sameItems(prev.clips, next.clips) ? prev.clips : next.clips,
    speeds: sameItems(prev.speeds, next.speeds) ? prev.speeds : next.speeds,
    clickSound: sameClickSound(prev.clickSound, next.clickSound)
      ? prev.clickSound
      : next.clickSound,
  };
}

/** RNNoise runs at 48 kHz only; the export renders at the same rate. */
export const PREVIEW_SAMPLE_RATE = 48_000;

export function browserPreviewAudioDeps(
  fetchFn: typeof fetch = fetch,
): Pick<PreviewAudioPlayerDeps, "createContext" | "fetchBytes"> {
  return {
    createContext: () =>
      new AudioContext({
        latencyHint: "interactive",
        sampleRate: PREVIEW_SAMPLE_RATE,
      }) as unknown as LiveAudioContextLike,
    fetchBytes: async (url) => {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`audio fetch failed (${res.status})`);
      return res.arrayBuffer();
    },
  };
}

interface Anchor {
  ctxStartS: number;
  outputStartMs: number;
  map: SpeedMap;
}

export function createPreviewAudioPlayer(deps: PreviewAudioPlayerDeps): PreviewAudioPlayer {
  const leadS = deps.leadS ?? PREVIEW_LEAD_S;
  const debounceMs = deps.debounceMs ?? PREVIEW_DEBOUNCE_MS;
  const tolerance = deps.driftToleranceMs ?? PREVIEW_DRIFT_TOLERANCE_MS;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));

  let ctx: LiveAudioContextLike | null = null;
  let args: PreviewAudioArgs | null = null;
  let loudness: LoudnessLufs = {};
  let noiseReduction: ProcessorFactory | null = deps.noiseReduction ?? null;
  let transport: PreviewTransport = { isPlaying: false, currentMs: 0, rate: 1 };
  let current: AudioGraph | null = null;
  let anchor: Anchor | null = null;
  let timer: TimerHandle | null = null;
  let disposed = false;
  /** Factory whose worklet has been (or is being) loaded into `ctx`. */
  let preparedNr: ProcessorFactory | null = null;

  const buffers = new Map<string, AudioBufferLike | null>();
  const pending = new Map<string, Promise<void>>();

  let clickMemo: { telemetry: unknown; clips: unknown; events: ClickEvent[] } | null = null;
  let envMemo: {
    mic: AudioBufferLike;
    regions: unknown;
    clips: unknown;
    speeds: unknown;
    rate: number;
    env: ReturnType<typeof micDuckEnvelope>;
  } | null = null;

  const context = (): LiveAudioContextLike => {
    ctx ??= deps.createContext();
    return ctx;
  };

  const cancelTimer = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const stop = (): void => {
    anchor = null;
    const g = current;
    current = null;
    if (!g) return;
    for (const s of g.sources) {
      try {
        s.stop?.();
      } catch {
        // Already stopped.
      }
    }
    g.limiter.disconnect();
    g.master.disconnect();
  };

  const urlsFor = (a: PreviewAudioArgs) => ({
    mic: a.micUrl,
    system: a.systemAudioUrl,
    click: clickSoundUrl(a.clickSound, a.mediaBaseUrl),
    regions: regionSourceUrls(a.audio.regions, a.mediaBaseUrl),
  });

  const decode = (url: string | null): void => {
    if (!url || buffers.has(url) || pending.has(url) || disposed) return;
    const job = deps
      .fetchBytes(url)
      .then((bytes) => context().decodeAudioData(bytes))
      .then(
        (buffer) => {
          buffers.set(url, buffer);
        },
        () => {
          // Undecodable input plays silent; not retried for this URL.
          buffers.set(url, null);
        },
      )
      .finally(() => {
        pending.delete(url);
        if (transport.isPlaying && !disposed) scheduleRebuild();
      });
    pending.set(url, job);
  };

  const sourcesFor = (a: PreviewAudioArgs): AudioGraphSources => {
    const urls = urlsFor(a);
    const get = (url: string | null): AudioBufferLike | undefined =>
      url ? (buffers.get(url) ?? undefined) : undefined;
    const regions: Record<string, AudioBufferLike> = {};
    for (const r of urls.regions) {
      const b = get(r.url);
      if (b) regions[r.id] = b;
    }
    const sources: AudioGraphSources = {};
    const mic = get(urls.mic);
    const system = get(urls.system);
    const click = get(urls.click);
    if (mic) sources.mic = mic;
    if (system) sources.system = system;
    if (click) sources.clickSound = click;
    if (Object.keys(regions).length > 0) sources.regions = regions;
    return sources;
  };

  const clickEvents = (a: PreviewAudioArgs): ClickEvent[] => {
    if (!clickMemo || clickMemo.telemetry !== a.telemetry || clickMemo.clips !== a.clips) {
      clickMemo = {
        telemetry: a.telemetry,
        clips: a.clips,
        events: clickEventsFromTelemetry(a.telemetry, a.clips),
      };
    }
    return clickMemo.events;
  };

  const duckEnvelope = (
    a: PreviewAudioArgs,
    mic: AudioBufferLike | undefined,
    speeds: readonly AudioSpeedRegion[],
    rate: number,
  ): ReturnType<typeof micDuckEnvelope> => {
    if (!mic) return undefined;
    const m = envMemo;
    if (
      m &&
      m.mic === mic &&
      m.regions === a.audio.regions &&
      m.clips === a.clips &&
      m.speeds === a.speeds &&
      m.rate === rate
    ) {
      return m.env;
    }
    const env = micDuckEnvelope(mic, a.audio.regions, a.clips, speeds);
    envMemo = { mic, regions: a.audio.regions, clips: a.clips, speeds: a.speeds, rate, env };
    return env;
  };

  const rebuild = (): void => {
    cancelTimer();
    stop();
    if (disposed || !transport.isPlaying || !args) return;
    const a = args;
    const sources = sourcesFor(a);
    const hasClicks = sources.clickSound !== undefined && clickEvents(a).length > 0;
    if (!sources.mic && !sources.system && !sources.regions && !hasClicks) {
      return;
    }
    const c = context();
    void c.resume().catch(() => undefined);
    const rate = transport.rate > 0 ? transport.rate : 1;
    const regionEnd = a.audio.regions.reduce((m, r) => Math.max(m, r.endMs), 0);
    const timelineEnd = Math.max(a.durationMs, regionEnd);
    const speeds = shuttleSpeeds(a.speeds, rate, timelineEnd);
    const map = new SpeedMap(speeds);
    const startMs = map.timelineToOutput(Math.max(0, transport.currentMs));
    const endMs = map.timelineToOutput(timelineEnd);
    if (!(endMs > startMs)) return;
    const startAtS = c.currentTime + leadS;
    const nr = a.audio.tracks.mic.noiseReduction && noiseReduction ? noiseReduction : undefined;
    if (nr && preparedNr !== nr) {
      // Plays unprocessed until the worklet is loaded, then rebuilds with it.
      preparedNr = nr;
      void prepareProcessor(nr, c).then((ready) => {
        if (ready && noiseReduction === nr && transport.isPlaying && !disposed) scheduleRebuild();
      });
    }
    current = buildAudioGraph({
      ctx: c,
      settings: a.audio,
      sources,
      clips: a.clips.length > 0 ? a.clips : undefined,
      speeds,
      regions: a.audio.regions,
      clickEvents: hasClicks ? clickEvents(a) : undefined,
      micEnvelope: duckEnvelope(a, sources.mic, speeds, rate),
      processors: nr ? { noiseReduction: nr } : undefined,
      loudnessLufs: loudness,
      startAtS,
      range: { startMs, endMs },
    });
    anchor = { ctxStartS: startAtS, outputStartMs: startMs, map };
  };

  function scheduleRebuild(): void {
    if (disposed || !transport.isPlaying) return;
    cancelTimer();
    timer = setTimer(() => {
      timer = null;
      rebuild();
    }, debounceMs);
  }

  const drifted = (t: PreviewTransport): boolean => {
    if (!anchor || !ctx) return false;
    const elapsedMs = Math.max(0, ctx.currentTime - anchor.ctxStartS) * 1000;
    const expected = anchor.outputStartMs + elapsedMs;
    return Math.abs(anchor.map.timelineToOutput(t.currentMs) - expected) > tolerance;
  };

  return {
    setArgs(incoming) {
      if (disposed) return;
      const prev = args;
      const next = stabilizeArgs(prev, incoming);
      args = next;
      const urls = urlsFor(next);
      decode(urls.mic);
      decode(urls.system);
      decode(urls.click);
      for (const r of urls.regions) decode(r.url);
      const changed =
        !prev ||
        prev.micUrl !== next.micUrl ||
        prev.systemAudioUrl !== next.systemAudioUrl ||
        prev.mediaBaseUrl !== next.mediaBaseUrl ||
        prev.audio !== next.audio ||
        prev.clickSound !== next.clickSound ||
        prev.telemetry !== next.telemetry ||
        prev.clips !== next.clips ||
        prev.speeds !== next.speeds ||
        prev.durationMs !== next.durationMs;
      if (changed) scheduleRebuild();
    },

    setLoudness(lufs) {
      const keys = new Set([...Object.keys(loudness), ...Object.keys(lufs)]) as Set<TrackKind>;
      if ([...keys].every((k) => Object.is(loudness[k], lufs[k]))) return;
      loudness = { ...lufs };
      scheduleRebuild();
    },

    setNoiseReduction(factory) {
      if (factory === noiseReduction) return;
      noiseReduction = factory;
      scheduleRebuild();
    },

    sync(next) {
      if (disposed) return;
      const prev = transport;
      transport = { ...next, rate: next.rate > 0 ? next.rate : 1 };
      if (!transport.isPlaying) {
        cancelTimer();
        stop();
        return;
      }
      if (!prev.isPlaying) {
        rebuild();
      } else if (transport.rate !== prev.rate) {
        scheduleRebuild();
      } else if (drifted(transport)) {
        rebuild();
      }
    },

    graph: () => current,

    async idle() {
      while (pending.size > 0) await Promise.all([...pending.values()]);
    },

    dispose() {
      if (disposed) return;
      cancelTimer();
      stop();
      disposed = true;
      const c = ctx;
      ctx = null;
      void c?.close().catch(() => undefined);
    },
  };
}
