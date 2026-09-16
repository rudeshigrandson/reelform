import type { CursorStyle } from "../inspector/cursor/types";
import type { CursorClickFxState, CursorFxState } from "./compose";
import { type CursorPack, type CursorSpriteRef, cursorSpriteFor } from "./cursorPack";
import type { ImageItemState } from "./layers/annotationLayer";
import { type SceneLayers, createSceneLayers } from "./layers/extendScene";
import { parseColor } from "./layers/geometry";
import type {
  ContainerLike,
  FillStyleLike,
  GraphicsLike,
  LayerPixi,
  PointLike,
  SpriteLike,
} from "./layers/pixiTypes";
import type { BackgroundPaint, SceneState } from "./scene";
import { squirclePoints } from "./squircle";

/**
 * Shared scene-graph builder (ENGINEERING_SPEC §6.3 "quality parity", §6.4).
 * Preview (`pixiStage.ts`) and export (`export/engine/pixiFrameRenderer.ts`)
 * both build their display tree with `createSceneGraph` and apply the same
 * `SceneState`; only the frame source differs (a <video>-backed texture vs a
 * `VideoFrame`-backed one, handed in via `setVideoTexture`). Pixi is reached
 * through the injected `SceneGraphPixi` port so tests use a fake.
 *
 *   FrameRoot                      (filters: ColorMatrix, Noise)
 *    ├ Background                  (paint + BackgroundImage; BlurFilter)
 *    ├ ContentGroup
 *    │  ├ Shadow                   (BlurFilter)
 *    │  ├ CameraContainer          (zoom; masked by Mask)
 *    │  │  ├ Placeholder, VideoSprite, VideoSpriteNext (cross-dissolve)
 *    │  │  ├ EffectRegions         (masked video copies: blur / pixelate)
 *    │  │  ├ AnnotationImages, AnnotationLayer
 *    │  │  ├ ClickEffects, CursorGhosts, Cursor
 *    │  ├ Mask (rounded rect / squircle)
 *    │  └ Border
 *    ├ AnnotationImagesFixed, AnnotationLayerFixed
 *    ├ WebcamBubble, CaptionLayer, TitleCardLayer
 *    └ Vignette
 */

// ── Port ─────────────────────────────────────────────────────────────────────

/** A texture as the graph sees it (real `Texture`, or a fake). */
export interface TextureLike {
  readonly width: number;
  readonly height: number;
}

export interface SceneSpriteLike extends SpriteLike {
  /** Assign a `TextureLike`; read type differs on real pixi. */
  texture: unknown;
  anchor: PointLike;
  filters: unknown;
}

export interface SceneGraphicsLike extends GraphicsLike {
  fill(style: FillStyleLike | GradientLike): this;
  filters: unknown;
  filterArea?: unknown;
}

export interface SceneContainerLike extends ContainerLike {
  filters: unknown;
  filterArea?: unknown;
  /** Radians; used for the 3D-tilt camera lean. */
  skew: PointLike;
}

export interface GradientLike {
  destroy(): void;
}
export interface BlurFilterLike {
  strength: number;
  destroy(): void;
}
export interface PixelateFilterLike {
  size: number;
  destroy(): void;
}
export interface ColorMatrixFilterLike {
  matrix: number[];
  destroy(): void;
}
export interface NoiseFilterLike {
  noise: number;
  seed: number;
  destroy(): void;
}

export interface GradientStopLike {
  offset: number;
  /** `#rrggbb` or `#rrggbbaa`. */
  color: string;
}

export interface SceneGraphPixi extends LayerPixi {
  Container: new (options?: { label?: string }) => SceneContainerLike;
  Graphics: new (options?: { label?: string }) => SceneGraphicsLike;
  Sprite: new (options?: { label?: string }) => SceneSpriteLike;
  createBlurFilter(strength: number): BlurFilterLike;
  createPixelateFilter(size: number): PixelateFilterLike;
  createColorMatrixFilter(): ColorMatrixFilterLike;
  createNoiseFilter(): NoiseFilterLike;
  /** Gradient in normalized local (shape-bounds) space. */
  createLinearGradient(o: {
    start: { x: number; y: number };
    end: { x: number; y: number };
    stops: GradientStopLike[];
  }): GradientLike;
  createRadialGradient(o: { stops: GradientStopLike[] }): GradientLike;
  createRectangle(x: number, y: number, width: number, height: number): unknown;
}

