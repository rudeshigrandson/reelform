import type { ExportPhase } from "../ui/types";

/**
 * Export progress model (ENGINEERING_SPEC §10.7). Progress = frames done /
 * total; ETA from an exponential moving average of per-frame wall time; speed
 * is media time produced per unit of wall time (1 = realtime). The clock is
 * injected so the model is deterministic under test.
 */

export type RenderPhase = Exclude<ExportPhase, "idle" | "done">;

export const PHASE_LABELS: Record<RenderPhase, string> = {
  preparing: "Preparing",
  rendering: "Rendering",
  "encoding-audio": "Encoding audio",
  muxing: "Muxing",
  finalizing: "Finalizing",
};

export type EncoderKind = "hardware" | "software";

export interface ExportProgress {
  phase: RenderPhase;
  label: string;
  framesDone: number;
  framesTotal: number;
  /** framesDone / framesTotal in [0, 1] (1 when there is nothing to render). */
  fraction: number;
  /** Remaining render time estimate, or null before the first frame. */
  etaMs: number | null;
  /** Realtime speed factor, or null before any wall time has elapsed. */
  speed: number | null;
  encoder: EncoderKind;
}

export interface ProgressTrackerOptions {
  framesTotal: number;
  fps: number;
  now: () => number;
  encoder: EncoderKind;
  /** EMA smoothing factor in (0, 1]; default 0.1. */
  alpha?: number | undefined;
  onProgress?: ((p: ExportProgress) => void) | undefined;
}

export const DEFAULT_EMA_ALPHA = 0.1;

export class ProgressTracker {
  private phase: RenderPhase = "preparing";
  private framesDone = 0;
  private emaMs: number | null = null;
  private renderStartMs: number | null = null;
  private lastFrameMs: number | null = null;
  private readonly alpha: number;
  private encoderKind: EncoderKind;

  constructor(private readonly opts: ProgressTrackerOptions) {
    this.encoderKind = opts.encoder;
    const a = opts.alpha ?? DEFAULT_EMA_ALPHA;
    this.alpha = Number.isFinite(a) && a > 0 && a <= 1 ? a : DEFAULT_EMA_ALPHA;
  }

  setPhase(phase: RenderPhase): void {
    this.phase = phase;
    if (phase === "rendering" && this.renderStartMs === null) {
      this.renderStartMs = this.opts.now();
      this.lastFrameMs = this.renderStartMs;
    }
    this.emit();
  }

  /** Record which encoder the attempt actually resolved to. */
  setEncoder(encoder: EncoderKind): void {
    this.encoderKind = encoder;
  }

  frameDone(): void {
    const t = this.opts.now();
    if (this.renderStartMs === null) {
      this.renderStartMs = t;
      this.lastFrameMs = t;
    }
    const dt = Math.max(0, t - (this.lastFrameMs ?? t));
    this.lastFrameMs = t;
    this.emaMs = this.emaMs === null ? dt : this.alpha * dt + (1 - this.alpha) * this.emaMs;
    this.framesDone = Math.min(this.opts.framesTotal, this.framesDone + 1);
    this.emit();
  }

  snapshot(): ExportProgress {
    const { framesTotal, fps } = this.opts;
    const remaining = Math.max(0, framesTotal - this.framesDone);
    const elapsed = this.renderStartMs === null ? 0 : (this.lastFrameMs ?? 0) - this.renderStartMs;
    return {
      phase: this.phase,
      label: PHASE_LABELS[this.phase],
      framesDone: this.framesDone,
      framesTotal,
      fraction: framesTotal > 0 ? this.framesDone / framesTotal : 1,
      etaMs: remaining === 0 ? 0 : this.emaMs === null ? null : this.emaMs * remaining,
      speed: elapsed > 0 && fps > 0 ? (this.framesDone * 1000) / fps / elapsed : null,
      encoder: this.encoderKind,
    };
  }

  private emit(): void {
    this.opts.onProgress?.(this.snapshot());
  }
}
