import type { Clip } from "../model/schema";
import { type AudioBufferLike, type BuildAudioGraphInput, buildAudioGraph } from "./graph";
import {
  EXPORT_SAMPLE_RATE,
  type OfflineContextFactory,
  RENDER_BLOCK_MS,
  framesFor,
  renderTimeline,
} from "./render";
import { type AudioSpeedRegion, SpeedMap } from "./speedMap";

/**
 * Export mixdown (ENGINEERING_SPEC §10.5): the same graph the preview plays,
 * rendered offline in 30s blocks over the exported output window, returned as
 * a 48 kHz stereo `AudioBuffer`-shaped object of exactly
 * `framesFor(durationMs)` frames so it lines up with the video frame plan.
 */

export interface ExportAudioBuffer extends AudioBufferLike {
  readonly numberOfChannels: 2;
}

export interface RenderExportAudioInput {
  settings: BuildAudioGraphInput["settings"];
  sources: BuildAudioGraphInput["sources"];
  clips?: readonly Clip[] | undefined;
  speeds?: readonly AudioSpeedRegion[] | undefined;
  /** Output ms (post speed) where the export starts. */
  outputStartMs: number;
  /** Output duration to render; use the video frame plan's duration. */
  durationMs: number;
  createContext: OfflineContextFactory;
  sampleRate?: number | undefined;
  blockMs?: number | undefined;
  loudnessLufs?: BuildAudioGraphInput["loudnessLufs"];
  onProgress?: ((renderedFrames: number, totalFrames: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/** True when there is anything audible to render. */
export function hasExportAudio(sources: BuildAudioGraphInput["sources"]): boolean {
  return (
    sources.mic !== undefined ||
    sources.system !== undefined ||
    Object.keys(sources.regions ?? {}).length > 0
  );
}

/** Timeline range → output window, using the audio speed map (ramps included). */
export function outputWindowFor(
  range: { startMs: number; endMs: number },
  speeds: readonly AudioSpeedRegion[] = [],
): { startMs: number; endMs: number } {
  const map = new SpeedMap(speeds);
  const startMs = map.timelineToOutput(Math.max(0, range.startMs));
  const endMs = map.timelineToOutput(Math.max(range.startMs, range.endMs));
  return { startMs, endMs: Math.max(startMs, endMs) };
}

/** Wrap rendered stereo channels as an `AudioBuffer`-like object. */
export function toExportAudioBuffer(
  channels: readonly [Float32Array, Float32Array],
  sampleRate: number,
): ExportAudioBuffer {
  const length = Math.min(channels[0].length, channels[1].length);
  return {
    sampleRate,
    numberOfChannels: 2,
    length,
    duration: length / sampleRate,
    getChannelData: (c) => {
      if (c !== 0 && c !== 1) throw new RangeError(`channel ${c} out of range`);
      return channels[c];
    },
  };
}

/** Render the export mixdown; null when the project has no audio at all. */
export async function renderExportAudio(
  input: RenderExportAudioInput,
): Promise<ExportAudioBuffer | null> {
  if (!hasExportAudio(input.sources)) return null;
  const sampleRate = input.sampleRate ?? EXPORT_SAMPLE_RATE;
  if (framesFor(input.durationMs, sampleRate) === 0) return null;
  const base = Math.max(0, input.outputStartMs);
  const rendered = await renderTimeline({
    durationMs: input.durationMs,
    sampleRate,
    blockMs: input.blockMs ?? RENDER_BLOCK_MS,
    createContext: input.createContext,
    onProgress: input.onProgress,
    signal: input.signal,
    build: (ctx, range) => {
      buildAudioGraph({
        ctx,
        settings: input.settings,
        sources: input.sources,
        clips: input.clips,
        speeds: input.speeds,
        loudnessLufs: input.loudnessLufs,
        startAtS: 0,
        range: { startMs: base + range.startMs, endMs: base + range.endMs },
      });
    },
  });
  return toExportAudioBuffer(rendered.channels, rendered.sampleRate);
}
