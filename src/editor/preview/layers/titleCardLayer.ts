import type { TitleCard } from "../../inspector/effects/types";
import type { FrameLayout } from "../layout";
import type { SceneState } from "../scene";
import { type RectPx, clamp, finiteOr, luminance, parseColor } from "./geometry";
import type { ContainerLike, LayerPixi } from "./pixiTypes";

/**
 * TitleCardLayer (ENGINEERING_SPEC §6.4 / §9.8): intro/outro cards occupy
 * prepended/appended timeline time — intro `[0, durationMs)`, outro
 * `[timelineDurationMs - durationMs, timelineDurationMs]`. The intro's
 * background fades out over its last `TITLE_CARD_FADE_MS` to reveal the
 * content; the outro's fades in over its first. Text fades with its card.
 */

export const TITLE_CARD_FADE_MS = 400;
/** Title font size in reference px (1920 long edge). */
export const TITLE_CARD_FONT_PX = 72;
export const TITLE_CARD_FONT = "Inter, system-ui, sans-serif";

export interface TitleCardLayerInput {
  intro?: TitleCard | null | undefined;
  outro?: TitleCard | null | undefined;
  /** Total timeline length including intro/outro time. */
  timelineDurationMs: number;
}

export interface TitleCardLayerState {
  visible: boolean;
  which: "intro" | "outro" | null;
  text: string;
  bgColor: string;
  bgAlpha: number;
  textColor: string;
  textAlpha: number;
  fontSize: number;
  /** Frame-local rect covering the whole frame. */
  rect: RectPx;
}

const smooth = (p: number): number => {
  const q = clamp(p, 0, 1);
  return q * q * (3 - 2 * q);
};

/** Text color with enough contrast against the card background. */
export function titleTextColor(bg: string): string {
  return luminance(parseColor(bg, 0x111114).color) > 0.4 ? "#111114" : "#ffffff";
}

export function evaluateTitleCardLayer(
  input: TitleCardLayerInput,
  tMs: number,
  layout: FrameLayout,
  _camera?: SceneState["camera"] | undefined,
): TitleCardLayerState {
  const k = Number.isFinite(layout.scale) && layout.scale > 0 ? layout.scale : 0;
  const rect: RectPx = { x: 0, y: 0, width: layout.frame.width, height: layout.frame.height };
  const hidden: TitleCardLayerState = {
    visible: false,
    which: null,
    text: "",
    bgColor: "#000000",
    bgAlpha: 0,
    textColor: "#ffffff",
    textAlpha: 0,
    fontSize: TITLE_CARD_FONT_PX * k,
    rect,
  };
  if (!Number.isFinite(tMs)) return hidden;
  const total = Math.max(0, finiteOr(input.timelineDurationMs, 0));

  const card = (c: TitleCard, which: "intro" | "outro", bgAlpha: number): TitleCardLayerState => ({
    visible: bgAlpha > 0,
    which,
    text: c.text,
    bgColor: c.bg,
    bgAlpha,
    textColor: titleTextColor(c.bg),
    textAlpha: bgAlpha,
    fontSize: TITLE_CARD_FONT_PX * k,
    rect,
  });

  const intro = input.intro;
  if (intro) {
    const d = Math.max(0, finiteOr(intro.durationMs, 0));
    if (tMs >= 0 && tMs < d) {
      const fade = Math.min(TITLE_CARD_FADE_MS, d / 2);
      const alpha = fade > 0 ? smooth((d - tMs) / fade) : 1;
      return card(intro, "intro", alpha);
    }
  }
  const outro = input.outro;
  if (outro) {
    const d = Math.max(0, finiteOr(outro.durationMs, 0));
    const start = total - d;
    const introEnd = intro ? Math.max(0, finiteOr(intro.durationMs, 0)) : 0;
    if (d > 0 && tMs >= Math.max(start, introEnd) && tMs <= total) {
      const fade = Math.min(TITLE_CARD_FADE_MS, d / 2);
      const alpha = fade > 0 ? smooth((tMs - start) / fade) : 1;
      return card(outro, "outro", alpha);
    }
  }
  return hidden;
}

// ── Pixi drawer ──────────────────────────────────────────────────────────────

export interface TitleCardLayerDrawer {
  /** Add to FrameRoot as the topmost layer. */
  container: ContainerLike;
  apply(state: TitleCardLayerState): void;
  destroy(): void;
}

export function createTitleCardLayer(pixi: LayerPixi): TitleCardLayerDrawer {
  const container = new pixi.Container({ label: "TitleCardLayer" });
  const bg = new pixi.Graphics({ label: "TitleCardBackground" });
  const text = new pixi.Text({ text: "", label: "TitleCardText" });
  text.anchor.set(0.5, 0.5);
  container.addChild(bg, text);
  let key = "";

  return {
    container,
    apply(state) {
      container.visible = state.visible;
      if (!state.visible) return;
      const { rect } = state;
      const nextKey = JSON.stringify([
        state.bgColor,
        rect,
        state.text,
        state.textColor,
        state.fontSize,
      ]);
      if (nextKey !== key) {
        key = nextKey;
        bg.clear()
          .rect(rect.x, rect.y, rect.width, rect.height)
          .fill({ color: parseColor(state.bgColor, 0x111114).color });
        text.text = state.text;
        text.style = {
          fontFamily: TITLE_CARD_FONT,
          fontSize: Math.max(1, state.fontSize),
          fontWeight: "700",
          fill: parseColor(state.textColor, 0xffffff).color,
          align: "center",
        };
        text.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2);
      }
      bg.alpha = state.bgAlpha;
      text.alpha = state.textAlpha;
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
