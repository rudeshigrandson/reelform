/**
 * Shared WebCodecs / sink fakes for the export engine tests. Fakes are cast to
 * the DOM types at the boundary; every decoded / rendered frame registers with
 * a `FrameLedger` so tests can assert no leaks and the held-frame bound.
 */
import type { SceneState } from "../../editor/preview/scene";
import type { AudioEncoderLike } from "./audio";
import type { VideoEncoderLike, WebCodecsApi } from "./engine";
import type { FrameRenderer } from "./frameRenderer";
import type { ExportMuxer, ExportSink, ExportSinkBeginInfo, MuxerOptions } from "./muxer";
import type { SourcePacket, VideoDecoderLike, VideoPacketSource } from "./streamingDecoder";

export class FrameLedger {
  live = 0;
  maxLive = 0;
  created = 0;
  doubleClose = 0;
  open(): void {
    this.live++;
    this.created++;
    this.maxLive = Math.max(this.maxLive, this.live);
  }
  close(): void {
    this.live--;
  }
}

export class FakeVideoFrame {
  closed = false;
  readonly displayWidth = 16;
  readonly displayHeight = 16;
  constructor(
    readonly ledger: FrameLedger,
    readonly timestamp: number,
    readonly duration: number | null = null,
  ) {
    ledger.open();
  }
  clone(): FakeVideoFrame {
    if (this.closed) throw new Error("clone of closed frame");
    return new FakeVideoFrame(this.ledger, this.timestamp, this.duration);
  }
  close(): void {
    if (this.closed) {
      this.ledger.doubleClose++;
      return;
    }
    this.closed = true;
    this.ledger.close();
  }
}

export const asVideoFrame = (f: FakeVideoFrame): VideoFrame => f as unknown as VideoFrame;
export const asFake = (f: VideoFrame | ImageBitmap): FakeVideoFrame =>
  f as unknown as FakeVideoFrame;

export interface FakeChunk {
  timestamp: number;
  duration: number | null;
  type: "key" | "delta";
  byteLength: number;
  copyTo(dest: Uint8Array): void;
}

export function fakeChunk(
  timestamp: number,
  type: "key" | "delta",
  duration: number | null = null,
): FakeChunk {
  return {
    timestamp,
    duration,
    type,
    byteLength: 4,
    copyTo(dest) {
      dest.set([0, 0, 0, 1]);
    },
  };
}

/** Constant-frame-rate packet stream with a keyframe every `gop` packets. */
export class FakePacketSource implements VideoPacketSource {
  readonly packets: SourcePacket[];
  keyLookups = 0;
  constructor(frameCount: number, fps: number, gop: number) {
    this.packets = Array.from({ length: frameCount }, (_, i) => {
      const timestampUs = Math.round((i * 1_000_000) / fps);
      const key = i % gop === 0;
      return {
        timestampUs,
        key,
        toChunk: () =>
          fakeChunk(timestampUs, key ? "key" : "delta") as unknown as EncodedVideoChunk,
      };
    });
  }
  async decoderConfig(): Promise<VideoDecoderConfig> {
    return { codec: "vp09.00.10.08" };
  }
  async keyPacketAt(timestampUs: number): Promise<SourcePacket | null> {
    this.keyLookups++;
    let found: SourcePacket | null = null;
    for (const p of this.packets) {
      if (p.timestampUs > timestampUs) break;
      if (p.key) found = p;
    }
    return found ?? this.packets[0] ?? null;
  }
  async next(packet: SourcePacket): Promise<SourcePacket | null> {
    return this.packets[this.packets.indexOf(packet) + 1] ?? null;
  }
}

type Listener = () => void;

