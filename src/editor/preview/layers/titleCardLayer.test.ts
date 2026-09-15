import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type FakeContainer, FakeGraphics, type FakeText, fakePixi } from "./fakePixi";
import { layoutFor } from "./testFixtures";
import {
  TITLE_CARD_FADE_MS,
  createTitleCardLayer,
  evaluateTitleCardLayer,
  titleTextColor,
} from "./titleCardLayer";

const layout = layoutFor();
const intro = { text: "Welcome", bg: "#111114", durationMs: 2000 };
const outro = { text: "Thanks", bg: "#f5f5f5", durationMs: 2000 };
const input = { intro, outro, timelineDurationMs: 10_000 };

describe("evaluateTitleCardLayer", () => {
  it("intro: opaque, then fades out to reveal content", () => {
    expect(evaluateTitleCardLayer(input, 0, layout)).toMatchObject({
      visible: true,
      which: "intro",
      bgAlpha: 1,
    });
    expect(evaluateTitleCardLayer(input, 2000 - TITLE_CARD_FADE_MS, layout).bgAlpha).toBe(1);
    const mid = evaluateTitleCardLayer(input, 2000 - TITLE_CARD_FADE_MS / 2, layout).bgAlpha;
    expect(mid).toBeCloseTo(0.5, 12);
    expect(evaluateTitleCardLayer(input, 2000, layout).visible).toBe(false);
  });

  it("outro: fades in and holds until the end", () => {
    expect(evaluateTitleCardLayer(input, 7999, layout).visible).toBe(false);
    expect(evaluateTitleCardLayer(input, 8000, layout).visible).toBe(false);
    expect(evaluateTitleCardLayer(input, 8000 + TITLE_CARD_FADE_MS, layout)).toMatchObject({
      which: "outro",
      bgAlpha: 1,
      text: "Thanks",
      textColor: "#111114",
    });
    expect(evaluateTitleCardLayer(input, 10_000, layout).bgAlpha).toBe(1);
    expect(evaluateTitleCardLayer(input, 10_001, layout).visible).toBe(false);
  });

  it("hidden without cards; intro wins on overlap", () => {
    expect(evaluateTitleCardLayer({ timelineDurationMs: 5000 }, 100, layout).visible).toBe(false);
    const tight = { intro, outro, timelineDurationMs: 3000 };
    expect(evaluateTitleCardLayer(tight, 1500, layout).which).toBe("intro");
    expect(evaluateTitleCardLayer(tight, 2500, layout).which).toBe("outro");
  });

  it("picks contrasting text color", () => {
    expect(titleTextColor("#000000")).toBe("#ffffff");
    expect(titleTextColor("#ffffff")).toBe("#111114");
  });

  it("property: alphas within [0,1]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 20000, noNaN: true }),
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 20000 }),
        (t, di, dout, total) => {
          const s = evaluateTitleCardLayer(
            {
              intro: { ...intro, durationMs: di },
              outro: { ...outro, durationMs: dout },
              timelineDurationMs: total,
            },
            t,
            layout,
          );
          expect(s.bgAlpha).toBeGreaterThanOrEqual(0);
          expect(s.bgAlpha).toBeLessThanOrEqual(1);
          expect(s.textAlpha).toBeGreaterThanOrEqual(0);
          expect(s.textAlpha).toBeLessThanOrEqual(1);
          if (s.visible) expect(s.bgAlpha).toBeGreaterThan(0);
        },
      ),
    );
  });
});

describe("createTitleCardLayer (fake pixi)", () => {
  it("fills the frame and applies alpha", () => {
    const layer = createTitleCardLayer(fakePixi);
    const s = evaluateTitleCardLayer(input, 1900, layout);
    layer.apply(s);
    const root = layer.container as FakeContainer;
    const [bg, text] = root.children as [FakeGraphics, FakeText];
    expect(bg).toBeInstanceOf(FakeGraphics);
    expect(bg.ops[0]).toEqual(["rect", 0, 0, layout.frame.width, layout.frame.height]);
    expect(bg.alpha).toBeCloseTo(s.bgAlpha, 12);
    expect(text.text).toBe("Welcome");
    expect(text.position.x).toBeCloseTo(layout.frame.width / 2, 9);
    layer.apply(evaluateTitleCardLayer(input, 5000, layout));
    expect(root.visible).toBe(false);
  });
});
