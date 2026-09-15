import { wrapWords } from "../../captions/wrap";
import { findActiveCaption } from "../../inspector/captions/logic";
import type { Caption, CaptionStyle, Word } from "../../inspector/captions/types";
import type { FrameLayout } from "../layout";
import type { SceneState } from "../scene";
import { clamp, finiteOr, parseColor } from "./geometry";
import type {
  ContainerLike,
  FontWeightLike,
  GraphicsLike,
  LayerPixi,
  TextLike,
  TextStyleLike,
} from "./pixiTypes";

/**
 * CaptionLayer (ENGINEERING_SPEC §6.4 / §9.6): burn-in captions. Positions are
 * frame-local px (the layer sits on FrameRoot). Font size is authored in px at
 * the 1920 long-edge reference, scaled by `layout.scale`.
 */

/** Segmentation default (§9.6). */
export const CAPTION_MAX_CHARS_PER_LINE = 42;
/** Distance from the top/bottom frame edge, fraction of frame height. */
export const CAPTION_EDGE_MARGIN = 0.07;
export const CAPTION_LINE_HEIGHT = 1.25;
/** Gap between word tokens in karaoke mode, fraction of font size. */
export const CAPTION_WORD_GAP = 0.28;

export interface CaptionLayerInput {
  captions: readonly Caption[];
  style: CaptionStyle;
  /** Burn-in switch; defaults to true. */
  enabled?: boolean | undefined;
  maxCharsPerLine?: number | undefined;
}

export interface CaptionToken {
  text: string;
  /** Index into the caption's `words`, or -1 when words don't match the text. */
  wordIndex: number;
}

export interface CaptionLine {
  text: string;
  tokens: CaptionToken[];
}

export interface CaptionTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: FontWeightLike;
  color: string;
  /** Current-word color in karaoke mode, or null. */
  highlightColor: string | null;
  stroke: { color: string; width: number } | null;
  pill: { color: string; alpha: number; padX: number; padY: number; radius: number } | null;
}

export interface CaptionLayerState {
  visible: boolean;
  captionId: string | null;
  lines: CaptionLine[];
  /** Karaoke current word (index into caption words), -1 for none. */
  activeWordIndex: number;
  /** Frame-local center x of every line. */
  centerX: number;
  /** Frame-local top of the first line (pill padding excluded). */
  top: number;
  lineHeight: number;
  style: CaptionTextStyle;
}

/**
 * Karaoke current word: the last word whose `t0 <= tMs` — it stays lit through
 * the pause that follows it. -1 before the first word.
 */
export function karaokeWordIndex(words: readonly Word[], tMs: number): number {
  let idx = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w && w.t0 <= tMs) idx = i;
  }
  return idx;
}

const norm = (s: string): string => s.replace(/\s+/gu, " ").trim();

/** Words that describe `caption.text`; falls back to pseudo-words when stale. */
function captionWords(c: Caption): { words: Word[]; timed: boolean } {
  if (c.words.length > 0 && norm(c.words.map((w) => w.text).join(" ")) === norm(c.text)) {
    return { words: [...c.words], timed: true };
  }
  const words = norm(c.text)
    .split(" ")
    .filter((t) => t.length > 0)
    .map((text) => ({ t0: c.startMs, t1: c.endMs, text }));
  return { words, timed: false };
}

/** Wrap with the shared greedy wrapper, keeping each token's word index. */
export function wrapCaptionLines(
  words: readonly Word[],
  maxCharsPerLine: number,
  maxLines: number,
  timed: boolean,
): CaptionLine[] {
  const { lines } = wrapWords(words, maxCharsPerLine, maxLines);
  const out: CaptionLine[] = [];
  let wi = 0;
  for (const line of lines) {
    const tokens: CaptionToken[] = [];
    let acc = "";
    while (wi < words.length && acc.length < line.length) {
      const w = words[wi];
      if (!w) break;
      acc = acc.length === 0 ? w.text : `${acc} ${w.text}`;
      tokens.push({ text: w.text, wordIndex: timed ? wi : -1 });
      wi++;
    }
    out.push({ text: line, tokens });
  }
  return out;
}

function textStyle(style: CaptionStyle, k: number): CaptionTextStyle {
  const fontSize = Math.max(1, finiteOr(style.sizePx, 40) * k);
  const bgAlpha = clamp(finiteOr(style.bgOpacity, 0), 0, 100) / 100;
  return {
    fontFamily: style.font,
    fontSize,
    fontWeight: style.preset === "bold" ? "800" : "600",
    color: style.color,
    highlightColor: style.wordHighlight ? style.highlightColor : null,
    stroke: style.outline ? { color: "#000000", width: Math.max(1, fontSize * 0.08) } : null,
    pill:
      bgAlpha > 0
        ? {
            color: style.bgColor,
            alpha: bgAlpha,
            padX: fontSize * 0.45,
            padY: fontSize * 0.2,
            radius: fontSize * 0.3,
          }
        : null,
  };
}

