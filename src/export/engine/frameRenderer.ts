import { type SceneInput, type SceneState, evaluateScene } from "../../editor/preview/scene";

/**
 * Export frame renderer port (ENGINEERING_SPEC §10.1 route 1). The engine
 * hands a `SceneState` (evaluated exactly as in preview) and the decoded
 * source frame; the renderer returns a NEW image the engine re-stamps with the
 * output timestamp and closes. The source frame is owned (and closed) by the
 * engine — renderers must not close or retain it past the returned promise.
 */
export interface FrameRenderer {
  render(state: SceneState, frame: VideoFrame | null): Promise<VideoFrame | ImageBitmap>;
  /**
   * Webcam frame drawn by the next `render` (null detaches it). Owned and
   * closed by the caller. Renderers without it cannot draw the webcam bubble.
   */
  setWebcamFrame?(frame: VideoFrame | null): void;
  /**
   * Cross-dissolve: the incoming clip's first frame drawn over the video at
   * `SceneState.transition.mix` by the next `render` (null detaches it). Owned
   * and closed by the caller.
   */
  setNextVideoFrame?(frame: VideoFrame | null): void;
  destroy(): void;
}

/** Scene evaluation at timeline time — the same `evaluateScene` preview uses. */
export function createSceneEvaluator(input: SceneInput): (timelineMs: number) => SceneState {
  return (timelineMs) => evaluateScene(input, timelineMs);
}
