import {
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  WebMOutputFormat,
} from "mediabunny";
import type { Codec } from "../bitrate";
import { BT709_LIMITED, type Container, muxerVideoCodec } from "./encoderConfig";
import type { EncoderKind } from "./progress";

/**
 * Muxer (ENGINEERING_SPEC §10.1 route 1): mediabunny MP4 (fast start) or WebM
 * writing through an injected `ExportSink` — the renderer-side port of the
 * main-process `export:begin` / `export:writeChunk` / `export:finish` /
 * `export:cancel` channels. Writes carry an absolute file position because
 * the muxer patches headers after the fact.
 */

export interface ExportSinkBeginInfo {
  container: Container;
  codec: Codec;
  width: number;
  height: number;
  fps: number;
  encoder: EncoderKind;
}

export interface ExportSink {
  begin(info: ExportSinkBeginInfo): Promise<void>;
  writeChunk(chunk: Uint8Array, position?: number | undefined): Promise<void>;
  finish(): Promise<{ path: string }>;
  /** Abort and delete the temp file. Must be safe to call more than once. */
  cancel(): Promise<void>;
}

export interface MuxerAudioTrack {
  codec: "aac" | "opus";
  sampleRate: number;
  numberOfChannels: number;
}

export interface MuxerOptions {
  container: Container;
  videoCodec: Codec;
  fps: number;
  audio: MuxerAudioTrack | null;
  /** Upper bounds that let MP4 reserve moov space up front (no in-memory buffering). */
  maximumVideoPackets?: number | undefined;
  maximumAudioPackets?: number | undefined;
  /** Written into `colr` when the encoder metadata lacks a colour space. */
  colorSpace?: VideoColorSpaceInit | undefined;
}

export interface ExportMuxer {
  start(): Promise<void>;
  addVideoChunk(
    chunk: EncodedVideoChunk,
    meta?: EncodedVideoChunkMetadata | undefined,
  ): Promise<void>;
  addAudioChunk(
    chunk: EncodedAudioChunk,
    meta?: EncodedAudioChunkMetadata | undefined,
  ): Promise<void>;
  finalize(): Promise<void>;
  cancel(): Promise<void>;
}

export type CreateExportMuxer = (opts: MuxerOptions, sink: ExportSink) => ExportMuxer;

/** Streamed write size; fewer, larger IPC messages. */
export const MUX_CHUNK_BYTES = 4 * 1024 * 1024;

/** Fill in the decoder config colour space when the encoder did not report one. */
export function withColorSpace(
  meta: EncodedVideoChunkMetadata | undefined,
  colorSpace: VideoColorSpaceInit,
): EncodedVideoChunkMetadata | undefined {
  const dc = meta?.decoderConfig;
  if (!meta || !dc) return meta;
  const reported = dc.colorSpace;
  const hasReported =
    reported !== undefined &&
    (reported.primaries != null || reported.transfer != null || reported.matrix != null);
  return hasReported ? meta : { ...meta, decoderConfig: { ...dc, colorSpace: { ...colorSpace } } };
}

/**
 * WebCodecs chunk → mediabunny packet. Copies the payload explicitly instead of
 * `EncodedPacket.fromEncodedChunk`, which requires the global chunk classes.
 */
export function toEncodedPacket(chunk: EncodedVideoChunk | EncodedAudioChunk): EncodedPacket {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return new EncodedPacket(data, chunk.type, chunk.timestamp / 1e6, (chunk.duration ?? 0) / 1e6);
}

export const createMediabunnyMuxer: CreateExportMuxer = (opts, sink) => {
  const writable = new WritableStream<StreamTargetChunk>({
    write: (c) => sink.writeChunk(c.data, c.position),
  });
  const reserve =
    opts.container === "mp4" &&
    opts.maximumVideoPackets !== undefined &&
    (opts.audio === null || opts.maximumAudioPackets !== undefined);
  const format =
    opts.container === "mp4"
      ? new Mp4OutputFormat({ fastStart: reserve ? "reserve" : "in-memory" })
      : new WebMOutputFormat();
  const output = new Output({
    format,
    target: new StreamTarget(writable, { chunked: true, chunkSize: MUX_CHUNK_BYTES }),
  });

  const video = new EncodedVideoPacketSource(muxerVideoCodec(opts.videoCodec));
  output.addVideoTrack(video, {
    frameRate: opts.fps,
    ...(reserve && opts.maximumVideoPackets !== undefined
      ? { maximumPacketCount: opts.maximumVideoPackets }
      : {}),
  });
  let audio: EncodedAudioPacketSource | null = null;
  if (opts.audio) {
    audio = new EncodedAudioPacketSource(opts.audio.codec);
    output.addAudioTrack(
      audio,
      reserve && opts.maximumAudioPackets !== undefined
        ? { maximumPacketCount: opts.maximumAudioPackets }
        : {},
    );
  }
  const colorSpace = opts.colorSpace ?? BT709_LIMITED;

  return {
    start: () => output.start(),
    addVideoChunk: (chunk, meta) =>
      video.add(toEncodedPacket(chunk), withColorSpace(meta, colorSpace)),
    addAudioChunk: async (chunk, meta) => {
      if (!audio) throw new Error("muxer has no audio track");
      await audio.add(toEncodedPacket(chunk), meta);
    },
    finalize: () => output.finalize(),
    cancel: async () => {
      if (output.state === "finalized" || output.state === "canceled") return;
      await output.cancel();
    },
  };
};
