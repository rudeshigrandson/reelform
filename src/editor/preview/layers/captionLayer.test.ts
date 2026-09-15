import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Caption,
  type CaptionStyle,
  DEFAULT_CAPTION_STYLE,
  type Word,
} from "../../inspector/captions/types";
import {
  CAPTION_EDGE_MARGIN,
  createCaptionLayer,
  evaluateCaptionLayer,
  karaokeWordIndex,
  wrapCaptionLines,
} from "./captionLayer";
import { type FakeContainer, FakeGraphics, type FakeText, fakePixi } from "./fakePixi";
import type { TextStyleLike } from "./pixiTypes";
import { layoutFor } from "./testFixtures";

const words: Word[] = [
  { t0: 1000, t1: 1300, text: "Click" },
  { t0: 1400, t1: 1600, text: "the" },
  { t0: 1700, t1: 2000, text: "export" },
  { t0: 2500, t1: 2900, text: "button" },
];
const caption: Caption = {
  id: "c1",
  startMs: 1000,
  endMs: 3000,
  text: "Click the export button",
  words,
};
const style = (patch: Partial<CaptionStyle> = {}): CaptionStyle => ({
  ...DEFAULT_CAPTION_STYLE,
  ...patch,
});
const layout = layoutFor();

describe("karaokeWordIndex", () => {
  it("tracks the last started word, holding through pauses", () => {
    expect(karaokeWordIndex(words, 999)).toBe(-1);
    expect(karaokeWordIndex(words, 1000)).toBe(0);
    expect(karaokeWordIndex(words, 1650)).toBe(1);
    expect(karaokeWordIndex(words, 2200)).toBe(2);
    expect(karaokeWordIndex(words, 2500)).toBe(3);
    expect(karaokeWordIndex([], 2500)).toBe(-1);
  });
});

