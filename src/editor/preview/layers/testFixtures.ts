import { DEFAULT_FRAME_SETTINGS, type FrameSettings } from "../../inspector/frame/types";
import { type FrameLayout, computeFrameLayout } from "../layout";
import type { SceneState } from "../scene";

/** Shared fixtures for layer tests. */

export function layoutFor(
  canvas = { width: 1920, height: 1080 },
  patch: Partial<FrameSettings> = {},
): FrameLayout {
  return computeFrameLayout(
    canvas,
    { ...structuredClone(DEFAULT_FRAME_SETTINGS), ...patch },
    {
      width: 1920,
      height: 1080,
    },
  );
}

export function cameraAt(scale = 1): SceneState["camera"] {
  return {
    scale,
    pivotX: 0,
    pivotY: 0,
    positionX: 0,
    positionY: 0,
    level: scale,
    regionId: null,
    focus: { x: 0.5, y: 0.5 },
    tiltX: 0,
    tiltY: 0,
  };
}
