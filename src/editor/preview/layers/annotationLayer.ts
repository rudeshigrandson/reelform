import { annotationVisualAt } from "../../annotations/animation";
import type {
  Annotation,
  ArrowHeadStyle,
  FontWeight,
  ImageFit,
  TextAlign,
  TextFont,
} from "../../inspector/annotations/types";
import type { FrameLayout } from "../layout";
import type { SceneState } from "../scene";
import { type RectPx, arrowGeometry, clamp, dashSegments, finiteOr, parseColor } from "./geometry";
import type {
  ContainerLike,
  FontWeightLike,
  GraphicsLike,
  LayerPixi,
  StrokeStyleLike,
  TextLike,
} from "./pixiTypes";

/**
 * AnnotationLayer (ENGINEERING_SPEC §6.4 / §9.7).
 *
 * Coordinates: annotation geometry is normalized 0..1 of the output frame
 * (inspector/annotations/types.ts). `followZoom` items (and every blur region,
 * §9.7) live in `space: "content"` — content-local px (frame px minus the
 * content offset), drawn inside CameraContainer so zoom/pan moves them. Other
 * items live in `space: "frame"` — frame-local px, drawn in
 * AnnotationLayerFixed on FrameRoot. Pixel-valued props (font size,
 * stroke, radius, padding, blur) are reference px scaled by `layout.scale`.
 *
 * `blur` items become `effects` region descriptors and `image` items become
 * `images` descriptors: both need the stage's video sprite / texture loader,
 * so the stage applies them.
 */

export type AnnotationSpace = "content" | "frame";

export interface AnnotationLayerInput {
  annotations: readonly Annotation[];
}

export type AnnotationDraw =
  | {
      kind: "text";
      text: string;
      fontFamily: string;
      fontSize: number;
      fontWeight: FontWeight;
      color: string;
      /** Background fill, or null when the pill is off. */
      background: string | null;
      padding: number;
      align: TextAlign;
    }
  | {
      kind: "arrow";
      strokeWidth: number;
      color: string;
      headStyle: ArrowHeadStyle;
      dashed: boolean;
    }
  | { kind: "line"; strokeWidth: number; color: string; dashed: boolean }
  | { kind: "rect"; fill: string; stroke: string; strokeWidth: number; radius: number }
  | { kind: "ellipse"; fill: string; stroke: string; strokeWidth: number }
  | { kind: "highlight"; fill: string; radius: number }
  | { kind: "emoji"; emoji: string }
  | { kind: "numberBadge"; value: number; fill: string; color: string }
  | { kind: "keystrokeBadge"; label: string };

export interface AnnotationItemState {
  id: string;
  space: AnnotationSpace;
  /** Un-animated box in container-local px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radians, around the box center. */
  rotation: number;
  /** Annotation opacity × animation opacity, 0..1. */
  alpha: number;
  /** Animation scale around the box center. */
  scale: number;
  /** Animation offset, px. */
  offsetX: number;
  offsetY: number;
  draw: AnnotationDraw;
}

/** A blur / pixelate region the stage applies to a copy of the video sprite. */
export interface EffectRegionState {
  id: string;
  space: AnnotationSpace;
  mode: "blur" | "pixelate";
  /** Animated rect (offset + scale baked in), container-local px. */
  rect: RectPx;
  rotation: number;
  alpha: number;
  /** Blur strength / pixel size in canvas px. */
  strength: number;
}

export interface ImageItemState {
  id: string;
  space: AnnotationSpace;
  src: string;
  fit: ImageFit;
  /** Animated rect (offset + scale baked in), container-local px. */
  rect: RectPx;
  rotation: number;
  alpha: number;
  cornerRadius: number;
}

export interface AnnotationLayerState {
  /** followZoom items, in order, for CameraContainer. */
  content: AnnotationItemState[];
  /** Fixed items, in order, for AnnotationLayerFixed. */
  frame: AnnotationItemState[];
  effects: EffectRegionState[];
  images: ImageItemState[];
}

export const EMPTY_ANNOTATION_LAYER: Readonly<AnnotationLayerState> = {
  content: [],
  frame: [],
  effects: [],
  images: [],
};

export const FONT_STACKS: Readonly<Record<TextFont, string>> = {
  Inter: "Inter, system-ui, sans-serif",
  System: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  Mono: "'SF Mono', Menlo, Consolas, monospace",
  Serif: "Georgia, 'Times New Roman', serif",
};

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

