import { UrlSource } from "mediabunny";
import type { Clip } from "../../editor/model/schema";
import type { RateRegion } from "../../editor/playback/clock";
import { type ComposeInput, createComposedSceneEvaluator } from "../../editor/preview/compose";
import type { AudioBlockSource } from "../../export/engine/audio";
import {
  type ExportEngineDeps,
  type ExportJob,
  type WebCodecsApi,
  runExport as defaultRunExport,
} from "../../export/engine/engine";
import { createFramePlan } from "../../export/engine/framePlan";
import type { FrameRenderer } from "../../export/engine/frameRenderer";
import { openVideoSource } from "../../export/engine/mediabunnySource";
import { type CreateExportMuxer, createMediabunnyMuxer } from "../../export/engine/muxer";
// Owned by the preview workstream (being refactored); only its exported factory is used.
import { createPixiFrameRenderer } from "../../export/engine/pixiFrameRenderer";
import {
  type FrameSource,
  StreamingDecoder,
  WEBCAM_DECODER_WINDOW,
  screenDecoderWindow,
} from "../../export/engine/streamingDecoder";
import { TRANSITION_DECODER_WINDOW } from "../../export/engine/transitionFeed";
import { browserVideoDecoder, browserWebCodecs } from "../../export/engine/webcodecsGlobals";
import type { TimeRange } from "./config";
import type { VideoRouteArgs, VideoRouteResult } from "./runner";

/**
 * MP4 / WebM route (§10.1 routes 1 & 3): timeline audio mixdown, then
 * `runExport` over WebCodecs + mediabunny demux/mux + the offscreen Pixi
 * renderer, streaming into the injected sink. Every browser-bound factory is
 * overridable so the wiring runs against the engine fakes in tests.
 */

export interface TimelineSnapshot {
  clips: readonly Clip[];
  speeds: readonly RateRegion[];
  sourceFps?: number | undefined;
  /**
   * Full composition input (base scene + annotations, captions, webcam, title
   * cards, cursor fx, color) for an output canvas — the same `composeScene`
   * the preview renders, so preview and export cannot drift.
   */
  sceneInput(size: { width: number; height: number }, options: SceneOptions): ComposeInput;
  /** Async inputs (e.g. the wallpaper manifest) to settle before the first frame. */
  prepare?: ((signal: AbortSignal) => Promise<void>) | undefined;
  /**
   * Webcam track composited into the bubble; null/omitted when the project has
   * no webcam or it is disabled (the scene input then has `hasWebcam: false`).
   */
  webcam?: WebcamTrack | null | undefined;
}

export interface WebcamTrack {
  url: string;
  /** `WebcamSettings.syncOffsetMs`, added to the webcam source time. */
  syncOffsetMs: number;
}

/** Decoder window for a frame source (§10.8 budget shared by screen + webcam). */
export interface FrameSourceOptions {
  maxWindow: number;
}

export interface SceneOptions {
  /** Output fps (seeds grain). */
  fps: number;
  /** Draw the caption layer into the frames. */
  burnInCaptions: boolean;
}

export interface RenderAudioArgs {
  range: TimeRange;
  /** Output duration of the frame plan (audio must match it exactly). */
  outputDurationMs: number;
  signal: AbortSignal;
}

export interface VideoRouteDeps {
  timeline: TimelineSnapshot;
  videoUrl: string;
  /** Lazy timeline mixdown (rendered block by block while it is encoded). */
  renderAudio(args: RenderAudioArgs): Promise<AudioBlockSource | null>;
  now(): number;
  /** `reelform-media://` base for the renderer's default assets (images, cursor packs). */
  mediaBaseUrl?: string | null | undefined;
  webcodecs?: (() => WebCodecsApi) | undefined;
  openFrameSource?: ((options: FrameSourceOptions) => Promise<FrameSource>) | undefined;
  /** Webcam decoder for `timeline.webcam`; defaults to a URL StreamingDecoder. */
  openWebcamSource?:
    | ((track: WebcamTrack, options: FrameSourceOptions) => Promise<FrameSource>)
    | undefined;
  createRenderer?:
    | ((size: { width: number; height: number }) => Promise<FrameRenderer>)
    | undefined;
  createMuxer?: CreateExportMuxer | undefined;
  runExport?: typeof defaultRunExport | undefined;
}

