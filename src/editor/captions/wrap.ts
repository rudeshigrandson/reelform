/**
 * Greedy line wrapping for caption text (ENGINEERING_SPEC §9.6).
 *
 * Given the words of a single caption, wrap them into at most `maxLines`
 * lines, each at most `maxCharsPerLine` characters, breaking only on word
 * boundaries. Words are joined by single spaces.
 *
 * The wrap is greedy: each word goes on the current line if it still fits
 * (accounting for the joining space), otherwise it starts a new line. A word
 * longer than `maxCharsPerLine` on its own occupies its own line (it cannot be
 * broken since we only break on word boundaries).
 */

import type { Word } from "./types.js";

export interface WrapResult {
  /** The wrapped lines (no trailing empties). */
  readonly lines: readonly string[];
  /**
   * True if every word fit within `maxLines` lines of `maxCharsPerLine`.
   * When false, `lines` still contains all words (overflowing onto extra
   * lines) so callers never silently drop text; segmentation is responsible
   * for producing inputs that fit.
   */
  readonly fits: boolean;
}

/**
 * Greedily wrap `words` into lines of at most `maxCharsPerLine` characters.
 * Returns all produced lines plus whether they fit within `maxLines`.
 */
export function wrapWords(
  words: readonly Word[],
  maxCharsPerLine: number,
  maxLines: number,
): WrapResult {
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const w = word.text;
    if (current.length === 0) {
      // Start of a line: place the word even if it alone exceeds the limit.
      current = w;
      continue;
    }
    // +1 for the joining space.
    if (current.length + 1 + w.length <= maxCharsPerLine) {
      current = `${current} ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }

  const fits = lines.length <= maxLines && lines.every((l) => l.length <= maxCharsPerLine);
  return { lines, fits };
}

/**
 * Wrap `words` and join the lines with `\n` to produce caption `text`.
 */
export function wrapText(
  words: readonly Word[],
  maxCharsPerLine: number,
  maxLines: number,
): string {
  return wrapWords(words, maxCharsPerLine, maxLines).lines.join("\n");
}
