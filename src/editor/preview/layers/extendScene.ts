import { DEFAULT_CAPTION_STYLE } from "../../inspector/captions/types";
import { DEFAULT_WEBCAM_SETTINGS } from "../../inspector/webcam/types";
import type { SceneState } from "../scene";
import {
  type AnnotationLayerDrawer,
  type AnnotationLayerInput,
  type AnnotationLayerState,
  createAnnotationLayer,
  evaluateAnnotationLayer,
} from "./annotationLayer";
import {
  type CaptionLayerDrawer,
  type CaptionLayerInput,
  type CaptionLayerState,
  createCaptionLayer,
  evaluateCaptionLayer,
} from "./captionLayer";
import type { LayerPixi } from "./pixiTypes";
import {
  type TitleCardLayerDrawer,
  type TitleCardLayerInput,
  type TitleCardLayerState,
  createTitleCardLayer,
  evaluateTitleCardLayer,
} from "./titleCardLayer";
import {
  type WebcamLayerDrawer,
  type WebcamLayerInput,
  type WebcamLayerState,
  createWebcamLayer,
  evaluateWebcamLayer,
} from "./webcamLayer";

/**
 * Combine the base scene (`evaluateScene`) with the remaining §6.4 layers.
 * Every layer is evaluated at `scene.tMs` against the same layout + camera,
 * so this stays pure and deterministic. A missing input yields a hidden layer.
 */

const NO_CAPTIONS: CaptionLayerInput = {
  captions: [],
  style: DEFAULT_CAPTION_STYLE,
  enabled: false,
};
const NO_WEBCAM: WebcamLayerInput = { settings: DEFAULT_WEBCAM_SETTINGS, hasWebcam: false };

export interface SceneExtras {
  annotations?: AnnotationLayerInput | undefined;
  captions?: CaptionLayerInput | undefined;
  webcam?: WebcamLayerInput | undefined;
  titleCards?: TitleCardLayerInput | undefined;
}

export interface LayersState {
  scene: SceneState;
  annotations: AnnotationLayerState;
  captions: CaptionLayerState;
  webcam: WebcamLayerState;
  titleCard: TitleCardLayerState;
}

export function extendScene(scene: SceneState, extras: SceneExtras): LayersState {
  const { tMs, layout, camera } = scene;
  return {
    scene,
    annotations: evaluateAnnotationLayer(
      extras.annotations ?? { annotations: [] },
      tMs,
      layout,
      camera,
    ),
    captions: evaluateCaptionLayer(extras.captions ?? NO_CAPTIONS, tMs, layout, camera),
    webcam: evaluateWebcamLayer(extras.webcam ?? NO_WEBCAM, tMs, layout, camera),
    titleCard: evaluateTitleCardLayer(
      extras.titleCards ?? { timelineDurationMs: 0 },
      tMs,
      layout,
      camera,
    ),
  };
}

export interface SceneLayers {
  annotations: AnnotationLayerDrawer;
  webcam: WebcamLayerDrawer;
  captions: CaptionLayerDrawer;
  titleCard: TitleCardLayerDrawer;
  apply(state: LayersState): void;
  destroy(): void;
}

/**
 * All layer drawers. Mount (§6.4 order):
 *   CameraContainer ← annotations.container (above VideoSprite, below cursor)
 *   FrameRoot ← annotations.fixedContainer, webcam.container, captions.container, titleCard.container
 */
export function createSceneLayers(pixi: LayerPixi): SceneLayers {
  const annotations = createAnnotationLayer(pixi);
  const webcam = createWebcamLayer(pixi);
  const captions = createCaptionLayer(pixi);
  const titleCard = createTitleCardLayer(pixi);
  return {
    annotations,
    webcam,
    captions,
    titleCard,
    apply(state) {
      annotations.apply(state.annotations);
      webcam.apply(state.webcam);
      captions.apply(state.captions);
      titleCard.apply(state.titleCard);
    },
    destroy() {
      annotations.destroy();
      webcam.destroy();
      captions.destroy();
      titleCard.destroy();
    },
  };
}