function drawFor(a: Annotation, k: number): AnnotationDraw | null {
  switch (a.kind) {
    case "text":
      return {
        kind: "text",
        text: a.text,
        fontFamily: FONT_STACKS[a.font] ?? FONT_STACKS.Inter,
        fontSize: nonNeg(a.fontSize) * k,
        fontWeight: a.fontWeight,
        color: a.color,
        background: a.background ? a.backgroundColor : null,
        padding: nonNeg(a.padding) * k,
        align: a.align,
      };
    case "arrow":
      return {
        kind: "arrow",
        strokeWidth: nonNeg(a.strokeWidth) * k,
        color: a.color,
        headStyle: a.headStyle,
        dashed: a.dashed,
      };
    case "line":
      return {
        kind: "line",
        strokeWidth: nonNeg(a.strokeWidth) * k,
        color: a.color,
        dashed: a.dashed,
      };
    case "rect":
      return {
        kind: "rect",
        fill: a.fill,
        stroke: a.stroke,
        strokeWidth: nonNeg(a.strokeWidth) * k,
        radius: nonNeg(a.radius) * k,
      };
    case "ellipse":
      return {
        kind: "ellipse",
        fill: a.fill,
        stroke: a.stroke,
        strokeWidth: nonNeg(a.strokeWidth) * k,
      };
    case "highlight":
      return { kind: "highlight", fill: a.fill, radius: nonNeg(a.radius) * k };
    case "emoji":
      return { kind: "emoji", emoji: a.emoji };
    case "numberBadge":
      return { kind: "numberBadge", value: a.value, fill: a.fill, color: a.color };
    case "keystrokeBadge":
      return { kind: "keystrokeBadge", label: a.label };
    case "blur":
    case "image":
      return null;
  }
}

/** Box after animation scale (around center) and offset. */
function animatedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  s: number,
  dx: number,
  dy: number,
): RectPx {
  const width = w * s;
  const height = h * s;
  return { x: x + (w - width) / 2 + dx, y: y + (h - height) / 2 + dy, width, height };
}

export function evaluateAnnotationLayer(
  input: AnnotationLayerInput,
  tMs: number,
  layout: FrameLayout,
  _camera?: SceneState["camera"] | undefined,
): AnnotationLayerState {
  const out: AnnotationLayerState = { content: [], frame: [], effects: [], images: [] };
  const k = nonNeg(layout.scale);
  // Geometry is normalized to the output frame for every item, so toggling
  // followZoom never moves an item at zoom 1. Content-space items are shifted
  // into ContentGroup/CameraContainer-local px (camera at z=1 is identity).
  const W = nonNeg(layout.frame.width);
  const H = nonNeg(layout.frame.height);
  const contentDx = finiteOr(layout.content.x - layout.frame.x, 0);
  const contentDy = finiteOr(layout.content.y - layout.frame.y, 0);
  for (const a of input.annotations) {
    const vis = annotationVisualAt(a, tMs);
    if (!vis.visible) continue;
    // §9.7: blur/pixelate lives in CameraContainer so it tracks the content it hides.
    const space: AnnotationSpace = a.followZoom || a.kind === "blur" ? "content" : "frame";
    const ox = space === "content" ? contentDx : 0;
    const oy = space === "content" ? contentDy : 0;
    const x = finiteOr(a.x, 0) * W - ox;
    const y = finiteOr(a.y, 0) * H - oy;
    const width = nonNeg(a.w) * W;
    const height = nonNeg(a.h) * H;
    const rotation = (finiteOr(a.rotation, 0) * Math.PI) / 180;
    const alpha = clamp(finiteOr(a.opacity, 1), 0, 1) * vis.opacity;
    const offsetX = vis.offsetX * W;
    const offsetY = vis.offsetY * H;

    if (a.kind === "blur") {
      out.effects.push({
        id: a.id,
        space,
        mode: a.pixelate ? "pixelate" : "blur",
        rect: animatedRect(x, y, width, height, vis.scale, offsetX, offsetY),
        rotation,
        alpha,
        strength: nonNeg(a.strength) * k,
      });
      continue;
    }
    if (a.kind === "image") {
      if (a.src.length === 0) continue;
      out.images.push({
        id: a.id,
        space,
        src: a.src,
        fit: a.fit,
        rect: animatedRect(x, y, width, height, vis.scale, offsetX, offsetY),
        rotation,
        alpha,
        cornerRadius: nonNeg(a.cornerRadius) * k,
      });
      continue;
    }
    const draw = drawFor(a, k);
    if (!draw) continue;
    const item: AnnotationItemState = {
      id: a.id,
      space,
      x,
      y,
      width,
      height,
      rotation,
      alpha,
      scale: vis.scale,
      offsetX,
      offsetY,
      draw,
    };
    (space === "content" ? out.content : out.frame).push(item);
  }
  return out;
}

