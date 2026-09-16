import type { Clip } from "../model/schema";
import type { DbEnvelope } from "./dsp";
import {
  type AudioBufferLike,
  type BuildAudioGraphInput,
  type ClickEvent,
  type GraphAudioRegion,
  buildAudioGraph,
  prepareProcessor,
} from "./graph";
import {
  EXPORT_SAMPLE_RATE,
  type OfflineContextFactory,
  RENDER_BLOCK_MS,
  type RenderedBlock,
  framesFor,
  renderTimelineBlocks,
} from "./render";
import { type AudioSpeedRegion, SpeedMap } from "./speedMap";

/**
 * Export mixdown (ENGINEERING_SPEC §10.5, §10.8): the same graph the preview
 * plays, rendered offline in 30s blocks over the exported output window. The
 * result is a LAZY 48 kHz stereo block source of exactly `framesFor(durationMs)`
 * frames: nothing renders until `blocks()` is iterated, and only one block is
 * held at a time, so a 60-minute export never allocates the whole timeline.
 */

export interface ExportAudioSource {
  readonly sampleRate: number;
  readonly numberOfChannels: 2;
  readonly length: number;
  blocks(): AsyncIterable<RenderedBlock>;
}

export interface ExportAudioBuffer extends AudioBufferLike {
  readonly numberOfChannels: 2;
}

export interface RenderExportAudioInput {
  settings: BuildAudioGraphInput["settings"];
  sources: BuildAudioGraphInput["sources"];
  clips?: readonly Clip[] | undefined;
  speeds?: readonly AudioSpeedRegion[] | undefined;
  /** Extra regions with their §4 source offsets (defaults to `settings.regions`). */
  regions?: readonly GraphAudioRegion[] | undefined;
  /** Click-sound events on timeline ms. */
  clickEvents?: readonly ClickEvent[] | undefined;
  /** Mic RMS envelope over output time; drives ducking of extra regions. */
  micEnvelope?: DbEnvelope | undefined;
  duckThresholdDb?: number | undefined;
  processors?: BuildAudioGraphInput["processors"];
  loudnessLufs?: BuildAudioGraphInput["loudnessLufs"];
  /** Output ms (post speed) where the export starts. */
  outputStartMs: number;
  /** Output duration to render; use the video frame plan's duration. */
  durationMs: number;
  createContext: OfflineContextFactory;
  sampleRate?: number | undefined;
  blockMs?: number | undefined;
  onProgress?: ((renderedFrames: number, totalFrames: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/** True when there is anything audible to render. */
export function hasExportAudio(
  sources: BuildAudioGraphInput["sources"],
  clickEvents: readonly ClickEvent[] = [],
): boolean {
  return (
    sources.mic !== undefined ||
    sources.system !== undefined ||
    Object.keys(sources.regions ?? {}).length > 0 ||
    (sources.clickSound !== undefined && clickEvents.length > 0)
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

/** Concatenate a block source into memory (tests / short previews only). */
export async function collectExportAudio(source: ExportAudioSource): Promise<ExportAudioBuffer> {
  const left = new Float32Array(source.length);
  const right = new Float32Array(source.length);
  for await (const block of source.blocks()) {
    left.set(block.channels[0].subarray(0, source.length - block.frameOffset), block.frameOffset);
    right.set(block.channels[1].subarray(0, source.length - block.frameOffset), block.frameOffset);
  }
  return toExportAudioBuffer([left, right], source.sampleRate);
}

/** Lazy export mixdown; null when the project has no audio at all. */
export function renderExportAudio(input: RenderExportAudioInput): ExportAudioSource | null {
  if (!hasExportAudio(input.sources, input.clickEvents)) return null;
  const sampleRate = input.sampleRate ?? EXPORT_SAMPLE_RATE;
  const length = framesFor(input.durationMs, sampleRate);
  if (length === 0) return null;
  const base = Math.max(0, input.outputStartMs);
  return {
    sampleRate,
    numberOfChannels: 2,
    length,
    blocks: () =>
      renderTimelineBlocks({
        durationMs: input.durationMs,
        sampleRate,
        blockMs: input.blockMs ?? RENDER_BLOCK_MS,
        createContext: input.createContext,
        onProgress: input.onProgress,
        signal: input.signal,
        // RNNoise loads its worklet into every fresh block context first.
        prepareContext: input.processors?.noiseReduction
          ? (ctx) => prepareProcessor(input.processors?.noiseReduction, ctx)
          : undefined,
        build: (ctx, range) => {
          buildAudioGraph({
            ctx,
            settings: input.settings,
            sources: input.sources,
            clips: input.clips,
            speeds: input.speeds,
            regions: input.regions,
            clickEvents: input.clickEvents,
            micEnvelope: input.micEnvelope,
            duckThresholdDb: input.duckThresholdDb,
            processors: input.processors,
            loudnessLufs: input.loudnessLufs,
            startAtS: 0,
            range: { startMs: base + range.startMs, endMs: base + range.endMs },
          });
        },
      }),
  };
}