/** Decodes one chunk per macrotask, like a real decoder that lags behind. */
export class FakeVideoDecoder implements VideoDecoderLike {
  state: CodecState = "unconfigured";
  queue: FakeChunk[] = [];
  maxQueueAtDecode = 0;
  decodedChunks: FakeChunk[] = [];
  failAtChunk: number | null = null;
  private listeners: Listener[] = [];
  private scheduled = false;
  private flushWaiters: { resolve: () => void; reject: (e: unknown) => void }[] = [];

  constructor(
    private readonly init: VideoDecoderInit,
    private readonly ledger: FrameLedger,
  ) {}

  get decodeQueueSize(): number {
    return this.queue.length;
  }
  configure(): void {
    if (this.state === "closed") throw new Error("InvalidStateError");
    this.state = "configured";
  }
  decode(chunk: EncodedVideoChunk): void {
    if (this.state !== "configured") throw new Error("InvalidStateError: decode");
    this.queue.push(chunk as unknown as FakeChunk);
    this.maxQueueAtDecode = Math.max(this.maxQueueAtDecode, this.queue.length);
    this.schedule();
  }
  flush(): Promise<void> {
    if (this.state !== "configured") return Promise.reject(new Error("InvalidStateError: flush"));
    if (this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => this.flushWaiters.push({ resolve, reject }));
  }
  reset(): void {
    this.queue = [];
    this.state = "unconfigured";
    this.rejectFlush(new Error("AbortError: reset"));
  }
  close(): void {
    this.queue = [];
    this.state = "closed";
    this.rejectFlush(new Error("AbortError: close"));
  }
  addEventListener(_type: "dequeue", listener: Listener): void {
    this.listeners.push(listener);
  }

  private rejectFlush(e: unknown): void {
    const w = this.flushWaiters;
    this.flushWaiters = [];
    for (const f of w) f.reject(e);
  }
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => this.process(), 0);
  }
  private process(): void {
    this.scheduled = false;
    if (this.state !== "configured") return;
    const chunk = this.queue.shift();
    if (!chunk) return;
    for (const l of this.listeners) l();
    this.decodedChunks.push(chunk);
    if (this.failAtChunk !== null && this.decodedChunks.length >= this.failAtChunk) {
      this.state = "closed";
      this.queue = [];
      this.rejectFlush(new Error("decode failed"));
      this.init.error(new DOMException("decode failed", "EncodingError"));
      return;
    }
    this.init.output(asVideoFrame(new FakeVideoFrame(this.ledger, chunk.timestamp)));
    if (this.queue.length > 0) this.schedule();
    else {
      const w = this.flushWaiters;
      this.flushWaiters = [];
      for (const f of w) f.resolve();
    }
  }
}

export interface EncodedRecord {
  timestamp: number;
  duration: number | null;
  keyFrame: boolean;
}

export interface EncoderBehaviour {
  /** Throw from configure() for this hardware preference. */
  configureThrows?: ((config: VideoEncoderConfig) => boolean) | undefined;
  /** Fire the error callback after this many outputs for this preference. */
  failAfterOutputs?: ((config: VideoEncoderConfig) => number | null) | undefined;
}

export class FakeVideoEncoder implements VideoEncoderLike {
  state: CodecState = "unconfigured";
  config: VideoEncoderConfig | null = null;
  queue: EncodedRecord[] = [];
  encoded: EncodedRecord[] = [];
  maxQueueAtEncode = 0;
  outputs = 0;
  private listeners: Listener[] = [];
  private scheduled = false;
  private flushWaiters: { resolve: () => void; reject: (e: unknown) => void }[] = [];

  constructor(
    private readonly init: VideoEncoderInit,
    private readonly behaviour: EncoderBehaviour,
  ) {}

