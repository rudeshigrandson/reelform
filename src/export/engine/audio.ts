import { ExportCancelledError, Pulse } from "./cancel";
import type { Container } from "./encoderConfig";

/**
 * Export audio encode (ENGINEERING_SPEC §10.1 route 1, §10.5). Input is the
 * already-rendered timeline `AudioBuffer` (OfflineAudioContext output).
 * AAC-LC 192k via WebCodecs when available (MP4); Opus for WebM; otherwise a
 * 16-bit PCM WAV is produced and flagged for the ffmpeg AAC finalize step.
 */

export const AAC_LC_CODEC = "mp4a.40.2";
export const AUDIO_BITRATE = 192_000;
export const MAX_AUDIO_QUEUE = 8;
/** 1 s at 48 kHz per `AudioData` block. */
export const DEFAULT_AUDIO_BLOCK_FRAMES = 48_000;

export interface AudioBufferLike {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
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

/** Planar Float32 copy of `[offset, offset + frames)` across all channels. */
export function planarBlock(
  buffer: AudioBufferLike,
  offset: number,
  frames: number,
): Float32Array<ArrayBuffer> {
  const ch = buffer.numberOfChannels;
  const out = new Float32Array(frames * ch);
  for (let c = 0; c < ch; c++) {
    out.set(buffer.getChannelData(c).subarray(offset, offset + frames), c * frames);
  }
  return out;
}

export async function encodeAudioBuffer(
  buffer: AudioBufferLike,
  config: AudioEncoderConfig,
  deps: EncodeAudioDeps,
): Promise<{ blocks: number }> {
  const { signal } = deps;
  const block = Math.max(1, Math.floor(deps.blockFrames ?? DEFAULT_AUDIO_BLOCK_FRAMES));
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
    for (let offset = 0; offset < buffer.length; offset += block) {
      check();
      while (encoder.encodeQueueSize >= MAX_AUDIO_QUEUE) {
        await changes.wait();
        check();
      }
      const frames = Math.min(block, buffer.length - offset);
      const data = deps.createAudioData({
        format: "f32-planar",
        sampleRate: buffer.sampleRate,
        numberOfChannels: buffer.numberOfChannels,
        numberOfFrames: frames,
        timestamp: Math.round((offset * 1_000_000) / buffer.sampleRate),
        data: planarBlock(buffer, offset, frames),
      });
      try {
        encoder.encode(data);
      } finally {
        data.close();
      }
      blocks++;
    }
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

/** 16-bit little-endian PCM WAV, channels interleaved. */
export function encodeWav(buffer: AudioBufferLike): Uint8Array {
  const ch = Math.max(1, buffer.numberOfChannels);
  const frames = buffer.length;
  const dataBytes = frames * ch * 2;
  const out = new Uint8Array(44 + dataBytes);
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
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  const channels = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, (channels[c] as Float32Array)[i] ?? 0));
      view.setInt16(at, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
      at += 2;
    }
  }
  return out;
}
