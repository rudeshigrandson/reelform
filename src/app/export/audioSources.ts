import { renderExportAudio } from "../../editor/audio/exportRender";
import { outputWindowFor } from "../../editor/audio/exportRender";
import type { AudioBufferLike, AudioGraphSources } from "../../editor/audio/graph";
import type { OfflineAudioContextLike, OfflineContextFactory } from "../../editor/audio/render";
import { EXPORT_SAMPLE_RATE } from "../../editor/audio/render";
import type { Clip } from "../../editor/model/schema";
import type { EditorData } from "../../editor/store";
import type { SpeedRegionLike } from "./runner";
import type { RenderAudioArgs } from "./videoRoute";

/**
 * Export audio inputs (§10.5): decode the session's mic / system tracks
 * (fetch + decodeAudioData) and render the mixdown in 30s offline blocks.
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
}

export interface LoadedAudioSources {
  sources: AudioGraphSources;
  /** Tracks that exist but could not be decoded (export continues without them). */
  failed: ("mic" | "system")[];
}

export async function loadAudioSources(
  urls: AudioTrackUrls,
  decoder: AudioDecodePort,
  signal: AbortSignal,
): Promise<LoadedAudioSources> {
  const sources: AudioGraphSources = {};
  const failed: LoadedAudioSources["failed"] = [];
  const load = async (kind: "mic" | "system", url: string | null): Promise<void> => {
    if (!url) return;
    try {
      sources[kind] = await decoder.decode(url, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      failed.push(kind);
    }
  };
  await Promise.all([load("mic", urls.micUrl), load("system", urls.systemAudioUrl)]);
  return { sources, failed };
}

export interface ExportAudioRendererDeps {
  urls: AudioTrackUrls;
  settings: EditorData["audio"];
  clips: readonly Clip[];
  speeds: readonly SpeedRegionLike[];
  decoder: AudioDecodePort;
  createContext: OfflineContextFactory;
  onDecodeFailed?: ((tracks: ("mic" | "system")[]) => void) | undefined;
}

export function createExportAudioRenderer(deps: ExportAudioRendererDeps) {
  return async (args: RenderAudioArgs): Promise<AudioBufferLike | null> => {
    const { sources, failed } = await loadAudioSources(deps.urls, deps.decoder, args.signal);
    if (failed.length > 0) deps.onDecodeFailed?.(failed);
    const window = outputWindowFor(args.range, deps.speeds);
    return renderExportAudio({
      settings: deps.settings,
      sources,
      clips: deps.clips,
      speeds: deps.speeds,
      outputStartMs: window.startMs,
      durationMs: args.outputDurationMs,
      createContext: deps.createContext,
      signal: args.signal,
    });
  };
}
