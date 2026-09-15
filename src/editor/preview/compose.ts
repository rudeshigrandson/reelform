import type { Annotation } from "../inspector/annotations/types";
import type { CursorStyle } from "../inspector/cursor/types";
import type { EffectsSettings } from "../inspector/effects/types";
import { DEFAULT_EFFECTS_SETTINGS } from "../inspector/effects/types";
import type { Clip } from "../model/schema";
import { type ColorFxState, evaluateColorFx } from "./colorEffects";
import {
  CLICK_EFFECT_BASE_PX,
  type CursorMotion,
  bounceScale,
  clickEffectsAt,
  hideIdleAlpha,
  loopBlend,
  motionBlurGhosts,
  swayOffset,
} from "./cursorEffects";
import type { AnnotationLayerState } from "./layers/annotationLayer";
import type { CaptionLayerInput, CaptionLayerState } from "./layers/captionLayer";
import { extendScene } from "./layers/extendScene";
import type { TitleCardLayerState } from "./layers/titleCardLayer";
import type { WebcamLayerInput, WebcamLayerState } from "./layers/webcamLayer";
import { type SceneInput, type SceneState, evaluateScene } from "./scene";
import { sourceTimeAt } from "./timeMapping";

/**
 * Full scene composition — `SceneBuilder.update(tMs)` (§6.4). Evaluates the
 * base scene plus every remaining layer at the same `tMs`. Pure: preview and
 * export call this with the same inputs and get identical `SceneState`s; the
 * shared scene graph (`sceneGraph.ts`) applies them.
 */

export interface ComposeInput extends SceneInput {
  /** Trimmed clip sequence; empty/omitted = identity timeline. */
  clips?: readonly Clip[] | null | undefined;
  /** Timeline duration (loop mode, outro card). */
  durationMs?: number | undefined;
  /** Frame rate that seeds grain (export fps, preview playback fps). */
  fps?: number | undefined;
  /** Indexed telemetry (clicks, idle, cursor types); null → no click/idle effects. */
  motion?: CursorMotion | null | undefined;
  effects?: EffectsSettings | undefined;
  annotations?: readonly Annotation[] | undefined;
  captions?: CaptionLayerInput | undefined;
  webcam?: WebcamLayerInput | undefined;
}

export interface CursorClickFxState {
  kind: "ripple" | "highlight";
  /** Content-local px. */
  x: number;
  y: number;
  radius: number;
  lineWidth: number;
  alpha: number;
  color: string;
}

export interface CursorFxState {
  visible: boolean;
  /** Content-local px (sway + loop applied). */
  x: number;
  y: number;
  /** Sprite height in content-local px. */
  size: number;
  alpha: number;
  /** Bounce click scale. */
  scale: number;
  /** Telemetry cursor type (`arrow`, `ibeam`, …). */
  type: string;
  style: CursorStyle;
  /** Uploaded arrow for the `custom` style, else null. */
  customUrl: string | null;
  ghosts: Array<{ x: number; y: number; alpha: number }>;
  clicks: CursorClickFxState[];
}

export interface SceneComposition {
  annotations: AnnotationLayerState;
  captions: CaptionLayerState;
  webcam: WebcamLayerState;
  titleCard: TitleCardLayerState;
  cursor: CursorFxState;
  color: ColorFxState;
}

const HIDDEN_CURSOR: CursorFxState = {
  visible: false,
  x: 0,
  y: 0,
  size: 0,
  alpha: 0,
  scale: 1,
  type: "arrow",
  style: "macos",
  customUrl: null,
  ghosts: [],
  clicks: [],
};

