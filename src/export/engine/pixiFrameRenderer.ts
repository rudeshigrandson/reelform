import type * as Pixi from "pixi.js";
import type { SceneState } from "../../editor/preview/scene";
import {
  type SceneAssets,
  type SceneGraph,
  type SceneGraphOptions,
  type SceneGraphPixi,
  createSceneGraph,
} from "../../editor/preview/sceneGraph";
import { createPixiSceneAssets, scenePixiFromModule } from "../../editor/preview/scenePixi";
import type { FrameRenderer } from "./frameRenderer";

/**
 * Offscreen Pixi stage for export (§10.1 route 1). Builds its display tree
 * with the same `createSceneGraph` the preview uses (so preview and export
 * cannot drift); it is never attached to the DOM, renders at resolution 1 and
 * uploads `VideoFrame`s as the video texture instead of a <video> element.
 * Async assets (image annotations, wallpapers images, cursor sprites) are
 * awaited before each snapshot so every frame is complete.
 * `pixi.js` is imported lazily so node tests never load it.
 */

export interface PixiFrameRendererOptions {
  width: number;
  height: number;
  preference?: "webgl" | "webgpu" | undefined;
  createVideoFrame?: ((source: HTMLCanvasElement, init: VideoFrameInit) => VideoFrame) | undefined;
  /** Texture / cursor-pack loading; defaults to Pixi Assets + fetch. */
  assets?: SceneAssets | undefined;
  /** `reelform-media://` base for default assets. */
  mediaBaseUrl?: string | null | undefined;
}

export interface PixiFrameRenderer extends FrameRenderer {
  /** Webcam frame for the next `render` (owned and closed by the caller). */
  setWebcamFrame(frame: VideoFrame | null): void;
  /** Cross-dissolve incoming frame for the next `render` (owned and closed by the caller). */
  setNextVideoFrame(frame: VideoFrame | null): void;
}

/** The export's scene graph — the parity test builds this with a fake pixi. */
export function buildExportSceneGraph(
  pixi: SceneGraphPixi,
  options: SceneGraphOptions = {},
): SceneGraph {
  return createSceneGraph(pixi, options);
}

/** Bound on apply → await-assets rounds per frame. */
export const MAX_ASSET_ROUNDS = 4;

interface FrameTex {
  source: Pixi.ImageSource;
  texture: Pixi.Texture;
}

export async function createPixiFrameRenderer(
  opts: PixiFrameRendererOptions,
): Promise<PixiFrameRenderer> {
  const PIXI = await import("pixi.js");
  const makeFrame = opts.createVideoFrame ?? ((source, init) => new VideoFrame(source, init));
  const app = new PIXI.Application();
  await app.init({
    width: Math.max(1, opts.width),
    height: Math.max(1, opts.height),
    preference: opts.preference ?? "webgl",
    background: 0x000000,
    backgroundAlpha: 1,
    antialias: true,
    autoDensity: false,
    resolution: 1,
    autoStart: false,
    preserveDrawingBuffer: true,
  });

  const graph = buildExportSceneGraph(scenePixiFromModule(PIXI), {
    assets: opts.assets ?? createPixiSceneAssets(PIXI, { mediaBaseUrl: opts.mediaBaseUrl }),
  });
  // The port's structural root is a real pixi Container at runtime.
  app.stage.addChild(graph.root as unknown as Pixi.Container);

  let video: FrameTex | null = null;
  let webcam: FrameTex | null = null;
  let next: FrameTex | null = null;
  let destroyed = false;

  const release = (t: FrameTex | null): void => {
    if (!t) return;
    t.texture.destroy(false);
    // The VideoFrame resource is owned (and closed) by the engine.
    t.source.unload();
  };

  /** Reuse the texture while the frame size is stable; rebuild when it changes. */
  function upload(current: FrameTex | null, frame: VideoFrame): FrameTex {
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (current && current.source.pixelWidth === w && current.source.pixelHeight === h) {
      current.source.resource = frame;
      current.source.update();
      return current;
    }
    release(current);
    const source = new PIXI.ImageSource({ resource: frame });
    return { source, texture: new PIXI.Texture({ source }) };
  }

  return {
    setNextVideoFrame(frame) {
      if (destroyed) return;
      if (!frame) {
        graph.setNextVideoTexture(null);
        release(next);
        next = null;
        return;
      }
      const uploaded = upload(next, frame);
      if (uploaded !== next) graph.setNextVideoTexture(uploaded.texture);
      next = uploaded;
    },

    setWebcamFrame(frame) {
      if (destroyed) return;
      if (!frame) {
        graph.setWebcamTexture(null);
        release(webcam);
        webcam = null;
        return;
      }
      const next = upload(webcam, frame);
      if (next !== webcam) graph.setWebcamTexture(next.texture);
      webcam = next;
    },

    async render(state: SceneState, frame: VideoFrame | null) {
      if (destroyed) throw new Error("renderer destroyed");
      if (frame) {
        const next = upload(video, frame);
        if (next !== video) graph.setVideoTexture(next.texture);
        video = next;
      }
      const renderState: SceneState = frame
        ? state
        : { ...state, video: { ...state.video, visible: false } };
      graph.apply(renderState);
      // A settled load can request another (cursor pack → its sprite texture).
      for (let i = 0; i < MAX_ASSET_ROUNDS && graph.hasPendingAssets(); i++) {
        await graph.whenIdle();
        if (destroyed) throw new Error("renderer destroyed");
        graph.apply(renderState);
      }
      app.render();
      // Snapshot synchronously, before the source frame is closed.
      return makeFrame(app.canvas, { timestamp: Math.round(state.tMs * 1000) });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      graph.setVideoTexture(null);
      graph.setWebcamTexture(null);
      graph.setNextVideoTexture(null);
      release(video);
      release(webcam);
      release(next);
      graph.destroy();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
