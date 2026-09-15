import { Pulse } from "./cancel";

/**
 * StreamingDecoder (ENGINEERING_SPEC §10.2).
 *
 * Demuxed packets → `VideoDecoder` with backpressure (`decodeQueueSize ≤ 8`)
 * → a small PTS-ordered window of decoded frames. `frameAt(sourceMs)` returns
 * a clone of the frame nearest that time; the caller closes it immediately
 * after rendering. Requests are expected to be (mostly) non-decreasing: frames
 * that can no longer be nearest to any later request are closed straight away.
 * Backward requests and forward jumps past a keyframe seek to the nearest
 * preceding keyframe; frames decoded before the target are discarded.
 *
 * Held-frame budget (§10.8, ≤ 12 decoded frames): the window never exceeds
 * `MAX_HELD_FRAMES − 2` frames including those still in the decode queue,
 * leaving room for the clone handed out and the rendered output frame.
 */

export const MAX_DECODE_QUEUE = 8;
export const MAX_HELD_FRAMES = 12;
/** Forward gaps larger than this check whether a keyframe seek is cheaper. */
export const SEEK_JUMP_US = 1_000_000;

/** One demuxed packet. Timestamps are in microseconds. */
export interface SourcePacket {
  readonly timestampUs: number;
  readonly key: boolean;
  toChunk(): EncodedVideoChunk;
}

export interface VideoPacketSource {
  decoderConfig(): Promise<VideoDecoderConfig>;
  /** Last key packet at or before `timestampUs` (first key packet if none). */
  keyPacketAt(timestampUs: number): Promise<SourcePacket | null>;
  /** Next packet in decode order, or null at end of stream. */
  next(packet: SourcePacket): Promise<SourcePacket | null>;
}

/** The subset of `VideoDecoder` this module uses (fakeable in tests). */
export interface VideoDecoderLike {
  readonly state: CodecState;
  readonly decodeQueueSize: number;
  configure(config: VideoDecoderConfig): void;
  decode(chunk: EncodedVideoChunk): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
  addEventListener(type: "dequeue", listener: () => void): void;
}

export type CreateVideoDecoder = (init: VideoDecoderInit) => VideoDecoderLike;

/** What the export loop needs from a frame source. */
export interface FrameSource {
  /** Clone of the decoded frame nearest `sourceMs`; the caller must close it. */
  frameAt(sourceMs: number): Promise<VideoFrame>;
  close(): void;
}

export class DecoderClosedError extends Error {
  override name = "DecoderClosedError";
}

export interface StreamingDecoderOptions {
  source: VideoPacketSource;
  createDecoder: CreateVideoDecoder;
}

export class StreamingDecoder implements FrameSource {
  /** Decoded frames sorted by timestamp. */
  private buffer: VideoFrame[] = [];
  private decoder: VideoDecoderLike | null = null;
  private config: VideoDecoderConfig | null = null;
  private nextPacket: SourcePacket | null = null;
  private flushed = false;
  private lastTargetUs: number | null = null;
  private pruneTargetUs = Number.NEGATIVE_INFINITY;
  private error: unknown = null;
  private closed = false;
  private busy = false;
  private readonly changes = new Pulse();
  private readonly maxWindow = MAX_HELD_FRAMES - 2;

  /** Diagnostics for tests. */
  readonly stats = { seeks: 0, packetsDecoded: 0, framesDiscarded: 0 };

  constructor(private readonly opts: StreamingDecoderOptions) {}

  /** Frames currently held by the decoder window. */
  get heldFrames(): number {
    return this.buffer.length;
  }