// ── Pixi drawer ──────────────────────────────────────────────────────────────

export const KEYSTROKE_BADGE_FILL = 0x111114;
export const KEYSTROKE_BADGE_ALPHA = 0.85;

interface Node {
  space: AnnotationSpace;
  root: ContainerLike;
  gfx: GraphicsLike;
  text: TextLike | null;
  key: string;
}

export interface AnnotationLayerDrawer {
  /** followZoom items — add inside CameraContainer, above the video sprite. */
  container: ContainerLike;
  /** Fixed items — add to FrameRoot above ContentGroup. */
  fixedContainer: ContainerLike;
  apply(state: AnnotationLayerState): void;
  destroy(): void;
}

const weight = (w: number): FontWeightLike => String(w) as FontWeightLike;

function strokeLine(
  g: GraphicsLike,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: StrokeStyleLike,
  dashed: boolean,
): void {
  const segs = dashed
    ? dashSegments(x1, y1, x2, y2, style.width * 2.5, style.width * 2)
    : [[x1, y1, x2, y2] as const];
  for (const [a, b, c, d] of segs) g.moveTo(a, b).lineTo(c, d);
  if (segs.length > 0) g.stroke(style);
}

function paintNode(pixi: LayerPixi, node: Node, item: AnnotationItemState): void {
  const g = node.gfx;
  const draw = item.draw;
  const w = item.width;
  const h = item.height;
  const left = -w / 2;
  const top = -h / 2;
  g.clear();

  const ensureText = (): TextLike => {
    if (!node.text) {
      node.text = new pixi.Text({ text: "", label: "AnnotationText" });
      node.text.anchor.set(0.5, 0.5);
      node.root.addChild(node.text);
    }
    node.text.visible = true;
    return node.text;
  };
  if (node.text) node.text.visible = false;

  switch (draw.kind) {
    case "text": {
      if (draw.background !== null) {
        const bg = parseColor(draw.background);
        g.roundRect(left, top, w, h, Math.min(h / 2, draw.padding)).fill(bg);
      }
      const t = ensureText();
      const c = parseColor(draw.color, 0xffffff);
      t.text = draw.text;
      t.style = {
        fontFamily: draw.fontFamily,
        fontSize: draw.fontSize,
        fontWeight: weight(draw.fontWeight),
        fill: c.color,
        align: draw.align,
      };
      t.alpha = c.alpha;
      const ax = draw.align === "left" ? 0 : draw.align === "right" ? 1 : 0.5;
      t.anchor.set(ax, 0.5);
      t.position.set(
        draw.align === "left"
          ? left + draw.padding
          : draw.align === "right"
            ? -left - draw.padding
            : 0,
        0,
      );
      return;
    }
    case "arrow": {
      const c = parseColor(draw.color, 0xff5a5f);
      const geo = arrowGeometry(left, top + h, left + w, top, draw.strokeWidth, draw.headStyle);
      const style: StrokeStyleLike = {
        color: c.color,
        alpha: c.alpha,
        width: draw.strokeWidth,
        cap: "round",
        join: "round",
      };
      const [x1, y1, x2, y2] = geo.shaft;
      strokeLine(g, x1, y1, x2, y2, style, draw.dashed);
      const head = geo.head;
      if (head.kind === "triangle") g.poly(head.points, true).fill(c);
      else if (head.kind === "open") g.poly(head.points, false).stroke(style);
      else if (head.kind === "circle") g.circle(head.x, head.y, head.radius).fill(c);
      return;
    }
    case "line": {
      const c = parseColor(draw.color, 0xff5a5f);
      strokeLine(
        g,
        left,
        top + h,
        left + w,
        top,
        { color: c.color, alpha: c.alpha, width: draw.strokeWidth, cap: "round" },
        draw.dashed,
      );
      return;
    }
    case "rect": {
      const fill = parseColor(draw.fill);
      const stroke = parseColor(draw.stroke, 0xff5a5f);
      const r = Math.min(draw.radius, Math.min(w, h) / 2);
      if (fill.alpha > 0) g.roundRect(left, top, w, h, r).fill(fill);
      if (draw.strokeWidth > 0 && stroke.alpha > 0) {
        const i = draw.strokeWidth / 2;
        g.roundRect(
          left + i,
          top + i,
          Math.max(0, w - draw.strokeWidth),
          Math.max(0, h - draw.strokeWidth),
          r,
        ).stroke({
          color: stroke.color,
          alpha: stroke.alpha,
          width: draw.strokeWidth,
        });
      }
      return;
    }
    case "ellipse": {
      const fill = parseColor(draw.fill);
      const stroke = parseColor(draw.stroke, 0xff5a5f);
      if (fill.alpha > 0) g.ellipse(0, 0, w / 2, h / 2).fill(fill);
      if (draw.strokeWidth > 0 && stroke.alpha > 0) {
        const i = draw.strokeWidth / 2;
        g.ellipse(0, 0, Math.max(0, w / 2 - i), Math.max(0, h / 2 - i)).stroke({
          color: stroke.color,
          alpha: stroke.alpha,
          width: draw.strokeWidth,
        });
      }
      return;
    }
    case "highlight":
      g.roundRect(left, top, w, h, Math.min(draw.radius, Math.min(w, h) / 2)).fill(
        parseColor(draw.fill, 0xffe14d),
      );
      return;
    case "emoji": {
      const t = ensureText();
      t.text = draw.emoji;
      t.style = { fontSize: Math.max(1, Math.min(w, h) * 0.85) };
      t.alpha = 1;
      t.anchor.set(0.5, 0.5);
      t.position.set(0, 0);
      return;
    }
    case "numberBadge": {
      const r = Math.min(w, h) / 2;
      g.circle(0, 0, r).fill(parseColor(draw.fill, 0xff5a5f));
      const t = ensureText();
      const c = parseColor(draw.color, 0xffffff);
      t.text = String(draw.value);
      t.style = {
        fontFamily: FONT_STACKS.Inter,
        fontSize: Math.max(1, r * 1.1),
        fontWeight: "700",
        fill: c.color,
      };
      t.alpha = c.alpha;
      t.anchor.set(0.5, 0.5);
      t.position.set(0, 0);
      return;
    }
    case "keystrokeBadge": {
      g.roundRect(left, top, w, h, h * 0.25).fill({
        color: KEYSTROKE_BADGE_FILL,
        alpha: KEYSTROKE_BADGE_ALPHA,
      });
      const t = ensureText();
      t.text = draw.label;
      t.style = {
        fontFamily: FONT_STACKS.Inter,
        fontSize: Math.max(1, h * 0.5),
        fontWeight: "600",
        fill: 0xffffff,
      };
      t.alpha = 1;
      t.anchor.set(0.5, 0.5);
      t.position.set(0, 0);
      return;
    }
  }
}

