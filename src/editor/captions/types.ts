/**
 * Local types for caption segmentation (ENGINEERING_SPEC §9.6).
 *
 * These are standalone and kept structurally compatible with the project's
 * schema `Caption` shape (`{ id, startMs, endMs, text, words }`). The M0
 * `schema.ts` does not yet export a `Caption`, so we define the output type
 * here rather than importing one; when the schema grows a `Caption`, this
 * type should remain assignable to it.
 */

/** A whisper-style word timestamp. Times are absolute milliseconds. */
export interface Word {
  /** Start time of the word, in ms. */
  readonly t0: number;
  /** End time of the word, in ms. */
  readonly t1: number;
  /** The word text (no surrounding whitespace). */
  readonly text: string;
}

/** A single caption row produced by segmentation. */
export interface Caption {
  /** Stable, deterministic id (index-based). */
  readonly id: string;
  /** Caption start time, in ms (first word's t0). */
  readonly startMs: number;
  /** Caption end time, in ms (last word's t1). */
  readonly endMs: number;
  /**
   * Rendered caption text. Contains a `\n` line break where the caption
   * wraps onto a second line.
   */
  readonly text: string;
  /** The words that make up this caption, in order. */
  readonly words: readonly Word[];
}

/** Options controlling segmentation. All are optional with spec defaults. */
export interface SegmentOptions {
  /** Max characters per rendered line. Default 42. */
  readonly maxCharsPerLine?: number;
  /** Max lines per caption. Default 2. */
  readonly maxLines?: number;
  /** Minimum caption duration in ms; short trailing captions merge back. Default 700. */
  readonly minDurationMs?: number;
  /** Split when the gap between adjacent words exceeds this, in ms. Default 350. */
  readonly pauseSplitMs?: number;
}

/** Fully-resolved options (defaults applied). */
export interface ResolvedSegmentOptions {
  readonly maxCharsPerLine: number;
  readonly maxLines: number;
  readonly minDurationMs: number;
  readonly pauseSplitMs: number;
}