  get encodeQueueSize(): number {
    return this.queue.length;
  }
  configure(config: VideoEncoderConfig): void {
    if (this.behaviour.configureThrows?.(config))
      throw new DOMException("rejected", "NotSupportedError");
    this.config = config;
    this.state = "configured";
  }
  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void {
    if (this.state !== "configured") throw new Error("InvalidStateError: encode");
    const f = asFake(frame);
    if (f.closed) throw new Error("encode of closed frame");
    const rec = {
      timestamp: f.timestamp,
      duration: f.duration,
      keyFrame: options?.keyFrame === true,
    };
    this.encoded.push(rec);
    this.queue.push(rec);
    this.maxQueueAtEncode = Math.max(this.maxQueueAtEncode, this.queue.length);
    this.schedule();
  }
  flush(): Promise<void> {
    if (this.state !== "configured") return Promise.reject(new Error("InvalidStateError: flush"));
    if (this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => this.flushWaiters.push({ resolve, reject }));
  }
  close(): void {
    this.state = "closed";
    this.queue = [];
    const w = this.flushWaiters;
    this.flushWaiters = [];
    for (const f of w) f.reject(new Error("AbortError: close"));
  }
  addEventListener(_type: "dequeue", listener: Listener): void {
    this.listeners.push(listener);
  }
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => this.process(), 0);
  }
  private process(): void {
    this.scheduled = false;
    if (this.state !== "configured") return;
    const rec = this.queue.shift();
    if (!rec) return;
    for (const l of this.listeners) l();
    const failAt = this.config ? (this.behaviour.failAfterOutputs?.(this.config) ?? null) : null;
    if (failAt !== null && this.outputs >= failAt) {
      this.state = "closed";
      this.queue = [];
      const w = this.flushWaiters;
      this.flushWaiters = [];
      for (const f of w) f.reject(new Error("encoder crashed"));
      this.init.error(new DOMException("encoder crashed", "EncodingError"));
      return;
    }
    const chunk = fakeChunk(rec.timestamp, rec.keyFrame ? "key" : "delta", rec.duration);
    const meta: EncodedVideoChunkMetadata | undefined =
      this.outputs === 0 ? { decoderConfig: { codec: this.config?.codec ?? "" } } : undefined;
    this.outputs++;
    this.init.output(chunk as unknown as EncodedVideoChunk, meta ?? {});
    if (this.queue.length > 0) this.schedule();
    else {
      const w = this.flushWaiters;
      this.flushWaiters = [];
      for (const f of w) f.resolve();
    }
  }
}

export class FakeAudioData {
  closed = false;
  constructor(
    readonly init: AudioDataInit,
    readonly counter: { live: number },
  ) {
    counter.live++;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.counter.live--;
  }
}

export class FakeAudioEncoder implements AudioEncoderLike {
  state: CodecState = "unconfigured";
  queue: { timestamp: number; frames: number }[] = [];
  encoded: { timestamp: number; frames: number }[] = [];
  maxQueueAtEncode = 0;
  failAfter: number | null = null;
  private listeners: Listener[] = [];
  private scheduled = false;
  private flushWaiters: { resolve: () => void; reject: (e: unknown) => void }[] = [];

  constructor(private readonly init: AudioEncoderInit) {}
  get encodeQueueSize(): number {
    return this.queue.length;
  }
  configure(): void {
    this.state = "configured";
  }
  encode(data: AudioData): void {
    if (this.state !== "configured") throw new Error("InvalidStateError: encode");
    const d = data as unknown as FakeAudioData;
    if (d.closed) throw new Error("encode of closed AudioData");
    const rec = { timestamp: d.init.timestamp, frames: d.init.numberOfFrames };
    this.encoded.push(rec);
    this.queue.push(rec);
    this.maxQueueAtEncode = Math.max(this.maxQueueAtEncode, this.queue.length);
    this.schedule();
  }
  flush(): Promise<void> {
    if (this.state !== "configured") return Promise.reject(new Error("InvalidStateError: flush"));
    if (this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve, reject) => this.flushWaiters.push({ resolve, reject }));
  }
  close(): void {
    this.state = "closed";
    this.queue = [];
    const w = this.flushWaiters;
    this.flushWaiters = [];
    for (const f of w) f.reject(new Error("AbortError: close"));
  }
  addEventListener(_type: "dequeue", listener: Listener): void {
    this.listeners.push(listener);
  }
  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => this.process(), 0);
  }
  private process(): void {
    this.scheduled = false;
    if (this.state !== "configured") return;
    const rec = this.queue.shift();
    if (!rec) return;
    for (const l of this.listeners) l();
    if (this.failAfter !== null && this.encoded.length - this.queue.length > this.failAfter) {
      this.state = "closed";
      this.init.error(new DOMException("audio encoder crashed", "EncodingError"));
      return;
    }
    this.init.output(fakeChunk(rec.timestamp, "key") as unknown as EncodedAudioChunk, {});
    if (this.queue.length > 0) this.schedule();
    else {
      const w = this.flushWaiters;
      this.flushWaiters = [];
      for (const f of w) f.resolve();
    }
  }
}

