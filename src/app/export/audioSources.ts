import { micDuckEnvelope } from "../../editor/audio/envelope";
import { type ExportAudioSource, renderExportAudio } from "../../editor/audio/exportRender";
import { outputWindowFor } from "../../editor/audio/exportRender";
import type {
  AudioBufferLike,
  AudioGraphSources,
  ProcessorFactory,
} from "../../editor/audio/graph";
import { integratedLoudness } from "../../editor/audio/loudness";
import type { OfflineAudioContextLike, OfflineContextFactory } from "../../editor/audio/render";
import { EXPORT_SAMPLE_RATE } from "../../editor/audio/render";
import {
  type ClickSoundSettings,
  type RegionSourceUrl,
  clickEventsFromTelemetry,
  clickSoundUrl,
  regionSourceUrls,
} from "../../editor/audio/sourceUrls";
import type { Telemetry } from "../../editor/autozoom/types";
import type { TrackKind } from "../../editor/inspector/audio/types";
import type { Clip } from "../../editor/model/schema";
import type { EditorData } from "../../editor/store";
import type { SpeedRegionLike } from "./runner";
import type { RenderAudioArgs } from "./videoRoute";

/**
 * Export audio inputs (§9.5, §10.5): decode the session's mic / system tracks,
 * extra regions and the click-sound pack (fetch + decodeAudioData), derive
 * click events, the ducking envelope and normalize loudness, and hand back a
 * lazy 30s-block mixdown.
 */

export interface AudioDecodePort {
  decode(url: string, signal: AbortSignal): Promise<AudioBufferLike>;
}

export function browserAudioDecoder(fetchFn: typeof fetch = fetch): AudioDecodePort {
  return {
    async decode(url, signal) {
      const res = await fetchFn(url, { signal });
      if (!res.ok) throw new Error(`audio fetch failed (${res.status})`);
      const bytes = await res.arrayBuffer();
      const ctx = new OfflineAudioContext(2, 1, EXPORT_SAMPLE_RATE);
      return ctx.decodeAudioData(bytes);
    },
  };
}

export const browserOfflineContext: OfflineContextFactory = (o) =>
  new OfflineAudioContext(o) as unknown as OfflineAudioContextLike;

export interface AudioTrackUrls {
  micUrl: string | null;
  systemAudioUrl: string | null;
  /** Extra regions (music / voiceover), keyed by region id. */
  regions?: readonly RegionSourceUrl[] | undefined;
  clickSoundUrl?: string | null | undefined;
}

/** Inputs that exist but could not be decoded (export continues without them). */
export type AudioDecodeFailure = TrackKind | "click-sound" | `region:${string}`;

export interface LoadedAudioSources {
  sources: AudioGraphSources;
  failed: AudioDecodeFailure[];
}

export async function loadAudioSources(
  urls: AudioTrackUrls,
  decoder: AudioDecodePort,
  signal: AbortSignal,
): Promise<LoadedAudioSources> {
  const sources: AudioGraphSources = {};
  const regions: Record<string, AudioBufferLike> = {};
  const failed: AudioDecodeFailure[] = [];
  const load = async (
    url: string | null | undefined,
    failure: AudioDecodeFailure,
    put: (buffer: AudioBufferLike) => void,
  ): Promise<void> => {
    if (!url) return;
    try {
      put(await decoder.decode(url, signal));
    } catch (e) {
      if (signal.aborted) throw e;
      failed.push(failure);
    }
  };
  await Promise.all([
    load(urls.micUrl, "mic", (b) => {
      sources.mic = b;
    }),
    load(urls.systemAudioUrl, "system", (b) => {
      sources.system = b;
    }),
    load(urls.clickSoundUrl, "click-sound", (b) => {
      sources.clickSound = b;
    }),
    ...(urls.regions ?? []).map((r) =>
      load(r.url, `region:${r.id}`, (b) => {
        regions[r.id] = b;
      }),
    ),
  ]);
  if (Object.keys(regions).length > 0) sources.regions = regions;
  return { sources, failed };
}

export type LoudnessLufs = Partial<Record<TrackKind, number>>;

/**
 * Integrated loudness for every normalized track: the measured value when one
 * exists (loudness worker), otherwise measured inline from the decoded buffer.
 */
export function loudnessForExport(
  settings: EditorData["audio"],
  sources: AudioGraphSources,
  measured: LoudnessLufs = {},
): LoudnessLufs {
  const out: LoudnessLufs = {};
  for (const kind of ["mic", "system"] as const) {
    const known = measured[kind];
    if (known !== undefined && !Number.isNaN(known)) {
      out[kind] = known;
      continue;
    }
    const buffer = sources[kind];
    if (!settings.tracks[kind].normalize || !buffer || buffer.numberOfChannels === 0) continue;
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
      buffer.getChannelData(c),
    );
    out[kind] = integratedLoudness(channels, buffer.sampleRate);
  }
  return out;
}

export interface ExportAudioRendererDeps {
  urls: Pick<AudioTrackUrls, "micUrl" | "systemAudioUrl">;
  /** `reelform-media://` base for project-relative region / custom click files. */
  mediaBaseUrl?: string | null | undefined;
  settings: EditorData["audio"];
  clips: readonly Clip[];
  speeds: readonly SpeedRegionLike[];
  /** Cursor click-sound setting (pack / custom file). */
  clickSound?: ClickSoundSettings | undefined;
  /** Recorded clicks (source ms). */
  telemetry?: Pick<Telemetry, "clicks"> | null | undefined;
  /** Loudness measured by the worker, read when the export starts. */
  loudnessLufs?: (() => LoudnessLufs) | undefined;
  /** RNNoise processor for the mic when noise reduction is on. */
  noiseReduction?: ProcessorFactory | null | undefined;
  decoder: AudioDecodePort;
  createContext: OfflineContextFactory;
  onDecodeFailed?: ((failed: AudioDecodeFailure[]) => void) | undefined;
}

export function createExportAudioRenderer(deps: ExportAudioRendererDeps) {
  return async (args: RenderAudioArgs): Promise<ExportAudioSource | null> => {
    const { settings } = deps;
    const mediaBaseUrl = deps.mediaBaseUrl ?? null;
    const { sources, failed } = await loadAudioSources(
      {
        ...deps.urls,
        regions: regionSourceUrls(settings.regions, mediaBaseUrl),
        clickSoundUrl: deps.clickSound ? clickSoundUrl(deps.clickSound, mediaBaseUrl) : null,
      },
      deps.decoder,
      args.signal,
    );
    if (failed.length > 0) deps.onDecodeFailed?.(failed);
    const window = outputWindowFor(args.range, deps.speeds);
    const clickEvents = sources.clickSound
      ? clickEventsFromTelemetry(deps.telemetry, deps.clips)
      : [];
    const noiseReduction =
      settings.tracks.mic.noiseReduction && deps.noiseReduction ? deps.noiseReduction : undefined;
    return renderExportAudio({
      settings,
      sources,
      clips: deps.clips,
      speeds: deps.speeds,
      regions: settings.regions,
      clickEvents,
      micEnvelope: micDuckEnvelope(sources.mic, settings.regions, deps.clips, deps.speeds),
      processors: noiseReduction ? { noiseReduction } : undefined,
      loudnessLufs: loudnessForExport(settings, sources, deps.loudnessLufs?.()),
      outputStartMs: window.startMs,
      durationMs: args.outputDurationMs,
      createContext: deps.createContext,
      signal: args.signal,
    });
  };
}
