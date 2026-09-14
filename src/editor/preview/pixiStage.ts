import type * as Pixi from "pixi.js";
import type { BackgroundPaint, SceneState } from "./scene";

/**
 * Imperative Pixi adapter for the preview canvas (§6.4). It owns display
 * objects only: every per-frame value comes from `SceneState`; there is no
 * animation logic here. `pixi.js` is imported lazily so tests / jsdom never
 * load it.
 *
 * Hierarchy:
 *   stage
 *    └ FrameRoot
 *       ├ Background     (solid / gradient Graphics; BlurFilter when blur > 0)
 *       └ ContentGroup   (at content rect origin)
 *          ├ Shadow      (blurred rounded rect)
 *          ├ CameraContainer (scale + pivot; masked by rounded rect)
 *          │  ├ Placeholder (neutral rect when no video)
 *          │  ├ VideoSprite
 *          │  └ CursorSprite (drawn arrow until cursor packs ship)
 *          ├ Mask
 *          └ Border
 */

export interface PreviewStage {
  /** Attach (or detach with null) the hidden <video> used as the frame source. */
  setVideo(el: HTMLVideoElement | null): void;
  render(state: SceneState): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

export interface PreviewStageOptions {
  width: number;
  height: number;
  resolution?: number | undefined;
  preference?: "webgpu" | "webgl" | undefined;
}

export type CreatePreviewStage = (
  host: HTMLElement,
  opts: PreviewStageOptions,
) => Promise<PreviewStage>;

/** Neutral placeholder fill — Pixi needs a numeric/hex color, not a CSS var. */
const PLACEHOLDER_COLOR = 0x2a2f38;

/** Arrow outline in a 32px box, hotspot at (0,0). */
const ARROW_POINTS = [0, 0, 0, 24, 6, 18.5, 10.5, 28, 14.5, 26.2, 10.2, 17, 18, 17];

export const createPixiStage: CreatePreviewStage = async (host, opts) => {
  const PIXI = await import("pixi.js");
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

  const frameRoot = new PIXI.Container({ label: "FrameRoot" });
  const background = new PIXI.Graphics({ label: "Background" });
  const contentGroup = new PIXI.Container({ label: "ContentGroup" });
  const shadow = new PIXI.Graphics({ label: "Shadow" });
  const camera = new PIXI.Container({ label: "CameraContainer" });
  const placeholder = new PIXI.Graphics({ label: "Placeholder" });
  const cursor = new PIXI.Graphics({ label: "CursorSprite" });
  const mask = new PIXI.Graphics({ label: "Mask" });
  const border = new PIXI.Graphics({ label: "Border" });

  cursor.poly(ARROW_POINTS).fill({ color: 0xffffff }).stroke({ color: 0x000000, width: 1.5 });
  camera.addChild(placeholder, cursor);
  camera.mask = mask;
  contentGroup.addChild(shadow, camera, mask, border);
  frameRoot.addChild(background, contentGroup);
  app.stage.addChild(frameRoot);

  const bgBlur = new PIXI.BlurFilter({ strength: 0, quality: 4 });
  const shadowBlur = new PIXI.BlurFilter({ strength: 0, quality: 4 });

  let gradient: Pixi.FillGradient | null = null;
  let videoSprite: Pixi.Sprite | null = null;
  let videoTexture: Pixi.Texture | null = null;
  let staticKey = "";
  let destroyed = false;

  function releaseVideo(): void {
    if (videoSprite) {
      camera.removeChild(videoSprite);
      videoSprite.destroy();
      videoSprite = null;
    }
    if (videoTexture) {
      // Never call source.destroy(): VideoSource.destroy clears the element's
      // src, and the <video> is owned by React. Unload GPU data and detach.
      const src = videoTexture.source as Pixi.VideoSource;
      src.autoUpdate = false;
      src.unload();
      videoTexture.destroy(false);
      videoTexture = null;
    }
  }

  function paintBackground(paint: BackgroundPaint, w: number, h: number): void {
    background.clear();
    gradient?.destroy();
    gradient = null;
    switch (paint.kind) {
      case "transparent":
        return;
      case "solid":
        background.rect(0, 0, w, h).fill({ color: paint.color });
        return;
      case "image":
        background.rect(0, 0, w, h).fill({ color: paint.fallbackColor });
        return;
      case "linear-gradient": {
        const rad = (paint.angle * Math.PI) / 180;
        const dx = Math.sin(rad) / 2;
        const dy = -Math.cos(rad) / 2;
        gradient = new PIXI.FillGradient({
          type: "linear",
          start: { x: 0.5 - dx, y: 0.5 - dy },
          end: { x: 0.5 + dx, y: 0.5 + dy },
          colorStops: paint.stops.map((s) => ({ offset: s.offset, color: s.color })),
          textureSpace: "local",
        });
        background.rect(0, 0, w, h).fill(gradient);
        return;
      }
      case "radial-gradient":
        gradient = new PIXI.FillGradient({
          type: "radial",
          center: { x: 0.5, y: 0.5 },
          innerRadius: 0,
          outerCenter: { x: 0.5, y: 0.5 },
          outerRadius: 0.5,
          colorStops: paint.stops.map((s) => ({ offset: s.offset, color: s.color })),
          textureSpace: "local",
        });
        background.rect(0, 0, w, h).fill(gradient);
        return;
    }
  }

  function applyStatic(state: SceneState): void {
    const { layout, content, background: bg } = state;
    const key = JSON.stringify([layout, content, bg]);
    if (key === staticKey) return;
    staticKey = key;
    const { frame } = layout;
    const cw = layout.content.width;
    const ch = layout.content.height;

    frameRoot.position.set(frame.x, frame.y);
    paintBackground(bg.paint, frame.width, frame.height);
    bgBlur.strength = bg.blur;
    background.filters = bg.blur > 0 ? [bgBlur] : [];
    // Blurred edges would bleed transparent pixels; clip to the frame box.
    background.filterArea = new PIXI.Rectangle(0, 0, frame.width, frame.height);

    contentGroup.position.set(layout.content.x - frame.x, layout.content.y - frame.y);

    shadow.clear();
    if (content.shadow.alpha > 0 && cw > 0 && ch > 0) {
      shadow
        .roundRect(0, content.shadow.offsetY, cw, ch, content.radius)
        .fill({ color: content.shadow.color, alpha: content.shadow.alpha });
      shadowBlur.strength = content.shadow.blur;
      shadow.filters = content.shadow.blur > 0 ? [shadowBlur] : [];
    } else {
      shadow.filters = [];
    }

    // TODO(squircle): superellipse mask via geometry/squircle.ts (§9.1); rounded rect for now.
    mask.clear().roundRect(0, 0, cw, ch, content.radius).fill({ color: 0xffffff });
    placeholder.clear().rect(0, 0, cw, ch).fill({ color: PLACEHOLDER_COLOR });

    border.clear();
    if (content.border.width > 0 && content.border.alpha > 0) {
      const inset = content.border.width / 2;
      border
        .roundRect(
          inset,
          inset,
          cw - content.border.width,
          ch - content.border.width,
          content.radius,
        )
        .stroke({
          color: content.border.color,
          alpha: content.border.alpha,
          width: content.border.width,
        });
    }
  }

  return {
    setVideo(el) {
      if (destroyed) return;
      releaseVideo();
      if (!el) return;
      const source = new PIXI.VideoSource({ resource: el, autoPlay: false, autoLoad: true });
      videoTexture = new PIXI.Texture({ source });
      videoSprite = new PIXI.Sprite({ texture: videoTexture, label: "VideoSprite" });
      camera.addChildAt(videoSprite, 1);
    },

    render(state) {
      if (destroyed) return;
      applyStatic(state);
      const cw = state.layout.content.width;
      const ch = state.layout.content.height;

      const cam = state.camera;
      camera.scale.set(cam.scale);
      camera.pivot.set(cam.pivotX, cam.pivotY);
      camera.position.set(cam.positionX, cam.positionY);

      const hasVideo = state.video.visible && videoSprite !== null;
      placeholder.visible = !hasVideo;
      if (videoSprite) {
        videoSprite.visible = hasVideo;
        const crop = state.video.crop;
        const cropW = crop && crop.width > 0 ? crop.width : 1;
        const cropH = crop && crop.height > 0 ? crop.height : 1;
        videoSprite.width = cw / cropW;
        videoSprite.height = ch / cropH;
        videoSprite.position.set(
          -(crop?.x ?? 0) * videoSprite.width,
          -(crop?.y ?? 0) * videoSprite.height,
        );
      }

      cursor.visible = state.cursor.visible;
      if (state.cursor.visible) {
        cursor.position.set(state.cursor.x, state.cursor.y);
        cursor.scale.set(state.cursor.size / 32);
      }

      app.render();
    },

    resize(width, height) {
      if (destroyed) return;
      app.renderer.resize(Math.max(1, width), Math.max(1, height));
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      releaseVideo();
      gradient?.destroy();
      bgBlur.destroy();
      shadowBlur.destroy();
      app.destroy({ removeView: true }, { children: true });
    },
  };
};
