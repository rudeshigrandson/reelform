import { describe, expect, it } from "vitest";
import { buildExportSceneGraph } from "../../export/engine/pixiFrameRenderer";
import { createAnnotation } from "../inspector/annotations/annotations";
import type { Annotation, AnnotationKind } from "../inspector/annotations/types";
import { DEFAULT_CAPTION_STYLE } from "../inspector/captions/types";
import { DEFAULT_CURSOR_SETTINGS } from "../inspector/cursor/types";
import { DEFAULT_EFFECTS_SETTINGS } from "../inspector/effects/types";
import { DEFAULT_FRAME_SETTINGS } from "../inspector/frame/types";
import { DEFAULT_WEBCAM_SETTINGS } from "../inspector/webcam/types";
import { type ComposeInput, composeScene } from "./compose";
import { buildCursorMotion } from "./cursorEffects";
import type { CursorPack } from "./cursorPack";
import { buildSmoothedCursorTrack } from "./cursorSmoothing";
import {
  FakeContainer,
  FakeGraphics,
  FakeSprite,
  FakeText,
  createFakeScenePixi,
  fakeTexture,
  findByLabel,
} from "./layers/fakePixi";
import { buildPreviewSceneGraph } from "./pixiStage";
import type { SceneState } from "./scene";
import {
  type SceneAssets,
  type TextureLike,
  fitImage,
  rotatedRectPoints,
  withAlpha,
} from "./sceneGraph";
import { resolveMediaPath } from "./scenePixi";
import { wallpaperRegistry } from "./wallpapers";

// ── fixtures ────────────────────────────────────────────────────────────────

function makeAnnotation(kind: AnnotationKind, patch: Record<string, unknown>): Annotation {
  const a = createAnnotation(kind, {
    id: String(patch.id ?? kind),
    playheadMs: 0,
    timelineDurationMs: 5000,
  });
  return { ...a, ...patch } as Annotation;
}

const track = buildSmoothedCursorTrack([
  { tMs: 0, x: 0.2, y: 0.3, cursorType: "arrow" },
  { tMs: 1000, x: 0.6, y: 0.5, cursorType: "ibeam" },
  { tMs: 4000, x: 0.61, y: 0.5, cursorType: "ibeam" },
]);

const motion = buildCursorMotion({
  points: [
    { tMs: 0, x: 0.2, y: 0.3, cursorType: "arrow" },
    { tMs: 1000, x: 0.6, y: 0.5, cursorType: "ibeam" },
    { tMs: 4000, x: 0.61, y: 0.5, cursorType: "ibeam" },
  ],
  clicks: [
    [900, 0.55, 0.5, "left", "down"],
    [950, 0.55, 0.5, "left", "up"],
  ],
});

function richInput(patch: Partial<ComposeInput> = {}): ComposeInput {
  const frame = structuredClone(DEFAULT_FRAME_SETTINGS);
  frame.squircle = true;
  frame.border = { width: 2, color: "#ffffff", opacity: 50 };
  frame.background = { ...frame.background, kind: "wallpaper", wallpaperId: "mesh-1" };
  const cursor = structuredClone(DEFAULT_CURSOR_SETTINGS);
  cursor.motionBlur = { enabled: true, amount: 60 };
  const effects = structuredClone(DEFAULT_EFFECTS_SETTINGS);
  effects.color = { brightness: 10, contrast: -5, saturation: 20, grain: true, vignette: 40 };
  effects.intro = { text: "Hello", bg: "#111114", durationMs: 600 };
  return {
    canvas: { width: 1280, height: 720 },
    frame,
    sourceSize: { width: 1920, height: 1080 },
    zoomRegions: [
      {
        id: "z",
        startMs: 800,
        endMs: 3000,
        level: 2,
        focus: { mode: "fixed", x: 0.5, y: 0.5 },
        easeInMs: 300,
        easeOutMs: 300,
        curve: "ease-out-cubic",
        source: "manual",
      },
    ],
    cursor,
    cursorTrack: track,
    hasVideo: true,
    wallpapers: wallpaperRegistry([
      {
        id: "mesh-1",
        name: "Mesh",
        category: "Mesh",
        kind: "mesh",
        angle: 0,
        stops: [{ offset: 0, color: "#101820" }],
        points: [{ x: 0.3, y: 0.3, color: "#ff5a5f", radius: 0.5 }],
      },
    ]),
    durationMs: 5000,
    fps: 30,
    motion,
    effects,
    annotations: [
      makeAnnotation("text", { id: "t1", startMs: 0, endMs: 5000, followZoom: true }),
      makeAnnotation("blur", { id: "b1", startMs: 0, endMs: 5000 }),
      makeAnnotation("blur", {
        id: "p1",
        startMs: 0,
        endMs: 5000,
        pixelate: true,
        rotation: 30,
      } as never),
      makeAnnotation("image", {
        id: "i1",
        startMs: 0,
        endMs: 5000,
        src: "media/logo.png",
        fit: "contain",
      } as never),
    ],
    captions: {
      captions: [{ id: "c1", startMs: 0, endMs: 5000, text: "hello world", words: [] }],
      style: DEFAULT_CAPTION_STYLE,
      enabled: true,
    },
    webcam: {
      settings: DEFAULT_WEBCAM_SETTINGS,
      hasWebcam: true,
      sourceSize: { width: 1280, height: 720 },
    },
    ...patch,
  };
}

