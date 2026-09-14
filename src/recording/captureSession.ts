import { type ChunkPump, createChunkPump } from "./chunkPump";
import {
  type CaptureFps,
  type DesktopConstraintOptions,
  type Platform,
  type WebcamQuality,
  buildDesktopConstraints,
  buildMicConstraints,
  buildSystemAudioConstraints,
  buildWebcamConstraints,
  sourcePixelSize,
} from "./constraints";
import {
  type IsTypeSupported,
  MIC_BITRATE,
  SYSTEM_AUDIO_BITRATE,
  TIMESLICE_MS,
  WEBCAM_BITRATE,
  negotiateAudioMime,
  negotiateVideoMime,
  videoBitrate,
} from "./encoding";
import type {
  AudioContextFactory,
  GetUserMedia,
  MediaRecorderLike,
  MediaStreamLike,
  RecorderFactory,
  StreamFactory,
} from "./media";
import { type FrameScheduler, type MicMeter, createMicMeter } from "./micMeter";
import { type RecordingError, type RecordingPort, type TrackKind, toRecordingError } from "./port";

/**
 * Electron capture backend, renderer side (ENGINEERING_SPEC §5.2): acquires the
 * desktop / mic / system / webcam streams, runs one MediaRecorder per track and
 * streams chunks to main through the RecordingPort.
 */

export interface CaptureDeps {
  getUserMedia: GetUserMedia;
  createRecorder: RecorderFactory;
  createStream: StreamFactory;
  isTypeSupported: IsTypeSupported;
  port: RecordingPort;
  /** Monotonic ms (performance.now). */
  now: () => number;
  /** performance.timeOrigin, to turn `now()` into epoch ms for telemetry alignment. */
  timeOrigin: number;
  /** Needed only for the mic meter. */
  createAudioContext?: AudioContextFactory | undefined;
  scheduleFrame?: FrameScheduler | undefined;
  onMicLevel?: ((level: number) => void) | undefined;
  onDeviceLost?: ((track: TrackKind) => void) | undefined;
  onError?: ((error: RecordingError, track: TrackKind) => void) | undefined;
}

export interface CaptureOptions {
  sessionId: string;
  platform: Platform;
  desktop: DesktopConstraintOptions;
  fps: CaptureFps;
  mic?: { deviceId?: string | undefined } | undefined;
  systemAudio: boolean;
  webcam?: { deviceId?: string | undefined; quality?: WebcamQuality | undefined } | undefined;
}

export interface CaptureTiming {
  /** Epoch ms right before MediaRecorder.start. */
  recorderStartEpochMs: number;
  /** Epoch ms of the first non-empty video `dataavailable`; null until it arrives. */
  firstDataEpochMs: number | null;
  /** Monotonic (epoch) ranges while paused. */
  pausedRanges: { startEpochMs: number; endEpochMs: number | null }[];
}

export interface TrackSummary {
  track: TrackKind;
  mimeType: string;
  chunkCount: number;
}

export interface StopResult {
  tracks: TrackSummary[];
  timing: CaptureTiming;
  errors: { track: TrackKind; error: RecordingError }[];
}

export type CaptureState = "recording" | "paused" | "stopping" | "stopped" | "discarded";

export interface CaptureSession {
  readonly state: CaptureState;
  /** Non-fatal limitations (e.g. system audio unsupported on macOS). Reason codes. */
  readonly warnings: readonly string[];
  readonly tracks: readonly TrackKind[];
  timing(): CaptureTiming;
  pause(): void;
  resume(): void;
  stop(): Promise<StopResult>;
  discard(): Promise<void>;
}

export const SYSTEM_AUDIO_UNAVAILABLE = "system-audio-unavailable";
export const NO_SUPPORTED_MIME = "no-supported-mime";
const FALLBACK_SIZE = { width: 1920, height: 1080 };

interface ActiveTrack {
  kind: TrackKind;
  stream: MediaStreamLike;
  mimeType: string;
  recorder: MediaRecorderLike | null;
  pump: ChunkPump;
  stopped: Promise<void>;
  unsubscribes: (() => void)[];
}

function stopStream(stream: MediaStreamLike): void {
  for (const t of stream.getTracks()) {
    try {
      t.stop();
    } catch {
      // track already stopped
    }
  }
}