  async frameAt(sourceMs: number): Promise<VideoFrame> {
    if (!Number.isFinite(sourceMs)) throw new RangeError(`invalid source time ${sourceMs}`);
    this.check();
    if (this.busy) throw new Error("StreamingDecoder.frameAt is not re-entrant");
    this.busy = true;
    try {
      const target = Math.round(sourceMs * 1000);
      const decoder = await this.ensureOpen();
      if (this.lastTargetUs === null || target < this.lastTargetUs) await this.seek(target);
      this.lastTargetUs = target;
      this.pruneTargetUs = target;
      let jumpChecked = false;

      for (;;) {
        this.check();
        this.prune(target);
        const lastFrame = this.buffer[this.buffer.length - 1];
        if (lastFrame && (lastFrame.timestamp >= target || this.flushed)) break;
        if (this.flushed) throw new Error("source has no decodable frames");

        const next = this.nextPacket;
        if (next === null) {
          await this.flush(decoder);
          continue;
        }
        if (!jumpChecked && next.timestampUs + SEEK_JUMP_US < target) {
          jumpChecked = true;
          const key = await this.opts.source.keyPacketAt(target);
          this.check();
          if (key && key.timestampUs > next.timestampUs) {
            await this.seek(target);
            continue;
          }
        }
        const queued = decoder.decodeQueueSize;
        if (queued >= MAX_DECODE_QUEUE || this.buffer.length + queued >= this.maxWindow) {
          await this.changes.wait();
          continue;
        }
        decoder.decode(next.toChunk());
        this.stats.packetsDecoded++;
        this.nextPacket = await this.opts.source.next(next);
      }

      const a = this.buffer[0] as VideoFrame;
      const b = this.buffer[1];
      const pick =
        a.timestamp < target && b && Math.abs(b.timestamp - target) < target - a.timestamp ? b : a;
      return pick.clone();
    } finally {
      this.busy = false;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeBuffer();
    const d = this.decoder;
    if (d && d.state !== "closed") {
      try {
        d.close();
      } catch {
        // Already closed by an error; nothing to release.
      }
    }
    this.changes.pulse();
  }

  private check(): void {
    if (this.closed) throw new DecoderClosedError("decoder closed");
    if (this.error !== null) throw this.error;
  }

  private async ensureOpen(): Promise<VideoDecoderLike> {
    if (this.decoder) return this.decoder;
    const config = await this.opts.source.decoderConfig();
    this.check();
    const decoder = this.opts.createDecoder({
      output: (frame) => this.onOutput(frame),
      error: (e) => {
        this.error ??= e;
        this.changes.pulse();
      },
    });
    decoder.addEventListener("dequeue", this.changes.pulse);
    decoder.configure(config);
    this.config = config;
    this.decoder = decoder;
    return decoder;
  }

  private onOutput(frame: VideoFrame): void {
    if (this.closed) {
      frame.close();
      return;
    }
    let i = this.buffer.length;
    while (i > 0 && (this.buffer[i - 1] as VideoFrame).timestamp > frame.timestamp) i--;
    this.buffer.splice(i, 0, frame);
    this.prune(this.pruneTargetUs);
    this.changes.pulse();
  }

  /** Close frames superseded by a later frame that is still ≤ target. */
  private prune(targetUs: number): void {
    while (this.buffer.length >= 2 && (this.buffer[1] as VideoFrame).timestamp <= targetUs) {
      (this.buffer.shift() as VideoFrame).close();
      this.stats.framesDiscarded++;
    }
  }

  private closeBuffer(): void {
    for (const f of this.buffer) f.close();
    this.buffer = [];
  }

  private async flush(decoder: VideoDecoderLike): Promise<void> {
    try {
      await decoder.flush();
    } catch (e) {
      this.check();
      throw e;
    }
    this.flushed = true;
  }

  private async seek(targetUs: number): Promise<void> {
    const decoder = this.decoder as VideoDecoderLike;
    this.closeBuffer();
    decoder.reset();
    decoder.configure(this.config as VideoDecoderConfig);
    this.flushed = false;
    this.pruneTargetUs = targetUs;
    this.stats.seeks++;
    this.nextPacket = await this.opts.source.keyPacketAt(targetUs);
    this.check();
    if (this.nextPacket === null) this.flushed = true;
  }
}