function fakeAssets(
  opts: { pack?: CursorPack | null; textures?: Record<string, TextureLike> } = {},
): SceneAssets & { loads: string[] } {
  const loads: string[] = [];
  return {
    loads,
    loadTexture: async (url) => {
      loads.push(url);
      return opts.textures?.[url] ?? null;
    },
    loadCursorPack: async () => opts.pack ?? null,
    resolveMediaUrl: (p) => resolveMediaPath(p, "reelform-media://root/"),
  };
}

const PACK: CursorPack = {
  id: "macos",
  size: 32,
  files: { arrow: "/cursors/macos/arrow.svg", ibeam: "/cursors/macos/ibeam.svg" },
  hotspots: { arrow: { x: 4, y: 2 }, ibeam: { x: 16, y: 16 } },
};

const TEXTURES = {
  "reelform-media://root/media/logo.png": fakeTexture(200, 100, "logo"),
  "/cursors/macos/arrow.svg": fakeTexture(64, 64, "arrow"),
  "/cursors/macos/ibeam.svg": fakeTexture(32, 64, "ibeam"),
};

// ── snapshot ────────────────────────────────────────────────────────────────

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const clean = (v: unknown): unknown => {
  if (typeof v === "number") return r6(v);
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (typeof x !== "function") o[k] = clean(x);
    return o;
  }
  return v;
};

function snapshot(n: FakeContainer): unknown {
  const base: Record<string, unknown> = {
    label: n.label,
    visible: n.visible,
    alpha: r6(n.alpha),
    rotation: r6(n.rotation),
    position: [r6(n.position.x), r6(n.position.y)],
    scale: [r6(n.scale.x), r6(n.scale.y)],
    pivot: [r6(n.pivot.x), r6(n.pivot.y)],
    mask: n.mask instanceof FakeContainer ? n.mask.label : null,
    filters: clean(n.filters),
    filterArea: clean(n.filterArea),
  };
  if (n instanceof FakeGraphics) base.ops = clean(n.ops);
  if (n instanceof FakeSprite) {
    base.size = [r6(n.width), r6(n.height)];
    base.texture = clean(n.texture);
  }
  if (n instanceof FakeText) base.text = [n.text, clean(n.style)];
  base.children = n.children.map(snapshot);
  return base;
}

