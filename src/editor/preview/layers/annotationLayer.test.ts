import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Annotation,
  type AnnotationKind,
  type AnnotationOf,
  DEFAULT_BASE,
  DEFAULT_BASE_OVERRIDES,
  DEFAULT_PROPS,
} from "../../inspector/annotations/types";
import { createAnnotationLayer, evaluateAnnotationLayer } from "./annotationLayer";
import { type FakeContainer, type FakeGraphics, type FakeText, fakePixi } from "./fakePixi";
import { layoutFor } from "./testFixtures";

const NONE = { type: "none", direction: "up", ms: 0 } as const;

function ann<K extends AnnotationKind>(
  kind: K,
  patch: Partial<AnnotationOf<K>> = {},
): AnnotationOf<K> {
  return {
    ...DEFAULT_BASE,
    ...DEFAULT_BASE_OVERRIDES[kind],
    ...DEFAULT_PROPS[kind],
    id: `${kind}-1`,
    startMs: 0,
    endMs: 1000,
    animIn: NONE,
    animOut: NONE,
    ...patch,
    // Spreading a generic-keyed default loses the discriminant link; the
    // fixture is structurally a valid AnnotationOf<K>.
  } as unknown as AnnotationOf<K>;
}

const layout = layoutFor();

describe("evaluateAnnotationLayer", () => {
  it("routes followZoom items to content space and fixed items to frame space", () => {
    const a = ann("rect", { id: "a", followZoom: true, x: 0.5, y: 0.25, w: 0.1, h: 0.2 });
    const b = ann("keystrokeBadge", { id: "b", label: "⌘K" });
    const s = evaluateAnnotationLayer({ annotations: [a, b] }, 500, layout);
    expect(s.content.map((i) => i.id)).toEqual(["a"]);
    expect(s.frame.map((i) => i.id)).toEqual(["b"]);
    const item = s.content[0];
    const dx = layout.content.x - layout.frame.x;
    const dy = layout.content.y - layout.frame.y;
    expect(dx).toBeGreaterThan(0); // default frame has padding, so the offset matters
    expect(item?.x).toBeCloseTo(0.5 * layout.frame.width - dx, 9);
    expect(item?.y).toBeCloseTo(0.25 * layout.frame.height - dy, 9);
    expect(item?.width).toBeCloseTo(0.1 * layout.frame.width, 9);
    const badge = s.frame[0];
    expect(badge?.x).toBeCloseTo(b.x * layout.frame.width, 9);
    expect(badge?.draw).toEqual({ kind: "keystrokeBadge", label: "⌘K" });
  });

  it("skips items outside their time range", () => {
    const a = ann("text", { startMs: 100, endMs: 200 });
    expect(evaluateAnnotationLayer({ annotations: [a] }, 50, layout).content).toEqual([]);
    expect(evaluateAnnotationLayer({ annotations: [a] }, 200, layout).content).toEqual([]);
    expect(evaluateAnnotationLayer({ annotations: [a] }, 150, layout).content).toHaveLength(1);
  });

  it("combines annotation opacity with the animation and converts rotation to radians", () => {
    const a = ann("highlight", {
      opacity: 0.5,
      rotation: 90,
      animIn: { type: "fade", direction: "up", ms: 200 },
    });
    const [item] = evaluateAnnotationLayer({ annotations: [a] }, 0, layout).content;
    expect(item?.alpha).toBe(0);
    const [held] = evaluateAnnotationLayer({ annotations: [a] }, 500, layout).content;
    expect(held?.alpha).toBe(0.5);
    expect(held?.rotation).toBeCloseTo(Math.PI / 2, 12);
  });

  it("scales reference px by layout.scale", () => {
    const small = layoutFor({ width: 960, height: 540 });
    const a = ann("arrow", { strokeWidth: 10 });
    const [item] = evaluateAnnotationLayer({ annotations: [a] }, 10, small).content;
    expect(item?.draw.kind === "arrow" && item.draw.strokeWidth).toBeCloseTo(10 * small.scale, 12);
  });

  it("emits blur/pixelate as region descriptors and images only with a source", () => {
    const blur = ann("blur", { id: "bl", pixelate: true, strength: 20 });
    const img = ann("image", { id: "im", src: "" });
    const img2 = ann("image", { id: "im2", src: "media/logo.png" });
    const s = evaluateAnnotationLayer({ annotations: [blur, img, img2] }, 10, layout);
    expect(s.content).toEqual([]);
    expect(s.effects).toHaveLength(1);
    expect(s.effects[0]?.mode).toBe("pixelate");
    expect(s.effects[0]?.strength).toBeCloseTo(20 * layout.scale, 12);
    expect(s.images.map((i) => i.id)).toEqual(["im2"]);
  });

  it("bakes pop scale into effect rects around the center", () => {
    const blur = ann("blur", {
      x: 0.2,
      y: 0.2,
      w: 0.2,
      h: 0.2,
      animIn: { type: "pop", direction: "up", ms: 200 },
    });
    const [r] = evaluateAnnotationLayer({ annotations: [blur] }, 0, layout).effects;
    const W = layout.frame.width;
    const H = layout.frame.height;
    const dx = layout.content.x - layout.frame.x;
    const dy = layout.content.y - layout.frame.y;
    expect(r?.rect.width).toBeCloseTo(0.2 * W * 0.6, 9);
    expect((r?.rect.x ?? 0) + (r?.rect.width ?? 0) / 2).toBeCloseTo(0.3 * W - dx, 9);
    expect((r?.rect.y ?? 0) + (r?.rect.height ?? 0) / 2).toBeCloseTo(0.3 * H - dy, 9);
  });

  it("blur regions always live in content space so they track the content (§9.7)", () => {
    const fixedBlur = ann("blur", { id: "fb", followZoom: false, x: 0.1, y: 0.1 });
    const [r] = evaluateAnnotationLayer({ annotations: [fixedBlur] }, 0, layout).effects;
    expect(r?.space).toBe("content");
    expect(r?.rect.x).toBeCloseTo(
      0.1 * layout.frame.width - (layout.content.x - layout.frame.x),
      9,
    );
  });

  it("property: toggling followZoom does not move an item at zoom 1", () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.double({ min: -0.5, max: 1.5, noNaN: true }),
          y: fc.double({ min: -0.5, max: 1.5, noNaN: true }),
          w: fc.double({ min: 0, max: 1, noNaN: true }),
          h: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 200, max: 3000 }),
        fc.integer({ min: 200, max: 3000 }),
        (geo, padding, cw, ch) => {
          const l = layoutFor(
            { width: cw, height: ch },
            {
              padding: {
                all: padding,
                matchAll: true,
                top: padding,
                right: padding,
                bottom: padding,
                left: padding,
              },
            },
          );
          const on = evaluateAnnotationLayer(
            { annotations: [ann("rect", { ...geo, followZoom: true })] },
            10,
            l,
          ).content[0];
          const off = evaluateAnnotationLayer(
            { annotations: [ann("rect", { ...geo, followZoom: false })] },
            10,
            l,
          ).frame[0];
          if (!on || !off) throw new Error("expected both items");
          // Content-local + ContentGroup offset == frame-local.
          expect(on.x + (l.content.x - l.frame.x)).toBeCloseTo(off.x, 6);
          expect(on.y + (l.content.y - l.frame.y)).toBeCloseTo(off.y, 6);
          expect(on.width).toBeCloseTo(off.width, 9);
          expect(on.height).toBeCloseTo(off.height, 9);
        },
      ),
    );
  });
});