/** Async assets (texture URLs, cursor packs). Loads never reject. */
export interface SceneAssets {
  loadTexture(url: string): Promise<TextureLike | null>;
  loadCursorPack(style: CursorStyle): Promise<CursorPack | null>;
  /** Project-relative media path → URL (`reelform-media://…`), or null. */
  resolveMediaUrl(path: string): string | null;
}

export interface SceneGraphOptions {
  assets?: SceneAssets | undefined;
  /** Called after an async asset settles so a paused preview can re-render. */
  onAssetLoaded?: (() => void) | undefined;
}

export interface SceneGraph {
  /** Add to the stage. */
  root: ContainerLike;
  setVideoTexture(texture: TextureLike | null): void;
  /**
   * Cross-dissolve source: a texture holding the incoming clip's first frame
   * (`SceneState.transition.incomingSourceMs`), drawn over the video at `mix`.
   */
  setNextVideoTexture(texture: TextureLike | null): void;
  setWebcamTexture(texture: TextureLike | null): void;
  apply(state: SceneState): void;
  /** True while textures / packs requested by `apply` are still loading. */
  hasPendingAssets(): boolean;
  /** Resolves once every pending load has settled (export awaits this). */
  whenIdle(): Promise<void>;
  destroy(): void;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Placeholder fill (Pixi needs a numeric color, not a CSS var). */
export const PLACEHOLDER_COLOR = 0x2a2f38;
/** Built-in arrow outline in a 32px box, hotspot at (0,0). */
export const ARROW_POINTS = [0, 0, 0, 24, 6, 18.5, 10.5, 28, 14.5, 26.2, 10.2, 17, 18, 17];
export const ARROW_BOX = 32;

export interface FitResult {
  /** Sprite rect relative to the item's top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Image annotation sprite rect for `contain` / `cover` / `fill` (cover is clipped by a mask). */
export function fitImage(
  boxW: number,
  boxH: number,
  texW: number,
  texH: number,
  fit: "contain" | "cover" | "fill",
): FitResult {
  if (fit === "fill" || !(texW > 0) || !(texH > 0) || !(boxW > 0) || !(boxH > 0)) {
    return { x: 0, y: 0, width: Math.max(0, boxW), height: Math.max(0, boxH) };
  }
  const k =
    fit === "contain" ? Math.min(boxW / texW, boxH / texH) : Math.max(boxW / texW, boxH / texH);
  const width = texW * k;
  const height = texH * k;
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height };
}

/** Background image rect for `fit` (letterbox) / `fill` (cover) inside a frame. */
export function fitBackgroundImage(
  frameW: number,
  frameH: number,
  texW: number,
  texH: number,
  fit: "fit" | "fill",
): FitResult {
  return fitImage(frameW, frameH, texW, texH, fit === "fit" ? "contain" : "cover");
}

/** `#rrggbb` + alpha → `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  const c = parseColor(hex);
  const a = Math.round(Math.min(1, Math.max(0, alpha * c.alpha)) * 255);
  return `#${c.color.toString(16).padStart(6, "0")}${a.toString(16).padStart(2, "0")}`;
}

/** Rotated rect polygon around its center (radians). */
export function rotatedRectPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number,
): number[] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const out: number[] = [];
  for (const [dx, dy] of [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ] as const) {
    out.push(cx + dx * c - dy * s, cy + dx * s + dy * c);
  }
  return out;
}

// ── Builder ──────────────────────────────────────────────────────────────────

interface EffectNode {
  root: SceneContainerLike;
  sprite: SceneSpriteLike;
  mask: SceneGraphicsLike;
  blur: BlurFilterLike | null;
  pixelate: PixelateFilterLike | null;
}

interface ImageNode {
  root: SceneContainerLike;
  sprite: SceneSpriteLike;
  mask: SceneGraphicsLike;
  space: "content" | "frame";
}

interface CursorNode {
  root: SceneContainerLike;
  arrow: SceneGraphicsLike;
  sprite: SceneSpriteLike;
}

