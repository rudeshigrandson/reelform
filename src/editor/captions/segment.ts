/**
 * Caption segmentation (ENGINEERING_SPEC §9.6).
 *
 * Turns whisper-style word timestamps into caption rows subject to:
 *  - at most `maxLines` lines of at most `maxCharsPerLine` chars,
 *  - a split on sentence-ending punctuation (. ! ? …),
 *  - a split on inter-word pauses greater than `pauseSplitMs`,
 *  - a minimum caption duration of `minDurationMs`, enforced by merging a
 *    too-short trailing caption back into its predecessor where possible.
 *
 * Pure and deterministic: no Date.now / Math.random. Given identical input
 * and options it always yields identical output.
 */

import type { Caption, ResolvedSegmentOptions, SegmentOptions, Word } from "./types.js";
import { wrapText, wrapWords } from "./wrap.js";

const DEFAULTS: ResolvedSegmentOptions = {
  maxCharsPerLine: 42,
  maxLines: 2,
  minDurationMs: 700,
  pauseSplitMs: 350,
};

/** Sentence-ending characters that force a caption boundary after a word. */
const SENTENCE_ENDINGS = [".", "!", "?", "…"] as const;

/** True if `text` ends with sentence-ending punctuation (ignoring closing quotes/brackets). */
export function endsSentence(text: string): boolean {
  // Trim trailing closing punctuation like quotes/parens so `word."` still counts.
  const trimmed = text.replace(/["'”’)\]}]+$/u, "");
  const last = trimmed.at(-1);
  if (last === undefined) return false;
  return (SENTENCE_ENDINGS as readonly string[]).includes(last);
}

function resolveOptions(options: SegmentOptions | undefined): ResolvedSegmentOptions {
  if (options === undefined) return DEFAULTS;
  return {
    maxCharsPerLine: options.maxCharsPerLine ?? DEFAULTS.maxCharsPerLine,
    maxLines: options.maxLines ?? DEFAULTS.maxLines,
    minDurationMs: options.minDurationMs ?? DEFAULTS.minDurationMs,
    pauseSplitMs: options.pauseSplitMs ?? DEFAULTS.pauseSplitMs,
  };
}

/**
 * Phase 1: group words into raw caption word-arrays honoring capacity,
 * pause and punctuation boundaries. No timing/merge logic here.
 */
function groupWords(words: readonly Word[], opts: ResolvedSegmentOptions): Word[][] {
  const groups: Word[][] = [];
  let current: Word[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // `noUncheckedIndexedAccess`: guard even though i is in range.
    if (word === undefined) continue;

    if (current.length === 0) {
      current.push(word);
      continue;
    }

    const prev = current[current.length - 1];
    // prev is always defined here (current is non-empty).
    const pause = prev !== undefined ? word.t0 - prev.t1 : 0;
    const forcedByPause = pause > opts.pauseSplitMs;
    const forcedByPunct = prev !== undefined && endsSentence(prev.text);

    if (forcedByPause || forcedByPunct) {
      groups.push(current);
      current = [word];
      continue;
    }

    // Capacity: would adding `word` still fit within maxLines x maxCharsPerLine?
    const candidate = [...current, word];
    if (wrapWords(candidate, opts.maxCharsPerLine, opts.maxLines).fits) {
      current.push(word);
    } else {
      groups.push(current);
      current = [word];
    }
  }

  if (current.length > 0) groups.push(current);
  return groups;
}

function durationOf(words: readonly Word[]): number {
  const first = words[0];
  const last = words[words.length - 1];
  if (first === undefined || last === undefined) return 0;
  return last.t1 - first.t0;
}

/**
 * Phase 2: enforce the min-duration rule by merging a too-short caption into
 * its predecessor. We only merge when the merge does not break the capacity
 * constraint (still wraps into <= maxLines); otherwise the short caption is
 * left as-is (spec: "where possible").
 */
function mergeShort(groups: Word[][], opts: ResolvedSegmentOptions): Word[][] {
  const result: Word[][] = [];

  for (const group of groups) {
    if (durationOf(group) >= opts.minDurationMs || result.length === 0) {
      result.push(group);
      continue;
    }
    // Too short and there is a predecessor: try to merge back into it.
    const prev = result[result.length - 1];
    if (prev === undefined) {
      result.push(group);
      continue;
    }
    const merged = [...prev, ...group];
    if (wrapWords(merged, opts.maxCharsPerLine, opts.maxLines).fits) {
      result[result.length - 1] = merged;
    } else {
      // Cannot merge without overflowing lines; keep as its own caption.
      result.push(group);
    }
  }

  return result;
}

function toCaption(words: readonly Word[], index: number, opts: ResolvedSegmentOptions): Caption {
  const first = words[0];
  const last = words[words.length - 1];
  // Callers only pass non-empty groups; assert defensively.
  const startMs = first !== undefined ? first.t0 : 0;
  const endMs = last !== undefined ? last.t1 : 0;
  return {
    id: `cap-${index}`,
    startMs,
    endMs,
    text: wrapText(words, opts.maxCharsPerLine, opts.maxLines),
    words: [...words],
  };
}

/**
 * Segment whisper-style `words` into caption rows per ENGINEERING_SPEC §9.6.
 */
export function segmentCaptions(words: readonly Word[], options?: SegmentOptions): Caption[] {
  const opts = resolveOptions(options);
  if (words.length === 0) return [];

  const grouped = groupWords(words, opts);
  const merged = mergeShort(grouped, opts);
  return merged.map((group, i) => toCaption(group, i, opts));
}
