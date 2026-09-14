import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { endsSentence, segmentCaptions } from "./segment.js";
import type { Word } from "./types.js";

/**
 * Build a sequence of contiguous words with a fixed per-word duration and a
 * fixed gap between words. `gaps[i]` (if given) overrides the gap *before*
 * word i.
 */
function timeline(
  texts: string[],
  opts: { durMs?: number; gapMs?: number; gaps?: Record<number, number> } = {},
): Word[] {
  const durMs = opts.durMs ?? 200;
  const gapMs = opts.gapMs ?? 50;
  const words: Word[] = [];
  let cursor = 0;
  texts.forEach((text, i) => {
    if (i > 0) cursor += opts.gaps?.[i] ?? gapMs;
    const t0 = cursor;
    const t1 = t0 + durMs;
    words.push({ t0, t1, text });
    cursor = t1;
  });
  return words;
}

describe("endsSentence", () => {
  it.each([
    ["done.", true],
    ["what?", true],
    ["wow!", true],
    ["hmm…", true],
    ['end."', true],
    ["end.)", true],
    ["middle", false],
    ["comma,", false],
    ["semi;", false],
  ])("%s -> %s", (text, expected) => {
    expect(endsSentence(text)).toBe(expected);
  });
});

describe("segmentCaptions - basics", () => {
  it("returns [] for empty input", () => {
    expect(segmentCaptions([])).toEqual([]);
  });

  it("produces a single caption for a short contiguous phrase", () => {
    const words = timeline(["hello", "there", "friend"], { durMs: 400 });
    const caps = segmentCaptions(words);
    expect(caps.length).toBe(1);
    expect(caps[0]?.text).toBe("hello there friend");
    expect(caps[0]?.startMs).toBe(words[0]?.t0);
    expect(caps[0]?.endMs).toBe(words[words.length - 1]?.t1);
    expect(caps[0]?.id).toBe("cap-0");
  });
});

describe("segmentCaptions - splitting on punctuation", () => {
  it("splits after a sentence-ending word", () => {
    // Two full sentences, each long enough to satisfy min duration.
    const words = timeline(["Hello", "world.", "How", "are", "you?"], { durMs: 400 });
    const caps = segmentCaptions(words);
    expect(caps.length).toBe(2);
    expect(caps[0]?.text).toBe("Hello world.");
    expect(caps[1]?.text).toBe("How are you?");
  });
});

describe("segmentCaptions - splitting on pause", () => {
  it("splits when the gap between words exceeds pauseSplitMs", () => {
    // Big pause (500ms > 350ms default) before "later".
    const words = timeline(["speaking", "now", "later", "then"], {
      durMs: 400,
      gaps: { 2: 500 },
    });
    const caps = segmentCaptions(words);
    expect(caps.length).toBe(2);
    expect(caps[0]?.text).toBe("speaking now");
    expect(caps[1]?.text).toBe("later then");
  });

  it("does not split on a pause within pauseSplitMs", () => {
    const words = timeline(["speaking", "now", "later", "then"], {
      durMs: 400,
      gaps: { 2: 300 }, // 300ms < 350ms default
    });
    const caps = segmentCaptions(words);
    expect(caps.length).toBe(1);
  });
});

describe("segmentCaptions - line wrapping at 42 chars", () => {
  it("wraps a long caption into two lines each <= 42 chars", () => {
    // 9 words, 43 chars if on one line -> must wrap to 2 lines.
    const words = timeline(
      ["the", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog"],
      { durMs: 300 },
    );
    const caps = segmentCaptions(words);
    expect(caps.length).toBe(1);
    const lines = caps[0]?.text.split("\n") ?? [];
    expect(lines.length).toBe(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(42);
  });

  it("starts a new caption when two full lines are exceeded", () => {
    // Many words so > 84 chars total; capacity forces a second caption.
    const texts = Array.from({ length: 20 }, () => "wordy");
    const words = timeline(texts, { durMs: 200 });
    const caps = segmentCaptions(words);
    expect(caps.length).toBeGreaterThan(1);
    for (const cap of caps) {
      expect(cap.text.split("\n").length).toBeLessThanOrEqual(2);
    }
  });
});

describe("segmentCaptions - min-duration merge", () => {
  it("merges a too-short trailing caption into the previous one", () => {
    // Sentence 1 is long; sentence 2 is a single very short word (100ms).
    const words: Word[] = [
      { t0: 0, t1: 800, text: "Hello" },
      { t0: 850, t1: 1600, text: "world." },
      { t0: 1650, t1: 1750, text: "Yes." }, // 100ms caption on its own -> too short
    ];
    const caps = segmentCaptions(words);
    // The short "Yes." should merge back, giving a single caption.
    expect(caps.length).toBe(1);
    expect(caps[0]?.text).toBe("Hello world. Yes.");
    expect(caps[0]?.endMs).toBe(1750);
  });

  it("keeps the short caption separate when merging would overflow lines", () => {
    // Predecessor already fills two lines; short tail cannot merge in.
    const filler = Array.from({ length: 16 }, () => "wordy"); // ~ fills 2 lines
    const words: Word[] = [];
    let cursor = 0;
    for (const text of filler) {
      words.push({ t0: cursor, t1: cursor + 300, text });
      cursor += 350;
    }
    // Force a boundary via a long pause, then a tiny caption.
    words.push({ t0: cursor + 500, t1: cursor + 600, text: "hi." }); // 100ms, short
    const caps = segmentCaptions(words);
    expect(caps.length).toBeGreaterThan(1);
    // Every caption respects the 2-line cap regardless of the failed merge.
    for (const cap of caps) {
      expect(cap.text.split("\n").length).toBeLessThanOrEqual(2);
    }
  });
});

describe("segmentCaptions - properties", () => {
  it("no line exceeds maxCharsPerLine and no caption exceeds maxLines", () => {
    const maxChars = 42;
    const maxLines = 2;

    // Arbitrary words: short-ish tokens with monotonic, non-negative timing.
    const wordArb = fc.record({
      text: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !/\s/.test(s)),
      dur: fc.integer({ min: 1, max: 2000 }),
      gap: fc.integer({ min: 0, max: 1000 }),
    });

    fc.assert(
      fc.property(fc.array(wordArb, { minLength: 0, maxLength: 60 }), (raw) => {
        // Materialize into a valid, monotonic timeline.
        const words: Word[] = [];
        let cursor = 0;
        for (const r of raw) {
          const t0 = cursor + r.gap;
          const t1 = t0 + r.dur;
          words.push({ t0, t1, text: r.text });
          cursor = t1;
        }

        const caps = segmentCaptions(words, {
          maxCharsPerLine: maxChars,
          maxLines,
        });

        for (const cap of caps) {
          const lines = cap.text.split("\n");
          expect(lines.length).toBeLessThanOrEqual(maxLines);
          for (const line of lines) {
            // A single token longer than maxChars is unavoidable (we only break
            // on word boundaries); exclude that case from the per-line bound.
            const isLoneOverlongWord = !line.includes(" ") && line.length > maxChars;
            if (!isLoneOverlongWord) {
              expect(line.length).toBeLessThanOrEqual(maxChars);
            }
          }
        }

        // Every input word appears in exactly one caption, in order.
        const flat = caps.flatMap((c) => c.words.map((x) => x.text));
        expect(flat).toEqual(words.map((x) => x.text));
      }),
    );
  });
});