export function createAnnotationLayer(pixi: LayerPixi): AnnotationLayerDrawer {
  const container = new pixi.Container({ label: "AnnotationLayer" });
  const fixedContainer = new pixi.Container({ label: "AnnotationLayerFixed" });
  const nodes = new Map<string, Node>();
  let contentOrder = "";
  let frameOrder = "";

  const drop = (id: string, node: Node): void => {
    const parent = node.space === "content" ? container : fixedContainer;
    parent.removeChild(node.root);
    node.root.destroy({ children: true });
    nodes.delete(id);
  };

  function sync(
    items: readonly AnnotationItemState[],
    parent: ContainerLike,
    prevOrder: string,
  ): string {
    const roots: ContainerLike[] = [];
    for (const item of items) {
      let node = nodes.get(item.id);
      if (node && node.space !== item.space) {
        drop(item.id, node);
        node = undefined;
      }
      if (!node) {
        const root = new pixi.Container({ label: `Annotation:${item.id}` });
        const gfx = new pixi.Graphics({ label: "AnnotationGraphics" });
        root.addChild(gfx);
        node = { space: item.space, root, gfx, text: null, key: "" };
        nodes.set(item.id, node);
      }
      const key = JSON.stringify([item.draw, item.width, item.height]);
      if (key !== node.key) {
        paintNode(pixi, node, item);
        node.key = key;
      }
      const { root } = node;
      root.visible = true;
      root.alpha = item.alpha;
      root.rotation = item.rotation;
      root.scale.set(item.scale);
      root.position.set(
        item.x + item.width / 2 + item.offsetX,
        item.y + item.height / 2 + item.offsetY,
      );
      roots.push(root);
    }
    const order = items.map((i) => i.id).join(" ");
    if (order !== prevOrder) {
      parent.removeChildren();
      if (roots.length > 0) parent.addChild(...roots);
    }
    return order;
  }

  return {
    container,
    fixedContainer,
    apply(state) {
      const live = new Set<string>();
      for (const i of state.content) live.add(i.id);
      for (const i of state.frame) live.add(i.id);
      for (const [id, node] of [...nodes]) if (!live.has(id)) drop(id, node);
      contentOrder = sync(state.content, container, contentOrder);
      frameOrder = sync(state.frame, fixedContainer, frameOrder);
    },
    destroy() {
      nodes.clear();
      container.destroy({ children: true });
      fixedContainer.destroy({ children: true });
    },
  };
}