export function createSceneGraph(
  pixi: SceneGraphPixi,
  options: SceneGraphOptions = {},
): SceneGraph {
  const { assets, onAssetLoaded } = options;
  const C = (label: string): SceneContainerLike => new pixi.Container({ label });
  const G = (label: string): SceneGraphicsLike => new pixi.Graphics({ label });
  const S = (label: string): SceneSpriteLike => new pixi.Sprite({ label });

  const frameRoot = C("FrameRoot");
  const background = C("Background");
  const bgPaint = G("BackgroundPaint");
  const bgImage = S("BackgroundImage");
  const contentGroup = C("ContentGroup");
  const shadow = G("Shadow");
  const camera = C("CameraContainer");
  const placeholder = G("Placeholder");
  const video = S("VideoSprite");
  const videoNext = S("VideoSpriteNext");
  const effects = C("EffectRegions");
  const imagesContent = C("AnnotationImages");
  const clickFx = G("ClickEffects");
  const ghosts = C("CursorGhosts");
  const mask = G("Mask");
  const border = G("Border");
  const imagesFixed = C("AnnotationImagesFixed");
  const vignette = G("Vignette");
  const layers: SceneLayers = createSceneLayers(pixi);

  const makeCursorNode = (label: string): CursorNode => {
    const root = C(label);
    const arrow = G("CursorArrow");
    arrow.poly(ARROW_POINTS).fill({ color: 0xffffff }).stroke({ color: 0x000000, width: 1.5 });
    const sprite = S("CursorSprite");
    sprite.visible = false;
    root.addChild(arrow, sprite);
    return { root, arrow, sprite };
  };
  const cursor = makeCursorNode("Cursor");

  bgImage.visible = false;
  background.addChild(bgPaint, bgImage);
  video.visible = false;
  videoNext.visible = false;
  camera.addChild(
    placeholder,
    video,
    videoNext,
    effects,
    imagesContent,
    layers.annotations.container,
    clickFx,
    ghosts,
    cursor.root,
  );
  camera.mask = mask;
  contentGroup.addChild(shadow, camera, mask, border);
  frameRoot.addChild(
    background,
    contentGroup,
    imagesFixed,
    layers.annotations.fixedContainer,
    layers.webcam.container,
    layers.captions.container,
    layers.titleCard.container,
    vignette,
  );

  const bgBlur = pixi.createBlurFilter(0);
  const shadowBlur = pixi.createBlurFilter(0);
  const webcamShadowBlur = pixi.createBlurFilter(0);
  const colorFilter = pixi.createColorMatrixFilter();
  const noiseFilter = pixi.createNoiseFilter();
  const gradients: GradientLike[] = [];
  const effectNodes = new Map<string, EffectNode>();
  const imageNodes = new Map<string, ImageNode>();
  const ghostNodes: CursorNode[] = [];

  let videoTexture: TextureLike | null = null;
  let nextVideoTexture: TextureLike | null = null;
  let webcamSprite: SceneSpriteLike | null = null;
  let staticKey = "";
  let destroyed = false;

  // ── assets ──
  const textures = new Map<string, TextureLike | null>();
  const packs = new Map<CursorStyle, CursorPack | null>();
  const pending = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): void => {
    const done = p.then(
      () => undefined,
      () => undefined,
    );
    pending.add(done);
    void done.then(() => {
      pending.delete(done);
      if (!destroyed) onAssetLoaded?.();
    });
  };
  const textureFor = (url: string | null): TextureLike | null => {
    if (!url || !assets) return null;
    if (textures.has(url)) return textures.get(url) ?? null;
    textures.set(url, null);
    track(
      assets.loadTexture(url).then(
        (t) => {
          textures.set(url, t);
        },
        () => {
          textures.set(url, null);
        },
      ),
    );
    return null;
  };
  const packFor = (style: CursorStyle): CursorPack | null => {
    if (!assets || style === "custom") return null;
    if (packs.has(style)) return packs.get(style) ?? null;
    packs.set(style, null);
    track(
      assets.loadCursorPack(style).then(
        (p) => {
          packs.set(style, p);
        },
        () => {
          packs.set(style, null);
        },
      ),
    );
    return null;
  };

  // ── static (only when layout / styling changes) ──
  function paintBackground(paint: BackgroundPaint, w: number, h: number): void {
    bgPaint.clear();
    for (const g of gradients.splice(0)) g.destroy();
    bgImage.visible = false;
    const stops = (s: ReadonlyArray<{ offset: number; color: string }>): GradientStopLike[] =>
      s.map((x) => ({ offset: x.offset, color: x.color }));
    switch (paint.kind) {
      case "transparent":
        return;
      case "solid":
        bgPaint.rect(0, 0, w, h).fill(parseColor(paint.color));
        return;
      case "image":
        bgPaint.rect(0, 0, w, h).fill(parseColor(paint.fallbackColor));
        return;
      case "linear-gradient": {
        const rad = (paint.angle * Math.PI) / 180;
        const dx = Math.sin(rad) / 2;
        const dy = -Math.cos(rad) / 2;
        const g = pixi.createLinearGradient({
          start: { x: 0.5 - dx, y: 0.5 - dy },
          end: { x: 0.5 + dx, y: 0.5 + dy },
          stops: stops(paint.stops),
        });
        gradients.push(g);
        bgPaint.rect(0, 0, w, h).fill(g);
        return;
      }
      case "radial-gradient": {
        const g = pixi.createRadialGradient({ stops: stops(paint.stops) });
        gradients.push(g);
        bgPaint.rect(0, 0, w, h).fill(g);
        return;
      }
      case "mesh": {
        bgPaint.rect(0, 0, w, h).fill(parseColor(paint.base));
        const long = Math.max(w, h);
        for (const p of paint.points) {
          const g = pixi.createRadialGradient({
            stops: [
              { offset: 0, color: withAlpha(p.color, 1) },
              { offset: 1, color: withAlpha(p.color, 0) },
            ],
          });
          gradients.push(g);
          bgPaint.circle(p.x * w, p.y * h, p.radius * long).fill(g);
        }
        return;
      }
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
    background.filterArea = pixi.createRectangle(frame.x, frame.y, frame.width, frame.height);
    contentGroup.position.set(layout.content.x - frame.x, layout.content.y - frame.y);

    const outline = (
      g: SceneGraphicsLike,
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
    ): SceneGraphicsLike =>
      content.squircle && r > 0
        ? g.poly(squirclePoints(x, y, w, h, r), true)
        : g.roundRect(x, y, w, h, r);

    shadow.clear();
    if (content.shadow.alpha > 0 && cw > 0 && ch > 0) {
      const c = parseColor(content.shadow.color);
      outline(shadow, 0, content.shadow.offsetY, cw, ch, content.radius).fill({
        color: c.color,
        alpha: content.shadow.alpha,
      });
      shadowBlur.strength = content.shadow.blur;
      shadow.filters = content.shadow.blur > 0 ? [shadowBlur] : [];
    } else {
      shadow.filters = [];
    }
    outline(mask.clear(), 0, 0, cw, ch, content.radius).fill({ color: 0xffffff });
    placeholder.clear().rect(0, 0, cw, ch).fill({ color: PLACEHOLDER_COLOR });

    border.clear();
    if (content.border.width > 0 && content.border.alpha > 0) {
      const bw = content.border.width;
      const c = parseColor(content.border.color, 0xffffff);
      outline(
        border,
        bw / 2,
        bw / 2,
        cw - bw,
        ch - bw,
        Math.max(0, content.radius - bw / 2),
      ).stroke({
        color: c.color,
        alpha: content.border.alpha,
        width: bw,
      });
    }
  }

  // ── per frame ──
  function applyBackgroundImage(state: SceneState): void {
    const paint = state.background.paint;
    if (paint.kind !== "image") {
      bgImage.visible = false;
      return;
    }
    const tex = textureFor(assets?.resolveMediaUrl(paint.path) ?? null);
    bgImage.visible = tex !== null;
    if (!tex) return;
    bgImage.texture = tex;
    const r = fitBackgroundImage(
      state.layout.frame.width,
      state.layout.frame.height,
      tex.width,
      tex.height,
      paint.fit,
    );
    bgImage.position.set(r.x, r.y);
    bgImage.width = r.width;
    bgImage.height = r.height;
  }

  function videoRect(state: SceneState): FitResult {
    const cw = state.layout.content.width;
    const ch = state.layout.content.height;
    const crop = state.video.crop;
    const width = cw / (crop && crop.width > 0 ? crop.width : 1);
    const height = ch / (crop && crop.height > 0 ? crop.height : 1);
    return { x: -(crop?.x ?? 0) * width, y: -(crop?.y ?? 0) * height, width, height };
  }

  function applyEffects(state: SceneState, hasVideo: boolean, vr: FitResult): void {
    const list = state.composition?.annotations.effects ?? [];
    const live = new Set(list.map((e) => e.id));
    for (const [id, node] of [...effectNodes]) {
      if (live.has(id)) continue;
      effects.removeChild(node.root);
      node.blur?.destroy();
      node.pixelate?.destroy();
      node.root.destroy({ children: true });
      effectNodes.delete(id);
    }
    const order: ContainerLike[] = [];
    for (const e of list) {
      let node = effectNodes.get(e.id);
      if (!node) {
        const root = C(`EffectRegion:${e.id}`);
        const sprite = S("EffectVideoCopy");
        const m = G("EffectMask");
        root.addChild(sprite, m);
        sprite.mask = m;
        node = { root, sprite, mask: m, blur: null, pixelate: null };
        effectNodes.set(e.id, node);
      }
      node.root.visible = hasVideo && e.alpha > 0;
      node.root.alpha = e.alpha;
      if (videoTexture) node.sprite.texture = videoTexture;
      node.sprite.position.set(vr.x, vr.y);
      node.sprite.width = vr.width;
      node.sprite.height = vr.height;
      node.mask
        .clear()
        .poly(rotatedRectPoints(e.rect.x, e.rect.y, e.rect.width, e.rect.height, e.rotation), true)
        .fill({ color: 0xffffff });
      if (e.mode === "blur") {
        node.pixelate?.destroy();
        node.pixelate = null;
        node.blur ??= pixi.createBlurFilter(e.strength);
        node.blur.strength = e.strength;
        node.sprite.filters = [node.blur];
      } else {
        node.blur?.destroy();
        node.blur = null;
        const size = Math.max(1, e.strength);
        node.pixelate ??= pixi.createPixelateFilter(size);
        node.pixelate.size = size;
        node.sprite.filters = [node.pixelate];
      }
      order.push(node.root);
    }
    effects.removeChildren();
    if (order.length > 0) effects.addChild(...order);
  }

  function applyImages(state: SceneState): void {
    const list: ImageItemState[] = state.composition?.annotations.images ?? [];
    const live = new Set(list.map((i) => i.id));
    for (const [id, node] of [...imageNodes]) {
      if (live.has(id)) continue;
      (node.space === "content" ? imagesContent : imagesFixed).removeChild(node.root);
      node.root.destroy({ children: true });
      imageNodes.delete(id);
    }
    const content: ContainerLike[] = [];
    const fixed: ContainerLike[] = [];
    for (const item of list) {
      let node = imageNodes.get(item.id);
      if (node && node.space !== item.space) {
        node.root.destroy({ children: true });
        imageNodes.delete(item.id);
        node = undefined;
      }
      if (!node) {
        const root = C(`AnnotationImage:${item.id}`);
        const sprite = S("AnnotationImageSprite");
        const m = G("AnnotationImageMask");
        root.addChild(sprite, m);
        sprite.mask = m;
        node = { root, sprite, mask: m, space: item.space };
        imageNodes.set(item.id, node);
      }
      const { width: w, height: h } = item.rect;
      const tex = textureFor(assets?.resolveMediaUrl(item.src) ?? null);
      node.root.position.set(item.rect.x + w / 2, item.rect.y + h / 2);
      node.root.rotation = item.rotation;
      node.root.alpha = item.alpha;
      node.root.visible = tex !== null;
      node.mask
        .clear()
        .roundRect(-w / 2, -h / 2, w, h, Math.min(item.cornerRadius, Math.min(w, h) / 2))
        .fill({ color: 0xffffff });
      if (tex) {
        node.sprite.texture = tex;
        const r = fitImage(w, h, tex.width, tex.height, item.fit);
        node.sprite.position.set(r.x - w / 2, r.y - h / 2);
        node.sprite.width = r.width;
        node.sprite.height = r.height;
      }
      (item.space === "content" ? content : fixed).push(node.root);
    }
    imagesContent.removeChildren();
    if (content.length > 0) imagesContent.addChild(...content);
    imagesFixed.removeChildren();
    if (fixed.length > 0) imagesFixed.addChild(...fixed);
  }

  function spriteRef(fx: CursorFxState): CursorSpriteRef | null {
    if (fx.style === "custom") {
      // Uploaded cursors are stored project-relative; URLs pass through unchanged.
      const url = fx.customUrl ? (assets?.resolveMediaUrl(fx.customUrl) ?? null) : null;
      return url ? { type: "arrow", url, hotspot: { x: 0, y: 0 }, boxSize: 0 } : null;
    }
    const pack = packFor(fx.style);
    return pack ? cursorSpriteFor(pack, fx.type) : null;
  }

  function placeCursor(
    node: CursorNode,
    x: number,
    y: number,
    size: number,
    scale: number,
    alpha: number,
    ref: CursorSpriteRef | null,
  ): void {
    const tex = ref ? textureFor(ref.url) : null;
    node.root.visible = alpha > 0 && size > 0;
    node.root.position.set(x, y);
    node.root.alpha = alpha;
    node.root.scale.set(scale);
    node.arrow.visible = tex === null;
    node.sprite.visible = tex !== null;
    if (tex === null || ref === null) {
      node.arrow.scale.set(size / ARROW_BOX);
      return;
    }
    node.sprite.texture = tex;
    const h = size;
    const w = tex.height > 0 ? (size * tex.width) / tex.height : size;
    const k = ref.boxSize > 0 ? size / ref.boxSize : 0;
    node.sprite.width = w;
    node.sprite.height = h;
    node.sprite.position.set(-ref.hotspot.x * k, -ref.hotspot.y * k);
  }

  function drawClicks(list: readonly CursorClickFxState[]): void {
    clickFx.clear();
    for (const c of list) {
      const col = parseColor(c.color, 0xffffff);
      if (c.kind === "highlight") {
        clickFx
          .circle(c.x, c.y, c.radius)
          .fill({ color: col.color, alpha: 0.3 * c.alpha * col.alpha });
      }
      clickFx
        .circle(c.x, c.y, c.radius)
        .stroke({ color: col.color, alpha: c.alpha * col.alpha, width: c.lineWidth });
    }
  }

  function applyCursor(state: SceneState): void {
    const fx = state.composition?.cursor;
    if (!fx) {
      // Base scene only (no composition): drawn arrow at the scene cursor.
      const cs = state.cursor;
      placeCursor(cursor, cs.x, cs.y, cs.size, 1, cs.visible ? 1 : 0, null);
      clickFx.clear();
      for (const g of ghostNodes) g.root.visible = false;
      return;
    }
    const ref = fx.visible ? spriteRef(fx) : null;
    placeCursor(cursor, fx.x, fx.y, fx.size, fx.scale, fx.visible ? fx.alpha : 0, ref);
    fx.ghosts.forEach((g, i) => {
      let node = ghostNodes[i];
      if (!node) {
        node = makeCursorNode(`CursorGhost:${i}`);
        ghostNodes.push(node);
        ghosts.addChild(node.root);
      }
      placeCursor(node, g.x, g.y, fx.size, fx.scale, fx.visible ? g.alpha : 0, ref);
    });
    for (let i = fx.ghosts.length; i < ghostNodes.length; i++) {
      const node = ghostNodes[i];
      if (node) node.root.visible = false;
    }
    drawClicks(fx.visible ? fx.clicks : []);
  }

  function applyColor(state: SceneState): void {
    const color = state.composition?.color;
    const { frame } = state.layout;
    const filters: unknown[] = [];
    if (color?.matrix) {
      colorFilter.matrix = [...color.matrix];
      filters.push(colorFilter);
    }
    if (color?.grain) {
      noiseFilter.noise = color.grain.noise;
      noiseFilter.seed = color.grain.seed;
      filters.push(noiseFilter);
    }
    frameRoot.filters = filters;
    frameRoot.filterArea =
      filters.length > 0 ? pixi.createRectangle(frame.x, frame.y, frame.width, frame.height) : null;

    vignette.clear();
    for (const g of vignetteGradients.splice(0)) g.destroy();
    const v = color?.vignette ?? 0;
    vignette.visible = v > 0;
    if (v > 0) {
      const g = pixi.createRadialGradient({
        stops: [
          { offset: 0, color: "#00000000" },
          { offset: 0.55, color: "#00000000" },
          { offset: 1, color: withAlpha("#000000", v) },
        ],
      });
      vignetteGradients.push(g);
      vignette.rect(0, 0, frame.width, frame.height).fill(g);
    }
  }
  const vignetteGradients: GradientLike[] = [];
  let vignetteKey = "";

  return {
    root: frameRoot,

    setVideoTexture(texture) {
      if (destroyed) return;
      videoTexture = texture;
      if (texture) video.texture = texture;
      for (const node of effectNodes.values()) if (texture) node.sprite.texture = texture;
    },

    setNextVideoTexture(texture) {
      if (destroyed) return;
      nextVideoTexture = texture;
      if (texture) videoNext.texture = texture;
      else videoNext.visible = false;
    },

    setWebcamTexture(texture) {
      if (destroyed) return;
      if (!texture) {
        layers.webcam.setSprite(null);
        webcamSprite?.destroy();
        webcamSprite = null;
        return;
      }
      if (!webcamSprite) {
        webcamSprite = S("WebcamSprite");
        layers.webcam.setSprite(webcamSprite);
      }
      webcamSprite.texture = texture;
    },

    apply(state) {
      if (destroyed) return;
      applyStatic(state);
      applyBackgroundImage(state);

      const cam = state.camera;
      camera.scale.set(cam.scale);
      camera.pivot.set(cam.pivotX, cam.pivotY);
      camera.position.set(cam.positionX, cam.positionY);
      camera.skew.set(cam.tiltX, cam.tiltY);

      // Parallax: overscan the background around the frame center, then offset it.
      const bgs = state.background;
      if (bgs.scale !== 1 || bgs.offsetX !== 0 || bgs.offsetY !== 0) {
        const cx = state.layout.frame.width / 2;
        const cy = state.layout.frame.height / 2;
        background.pivot.set(cx, cy);
        background.position.set(cx + bgs.offsetX, cy + bgs.offsetY);
        background.scale.set(bgs.scale);
      } else {
        background.pivot.set(0, 0);
        background.position.set(0, 0);
        background.scale.set(1);
      }

      const hasVideo = state.video.visible && videoTexture !== null;
      placeholder.visible = !hasVideo;
      video.visible = hasVideo;
      const vr = videoRect(state);
      video.position.set(vr.x, vr.y);
      video.width = vr.width;
      video.height = vr.height;

      const tr = state.transition;
      const dissolve = tr?.kind === "cross-dissolve" ? tr.mix : 0;
      videoNext.visible = hasVideo && nextVideoTexture !== null && dissolve > 0;
      videoNext.alpha = dissolve;
      videoNext.position.set(vr.x, vr.y);
      videoNext.width = vr.width;
      videoNext.height = vr.height;

      applyEffects(state, hasVideo, vr);
      applyImages(state);
      applyCursor(state);

      const comp = state.composition;
      layers.annotations.container.visible = comp !== undefined;
      layers.annotations.fixedContainer.visible = comp !== undefined;
      if (comp) {
        layers.apply({ scene: state, ...comp });
        const sh = comp.webcam.shadow;
        webcamShadowBlur.strength = sh ? sh.blur : 0;
        // Built from this port's Graphics, so it carries `filters`.
        (layers.webcam.shadow as SceneGraphicsLike).filters =
          sh && sh.blur > 0 ? [webcamShadowBlur] : [];
      } else {
        layers.webcam.container.visible = false;
        layers.captions.container.visible = false;
        layers.titleCard.container.visible = false;
      }
      // Grain seed changes every frame; only the seed is updated then.
      const color = comp?.color;
      const vk = JSON.stringify([
        color?.matrix,
        color?.vignette,
        color?.grain?.noise,
        state.layout.frame,
      ]);
      if (vk !== vignetteKey) {
        vignetteKey = vk;
        applyColor(state);
      } else if (comp?.color.grain) {
        noiseFilter.seed = comp.color.grain.seed;
      }
    },

    hasPendingAssets() {
      return pending.size > 0;
    },

    async whenIdle() {
      while (pending.size > 0) await Promise.all([...pending]);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      layers.webcam.setSprite(null);
      webcamSprite?.destroy();
      webcamSprite = null;
      for (const node of effectNodes.values()) {
        node.blur?.destroy();
        node.pixelate?.destroy();
      }
      effectNodes.clear();
      imageNodes.clear();
      for (const g of gradients.splice(0)) g.destroy();
      for (const g of vignetteGradients.splice(0)) g.destroy();
      bgBlur.destroy();
      shadowBlur.destroy();
      webcamShadowBlur.destroy();
      colorFilter.destroy();
      noiseFilter.destroy();
      // Video/webcam textures are owned by the stage / engine.
      video.texture = null;
      videoNext.texture = null;
      nextVideoTexture = null;
      layers.destroy();
      frameRoot.destroy({ children: true });
    },
  };
}
