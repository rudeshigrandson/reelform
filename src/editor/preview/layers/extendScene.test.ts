import { describe, expect, it } from "vitest";
import { DEFAULT_BASE, DEFAULT_PROPS } from "../../inspector/annotations/types";
import { DEFAULT_CAPTION_STYLE } from "../../inspector/captions/types";
import { DEFAULT_CURSOR_SETTINGS } from "../../inspector/cursor/types";
import { DEFAULT_FRAME_SETTINGS } from "../../inspector/frame/types";
import { DEFAULT_WEBCAM_SETTINGS } from "../../inspector/webcam/types";
import type { ZoomRegion } from "../../inspector/zoom/types";
import { type SceneInput, evaluateScene } from "../scene";
import { evaluateAnnotationLayer } from "./annotationLayer";
import { type SceneExtras, createSceneLayers, extendScene } from "./extendScene";
import { type FakeContainer, fakePixi } from "./fakePixi";
import { evaluateWebcamLayer } from "./webcamLayer";

const zoom: ZoomRegion = {
  id: "z",
  startMs: 1000,
  endMs: 5000,
  level: 2,
  focus: { mode: "fixed", x: 0.5, y: 0.5 },
  easeInMs: 500,
  easeOutMs: 500,
  curve: "ease-out-cubic",
  source: "manual",
};

const sceneInput: SceneInput = {
  canvas: { width: 1280, height: 720 },
  frame: structuredClone(DEFAULT_FRAME_SETTINGS),
  sourceSize: { width: 1920, height: 1080 },
  zoomRegions: [zoom],
  cursor: structuredClone(DEFAULT_CURSOR_SETTINGS),
  hasVideo: true,
};

const extras: SceneExtras = {
  annotations: {
    annotations: [
      {
        ...DEFAULT_BASE,
        ...DEFAULT_PROPS.keystrokeBadge,
        label: "⌘K",
        followZoom: false,
        id: "k",
        startMs: 0,
        endMs: 6000,
      },
    ],
  },
  captions: {
    captions: [{ id: "c", startMs: 0, endMs: 6000, text: "Hello there", words: [] }],
    style: DEFAULT_CAPTION_STYLE,
  },
  webcam: { settings: DEFAULT_WEBCAM_SETTINGS, hasWebcam: true },
  titleCards: {
    intro: { text: "Intro", bg: "#000000", durationMs: 500 },
    timelineDurationMs: 6000,
  },
};

describe("extendScene", () => {
  it("hides every layer when no extras are given", () => {
    const l = extendScene(evaluateScene(sceneInput, 3000), {});
    expect(l.annotations).toEqual({ content: [], frame: [], effects: [], images: [] });
    expect(l.captions.visible).toBe(false);
    expect(l.webcam.visible).toBe(false);
    expect(l.titleCard.visible).toBe(false);
  });

  it("evaluates each layer at the scene time with its layout and camera", () => {
    const scene = evaluateScene(sceneInput, 3000);
    const l = extendScene(scene, extras);
    expect(l.scene).toBe(scene);
    expect(l.annotations).toEqual(
      evaluateAnnotationLayer(extras.annotations ?? { annotations: [] }, 3000, scene.layout),
    );
    expect(l.captions.captionId).toBe("c");
    expect(scene.camera.scale).toBe(2);
    expect(l.webcam).toEqual(
      evaluateWebcamLayer(
        extras.webcam ?? { settings: DEFAULT_WEBCAM_SETTINGS, hasWebcam: false },
        3000,
        scene.layout,
        scene.camera,
      ),
    );
    expect(l.webcam.scale).toBeCloseTo(1 / 1.5, 12);
    expect(l.titleCard.visible).toBe(false);
    expect(extendScene(evaluateScene(sceneInput, 100), extras).titleCard.which).toBe("intro");
  });

  it("is deterministic", () => {
    for (const t of [0, 400, 1200, 3000, 5500]) {
      expect(extendScene(evaluateScene(sceneInput, t), extras)).toEqual(
        extendScene(evaluateScene(sceneInput, t), extras),
      );
    }
  });
});

describe("createSceneLayers (fake pixi)", () => {
  it("applies all layers from one LayersState", () => {
    const layers = createSceneLayers(fakePixi);
    layers.apply(extendScene(evaluateScene(sceneInput, 3000), extras));
    expect((layers.annotations.fixedContainer as FakeContainer).children).toHaveLength(1);
    expect(layers.captions.container.visible).toBe(true);
    expect(layers.webcam.container.visible).toBe(true);
    expect(layers.titleCard.container.visible).toBe(false);
    layers.destroy();
    expect((layers.captions.container as FakeContainer).destroyed).toBe(true);
  });
});
