import type { AssertTrue, AudioBufferLike, AudioContextLike } from "./graph";

/**
 * Offline timeline render (ENGINEERING_SPEC §10.5): the graph is rebuilt per
 * 30s block on a fresh OfflineAudioContext so memory stays bounded; blocks are
 * rendered sequentially and either streamed (`renderTimelineBlocks`) or
 * concatenated into stereo Float32Arrays (`renderTimeline`).
 */

export const EXPORT_SAMPLE_RATE = 48_000;
export const RENDER_BLOCK_MS = 30_000;
/**
 * Extra audio rendered before / after each block and discarded. The master
 * DynamicsCompressor has look-ahead latency (~6ms in Chromium) and release
 * state, so rendering a block in isolation would drop its last few ms and start
 * the next one cold — an audible gap/click every 30s. Padding keeps the output
 * identical to a single continuous render (up to the constant limiter latency).
 */
export const RENDER_PRE_ROLL_MS = 500;
export const RENDER_POST_ROLL_MS = 50;

export interface OfflineAudioContextLike extends AudioContextLike {
  startRendering(): Promise<AudioBufferLike>;
}

export type OfflineContextFactory = (options: {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
}) => OfflineAudioContextLike;

export interface RenderRange {
  startMs: number;
  endMs: number;
}

export interface RenderTimelineInput {
  durationMs: number;
  createContext: OfflineContextFactory;
  /**
   * Wire the graph for this block; context time 0 = `range.startMs`. The range
   * includes pre/post-roll padding; it never starts before 0 or ends after
   * `durationMs` + post-roll.
   */
  build: (ctx: OfflineAudioContextLike, range: RenderRange) => void;
  /** Awaited on each fresh block context before `build` (e.g. AudioWorklet module load). */
  prepareContext?: ((ctx: OfflineAudioContextLike) => Promise<unknown>) | undefined;
  sampleRate?: number | undefined;
  blockMs?: number | undefined;
  /** Discarded lead-in rendered before each block (default {@link RENDER_PRE_ROLL_MS}). */
  preRollMs?: number | undefined;
  /** Discarded tail rendered after each block (default {@link RENDER_POST_ROLL_MS}). */
  postRollMs?: number | undefined;
  /** Called after each block with frames rendered so far / total. */
  onProgress?: ((renderedFrames: number, totalFrames: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}

export interface RenderedBlock {
  /** Frame offset of this block in the whole render. */
  frameOffset: number;
  channels: [Float32Array, Float32Array];
}

export interface RenderedAudio {
  sampleRate: number;
  length: number;
  channels: [Float32Array, Float32Array];
}

/** Total frames for a duration, rounded to the nearest sample. */
export function framesFor(durationMs: number, sampleRate: number): number {
  return Number.isFinite(durationMs) && durationMs > 0
    ? Math.round((durationMs * sampleRate) / 1000)
    : 0;
}

/** Render block by block, yielding stereo blocks of exactly the planned length. */
export async function* renderTimelineBlocks(
  input: RenderTimelineInput,
): AsyncGenerator<RenderedBlock> {
  const sampleRate = input.sampleRate ?? EXPORT_SAMPLE_RATE;
  const blockFrames = Math.max(1, framesFor(input.blockMs ?? RENDER_BLOCK_MS, sampleRate));
  const total = framesFor(input.durationMs, sampleRate);
  const pre = framesFor(input.preRollMs ?? RENDER_PRE_ROLL_MS, sampleRate);
  const post = framesFor(input.postRollMs ?? RENDER_POST_ROLL_MS, sampleRate);
  for (let offset = 0; offset < total; offset += blockFrames) {
    if (input.signal?.aborted) throw new DOMException("Audio render aborted", "AbortError");
    const length = Math.min(blockFrames, total - offset);
    const lead = Math.min(pre, offset);
    const renderStart = offset - lead;
    const renderLength = lead + length + post;
    const ctx = input.createContext({ numberOfChannels: 2, length: renderLength, sampleRate });
    const range = {
      startMs: (renderStart * 1000) / sampleRate,
      endMs: ((renderStart + renderLength) * 1000) / sampleRate,
    };
    if (input.prepareContext) {
      await input.prepareContext(ctx);
      if (input.signal?.aborted) throw new DOMException("Audio render aborted", "AbortError");
    }
    input.build(ctx, range);
    const buf = await ctx.startRendering();
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    const n = Math.max(0, Math.min(length, buf.length - lead));
    if (buf.numberOfChannels > 0 && n > 0) {
      const l = buf.getChannelData(0);
      const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
      left.set(l.subarray(lead, lead + n));
      right.set(r.subarray(lead, lead + n));
    }
    input.onProgress?.(offset + length, total);
    yield { frameOffset: offset, channels: [left, right] };
  }
}

/** Render the whole timeline and concatenate blocks (exact total length). */
export async function renderTimeline(input: RenderTimelineInput): Promise<RenderedAudio> {
  const sampleRate = input.sampleRate ?? EXPORT_SAMPLE_RATE;
  const length = framesFor(input.durationMs, sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for await (const block of renderTimelineBlocks(input)) {
    left.set(block.channels[0], block.frameOffset);
    right.set(block.channels[1], block.frameOffset);
  }
  return { sampleRate, length, channels: [left, right] };
}

/** Compile-time proof that a real OfflineAudioContext satisfies {@link OfflineAudioContextLike}. */
export type RealOfflineContextIsCompatible = AssertTrue<
  OfflineAudioContext extends OfflineAudioContextLike ? true : false
>;