/** StreamingDecoder over a mediabunny URL input; `close` also disposes the demuxer. */
export async function openUrlFrameSource(
  url: string,
  options?: FrameSourceOptions | undefined,
): Promise<FrameSource> {
  const opened = await openVideoSource(new UrlSource(url));
  const decoder = new StreamingDecoder({
    source: opened.packets,
    createDecoder: browserVideoDecoder,
    maxWindow: options?.maxWindow,
  });
  return {
    frameAt: (ms) => decoder.frameAt(ms),
    close: () => {
      decoder.close();
      opened.dispose();
    },
  };
}

export function createVideoRoute(deps: VideoRouteDeps) {
  return async (args: VideoRouteArgs): Promise<VideoRouteResult> => {
    const { config, range, signal } = args;
    const { timeline } = deps;
    const webcam = timeline.webcam ?? null;
    const plan = createFramePlan({
      clips: timeline.clips,
      speeds: timeline.speeds,
      range,
      sourceFps: timeline.sourceFps,
      fps: config.fps,
    });

    const audio =
      args.includeAudio && plan.totalFrames > 0
        ? await deps.renderAudio({ range, outputDurationMs: plan.outputDurationMs, signal })
        : null;

    await timeline.prepare?.(signal);
    const size = { width: config.width, height: config.height };
    const renderer = await (
      deps.createRenderer ??
      ((s) => createPixiFrameRenderer({ ...s, mediaBaseUrl: deps.mediaBaseUrl ?? null }))
    )(size);
    try {
      const job: ExportJob = {
        config,
        timeline: {
          clips: timeline.clips,
          speeds: timeline.speeds,
          range,
          sourceFps: timeline.sourceFps,
        },
        sceneAt: createComposedSceneEvaluator(
          timeline.sceneInput(size, { fps: config.fps, burnInCaptions: args.burnInCaptions }),
        ),
        audio,
        preferHardware: args.preferHardware,
        webcam: webcam ? { syncOffsetMs: webcam.syncOffsetMs } : null,
      };
      const screenWindow = { maxWindow: screenDecoderWindow(webcam !== null) };
      const openWebcam = deps.openWebcamSource ?? ((t, o) => openUrlFrameSource(t.url, o));
      const engineDeps: ExportEngineDeps = {
        webcodecs: (deps.webcodecs ?? browserWebCodecs)(),
        openFrameSource: () =>
          (deps.openFrameSource ?? ((o) => openUrlFrameSource(deps.videoUrl, o)))(screenWindow),
        openWebcamSource: webcam
          ? () => openWebcam(webcam, { maxWindow: WEBCAM_DECODER_WINDOW })
          : undefined,
        // Cross-dissolve incoming frames come from their own small decoder so the
        // main screen decoder keeps streaming forward.
        openNextFrameSource: () =>
          (deps.openFrameSource ?? ((o) => openUrlFrameSource(deps.videoUrl, o)))({
            maxWindow: TRANSITION_DECODER_WINDOW,
          }),
        renderer,
        createMuxer: deps.createMuxer ?? createMediabunnyMuxer,
        sink: args.sink,
        now: deps.now,
      };
      const result = await (deps.runExport ?? defaultRunExport)(job, engineDeps, {
        signal,
        onProgress: args.onProgress,
        onWarning: args.onWarning,
      });
      return {
        path: result.path,
        encoder: result.encoder,
        attempts: result.attempts,
        pcmAudio: result.pcmAudio,
      };
    } finally {
      renderer.destroy();
    }
  };
}
