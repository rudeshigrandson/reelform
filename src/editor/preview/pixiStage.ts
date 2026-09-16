import type * as Pixi from "pixi.js";
import type { SceneState } from "./scene";
import {
  type SceneAssets,
  type SceneGraph,
  type SceneGraphOptions,
  type SceneGraphPixi,
  createSceneGraph,
} from "./sceneGraph";
import { createPixiSceneAssets, scenePixiFromModule } from "./scenePixi";

/**
 * Imperative Pixi adapter for the preview canvas (§6.3/§6.4). The display
 * tree comes from the shared `createSceneGraph` (the export renderer builds
 * the same one); this file only owns the Pixi application, the <video>
 * textures and the render calls. `pixi.js` is imported lazily so tests /
 * jsdom never load it.
 */

export interface PreviewStage {
  /** Attach (or detach with null) the hidden <video> used as the frame source. */
  setVideo(el: HTMLVideoElement | null): void;
  render(state: SceneState): void;
  resize(width: number, height: number): void;
  destroy(): void;
  /** Attach the hidden <video> parked on the incoming clip's first frame (cross-dissolve). */
  setNextVideo?: ((el: HTMLVideoElement | null) => void) | undefined;
  /** Attach the hidden webcam <video> (optional for fakes). */
  setWebcam?: ((el: HTMLVideoElement | null) => void) | undefined;
  /** A new video frame was presented (requestVideoFrameCallback): re-upload and redraw. */
  refreshVideo?: (() => void) | undefined;
  /** Render resolution (device px per CSS px) for preview quality. */
  setResolution?: ((resolution: number) => void) | undefined;
}

export interface PreviewStageOptions {
  width: number;
  height: number;
  resolution?: number | undefined;
  preference?: "webgpu" | "webgl" | undefined;
  /** Texture / cursor-pack loading; defaults to Pixi Assets + fetch. */
  assets?: SceneAssets | undefined;
  /** `reelform-media://` base for default assets. */
  mediaBaseUrl?: string | null | undefined;
}

export type CreatePreviewStage = (
  host: HTMLElement,
  opts: PreviewStageOptions,
) => Promise<PreviewStage>;

/** The preview's scene graph — the parity test builds this with a fake pixi. */
export function buildPreviewSceneGraph(
  pixi: SceneGraphPixi,
  options: SceneGraphOptions = {},
): SceneGraph {
  return createSceneGraph(pixi, options);
}

interface VideoTex {
  source: Pixi.VideoSource;
  texture: Pixi.Texture;
}

function makeVideoTexture(PIXI: typeof Pixi, el: HTMLVideoElement): VideoTex {
  const source = new PIXI.VideoSource({ resource: el, autoPlay: false, autoLoad: true });
  return { source, texture: new PIXI.Texture({ source }) };
}

function releaseVideoTexture(v: VideoTex | null): void {
  if (!v) return;
  // Never call source.destroy(): VideoSource.destroy clears the element's
  // src, and the <video> is owned by React. Unload GPU data and detach.
  v.source.autoUpdate = false;
  v.source.unload();
  v.texture.destroy(false);
}

export const createPixiStage: CreatePreviewStage = async (host, opts) => {
  const PIXI = await import("pixi.js");
  // The renderer CSP has no 'unsafe-eval' (SPEC §13); this swaps Pixi's
  // runtime-generated shader/uniform code for precompiled paths.
  await import("pixi.js/unsafe-eval");
  const app = new PIXI.Application();
  await app.init({
    width: Math.max(1, opts.width),
    height: Math.max(1, opts.height),
    preference: opts.preference ?? "webgpu",
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: opts.resolution ?? globalThis.devicePixelRatio ?? 1,
    autoStart: false,
  });
  app.canvas.style.display = "block";
  host.appendChild(app.canvas);

  let destroyed = false;
  let last: SceneState | null = null;
  let frameQueued = false;
  const redraw = (): void => {
    if (destroyed || !last) return;
    graph.apply(last);
    app.render();
  };
  // Coalesce asset / video-frame redraws into one per animation frame.
  const queueRedraw = (): void => {
    if (frameQueued || destroyed) return;
    frameQueued = true;
    const raf =
      globalThis.requestAnimationFrame ??
      ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
    raf(() => {
      frameQueued = false;
      redraw();
    });
  };

  const graph = buildPreviewSceneGraph(scenePixiFromModule(PIXI), {
    assets: opts.assets ?? createPixiSceneAssets(PIXI, { mediaBaseUrl: opts.mediaBaseUrl }),
    onAssetLoaded: queueRedraw,
  });
  // The port's structural root is a real pixi Container at runtime.
  app.stage.addChild(graph.root as unknown as Pixi.Container);

  let video: VideoTex | null = null;
  let webcam: VideoTex | null = null;
  let nextVideo: VideoTex | null = null;

  return {
    setNextVideo(el) {
      if (destroyed) return;
      graph.setNextVideoTexture(null);
      releaseVideoTexture(nextVideo);
      nextVideo = el ? makeVideoTexture(PIXI, el) : null;
      graph.setNextVideoTexture(nextVideo?.texture ?? null);
    },

    setVideo(el) {
      if (destroyed) return;
      graph.setVideoTexture(null);
      releaseVideoTexture(video);
      video = el ? makeVideoTexture(PIXI, el) : null;
      graph.setVideoTexture(video?.texture ?? null);
    },

    setWebcam(el) {
      if (destroyed) return;
      graph.setWebcamTexture(null);
      releaseVideoTexture(webcam);
      webcam = el ? makeVideoTexture(PIXI, el) : null;
      graph.setWebcamTexture(webcam?.texture ?? null);
    },

    refreshVideo() {
      if (destroyed) return;
      video?.source.update();
      webcam?.source.update();
      nextVideo?.source.update();
      queueRedraw();
    },

    setResolution(resolution) {
      if (destroyed || !(resolution > 0)) return;
      if (Math.abs(app.renderer.resolution - resolution) < 1e-3) return;
      app.renderer.resize(app.renderer.width, app.renderer.height, resolution);
      redraw();
    },

    render(state) {
      if (destroyed) return;
      last = state;
      graph.apply(state);
      app.render();
    },

    resize(width, height) {
      if (destroyed) return;
      app.renderer.resize(Math.max(1, width), Math.max(1, height));
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      graph.setVideoTexture(null);
      graph.setWebcamTexture(null);
      graph.setNextVideoTexture(null);
      releaseVideoTexture(video);
      releaseVideoTexture(webcam);
      releaseVideoTexture(nextVideo);
      video = null;
      webcam = null;
      nextVideo = null;
      graph.destroy();
      app.destroy({ removeView: true }, { children: true });
    },
  };
};