export function evaluateCaptionLayer(
  input: CaptionLayerInput,
  tMs: number,
  layout: FrameLayout,
  _camera?: SceneState["camera"] | undefined,
): CaptionLayerState {
  const k = Number.isFinite(layout.scale) && layout.scale > 0 ? layout.scale : 0;
  const style = textStyle(input.style, k);
  const W = layout.frame.width;
  const H = layout.frame.height;
  const lineHeight = style.fontSize * CAPTION_LINE_HEIGHT;
  const hidden: CaptionLayerState = {
    visible: false,
    captionId: null,
    lines: [],
    activeWordIndex: -1,
    centerX: W / 2,
    top: 0,
    lineHeight,
    style,
  };
  if (input.enabled === false || !Number.isFinite(tMs)) return hidden;
  const caption = findActiveCaption(input.captions, tMs);
  if (!caption) return hidden;

  const { words: raw, timed } = captionWords(caption);
  const words = input.style.uppercase
    ? raw.map((w) => ({ ...w, text: w.text.toLocaleUpperCase() }))
    : raw;
  if (words.length === 0) return hidden;
  const maxChars = Math.max(
    1,
    Math.floor(
      finiteOr(input.maxCharsPerLine ?? CAPTION_MAX_CHARS_PER_LINE, CAPTION_MAX_CHARS_PER_LINE),
    ),
  );
  const maxLines = Math.max(1, Math.floor(finiteOr(input.style.maxLines, 2)));
  const lines = wrapCaptionLines(words, maxChars, maxLines, timed);

  const blockH = lines.length * lineHeight;
  const padY = style.pill?.padY ?? 0;
  const margin = H * CAPTION_EDGE_MARGIN;
  let top: number;
  switch (input.style.position) {
    case "top":
      top = margin + padY;
      break;
    case "custom": {
      const cy = (clamp(finiteOr(input.style.customY, 85), 0, 100) / 100) * H;
      top = clamp(cy - blockH / 2, padY, Math.max(padY, H - blockH - padY));
      break;
    }
    default:
      top = H - margin - padY - blockH;
  }

  return {
    visible: true,
    captionId: caption.id,
    lines,
    activeWordIndex: timed && style.highlightColor !== null ? karaokeWordIndex(words, tMs) : -1,
    centerX: W / 2,
    top,
    lineHeight,
    style,
  };
}

// ── Pixi drawer ──────────────────────────────────────────────────────────────

export interface CaptionLayerDrawer {
  /** Add to FrameRoot above the webcam bubble. */
  container: ContainerLike;
  apply(state: CaptionLayerState): void;
  destroy(): void;
}

export function createCaptionLayer(pixi: LayerPixi): CaptionLayerDrawer {
  const container = new pixi.Container({ label: "CaptionLayer" });
  const pill: GraphicsLike = new pixi.Graphics({ label: "CaptionPill" });
  const textRoot = new pixi.Container({ label: "CaptionText" });
  container.addChild(pill, textRoot);
  const pool: TextLike[] = [];

  const textAt = (i: number): TextLike => {
    let t = pool[i];
    if (!t) {
      t = new pixi.Text({ text: "", label: "CaptionToken" });
      pool.push(t);
      textRoot.addChild(t);
    }
    t.visible = true;
    return t;
  };

  return {
    container,
    apply(state) {
      container.visible = state.visible;
      if (!state.visible) return;
      const s = state.style;
      const base: TextStyleLike = {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        fill: parseColor(s.color, 0xffffff).color,
        align: "center",
      };
      if (s.stroke)
        base.stroke = { color: parseColor(s.stroke.color).color, width: s.stroke.width };
      const highlight =
        s.highlightColor !== null ? parseColor(s.highlightColor, 0xffd60a).color : null;
      const karaoke = highlight !== null && state.activeWordIndex >= 0;
      const gap = s.fontSize * CAPTION_WORD_GAP;

      let used = 0;
      let maxWidth = 0;
      state.lines.forEach((line, li) => {
        const y = state.top + li * state.lineHeight;
        // One Text per line unless a word in this line needs its own color.
        const split = karaoke && line.tokens.some((tk) => tk.wordIndex === state.activeWordIndex);
        const pieces = split ? line.tokens : [{ text: line.text, wordIndex: -1 }];
        const texts = pieces.map((p) => {
          const t = textAt(used++);
          t.text = p.text;
          t.style =
            split && p.wordIndex === state.activeWordIndex && highlight !== null
              ? { ...base, fill: highlight }
              : base;
          t.anchor.set(0, 0);
          return t;
        });
        const lineWidth =
          texts.reduce((sum, t) => sum + t.width, 0) + gap * Math.max(0, texts.length - 1);
        maxWidth = Math.max(maxWidth, lineWidth);
        let x = state.centerX - lineWidth / 2;
        for (const t of texts) {
          t.position.set(x, y);
          x += t.width + gap;
        }
      });
      for (let i = used; i < pool.length; i++) {
        const t = pool[i];
        if (t) t.visible = false;
      }

      pill.clear();
      if (s.pill && state.lines.length > 0) {
        const c = parseColor(s.pill.color);
        const h = state.lines.length * state.lineHeight + s.pill.padY * 2;
        const w = maxWidth + s.pill.padX * 2;
        pill
          .roundRect(state.centerX - w / 2, state.top - s.pill.padY, w, h, s.pill.radius)
          .fill({ color: c.color, alpha: s.pill.alpha * c.alpha });
      }
    },
    destroy() {
      pool.length = 0;
      container.destroy({ children: true });
    },
  };
}
