import type { SceneState } from "../../editor/preview/scene";
import type { FrameRenderer } from "./frameRenderer";
import type { FrameSource } from "./streamingDecoder";

/**
 * Second video frame for cross-dissolve transitions (ENGINEERING_SPEC §9.8),
 * the export counterpart of the preview's extra hidden <video>: while
 * `SceneState.transition` is a cross-dissolve with `mix > 0`, the incoming
 * clip's first frame (`incomingSourceMs`) is decoded once from a dedicated
 * decoder, held for the whole dissolve window and attached with
 * `renderer.setNextVideoFrame`. At most one extra frame is ever held.
 *
 * A decoder that fails to open or decode disables dissolves for the rest of
 * the attempt; the cut then renders as a hard cut rather than failing export.
 */

/** Decoder window for the incoming-frame decoder (boundaries only move forward). */
export const TRANSITION_DECODER_WINDOW = 2;

export interface TransitionFeedOptions {
  open: (() => Promise<FrameSource>) | null;
  renderer: FrameRenderer;
}

export class TransitionFeed {
  private source: FrameSource | null = null;
  private frame: VideoFrame | null = null;
  private frameMs: number | null = null;
  private failed = false;

  constructor(private readonly opts: TransitionFeedOptions) {}

  /** Attach (or detach) the incoming frame for `scene`. */
  async prepare(scene: SceneState, aborted: () => boolean): Promise<void> {
    const { renderer, open } = this.opts;
    const tr = scene.transition;
    const wantMs =
      tr?.kind === "cross-dissolve" &&
      tr.mix > 0 &&
      open !== null &&
      !this.failed &&
      typeof renderer.setNextVideoFrame === "function"
        ? tr.incomingSourceMs
        : null;
    if (wantMs === null) {
      this.detach();
      return;
    }
    if (this.frame && this.frameMs === wantMs) return;
    this.detach();
    try {
      this.source ??= await (open as () => Promise<FrameSource>)();
      if (aborted()) return;
      const frame = await this.source.frameAt(wantMs);
      if (aborted()) {
        frame.close();
        return;
      }
      this.frame = frame;
      this.frameMs = wantMs;
      renderer.setNextVideoFrame?.(frame);
    } catch (e) {
      if (aborted()) throw e;
      this.failed = true;
      this.release();
    }
  }

  /** Detach and close the held frame (the decoder stays open). */
  detach(): void {
    if (!this.frame) return;
    this.opts.renderer.setNextVideoFrame?.(null);
    this.frame.close();
    this.frame = null;
    this.frameMs = null;
  }

  /** Detach and close the decoder. */
  release(): void {
    this.detach();
    this.source?.close();
    this.source = null;
  }
}
