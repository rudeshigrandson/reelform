import type { SceneState } from "../../editor/preview/scene";
import type { ExportConfig } from "../route";
import {
  type AudioBufferLike,
  type AudioEncoderLike,
  type AudioPlan,
  chooseAudioPlan,
  encodeAudioBuffer,
  encodeWav,
} from "./audio";
import { ExportCancelledError, Pulse, throwIfAborted } from "./cancel";
import {
  ExportConfigError,
  resolveVideoEncoderConfig,
  validateExportConfig,
} from "./encoderConfig";
import { type FramePlan, type FramePlanInput, createFramePlan } from "./framePlan";
import type { FrameRenderer } from "./frameRenderer";
import type { CreateExportMuxer, ExportMuxer, ExportSink } from "./muxer";
import { type EncoderKind, type ExportProgress, ProgressTracker } from "./progress";
import type { FrameSource } from "./streamingDecoder";

/**
 * WebCodecs export engine (ENGINEERING_SPEC §10.1 routes 1 & 3, §10.3, §10.7).
 *
 * For each output frame: evaluate the scene at its timeline time, fetch the
 * nearest decoded source frame, render, close the source frame, re-stamp the
 * render with the output timestamp (µs), encode, close. Encoded chunks stream
 * through the muxer into the `ExportSink`. A hardware encoder that is rejected
 * at probe time falls back to software in place; one that errors mid-export
 * restarts the whole export on the software encoder (no partial resume).
 */

export const MAX_ENCODE_QUEUE = 8;
/** Bound on encoded chunks waiting for the muxer / sink (IPC backpressure). */
export const MAX_PENDING_MUX = 32;

/** The subset of `VideoEncoder` the engine uses (fakeable in tests). */
export interface VideoEncoderLike {
  readonly state: CodecState;
  readonly encodeQueueSize: number;
  configure(config: VideoEncoderConfig): void;
  encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions): void;
  flush(): Promise<void>;
  close(): void;
  addEventListener(type: "dequeue", listener: () => void): void;
}

/** Injected WebCodecs surface — real globals in the renderer, fakes in tests. */
export interface WebCodecsApi {
  isVideoConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
  createVideoEncoder(init: VideoEncoderInit): VideoEncoderLike;
  isAudioConfigSupported(config: AudioEncoderConfig): Promise<AudioEncoderSupport>;
  createAudioEncoder(init: AudioEncoderInit): AudioEncoderLike;
  createVideoFrame(image: VideoFrame | ImageBitmap, init: VideoFrameInit): VideoFrame;
  createAudioData(init: AudioDataInit): AudioData;
}

export interface ExportJob {
  config: ExportConfig;
  /** Clips / speeds / range / source fps; the output fps comes from `config`. */
  timeline: Omit<FramePlanInput, "fps">;
  /** Scene at a timeline time (see `createSceneEvaluator`). */
  sceneAt(timelineMs: number): SceneState;
  /** Already-rendered timeline audio, or null for a silent export. */
  audio?: AudioBufferLike | null | undefined;
  /** False when `selectRoute` chose `software-fallback`. */
  preferHardware: boolean;
}

export interface ExportEngineDeps {
  webcodecs: WebCodecsApi;
  /** Opens a fresh decoder for the source (called at most once per attempt). */
  openFrameSource(): Promise<FrameSource>;
  renderer: FrameRenderer;
  createMuxer: CreateExportMuxer;
  sink: ExportSink;
  /** Wall clock for progress/ETA only (never affects output). */
  now(): number;
}

export interface RunExportOptions {
  signal?: AbortSignal | undefined;
  onProgress?: ((progress: ExportProgress) => void) | undefined;
}

export interface ExportResult {
  path: string;
  encoder: EncoderKind;
  attempts: number;
  framesEncoded: number;
  audio: AudioPlan["kind"] | "none";
  /** PCM WAV to be muxed as AAC by the ffmpeg finalize step; null otherwise. */
  pcmWav: Uint8Array | null;
}