function evaluateCursorFx(
  input: ComposeInput,
  base: SceneState,
  toSource: (t: number) => number,
): CursorFxState {
  const { cursor, cursorTrack } = input;
  const hidden: CursorFxState = { ...HIDDEN_CURSOR, style: cursor.style };
  if (!base.cursor.visible || !cursorTrack) return hidden;
  const t = base.tMs;
  const { layout, camera } = base;
  const cw = layout.content.width;
  const ch = layout.content.height;
  const crop = base.video.crop;
  const toContent = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: (crop && crop.width > 0 ? (p.x - crop.x) / crop.width : p.x) * cw,
    y: (crop && crop.height > 0 ? (p.y - crop.y) / crop.height : p.y) * ch,
  });
  const zoomK = layout.scale / (camera.scale > 0 ? camera.scale : 1);
  const src = toSource(t);
  const motion = input.motion ?? null;

  const loopW = cursor.loop && input.durationMs !== undefined ? loopBlend(t, input.durationMs) : 0;
  const start = loopW > 0 ? cursorTrack.positionAt(toSource(0)) : null;
  const at = (sourceMs: number): { x: number; y: number } => {
    const p = cursorTrack.positionAt(sourceMs);
    if (!start) return p;
    return { x: p.x + (start.x - p.x) * loopW, y: p.y + (start.y - p.y) * loopW };
  };

  const pos = toContent(at(src));
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return hidden;
  if (cursor.sway && motion) {
    const s = swayOffset(motion.idle, src);
    pos.x += s.x * zoomK;
    pos.y += s.y * zoomK;
  }

  const alpha =
    cursor.hideWhenIdle.enabled && motion
      ? hideIdleAlpha(motion.idle, src, cursor.hideWhenIdle.delaySec * 1000)
      : 1;
  const clicks = motion?.clicks ?? [];
  const scale = cursor.clickEffect.type === "bounce" ? bounceScale(clicks, src) : 1;

  const ghosts: CursorFxState["ghosts"] = [];
  if (cursor.motionBlur.enabled) {
    for (const g of motionBlurGhosts(cursor.motionBlur.amount)) {
      const gp = toContent(at(src - g.backMs));
      if (Math.hypot(gp.x - pos.x, gp.y - pos.y) < 0.5) continue;
      ghosts.push({ x: gp.x, y: gp.y, alpha: g.alpha * alpha });
    }
  }

  const pct = Number.isFinite(cursor.clickEffect.size) ? cursor.clickEffect.size / 100 : 1;
  const clickFx: CursorClickFxState[] = clickEffectsAt(cursor.clickEffect.type, clicks, src).map(
    (fx) => {
      const p = toContent(fx);
      return {
        kind: fx.kind,
        x: p.x,
        y: p.y,
        radius: CLICK_EFFECT_BASE_PX * pct * zoomK * fx.radius,
        lineWidth: 2.5 * zoomK,
        alpha: fx.alpha,
        color: cursor.clickEffect.color,
      };
    },
  );

  return {
    visible: alpha > 0,
    x: pos.x,
    y: pos.y,
    size: base.cursor.size,
    alpha,
    scale,
    type: motion?.typeAt(src) ?? "arrow",
    style: cursor.style,
    customUrl: cursor.style === "custom" ? (cursor.customCursor?.path ?? null) : null,
    ghosts,
    clicks: clickFx,
  };
}

export function composeScene(input: ComposeInput, tMs: number): SceneState {
  const clips = input.clips;
  const toSource =
    input.sourceTimeAt ??
    (clips && clips.length > 0 ? (t: number) => sourceTimeAt(clips, t) : undefined);
  const sceneInput: SceneInput = toSource ? { ...input, sourceTimeAt: toSource } : input;
  const base = evaluateScene(sceneInput, tMs);
  const effects = input.effects ?? DEFAULT_EFFECTS_SETTINGS;
  const layers = extendScene(base, {
    annotations: { annotations: input.annotations ?? [] },
    captions: input.captions,
    webcam: input.webcam,
    titleCards: {
      intro: effects.intro,
      outro: effects.outro,
      timelineDurationMs: input.durationMs ?? 0,
    },
  });
  return {
    ...base,
    composition: {
      annotations: layers.annotations,
      captions: layers.captions,
      webcam: layers.webcam,
      titleCard: layers.titleCard,
      cursor: evaluateCursorFx(input, base, toSource ?? ((t) => t)),
      color: evaluateColorFx(effects.color, base.tMs, input.fps ?? 30),
    },
  };
}

/** Export's `sceneAt`: the same composition preview renders. */
export function createComposedSceneEvaluator(
  input: ComposeInput,
): (timelineMs: number) => SceneState {
  return (timelineMs) => composeScene(input, timelineMs);
}