/** Acquire streams and start recording every requested track. */
export async function startCapture(
  deps: CaptureDeps,
  opts: CaptureOptions,
): Promise<CaptureSession> {
  const warnings: string[] = [];
  const acquired: MediaStreamLike[] = [];
  const epoch = (): number => deps.timeOrigin + deps.now();

  const videoMime = negotiateVideoMime(deps.isTypeSupported);
  if (!videoMime) {
    throw { code: NO_SUPPORTED_MIME, message: "MediaRecorder supports no video format" };
  }
  const audioMime = negotiateAudioMime(deps.isTypeSupported);
  const desktopOpts: DesktopConstraintOptions = { ...opts.desktop, fps: opts.fps };

  const streams: { kind: TrackKind; stream: MediaStreamLike; mimeType: string; bps: number }[] = [];
  const pixel = opts.desktop.size
    ? sourcePixelSize(opts.desktop.size, opts.desktop.scaleFactor)
    : FALLBACK_SIZE;

  try {
    // Desktop video (+ loopback audio on win/linux).
    let videoStream: MediaStreamLike | null = null;
    if (opts.systemAudio) {
      const sys = buildSystemAudioConstraints(opts.platform, desktopOpts);
      if (!sys.ok) {
        warnings.push(sys.reason);
      } else if (!audioMime) {
        warnings.push(SYSTEM_AUDIO_UNAVAILABLE);
      } else {
        try {
          const combined = await deps.getUserMedia(sys.constraints);
          acquired.push(combined);
          const audio = combined.getAudioTracks();
          videoStream = deps.createStream(combined.getVideoTracks());
          if (audio.length > 0) {
            streams.push({
              kind: "system",
              stream: deps.createStream(audio),
              mimeType: audioMime,
              bps: SYSTEM_AUDIO_BITRATE,
            });
          } else {
            warnings.push(SYSTEM_AUDIO_UNAVAILABLE);
          }
        } catch {
          // e.g. Linux without PipeWire: fall back to video-only desktop capture.
          warnings.push(SYSTEM_AUDIO_UNAVAILABLE);
        }
      }
    }
    if (!videoStream) {
      videoStream = await deps.getUserMedia(buildDesktopConstraints(desktopOpts));
      acquired.push(videoStream);
    }
    streams.unshift({
      kind: "video",
      stream: videoStream,
      mimeType: videoMime.mimeType,
      bps: videoBitrate(pixel, opts.fps),
    });

    if (opts.mic) {
      if (!audioMime) throw { code: NO_SUPPORTED_MIME, message: "No supported audio format" };
      const mic = await deps.getUserMedia(buildMicConstraints(opts.mic.deviceId));
      acquired.push(mic);
      streams.push({ kind: "mic", stream: mic, mimeType: audioMime, bps: MIC_BITRATE });
    }
    if (opts.webcam) {
      const cam = await deps.getUserMedia(
        buildWebcamConstraints(opts.webcam.deviceId, opts.webcam.quality),
      );
      acquired.push(cam);
      streams.push({
        kind: "webcam",
        stream: cam,
        mimeType: videoMime.mimeType,
        bps: WEBCAM_BITRATE,
      });
    }
  } catch (err) {
    for (const s of acquired) stopStream(s);
    throw toRecordingError(err, "capture-permission-denied");
  }

  const timing: CaptureTiming = {
    recorderStartEpochMs: 0,
    firstDataEpochMs: null,
    pausedRanges: [],
  };
  const errors: { track: TrackKind; error: RecordingError }[] = [];
  let state: CaptureState = "recording";

  const reportError = (track: TrackKind, err: unknown): void => {
    const e = toRecordingError(err);
    errors.push({ track, error: e });
    deps.onError?.(e, track);
  };

  const active: ActiveTrack[] = [];
  let meter: MicMeter | null = null;
  try {
    for (const s of streams) {
      const pump = createChunkPump({
        sessionId: opts.sessionId,
        track: s.kind,
        write: (req) => deps.port.writeChunk(req),
        onError: (err) => reportError(s.kind, err),
      });
      let resolveStopped: () => void = () => {};
      const stopped = new Promise<void>((r) => {
        resolveStopped = r;
      });
      const t: ActiveTrack = {
        kind: s.kind,
        stream: s.stream,
        mimeType: s.mimeType,
        recorder: null,
        pump,
        stopped,
        unsubscribes: [],
      };
      active.push(t);
      const isAudio = s.kind === "mic" || s.kind === "system";
      t.recorder = deps.createRecorder(
        s.stream,
        isAudio
          ? { mimeType: s.mimeType, audioBitsPerSecond: s.bps }
          : { mimeType: s.mimeType, videoBitsPerSecond: s.bps },
        {
          onData: (blob) => {
            if (s.kind === "video" && timing.firstDataEpochMs === null && blob.size > 0) {
              timing.firstDataEpochMs = epoch();
            }
            if (state !== "discarded") pump.push(blob);
          },
          onStop: () => resolveStopped(),
          onError: (err) => reportError(s.kind, err),
        },
      );
      for (const track of s.stream.getTracks()) {
        t.unsubscribes.push(
          track.onEnded(() => {
            if (state === "recording" || state === "paused") deps.onDeviceLost?.(s.kind);
          }),
        );
      }
    }

    const micTrack = active.find((t) => t.kind === "mic");
    if (micTrack && deps.createAudioContext && deps.scheduleFrame && deps.onMicLevel) {
      try {
        meter = createMicMeter({
          stream: micTrack.stream,
          createAudioContext: deps.createAudioContext,
          schedule: deps.scheduleFrame,
          onLevel: deps.onMicLevel,
        });
      } catch {
        // The meter is cosmetic; recording continues without a level.
        meter = null;
      }
    }

    timing.recorderStartEpochMs = epoch();
    for (const t of active) t.recorder?.start(TIMESLICE_MS);
  } catch (err) {
    // Recorder construction/start failed: release everything already acquired.
    state = "discarded";
    for (const t of active) {
      t.pump.abort();
      for (const u of t.unsubscribes) u();
      try {
        if (t.recorder && t.recorder.state !== "inactive") t.recorder.stop();
      } catch {
        // recorder already unusable
      }
    }
    for (const s of acquired) stopStream(s);
    if (meter) await meter.stop().catch(() => {});
    throw toRecordingError(err, "recorder-start-failed");
  }

  const release = async (): Promise<void> => {
    for (const t of active) {
      for (const u of t.unsubscribes) u();
      stopStream(t.stream);
    }
    for (const s of acquired) stopStream(s);
    if (meter) await meter.stop().catch(() => {});
  };

  const stopRecorders = async (): Promise<void> => {
    await Promise.all(
      active.map((t) => {
        if (t.recorder && t.recorder.state !== "inactive") {
          try {
            t.recorder.stop();
          } catch (err) {
            reportError(t.kind, err);
            return Promise.resolve();
          }
          return t.stopped;
        }
        return Promise.resolve();
      }),
    );
  };

  const closePausedRange = (): void => {
    const last = timing.pausedRanges[timing.pausedRanges.length - 1];
    if (last && last.endEpochMs === null) last.endEpochMs = epoch();
  };

  return {
    get state() {
      return state;
    },
    warnings,
    tracks: active.map((t) => t.kind),
    timing: () => ({
      ...timing,
      pausedRanges: timing.pausedRanges.map((r) => ({ ...r })),
    }),
    pause: () => {
      if (state !== "recording") return;
      state = "paused";
      timing.pausedRanges.push({ startEpochMs: epoch(), endEpochMs: null });
      for (const t of active) if (t.recorder?.state === "recording") t.recorder.pause();
      meter?.setPaused(true);
    },
    resume: () => {
      if (state !== "paused") return;
      state = "recording";
      closePausedRange();
      for (const t of active) if (t.recorder?.state === "paused") t.recorder.resume();
      meter?.setPaused(false);
    },
    stop: async () => {
      if (state !== "recording" && state !== "paused") {
        throw { code: "capture-not-active", message: `Cannot stop in state ${state}` };
      }
      closePausedRange();
      state = "stopping";
      await stopRecorders();
      const tracks: TrackSummary[] = [];
      for (const t of active) {
        try {
          await t.pump.flush();
        } catch {
          // Already reported through the pump's onError.
        }
        try {
          // Always end the track (even after a write error) so main closes the
          // file and keeps every chunk that reached disk (§5.6).
          await deps.port.endTrack({
            sessionId: opts.sessionId,
            track: t.kind,
            chunkCount: t.pump.written,
            mimeType: t.mimeType,
          });
        } catch (err) {
          reportError(t.kind, err);
        }
        tracks.push({ track: t.kind, mimeType: t.mimeType, chunkCount: t.pump.written });
      }
      await release();
      state = "stopped";
      return {
        tracks,
        timing: { ...timing, pausedRanges: timing.pausedRanges.map((r) => ({ ...r })) },
        errors: [...errors],
      };
    },
    discard: async () => {
      if (state === "discarded" || state === "stopped") return;
      state = "discarded";
      for (const t of active) t.pump.abort();
      await stopRecorders();
      await release();
    },
  };
}