/** A video encoder failure; hardware failures trigger the software restart. */
export class EncoderFailure extends Error {
  override name = "EncoderFailure";
  constructor(
    readonly encoder: EncoderKind,
    cause: unknown,
  ) {
    super(
      `${encoder} video encoder failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
      },
    );
  }
}

export async function runExport(
  job: ExportJob,
  deps: ExportEngineDeps,
  options: RunExportOptions = {},
): Promise<ExportResult> {
  validateExportConfig(job.config);
  const plan = createFramePlan({ ...job.timeline, fps: job.config.fps });
  if (plan.totalFrames === 0) throw new ExportConfigError("export range is empty");
  throwIfAborted(options.signal);
  try {
    return await attemptExport(job, deps, plan, options, job.preferHardware, 1);
  } catch (e) {
    if (options.signal?.aborted) throw new ExportCancelledError();
    if (e instanceof EncoderFailure && e.encoder === "hardware") {
      return attemptExport(job, deps, plan, options, false, 2);
    }
    throw e;
  }
}

async function attemptExport(
  job: ExportJob,
  deps: ExportEngineDeps,
  plan: FramePlan,
  options: RunExportOptions,
  allowHardware: boolean,
  attempt: number,
): Promise<ExportResult> {
  const { webcodecs: wc, sink, renderer } = deps;
  const { signal } = options;
  const { config } = job;
  const changes = new Pulse();
  const progress = new ProgressTracker({
    framesTotal: plan.totalFrames,
    fps: config.fps,
    now: deps.now,
    encoder: allowHardware ? "hardware" : "software",
    onProgress: options.onProgress,
  });

  let encoderKind: EncoderKind = allowHardware ? "hardware" : "software";
  let frames: FrameSource | null = null;
  let encoder: VideoEncoderLike | null = null;
  let muxer: ExportMuxer | null = null;
  let sinkOpen = false;
  let failure: unknown = null;
  let pendingMux = 0;
  let muxChain: Promise<void> = Promise.resolve();
  let framesEncoded = 0;

  const closeEncoder = (): void => {
    if (encoder && encoder.state !== "closed") {
      try {
        encoder.close();
      } catch {
        // Already closed.
      }
    }
  };
  const closeFrames = (): void => {
    frames?.close();
    frames = null;
  };
  const onAbort = (): void => {
    closeFrames();
    closeEncoder();
    changes.pulse();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const check = (): void => {
    if (signal?.aborted) throw new ExportCancelledError();
    if (failure !== null) throw failure;
  };
  const enqueueMux = (write: (m: ExportMuxer) => Promise<void>): void => {
    const m = muxer as ExportMuxer;
    pendingMux++;
    muxChain = muxChain
      .then(() => (failure === null && !signal?.aborted ? write(m) : undefined))
      .catch((e: unknown) => {
        failure ??= e;
      })
      .finally(() => {
        pendingMux--;
        changes.pulse();
      });
  };

  try {
    progress.setPhase("preparing");
    const videoConfig = await resolveVideoEncoderConfig(
      config,
      { isConfigSupported: (c) => wc.isVideoConfigSupported(c) },
      allowHardware,
    );
    encoderKind = videoConfig.hardwareAcceleration === "prefer-hardware" ? "hardware" : "software";
    progress.setEncoder(encoderKind);
    check();

    const audioIn = job.audio ?? null;
    const audioPlan: AudioPlan | null =
      audioIn && audioIn.length > 0
        ? await chooseAudioPlan(config.container, wc, audioIn.sampleRate, audioIn.numberOfChannels)
        : null;
    check();

    await sink.begin({
      container: config.container,
      codec: config.codec,
      width: config.width,
      height: config.height,
      fps: config.fps,
      encoder: encoderKind,
    });
    sinkOpen = true;
    check();

    const muxAudio =
      audioIn && audioPlan && audioPlan.kind !== "pcm-wav"
        ? {
            codec: audioPlan.kind,
            sampleRate: audioIn.sampleRate,
            numberOfChannels: audioIn.numberOfChannels,
          }
        : null;
    muxer = deps.createMuxer(
      {
        container: config.container,
        videoCodec: config.codec,
        fps: config.fps,
        audio: muxAudio,
        maximumVideoPackets: plan.totalFrames,
        maximumAudioPackets: audioIn ? Math.ceil(audioIn.length / 480) + 64 : undefined,
        colorSpace: videoConfig.colorSpace,
      },
      sink,
    );
    await muxer.start();
    check();

    // Audio is encoded BEFORE video. mediabunny (MP4 fast-start and WebM)
    // queues every packet in memory until each track has produced one, so
    // encoding audio last would buffer the whole encoded video in RAM
    // (§10.8 memory bound). Encoded audio is small (192 kbps).
    let pcmWav: Uint8Array | null = null;
    if (audioIn && audioPlan) {
      progress.setPhase("encoding-audio");
      if (audioPlan.kind === "pcm-wav") {
        pcmWav = encodeWav(audioIn);
      } else {
        await encodeAudioBuffer(audioIn, audioPlan.config, {
          createEncoder: (init) => wc.createAudioEncoder(init),
          createAudioData: (init) => wc.createAudioData(init),
          onChunk: (chunk, meta) => enqueueMux((m) => m.addAudioChunk(chunk, meta)),
          signal,
        });
      }
      check();
    }

    const enc = wc.createVideoEncoder({
      output: (chunk, meta) => {
        framesEncoded++;
        // §10.7: progress counts frames the encoder has actually produced.
        progress.frameDone();
        enqueueMux((m) => m.addVideoChunk(chunk, meta));
      },
      error: (e) => {
        failure ??= new EncoderFailure(encoderKind, e);
        changes.pulse();
      },
    });
    encoder = enc;
    enc.addEventListener("dequeue", changes.pulse);
    try {
      enc.configure(videoConfig);
    } catch (e) {
      throw new EncoderFailure(encoderKind, e);
    }

    progress.setPhase("rendering");
    for (let i = 0; i < plan.totalFrames; i++) {
      check();
      while (enc.encodeQueueSize >= MAX_ENCODE_QUEUE || pendingMux >= MAX_PENDING_MUX) {
        await changes.wait();
        check();
      }
      const pf = plan.frameAt(i);
      const state = job.sceneAt(pf.timelineMs);
      let source: VideoFrame | null = null;
      let rendered: VideoFrame | ImageBitmap;
      try {
        if (pf.sourceMs !== null && state.video.visible) {
          frames ??= await deps.openFrameSource();
          check();
          source = await frames.frameAt(pf.sourceMs);
        }
        check();
        rendered = await renderer.render(state, source);
      } finally {
        source?.close();
      }
      let out: VideoFrame;
      try {
        out = wc.createVideoFrame(rendered, {
          timestamp: pf.timestampUs,
          duration: pf.durationUs,
        });
      } finally {
        rendered.close();
      }
      try {
        check();
        enc.encode(out, { keyFrame: pf.keyFrame });
      } catch (e) {
        if (e instanceof ExportCancelledError || failure !== null) throw e;
        throw new EncoderFailure(encoderKind, e);
      } finally {
        out.close();
      }
    }

    try {
      await enc.flush();
    } catch (e) {
      check();
      throw new EncoderFailure(encoderKind, e);
    }
    check();
    closeEncoder();
    closeFrames();

    progress.setPhase("muxing");
    await muxChain;
    check();
    const finishing = muxer;
    await finishing.finalize();
    muxer = null;
    check();

    progress.setPhase("finalizing");
    const { path } = await sink.finish();
    sinkOpen = false;
    return {
      path,
      encoder: encoderKind,
      attempts: attempt,
      framesEncoded,
      audio: audioPlan?.kind ?? "none",
      pcmWav,
    };
  } catch (e) {
    closeFrames();
    closeEncoder();
    if (muxer) await muxer.cancel().catch(() => undefined);
    if (sinkOpen) await sink.cancel().catch(() => undefined);
    if (signal?.aborted) throw new ExportCancelledError();
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
