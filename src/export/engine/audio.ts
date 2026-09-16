import { ExportCancelledError, Pulse } from "./cancel";
import type { Container } from "./encoderConfig";

/**
 * Export audio encode (ENGINEERING_SPEC §10.1 route 1, §10.5, §10.8). Input is
 * a lazy block source over the offline timeline render, so at most one render
 * block (30 s) is in memory. AAC-LC 192k via WebCodecs when available (MP4);
 * Opus for WebM; otherwise a 16-bit PCM WAV is streamed to disk for the ffmpeg
 * AAC finalize step.
 */

export const AAC_LC_CODEC = "mp4a.40.2";
export const AUDIO_BITRATE = 192_000;
export const MAX_AUDIO_QUEUE = 8;
/** 1 s at 48 kHz per `AudioData` block. */
export const DEFAULT_AUDIO_BLOCK_FRAMES = 48_000;
export const WAV_HEADER_BYTES = 44;

export interface AudioBufferLike {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

/** One rendered block: `channels[c]` holds frames `[frameOffset, frameOffset + length)`. */
export interface AudioBlock {
  frameOffset: number;
  channels: readonly Float32Array[];
}

/** Lazily rendered audio; each `blocks()` call starts a fresh pass. */
export interface AudioBlockSource {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  /** Total frames across all blocks. */
  readonly length: number;
  blocks(): AsyncIterable<AudioBlock>;
}

/** Wrap an in-memory buffer as a block source (tests, small clips). */
export function bufferBlockSource(
  buffer: AudioBufferLike,
  blockFrames = DEFAULT_AUDIO_BLOCK_FRAMES,
): AudioBlockSource {
  const step = Math.max(1, Math.floor(blockFrames));
  return {
    sampleRate: buffer.sampleRate,
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    async *blocks() {
      for (let offset = 0; offset < buffer.length; offset += step) {
        const end = Math.min(buffer.length, offset + step);
        yield {
          frameOffset: offset,
          channels: Array.from({ length: buffer.numberOfChannels }, (_, c) =>
            buffer.getChannelData(c).subarray(offset, end),
          ),
        };
      }
    },
  };
}

export type AudioPlan =
  | { kind: "aac" | "opus"; config: AudioEncoderConfig }
  | { kind: "pcm-wav"; reason: string };

export interface AudioEncoderProbe {
  isAudioConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport>;
}

export async function chooseAudioPlan(
  container: Container,
  probe: AudioEncoderProbe,
  sampleRate: number,
  numberOfChannels: number,
): Promise<AudioPlan> {
  const kind = container === "mp4" ? "aac" : "opus";
  const config: AudioEncoderConfig = {
    codec: kind === "aac" ? AAC_LC_CODEC : "opus",
    sampleRate,
    numberOfChannels,
    bitrate: AUDIO_BITRATE,
  };
  try {
    if ((await probe.isAudioConfigSupported(config)).supported === true) return { kind, config };
  } catch {
    // Treat a throwing probe as unsupported.
  }
  return { kind: "pcm-wav", reason: `${config.codec} encoder unavailable` };
}

/** The subset of `AudioEncoder` this module uses (fakeable in tests). */
export interface AudioEncoderLike {
  readonly state: CodecState;
  readonly encodeQueueSize: number;
  configure(config: AudioEncoderConfig): void;
  encode(data: AudioData): void;
  flush(): Promise<void>;
  close(): void;
  addEventListener(type: "dequeue", listener: () => void): void;
}

export interface EncodeAudioDeps {
  createEncoder(init: AudioEncoderInit): AudioEncoderLike;
  createAudioData(init: AudioDataInit): AudioData;
  onChunk(chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata | undefined): void;
  signal?: AbortSignal | undefined;
  blockFrames?: number | undefined;
}

const blockLength = (block: AudioBlock): number =>
  block.channels.reduce((m, c) => Math.min(m, c.length), block.channels[0]?.length ?? 0);

/** Planar Float32 copy of `[offset, offset + frames)` of a block's channels. */
export function planarBlock(
  channels: readonly Float32Array[],
  offset: number,
  frames: number,
  numberOfChannels = channels.length,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(frames * numberOfChannels);
  for (let c = 0; c < numberOfChannels; c++) {
    const ch = channels[c] ?? channels[0];
    if (ch) out.set(ch.subarray(offset, offset + frames), c * frames);
  }
  return out;
}

/**
 * Encode a block source. Each rendered block is split into `blockFrames`
 * AudioData chunks whose µs timestamps come from the block's `frameOffset`.
 */
export async function encodeAudioBuffer(
  source: AudioBlockSource,
  config: AudioEncoderConfig,
  deps: EncodeAudioDeps,
): Promise<{ blocks: number }> {
  const { signal } = deps;
  const step = Math.max(1, Math.floor(deps.blockFrames ?? DEFAULT_AUDIO_BLOCK_FRAMES));
  const changes = new Pulse();
  let failure: unknown = null;
  const encoder = deps.createEncoder({
    output: (chunk, meta) => deps.onChunk(chunk, meta),
    error: (e) => {
      failure ??= e;
      changes.pulse();
    },
  });
  const closeEncoder = (): void => {
    if (encoder.state !== "closed") encoder.close();
  };
  const onAbort = (): void => {
    closeEncoder();
    changes.pulse();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const check = (): void => {
    if (signal?.aborted) throw new ExportCancelledError();
    if (failure !== null) throw failure;
  };

  let blocks = 0;
  try {
    encoder.addEventListener("dequeue", changes.pulse);
    encoder.configure(config);
    check();
    for await (const block of source.blocks()) {
      check();
      const frames = Math.min(blockLength(block), Math.max(0, source.length - block.frameOffset));
      for (let offset = 0; offset < frames; offset += step) {
        check();
        while (encoder.encodeQueueSize >= MAX_AUDIO_QUEUE) {
          await changes.wait();
          check();
        }
        const n = Math.min(step, frames - offset);
        const data = deps.createAudioData({
          format: "f32-planar",
          sampleRate: source.sampleRate,
          numberOfChannels: source.numberOfChannels,
          numberOfFrames: n,
          timestamp: Math.round(((block.frameOffset + offset) * 1_000_000) / source.sampleRate),
          data: planarBlock(block.channels, offset, n, source.numberOfChannels),
        });
        try {
          encoder.encode(data);
        } finally {
          data.close();
        }
        blocks++;
      }
    }
    check();
    await encoder.flush();
    check();
    return { blocks };
  } catch (e) {
    if (signal?.aborted) throw new ExportCancelledError();
    throw failure ?? e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    closeEncoder();
  }
}

/** 44-byte 16-bit PCM WAV header for `frames` frames. */
export function wavHeader(
  sampleRate: number,
  numberOfChannels: number,
  frames: number,
): Uint8Array {
  const ch = Math.max(1, numberOfChannels);
  const dataBytes = frames * ch * 2;
  const out = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(out.buffer);
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return out;
}

/** Interleaved, clamped 16-bit little-endian samples for `frames` frames of `channels`. */
export function pcm16Interleaved(
  channels: readonly Float32Array[],
  frames: number,
  numberOfChannels = channels.length,
): Uint8Array {
  const ch = Math.max(1, numberOfChannels);
  const out = new Uint8Array(frames * ch * 2);
  const view = new DataView(out.buffer);
  let at = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const raw = (channels[c] ?? channels[0])?.[i] ?? 0;
      const s = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      view.setInt16(at, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      at += 2;
    }
  }
  return out;
}

/** Bytes of a WAV written to disk: header first, then each block in order. */
export async function streamWav(
  source: AudioBlockSource,
  write: (bytes: Uint8Array) => Promise<void>,
  signal?: AbortSignal | undefined,
): Promise<{ bytes: number }> {
  if (signal?.aborted) throw new ExportCancelledError();
  const ch = Math.max(1, source.numberOfChannels);
  await write(wavHeader(source.sampleRate, ch, source.length));
  let written = 0;
  for await (const block of source.blocks()) {
    if (signal?.aborted) throw new ExportCancelledError();
    const frames = Math.min(
      blockLength(block),
      Math.max(0, source.length - block.frameOffset),
      source.length - written,
    );
    if (frames <= 0) continue;
    await write(pcm16Interleaved(block.channels, frames, ch));
    written += frames;
  }
  // Pad a short render so the data chunk matches the header.
  if (written < source.length) {
    await write(new Uint8Array((source.length - written) * ch * 2));
  }
  return { bytes: WAV_HEADER_BYTES + source.length * ch * 2 };
}

/** 16-bit little-endian PCM WAV of an in-memory buffer, channels interleaved. */
export function encodeWav(buffer: AudioBufferLike): Uint8Array {
  const ch = Math.max(1, buffer.numberOfChannels);
  const header = wavHeader(buffer.sampleRate, ch, buffer.length);
  const channels = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  const body = pcm16Interleaved(channels, buffer.length, ch);
  const out = new Uint8Array(header.byteLength + body.byteLength);
  out.set(header);
  out.set(body, header.byteLength);
  return out;
}
