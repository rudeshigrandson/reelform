import { createComposedSceneEvaluator } from "../../editor/preview/compose";
import type { SceneState } from "../../editor/preview/scene";
import { ExportCancelledError } from "../../export/engine/cancel";
import { ExportConfigError } from "../../export/engine/encoderConfig";
import { createFramePlan } from "../../export/engine/framePlan";
import type { FrameRenderer } from "../../export/engine/frameRenderer";
import { ProgressTracker } from "../../export/engine/progress";
import type { FrameSource } from "../../export/engine/streamingDecoder";
import { type GifWorkerLike, createGifEncoderClient } from "../../export/gif/client";
import { sampleFrameIndices } from "../../export/gif/palette";
import type { RgbaFrame } from "../../export/gif/types";
import type { GifRouteArgs, GifRouteResult } from "./runner";
import type { TimelineSnapshot } from "./videoRoute";

/**
 * GIF route (§10.6): render each output frame with the export renderer, read
 * RGBA, and stream it through the GIF worker into the same file sink. Palette
 * samples (10% of frames) are fed first unless the palette is adaptive.
 */

export interface GifRouteDeps {
  timeline: TimelineSnapshot;
  createWorker: () => GifWorkerLike;
  openFrameSource: () => Promise<FrameSource>;
  createRenderer: (size: { width: number; height: number }) => Promise<FrameRenderer>;
  /** Pixels of a rendered image at the output size (the caller closes the image). */
  readPixels: (
    image: VideoFrame | ImageBitmap,
    width: number,
    height: number,
  ) => Promise<RgbaFrame>;
  now(): number;
}

/** OffscreenCanvas readback (renderer-only glue). */
export async function readPixelsOffscreen(
  image: VideoFrame | ImageBitmap,
  width: number,
  height: number,
): Promise<RgbaFrame> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable for GIF readback");
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

export function createGifRoute(deps: GifRouteDeps) {
  return async (args: GifRouteArgs): Promise<GifRouteResult> => {
    const { options, range, sink, signal } = args;
    const { timeline } = deps;
    const plan = createFramePlan({
      clips: timeline.clips,
      speeds: timeline.speeds,
      range,
      sourceFps: timeline.sourceFps,
      fps: options.fps,
    });
    if (plan.totalFrames === 0) throw new ExportConfigError("export range is empty");
    if (signal.aborted) throw new ExportCancelledError();

    let estimatedBytes: number | null = null;
    const tracker = new ProgressTracker({
      framesTotal: plan.totalFrames,
      fps: options.fps,
      now: deps.now,
      encoder: "software",
      onProgress: (p) => args.onProgress(p, estimatedBytes),
    });
    tracker.setPhase("preparing");

    const size = { width: options.width, height: options.height };
    // Built on first use, i.e. after `timeline.prepare` settled async inputs.
    let evaluate: ((timelineMs: number) => SceneState) | null = null;
    const sceneAt = (timelineMs: number): SceneState => {
      evaluate ??= createComposedSceneEvaluator(
        timeline.sceneInput(size, { fps: options.fps, burnInCaptions: args.burnInCaptions }),
      );
      return evaluate(timelineMs);
    };
    let frames: FrameSource | null = null;
    let renderer: FrameRenderer | null = null;
    let sinkOpen = false;
    const client = createGifEncoderClient({
      createWorker: deps.createWorker,
      onChunk: (bytes) => sink.writeChunk(bytes),
      onProgress: (m) => {
        estimatedBytes = m.estimatedBytes;
      },
    });
    const onAbort = (): void => client.cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    const check = (): void => {
      if (signal.aborted) throw new ExportCancelledError();
    };

    const renderAt = async (index: number): Promise<RgbaFrame> => {
      const pf = plan.frameAt(index);
      const state = sceneAt(pf.timelineMs);
      let source: VideoFrame | null = null;
      let image: VideoFrame | ImageBitmap;
      try {
        if (pf.sourceMs !== null && state.video.visible) {
          frames ??= await deps.openFrameSource();
          check();
          source = await frames.frameAt(pf.sourceMs);
        }
        check();
        image = await (renderer as FrameRenderer).render(state, source);
      } finally {
        source?.close();
      }
      try {
        return await deps.readPixels(image, size.width, size.height);
      } finally {
        image.close();
      }
    };

    try {
      await timeline.prepare?.(signal);
      check();
      await sink.begin({ container: "gif" });
      sinkOpen = true;
      check();
      renderer = await deps.createRenderer(size);
      check();
      client.init({ ...options, totalFrames: plan.totalFrames });

      if (!options.adaptivePalette) {
        for (const i of sampleFrameIndices(plan.totalFrames)) {
          check();
          client.addSample(await renderAt(i));
        }
      }

      tracker.setPhase("rendering");
      for (let i = 0; i < plan.totalFrames; i++) {
        check();
        await client.addFrame(await renderAt(i));
        tracker.frameDone();
      }
      tracker.setPhase("finalizing");
      const done = await client.finish();
      check();
      const { path } = await sink.finish();
      sinkOpen = false;
      return { path, bytes: done.totalBytes, frames: done.frames };
    } catch (e) {
      client.cancel();
      if (sinkOpen) await sink.cancel().catch(() => undefined);
      if (signal.aborted) throw new ExportCancelledError();
      throw e;
    } finally {
      signal.removeEventListener("abort", onAbort);
      (frames as FrameSource | null)?.close();
      renderer?.destroy();
    }
  };
}