export class FakeSink implements ExportSink {
  events: string[] = [];
  infos: ExportSinkBeginInfo[] = [];
  bytes = 0;
  writes: { length: number; position: number | undefined }[] = [];
  async begin(info: ExportSinkBeginInfo): Promise<void> {
    this.events.push("begin");
    this.infos.push(info);
  }
  async writeChunk(chunk: Uint8Array, position?: number | undefined): Promise<void> {
    this.bytes += chunk.byteLength;
    this.writes.push({ length: chunk.byteLength, position });
  }
  async finish(): Promise<{ path: string }> {
    this.events.push("finish");
    return { path: "/tmp/out.mp4" };
  }
  async cancel(): Promise<void> {
    this.events.push("cancel");
  }
}

export class FakeMuxer implements ExportMuxer {
  video: { timestamp: number; type: string; meta: EncodedVideoChunkMetadata | undefined }[] = [];
  audio: number[] = [];
  /** Track of every added packet, in call order. */
  order: ("video" | "audio")[] = [];
  started = false;
  finalized = false;
  cancelled = false;
  private position = 0;
  constructor(
    readonly opts: MuxerOptions,
    private readonly sink: ExportSink,
  ) {}
  async start(): Promise<void> {
    this.started = true;
  }
  async addVideoChunk(
    chunk: EncodedVideoChunk,
    meta?: EncodedVideoChunkMetadata | undefined,
  ): Promise<void> {
    if (!this.started || this.finalized) throw new Error("muxer not writable");
    this.video.push({ timestamp: chunk.timestamp, type: chunk.type, meta });
    this.order.push("video");
    await this.sink.writeChunk(new Uint8Array(chunk.byteLength), this.position);
    this.position += chunk.byteLength;
  }
  async addAudioChunk(chunk: EncodedAudioChunk): Promise<void> {
    if (!this.opts.audio) throw new Error("no audio track");
    this.audio.push(chunk.timestamp);
    this.order.push("audio");
  }
  async finalize(): Promise<void> {
    this.finalized = true;
  }
  async cancel(): Promise<void> {
    this.cancelled = true;
  }
}