describe("wrapCaptionLines", () => {
  it("keeps word indices per line", () => {
    const lines = wrapCaptionLines(words, 12, 2, true);
    expect(lines.map((l) => l.text)).toEqual(["Click the", "export", "button"]);
    expect(lines.map((l) => l.tokens.map((t) => t.wordIndex))).toEqual([[0, 1], [2], [3]]);
  });

  it("property: tokens reproduce all words in order and each line text", () => {
    const wordArb = fc.stringMatching(/^[a-zA-Z']{1,14}$/);
    fc.assert(
      fc.property(
        fc.array(wordArb, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 1, max: 60 }),
        (texts, max) => {
          const ws = texts.map((text, i) => ({ t0: i, t1: i + 1, text }));
          const lines = wrapCaptionLines(ws, max, 2, true);
          expect(lines.flatMap((l) => l.tokens.map((t) => t.wordIndex))).toEqual(
            ws.map((_, i) => i),
          );
          for (const l of lines) expect(l.tokens.map((t) => t.text).join(" ")).toBe(l.text);
        },
      ),
    );
  });
});

describe("evaluateCaptionLayer", () => {
  it("shows the active caption on a half-open range", () => {
    const input = { captions: [caption], style: style() };
    expect(evaluateCaptionLayer(input, 999, layout).visible).toBe(false);
    expect(evaluateCaptionLayer(input, 1000, layout).captionId).toBe("c1");
    expect(evaluateCaptionLayer(input, 3000, layout).visible).toBe(false);
    expect(evaluateCaptionLayer({ ...input, enabled: false }, 1500, layout).visible).toBe(false);
  });

  it("karaoke index only when word highlight is on", () => {
    expect(
      evaluateCaptionLayer({ captions: [caption], style: style() }, 1800, layout).activeWordIndex,
    ).toBe(-1);
    const s = evaluateCaptionLayer(
      { captions: [caption], style: style({ wordHighlight: true }) },
      1800,
      layout,
    );
    expect(s.activeWordIndex).toBe(2);
    expect(s.style.highlightColor).toBe(DEFAULT_CAPTION_STYLE.highlightColor);
  });

  it("falls back to the text when words are stale (edited caption)", () => {
    const edited = { ...caption, text: "Press the big button" };
    const s = evaluateCaptionLayer(
      { captions: [edited], style: style({ wordHighlight: true }) },
      1800,
      layout,
    );
    expect(s.lines.map((l) => l.text)).toEqual(["Press the big button"]);
    expect(s.activeWordIndex).toBe(-1);
    expect(s.lines[0]?.tokens.every((t) => t.wordIndex === -1)).toBe(true);
  });

  it("uppercases and wraps to maxChars", () => {
    const s = evaluateCaptionLayer(
      { captions: [caption], style: style({ uppercase: true }), maxCharsPerLine: 10 },
      1500,
      layout,
    );
    expect(s.lines.map((l) => l.text)).toEqual(["CLICK THE", "EXPORT", "BUTTON"]);
  });

  it("positions bottom / top / custom inside the frame", () => {
    const H = layout.frame.height;
    const bottom = evaluateCaptionLayer({ captions: [caption], style: style() }, 1500, layout);
    const blockH = bottom.lines.length * bottom.lineHeight;
    expect(bottom.top + blockH).toBeCloseTo(H - H * CAPTION_EDGE_MARGIN, 9);
    const top = evaluateCaptionLayer(
      { captions: [caption], style: style({ position: "top" }) },
      1500,
      layout,
    );
    expect(top.top).toBeCloseTo(H * CAPTION_EDGE_MARGIN, 9);
    const custom = evaluateCaptionLayer(
      { captions: [caption], style: style({ position: "custom", customY: 100, bgOpacity: 50 }) },
      1500,
      layout,
    );
    expect(
      custom.top + custom.lines.length * custom.lineHeight + (custom.style.pill?.padY ?? 0),
    ).toBeLessThanOrEqual(H + 1e-9);
    expect(custom.centerX).toBe(layout.frame.width / 2);
  });

  it("maps style: size × layout.scale, outline stroke, pill", () => {
    const s = evaluateCaptionLayer(
      { captions: [caption], style: style({ sizePx: 40, outline: true, bgOpacity: 70 }) },
      1500,
      layout,
    );
    expect(s.style.fontSize).toBeCloseTo(40 * layout.scale, 12);
    expect(s.style.stroke).not.toBeNull();
    expect(s.style.pill?.alpha).toBeCloseTo(0.7, 12);
  });
});

describe("createCaptionLayer (fake pixi)", () => {
  it("colors the current word and draws the pill", () => {
    const layer = createCaptionLayer(fakePixi);
    const s = evaluateCaptionLayer(
      {
        captions: [caption],
        style: style({ wordHighlight: true, bgOpacity: 40, highlightColor: "#ffd60a" }),
      },
      1800,
      layout,
    );
    layer.apply(s);
    const root = layer.container as FakeContainer;
    expect(root.visible).toBe(true);
    const pill = root.children[0] as FakeGraphics;
    expect(pill).toBeInstanceOf(FakeGraphics);
    expect(pill.opNames()).toEqual(["roundRect", "fill"]);
    const texts = (root.children[1] as FakeContainer).children as FakeText[];
    const visible = texts.filter((t) => t.visible);
    const lit = visible.filter((t) => (t.style as TextStyleLike).fill === 0xffd60a);
    expect(lit.map((t) => t.text)).toEqual(["export"]);

    // Next frame without highlight hides spare pooled texts and caption.
    layer.apply(evaluateCaptionLayer({ captions: [caption], style: style() }, 1800, layout));
    expect(texts.filter((t) => t.visible).map((t) => t.text)).toEqual(["Click the export button"]);
    layer.apply(evaluateCaptionLayer({ captions: [caption], style: style() }, 5000, layout));
    expect(root.visible).toBe(false);
  });

  it("centers each line on centerX", () => {
    const layer = createCaptionLayer(fakePixi);
    const s = evaluateCaptionLayer({ captions: [caption], style: style() }, 1500, layout);
    layer.apply(s);
    const [t] = ((layer.container as FakeContainer).children[1] as FakeContainer)
      .children as FakeText[];
    expect((t?.position.x ?? 0) + (t?.width ?? 0) / 2).toBeCloseTo(s.centerX, 9);
  });
});
