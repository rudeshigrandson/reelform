import type * as Pixi from "pixi.js";
import type { BackgroundPaint, SceneState } from "../../editor/preview/scene";
import type { FrameRenderer } from "./frameRenderer";

/**
 * Offscreen Pixi stage for export (§10.1 route 1). Mirrors the preview
 * hierarchy in `editor/preview/pixiStage.ts` (FrameRoot → Background,
 * ContentGroup → Shadow, CameraContainer[Placeholder, VideoSprite, Cursor],
 * Mask, Border) but is never attached to the DOM, renders at resolution 1 and
 * takes `VideoFrame`s as the video texture instead of a <video> element.
 * `pixi.js` is imported lazily so node tests never load it.
 *
 * Not unit-tested (needs a GPU context); parity with preview is covered by the
 * §10.4 golden tests once they land.
 */

export interface PixiFrameRendererOptions {
  width: number;
  height: number;
  preference?: "webgl" | "webgpu" | undefined;
  createVideoFrame?: ((source: HTMLCanvasElement, init: VideoFrameInit) => VideoFrame) | undefined;
}

const PLACEHOLDER_COLOR = 0x2a2f38;
const ARROW_POINTS = [0, 0, 0, 24, 6, 18.5, 10.5, 28, 14.5, 26.2, 10.2, 17, 18, 17];

export async function createPixiFrameRenderer(
  opts: PixiFrameRendererOptions,
): Promise<FrameRenderer> {
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
  let videoSource: Pixi.ImageSource | null = null;
  let videoTexture: Pixi.Texture | null = null;
  let videoSprite: Pixi.Sprite | null = null;
  let staticKey = "";
  let destroyed = false;

  function releaseVideo(): void {
    if (videoSprite) {
      camera.removeChild(videoSprite);
      videoSprite.destroy();
      videoSprite = null;
    }
    videoTexture?.destroy(false);
    videoTexture = null;
    // The VideoFrame resource is owned (and closed) by the engine.
    videoSource?.unload();
    videoSource = null;
  }

  function setVideoFrame(frame: VideoFrame): void {
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (videoSource && videoSource.pixelWidth === w && videoSource.pixelHeight === h) {
      videoSource.resource = frame;
      videoSource.update();
      return;
    }
    releaseVideo();
    videoSource = new PIXI.ImageSource({ resource: frame });
    videoTexture = new PIXI.Texture({ source: videoSource });
    videoSprite = new PIXI.Sprite({ texture: videoTexture, label: "VideoSprite" });
    camera.addChildAt(videoSprite, 1);
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
    async render(state, frame) {
      if (destroyed) throw new Error("renderer destroyed");
      applyStatic(state);
      const cw = state.layout.content.width;
      const ch = state.layout.content.height;
      const cam = state.camera;
      camera.scale.set(cam.scale);
      camera.pivot.set(cam.pivotX, cam.pivotY);
      camera.position.set(cam.positionX, cam.positionY);

      const hasVideo = state.video.visible && frame !== null;
      if (frame) setVideoFrame(frame);
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
      // Snapshot synchronously, before the source frame is closed.
      return makeFrame(app.canvas, { timestamp: Math.round(state.tMs * 1000) });
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
}