function build(kind: "preview" | "export", assets: SceneAssets) {
  const pixi = createFakeScenePixi();
  const graph =
    kind === "preview"
      ? buildPreviewSceneGraph(pixi, { assets })
      : buildExportSceneGraph(pixi, { assets });
  return { graph, root: graph.root as FakeContainer };
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("scene graph parity (preview vs export)", () => {
  it("the same SceneState yields identical display trees at every time", async () => {
    const assets = fakeAssets({ pack: PACK, textures: TEXTURES });
    const preview = build("preview", assets);
    const exp = build("export", assets);
    const videoTex = fakeTexture(1920, 1080, "video");
    preview.graph.setVideoTexture(videoTex);
    exp.graph.setVideoTexture(videoTex);
    const webcamTex = fakeTexture(1280, 720, "webcam");
    preview.graph.setWebcamTexture(webcamTex);
    exp.graph.setWebcamTexture(webcamTex);

    const input = richInput();
    for (const t of [0, 300, 920, 1500, 2900, 4800]) {
      const state = composeScene(input, t);
      preview.graph.apply(state);
      exp.graph.apply(state);
      expect(snapshot(preview.root)).toEqual(snapshot(exp.root));
    }
    await Promise.all([preview.graph.whenIdle(), exp.graph.whenIdle()]);
    const state = composeScene(input, 1500);
    preview.graph.apply(state);
    exp.graph.apply(state);
    expect(snapshot(preview.root)).toEqual(snapshot(exp.root));
  });

  it("re-applying a state is idempotent and composition is deterministic", () => {
    const { graph, root } = build("preview", fakeAssets());
    const a = composeScene(richInput(), 1234);
    const b = composeScene(richInput(), 1234);
    expect(a).toEqual(b);
    graph.apply(a);
    const first = snapshot(root);
    graph.apply(b);
    expect(snapshot(root)).toEqual(first);
  });
});

describe("scene graph structure", () => {
  const labels = (n: FakeContainer): string[] => n.children.map((c) => c.label);

  it("mounts layers in §6.4 order", () => {
    const { graph, root } = build("export", fakeAssets());
    graph.apply(composeScene(richInput(), 0));
    expect(labels(root)).toEqual([
      "Background",
      "ContentGroup",
      "AnnotationImagesFixed",
      "AnnotationLayerFixed",
      "WebcamBubble",
      "CaptionLayer",
      "TitleCardLayer",
      "Vignette",
    ]);
    const camera = findByLabel(root, "CameraContainer")[0] as FakeContainer;
    expect(labels(camera)).toEqual([
      "Placeholder",
      "VideoSprite",
      "VideoSpriteNext",
      "EffectRegions",
      "AnnotationImages",
      "AnnotationLayer",
      "ClickEffects",
      "CursorGhosts",
      "Cursor",
    ]);
  });

  it("cross-dissolve draws the next-clip texture over the video at the transition mix", () => {
    const { graph, root } = build("preview", fakeAssets());
    graph.setVideoTexture(fakeTexture(1920, 1080, "video"));
    const clips = [
      { id: "a", sourceStartMs: 0, sourceEndMs: 2000, timelineStartMs: 0 },
      { id: "b", sourceStartMs: 3000, sourceEndMs: 5000, timelineStartMs: 2000 },
    ];
    const effects = structuredClone(DEFAULT_EFFECTS_SETTINGS);
    effects.transition = { kind: "cross-dissolve", durationMs: 400 };
    const input = richInput({ clips, effects });
    const next = findByLabel(root, "VideoSpriteNext")[0] as FakeSprite;

    // No texture yet → hidden even mid-dissolve.
    graph.apply(composeScene(input, 1800));
    expect(next.visible).toBe(false);

    graph.setNextVideoTexture(fakeTexture(1920, 1080, "next"));
    const mid = composeScene(input, 1800);
    graph.apply(mid);
    expect(next.visible).toBe(true);
    expect(next.alpha).toBeCloseTo(mid.transition?.mix ?? -1, 10);
    const video = findByLabel(root, "VideoSprite")[0] as FakeSprite;
    expect([next.width, next.height]).toEqual([video.width, video.height]);

    graph.apply(composeScene(input, 1000));
    expect(next.visible).toBe(false);
    graph.setNextVideoTexture(null);
    graph.apply(mid);
    expect(next.visible).toBe(false);
  });

  it("3D tilt skews the camera and parallax offsets an overscanned background", () => {
    const { graph, root } = build("preview", fakeAssets());
    const cam = findByLabel(root, "CameraContainer")[0] as FakeContainer;
    const bg = findByLabel(root, "Background")[0] as FakeContainer;
    const moving = buildSmoothedCursorTrack(
      Array.from({ length: 41 }, (_, i) => ({ tMs: i * 100, x: 0.1 + i * 0.02, y: 0.5 })),
      { smoothing: 0 },
    );
    const effects = structuredClone(DEFAULT_EFFECTS_SETTINGS);
    effects.motion = { tilt3d: true, parallax: true };
    const input = richInput({
      effects,
      cursorTrack: moving,
      zoomRegions: [
        {
          id: "f",
          startMs: 0,
          endMs: 4000,
          level: 2,
          focus: { mode: "follow", x: 0.5, y: 0.5 },
          easeInMs: 200,
          easeOutMs: 200,
          curve: "linear",
          source: "manual",
        },
      ],
    });
    const state = composeScene(input, 2000);
    graph.apply(state);
    expect(state.camera.tiltX).not.toBe(0);
    expect([cam.skew.x, cam.skew.y]).toEqual([state.camera.tiltX, state.camera.tiltY]);
    expect(bg.scale.x).toBeGreaterThan(1);
    const { width, height } = state.layout.frame;
    expect(bg.pivot.x).toBeCloseTo(width / 2, 6);
    expect(bg.position.x).toBeCloseTo(width / 2 + state.background.offsetX, 6);
    expect(bg.position.y).toBeCloseTo(height / 2 + state.background.offsetY, 6);

    graph.apply(composeScene(richInput(), 2000));
    expect([cam.skew.x, cam.skew.y]).toEqual([0, 0]);
    expect([bg.scale.x, bg.position.x, bg.pivot.x]).toEqual([1, 0, 0]);
  });

  it("squircle mask is a superellipse polygon; plain radius uses roundRect", () => {
    const { graph, root } = build("preview", fakeAssets());
    graph.apply(composeScene(richInput(), 0));
    const mask = findByLabel(root, "Mask")[0] as FakeGraphics;
    expect(mask.opNames()).toEqual(["poly", "fill"]);
    const plain = richInput();
    plain.frame.squircle = false;
    graph.apply(composeScene(plain, 0));
    expect(mask.opNames()).toEqual(["roundRect", "fill"]);
  });

  it("shows the placeholder until a video texture is attached", () => {
    const { graph, root } = build("preview", fakeAssets());
    graph.apply(composeScene(richInput(), 0));
    const ph = findByLabel(root, "Placeholder")[0] as FakeGraphics;
    const vid = findByLabel(root, "VideoSprite")[0] as FakeSprite;
    expect([ph.visible, vid.visible]).toEqual([true, false]);
    graph.setVideoTexture(fakeTexture(1920, 1080));
    graph.apply(composeScene(richInput(), 0));
    expect([ph.visible, vid.visible]).toEqual([false, true]);
  });

  it("blur and pixelate regions are masked copies of the video with their filters", () => {
    const { graph, root } = build("preview", fakeAssets());
    const tex = fakeTexture(1920, 1080, "video");
    graph.setVideoTexture(tex);
    graph.apply(composeScene(richInput(), 1000));
    const regions = findByLabel(root, "EffectRegions")[0] as FakeContainer;
    expect(regions.children.map((c) => c.label)).toEqual(["EffectRegion:b1", "EffectRegion:p1"]);
    const [blur, pix] = regions.children.map((c) => c.children[0] as FakeSprite);
    expect(blur?.texture).toBe(tex);
    expect((blur?.filters as Array<{ kind: string }>)[0]?.kind).toBe("blur");
    expect((pix?.filters as Array<{ kind: string }>)[0]?.kind).toBe("pixelate");
    expect(blur?.mask).toBeInstanceOf(FakeGraphics);
    // Removing an annotation drops its region.
    graph.apply(composeScene(richInput({ annotations: [] }), 1000));
    expect(regions.children).toHaveLength(0);
  });

  it("image annotations wait for their texture, then fit contain", async () => {
    const assets = fakeAssets({ textures: TEXTURES });
    const { graph, root } = build("export", assets);
    const input = richInput();
    graph.apply(composeScene(input, 0));
    const node = findByLabel(root, "AnnotationImage:i1")[0] as FakeContainer;
    expect(node.visible).toBe(false);
    expect(graph.hasPendingAssets()).toBe(true);
    await graph.whenIdle();
    expect(assets.loads).toContain("reelform-media://root/media/logo.png");
    graph.apply(composeScene(input, 0));
    expect(node.visible).toBe(true);
    const sprite = node.children[0] as FakeSprite;
    expect(sprite.width / sprite.height).toBeCloseTo(2);
  });

  it("cursor: drawn arrow without a pack, pack sprite with hotspot once loaded", async () => {
    const noPack = build("preview", fakeAssets({ pack: null }));
    noPack.graph.apply(composeScene(richInput(), 2000));
    await noPack.graph.whenIdle();
    noPack.graph.apply(composeScene(richInput(), 2000));
    const cur = findByLabel(noPack.root, "Cursor")[0] as FakeContainer;
    expect(cur.children.map((c) => c.visible)).toEqual([true, false]);

    const withPack = build("preview", fakeAssets({ pack: PACK, textures: TEXTURES }));
    // Pack loads first; its sprite texture is requested on the next apply.
    withPack.graph.apply(composeScene(richInput(), 2000));
    await withPack.graph.whenIdle();
    withPack.graph.apply(composeScene(richInput(), 2000));
    expect(withPack.graph.hasPendingAssets()).toBe(true);
    await withPack.graph.whenIdle();
    const state = composeScene(richInput(), 2000);
    withPack.graph.apply(state);
    const c2 = findByLabel(withPack.root, "Cursor")[0] as FakeContainer;
    const sprite = c2.children[1] as FakeSprite;
    expect(c2.children.map((c) => c.visible)).toEqual([false, true]);
    const size = state.composition?.cursor.size ?? 0;
    expect(state.composition?.cursor.type).toBe("ibeam");
    expect(sprite.height).toBeCloseTo(size);
    expect(sprite.width).toBeCloseTo(size / 2);
    expect(sprite.position.x).toBeCloseTo(-16 * (size / 32));
  });

  it("draws click ripples and motion blur ghosts", () => {
    const { graph, root } = build("preview", fakeAssets());
    const state = composeScene(richInput(), 950);
    graph.apply(state);
    const clicks = findByLabel(root, "ClickEffects")[0] as FakeGraphics;
    expect(clicks.opNames()).toContain("circle");
    const ghosts = findByLabel(root, "CursorGhosts")[0] as FakeContainer;
    expect(ghosts.children.filter((g) => g.visible).length).toBe(
      state.composition?.cursor.ghosts.length,
    );
    expect(state.composition?.cursor.ghosts.length).toBeGreaterThan(0);
  });

  it("applies color matrix + seeded grain to FrameRoot and a vignette overlay", () => {
    const { graph, root } = build("export", fakeAssets());
    graph.apply(composeScene(richInput(), 0));
    const kinds = (root.filters as Array<{ kind: string }>).map((f) => f.kind);
    expect(kinds).toEqual(["colorMatrix", "noise"]);
    const seed0 = (root.filters as Array<{ seed?: number }>)[1]?.seed;
    graph.apply(composeScene(richInput(), 100));
    expect((root.filters as Array<{ seed?: number }>)[1]?.seed).not.toBe(seed0);
    expect((findByLabel(root, "Vignette")[0] as FakeGraphics).visible).toBe(true);

    const plain = richInput({ effects: DEFAULT_EFFECTS_SETTINGS });
    graph.apply(composeScene(plain, 0));
    expect(root.filters).toEqual([]);
    expect((findByLabel(root, "Vignette")[0] as FakeGraphics).visible).toBe(false);
  });

  it("webcam texture attaches a sprite to the bubble; base-only states hide layers", () => {
    const { graph, root } = build("preview", fakeAssets());
    graph.setWebcamTexture(fakeTexture(1280, 720));
    graph.apply(composeScene(richInput(), 1000));
    expect(findByLabel(root, "WebcamSprite")).toHaveLength(1);
    const { composition: _c, ...base } = composeScene(richInput(), 1000);
    graph.apply(base as SceneState);
    expect((findByLabel(root, "WebcamBubble")[0] as FakeContainer).visible).toBe(false);
    graph.setWebcamTexture(null);
    expect(findByLabel(root, "WebcamSprite")).toHaveLength(0);
  });

  it("destroy tears down the tree and ignores later calls", () => {
    const { graph, root } = build("preview", fakeAssets());
    graph.apply(composeScene(richInput(), 0));
    graph.destroy();
    expect(root.destroyed).toBe(true);
    graph.apply(composeScene(richInput(), 0));
    graph.destroy();
  });
});

describe("scene graph helpers", () => {
  it("fitImage contain / cover / fill", () => {
    expect(fitImage(100, 100, 200, 100, "contain")).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    });
    expect(fitImage(100, 100, 200, 100, "cover")).toEqual({
      x: -50,
      y: 0,
      width: 200,
      height: 100,
    });
    expect(fitImage(100, 50, 10, 10, "fill")).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(fitImage(100, 50, 0, 10, "contain")).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it("withAlpha / rotatedRectPoints / resolveMediaPath", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("#ff000080");
    const pts = rotatedRectPoints(0, 0, 10, 10, Math.PI / 2);
    expect(pts[0]).toBeCloseTo(10);
    expect(pts[1]).toBeCloseTo(0);
    expect(resolveMediaPath("media/a.png", "reelform-media://r")).toBe(
      "reelform-media://r/media/a.png",
    );
    expect(resolveMediaPath("reelform-media://x/y.png", null)).toBe("reelform-media://x/y.png");
    expect(resolveMediaPath("media/a.png", null)).toBeNull();
    expect(resolveMediaPath("", "x")).toBeNull();
  });
});
