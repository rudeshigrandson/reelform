import type { SceneState } from "../../editor/preview/scene";
import type { FrameRenderer } from "./frameRenderer";
import { DecoderClosedError, type FrameSource } from "./streamingDecoder";

/**
 * Webcam bubble frames for export (ENGINEERING_SPEC §6.4 WebcamBubble, §9.4,
 * §10.2). The webcam track is decoded by a second frame source that shares the
 * §10.8 held-frame budget with the screen decoder. Timeline → webcam time uses
 * the same clip/speed mapping as the screen track (the planned frame's
 * `sourceMs`) plus `syncOffsetMs`, exactly like the preview's webcam element
 * (`decideVideoSync` with `offsetMs`). Visibility (enabled, visibility regions)
 * comes from the composed scene, so export and preview agree.
 *
 * A missing or unreadable webcam never fails the export: the feed turns
 * unavailable, reports once, and the bubble is hidden for the rest of the run.
 */

export const WEBCAM_UNAVAILABLE_NOTICE =
  "Webcam footage couldn't be read — exported without the webcam bubble";

/** Webcam source time for a planned frame, or null when it maps to no clip. */
export function webcamSourceMsFor(sourceMs: number | null, syncOffsetMs: number): number | null {
  if (sourceMs === null || !Number.isFinite(sourceMs)) return null;
  const offset = Number.isFinite(syncOffsetMs) ? syncOffsetMs : 0;
  return Math.max(0, sourceMs + offset);
}

/** The scene with the webcam bubble hidden (no placeholder is drawn). */
export function withoutWebcam(state: SceneState): SceneState {
  const c = state.composition;
  if (!c?.webcam.visible) return state;
  return { ...state, composition: { ...c, webcam: { ...c.webcam, visible: false } } };
}

export interface WebcamFeedOptions {
  /** Opens the webcam frame source (called lazily, again after `release`). */
  open: (() => Promise<FrameSource>) | null;
  syncOffsetMs: number;
  renderer: FrameRenderer;
  /** Called once, the first time the webcam turns out to be unreadable. */
  onUnavailable?: ((error: unknown) => void) | undefined;
}

export interface WebcamPrepared {
  /** Scene to render (bubble hidden when no frame could be supplied). */
  state: SceneState;
  /** Frame attached to the renderer; close it right after `render`. */
  frame: VideoFrame | null;
}

export class WebcamFeed {
  private source: FrameSource | null = null;
  private attached = false;
  private generation = 0;
  private error: unknown = null;
  private failed = false;

  constructor(private readonly opts: WebcamFeedOptions) {}

  /** True once the webcam source failed to open or decode. */
  get unavailable(): boolean {
    return this.failed;
  }

  get lastError(): unknown {
    return this.error;
  }

  /**
   * Fetch the webcam frame for a planned frame and attach it to the renderer.
   * `isAborted` distinguishes cancellation (rethrown) from webcam failures.
   */
  async prepare(
    state: SceneState,
    sourceMs: number | null,
    isAborted: () => boolean,
  ): Promise<WebcamPrepared> {
    if (!state.composition?.webcam.visible) {
      this.detach();
      return { state, frame: null };
    }
    const setFrame = this.opts.renderer.setWebcamFrame?.bind(this.opts.renderer);
    const open = this.opts.open;
    const t = webcamSourceMsFor(sourceMs, this.opts.syncOffsetMs);
    if (t === null || this.failed || !setFrame || !open) {
      this.detach();
      return { state: withoutWebcam(state), frame: null };
    }
    let frame: VideoFrame | null = null;
    try {
      if (!this.source) {
        const gen = this.generation;
        const opened = await open();
        if (gen !== this.generation) {
          opened.close();
          throw new DecoderClosedError("webcam feed released");
        }
        this.source = opened;
      }
      frame = await this.source.frameAt(t);
      setFrame(frame);
      this.attached = true;
      return { state, frame };
    } catch (e) {
      frame?.close();
      if (isAborted()) throw e;
      this.fail(e);
      this.detach();
      return { state: withoutWebcam(state), frame: null };
    }
  }

  /** Close the decoder (keeps the unavailable flag; reopens on next use). */
  release(): void {
    this.generation++;
    const s = this.source;
    this.source = null;
    s?.close();
  }

  private detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.opts.renderer.setWebcamFrame?.(null);
  }

  private fail(e: unknown): void {
    this.release();
    if (this.failed) return;
    this.failed = true;
    this.error = e;
    this.opts.onUnavailable?.(e);
  }
}
