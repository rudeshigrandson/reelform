import { UrlSource } from "mediabunny";
import type { Clip } from "../../editor/model/schema";
import type { RateRegion } from "../../editor/playback/clock";
import { type ComposeInput, createComposedSceneEvaluator } from "../../editor/preview/compose";
import type { AudioBufferLike } from "../../export/engine/audio";
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
import { type FrameSource, StreamingDecoder } from "../../export/engine/streamingDecoder";
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
  renderAudio(args: RenderAudioArgs): Promise<AudioBufferLike | null>;
  now(): number;
  /** `reelform-media://` base for the renderer's default assets (images, cursor packs). */
  mediaBaseUrl?: string | null | undefined;
  webcodecs?: (() => WebCodecsApi) | undefined;
  openFrameSource?: (() => Promise<FrameSource>) | undefined;
  createRenderer?:
    | ((size: { width: number; height: number }) => Promise<FrameRenderer>)
    | undefined;
  createMuxer?: CreateExportMuxer | undefined;
  runExport?: typeof defaultRunExport | undefined;
}

/** StreamingDecoder over a mediabunny URL input; `close` also disposes the demuxer. */
export async function openUrlFrameSource(url: string): Promise<FrameSource> {
  const opened = await openVideoSource(new UrlSource(url));
  const decoder = new StreamingDecoder({
    source: opened.packets,
    createDecoder: browserVideoDecoder,
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
      };
      const engineDeps: ExportEngineDeps = {
        webcodecs: (deps.webcodecs ?? browserWebCodecs)(),
        openFrameSource: deps.openFrameSource ?? (() => openUrlFrameSource(deps.videoUrl)),
        renderer,
        createMuxer: deps.createMuxer ?? createMediabunnyMuxer,
        sink: args.sink,
        now: deps.now,
      };
      const result = await (deps.runExport ?? defaultRunExport)(job, engineDeps, {
        signal,
        onProgress: args.onProgress,
      });
      return {
        path: result.path,
        encoder: result.encoder,
        attempts: result.attempts,
        pcmWav: result.pcmWav,
      };
    } finally {
      renderer.destroy();
    }
  };
}