export class FakeRenderer implements FrameRenderer {
  calls: {
    tMs: number;
    sourceTimestamp: number | null;
    /** Timestamp of the attached webcam frame when the bubble is visible, else null. */
    webcamTimestamp: number | null;
    webcamVisible: boolean;
  }[] = [];
  /** `setWebcamFrame` history: frame timestamps, null for detach. */
  webcamSets: (number | null)[] = [];
  onRender: ((callIndex: number) => void) | null = null;
  /** `setNextVideoFrame` history: frame timestamps, null for detach. */
  nextSets: (number | null)[] = [];
  /** Per render: timestamp of the attached cross-dissolve frame, else null. */
  nextAtRender: (number | null)[] = [];
  private webcam: FakeVideoFrame | null = null;
  private next: FakeVideoFrame | null = null;
  constructor(private readonly ledger: FrameLedger) {}
  setWebcamFrame(frame: VideoFrame | null): void {
    this.webcam = frame ? asFake(frame) : null;
    this.webcamSets.push(this.webcam ? this.webcam.timestamp : null);
  }
  setNextVideoFrame(frame: VideoFrame | null): void {
    this.next = frame ? asFake(frame) : null;
    this.nextSets.push(this.next ? this.next.timestamp : null);
  }
  async render(state: SceneState, frame: VideoFrame | null): Promise<VideoFrame> {
    const src = frame ? asFake(frame) : null;
    if (src?.closed) throw new Error("render of closed source frame");
    if (this.next?.closed) throw new Error("render with a closed cross-dissolve frame");
    this.nextAtRender.push(this.next ? this.next.timestamp : null);
    const webcamVisible = state.composition?.webcam.visible === true;
    if (webcamVisible && (this.webcam === null || this.webcam.closed)) {
      throw new Error("visible webcam bubble without a live webcam frame");
    }
    this.calls.push({
      tMs: state.tMs,
      sourceTimestamp: src ? src.timestamp : null,
      webcamTimestamp: webcamVisible && this.webcam ? this.webcam.timestamp : null,
      webcamVisible,
    });
    this.onRender?.(this.calls.length);
    return asVideoFrame(new FakeVideoFrame(this.ledger, 0));
  }
  destroy(): void {}
}

/** Minimal SceneState: the engine only reads `tMs` / `video.visible`. */
export function fakeScene(tMs: number, visible = true): SceneState {
  return { tMs, video: { visible, crop: null } } as unknown as SceneState;
}

export interface FakeWebCodecsOptions {
  hwSupported?: boolean | undefined;
  swSupported?: boolean | undefined;
  aacSupported?: boolean | undefined;
  opusSupported?: boolean | undefined;
  encoder?: EncoderBehaviour | undefined;
}

export function createFakeWebCodecs(ledger: FrameLedger, opts: FakeWebCodecsOptions = {}) {
  const videoEncoders: FakeVideoEncoder[] = [];
  const audioEncoders: FakeAudioEncoder[] = [];
  const audioDataCounter = { live: 0 };
  const probed: VideoEncoderConfig[] = [];
  const api: WebCodecsApi = {
    async isVideoConfigSupported(config) {
      probed.push(config);
      const hw = config.hardwareAcceleration === "prefer-hardware";
      return { supported: hw ? (opts.hwSupported ?? true) : (opts.swSupported ?? true), config };
    },
    createVideoEncoder(init) {
      const e = new FakeVideoEncoder(init, opts.encoder ?? {});
      videoEncoders.push(e);
      return e;
    },
    async isAudioConfigSupported(config) {
      const ok =
        config.codec === "opus" ? (opts.opusSupported ?? true) : (opts.aacSupported ?? true);
      return { supported: ok, config };
    },
    createAudioEncoder(init) {
      const e = new FakeAudioEncoder(init);
      audioEncoders.push(e);
      return e;
    },
    createVideoFrame(image, init) {
      if (asFake(image).closed) throw new Error("VideoFrame from closed image");
      return asVideoFrame(new FakeVideoFrame(ledger, init.timestamp ?? 0, init.duration ?? null));
    },
    createAudioData(init) {
      return new FakeAudioData(init, audioDataCounter) as unknown as AudioData;
    },
  };
  return { api, videoEncoders, audioEncoders, audioDataCounter, probed };
}

/** A fake AudioBuffer whose samples encode their own index. */
export function fakeAudioBuffer(length: number, sampleRate = 48_000, channels = 2) {
  const data = Array.from({ length: channels }, (_, c) =>
    Float32Array.from({ length }, (_, i) => ((i % 100) / 100) * (c === 0 ? 1 : -1)),
  );
  return {
    sampleRate,
    numberOfChannels: channels,
    length,
    getChannelData: (c: number) => data[c] as Float32Array,
  };
}