describe("createAnnotationLayer (fake pixi)", () => {
  const all: Annotation[] = [
    ann("text", { id: "t" }),
    ann("arrow", { id: "a", dashed: true }),
    ann("line", { id: "l" }),
    ann("rect", { id: "r" }),
    ann("ellipse", { id: "e" }),
    ann("highlight", { id: "h" }),
    ann("emoji", { id: "em" }),
    ann("numberBadge", { id: "n", value: 3 }),
    ann("keystrokeBadge", { id: "k", label: "⌘K" }),
  ];

  it("draws every drawable kind into the right container", () => {
    const layer = createAnnotationLayer(fakePixi);
    const state = evaluateAnnotationLayer({ annotations: all }, 10, layout);
    layer.apply(state);
    const content = layer.container as FakeContainer;
    const fixed = layer.fixedContainer as FakeContainer;
    expect(content.children.map((c) => c.label)).toEqual(
      ["t", "a", "l", "r", "e", "h", "em", "n"].map((id) => `Annotation:${id}`),
    );
    expect(fixed.children.map((c) => c.label)).toEqual(["Annotation:k"]);

    const gfx = (root: FakeContainer | undefined): FakeGraphics =>
      root?.children[0] as FakeGraphics;
    const text = (root: FakeContainer | undefined): FakeText => root?.children[1] as FakeText;
    const byId = (id: string): FakeContainer | undefined =>
      [...content.children, ...fixed.children].find((c) => c.label === `Annotation:${id}`);

    expect(gfx(byId("a")).opNames()).toContain("poly");
    expect(
      gfx(byId("a"))
        .opNames()
        .filter((o) => o === "moveTo").length,
    ).toBeGreaterThan(1);
    expect(gfx(byId("e")).opNames()).toContain("ellipse");
    expect(gfx(byId("n")).opNames()).toContain("circle");
    expect(text(byId("n")).text).toBe("3");
    expect(text(byId("k")).text).toBe("⌘K");
    expect(gfx(byId("k")).opNames()).toEqual(["roundRect", "fill"]);
    // Default rect fill is fully transparent → stroke only.
    expect(gfx(byId("r")).opNames()).toEqual(["roundRect", "stroke"]);

    const t = byId("k");
    const item = state.frame[0];
    expect(t?.position.x).toBeCloseTo((item?.x ?? 0) + (item?.width ?? 0) / 2, 9);
  });

  it("repaints only on geometry/style change and removes stale nodes", () => {
    const layer = createAnnotationLayer(fakePixi);
    const a = ann("rect", { id: "r" });
    layer.apply(evaluateAnnotationLayer({ annotations: [a] }, 10, layout));
    const root = (layer.container as FakeContainer).children[0];
    const g = root?.children[0] as FakeGraphics;
    const ops = g.ops;
    layer.apply(evaluateAnnotationLayer({ annotations: [a] }, 20, layout));
    expect(g.ops).toBe(ops);
    layer.apply(
      evaluateAnnotationLayer({ annotations: [{ ...a, stroke: "#00ff00" }] }, 20, layout),
    );
    expect(g.ops).not.toBe(ops);

    layer.apply(evaluateAnnotationLayer({ annotations: [a] }, 5000, layout));
    expect((layer.container as FakeContainer).children).toEqual([]);
    expect(root?.destroyed).toBe(true);
  });

  it("moves a node when followZoom flips", () => {
    const layer = createAnnotationLayer(fakePixi);
    const a = ann("emoji", { id: "x", followZoom: true });
    layer.apply(evaluateAnnotationLayer({ annotations: [a] }, 10, layout));
    layer.apply(
      evaluateAnnotationLayer({ annotations: [{ ...a, followZoom: false }] }, 10, layout),
    );
    expect((layer.container as FakeContainer).children).toEqual([]);
    expect((layer.fixedContainer as FakeContainer).children.map((c) => c.label)).toEqual([
      "Annotation:x",
    ]);
  });
});
