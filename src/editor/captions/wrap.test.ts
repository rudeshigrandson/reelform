import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Word } from "./types.js";
import { wrapText, wrapWords } from "./wrap.js";

/** Build a Word with dummy timing from just its text (timing irrelevant to wrapping). */
function w(text: string): Word {
  return { t0: 0, t1: 1, text };
}

function words(...texts: string[]): Word[] {
  return texts.map(w);
}

describe("wrapWords", () => {
  it("keeps everything on one line when it fits", () => {
    const res = wrapWords(words("hello", "world"), 42, 2);
    expect(res.lines).toEqual(["hello world"]);
    expect(res.fits).toBe(true);
  });

  it("wraps at 42 chars into 2 lines on word boundaries", () => {
    // "the quick brown fox jumps over the lazy dog" is 43 chars on one line.
    const res = wrapWords(
      words("the", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog"),
      42,
      2,
    );
    expect(res.lines.length).toBe(2);
    for (const line of res.lines) {
      expect(line.length).toBeLessThanOrEqual(42);
    }
    // No word is split; rejoining lines by space reproduces the input.
    expect(res.lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
    expect(res.fits).toBe(true);
  });

  it("marks fits=false when content needs more than maxLines", () => {
    const long = words(
      "aaaaaaaaaa",
      "bbbbbbbbbb",
      "cccccccccc",
      "dddddddddd",
      "eeeeeeeeee",
      "ffffffffff",
      "gggggggggg",
      "hhhhhhhhhh",
    );
    const res = wrapWords(long, 42, 2);
    expect(res.fits).toBe(false);
  });

  it("places an over-long single word on its own line", () => {
    const res = wrapWords(words("supercalifragilisticexpialidocious-plus-more-chars"), 42, 2);
    expect(res.lines.length).toBe(1);
    expect(res.lines[0]?.length).toBeGreaterThan(42);
    expect(res.fits).toBe(false);
  });
});

describe("wrapText", () => {
  it("joins wrapped lines with a newline", () => {
    const text = wrapText(
      words("the", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog"),
      42,
      2,
    );
    expect(text).toContain("\n");
    expect(text.split("\n").length).toBe(2);
  });

  it("has no newline when it fits on one line", () => {
    expect(wrapText(words("hi", "there"), 42, 2)).toBe("hi there");
  });
});

describe("wrapWords properties", () => {
  it("never splits a word and preserves order", () => {
    const arb = fc.array(
      fc.string({ minLength: 1, maxLength: 10 }).filter((s) => !/\s/.test(s)),
      { minLength: 1, maxLength: 30 },
    );
    fc.assert(
      fc.property(arb, fc.integer({ min: 5, max: 50 }), (texts, maxChars) => {
        const res = wrapWords(words(...texts), maxChars, 2);
        // Rejoining all lines by a single space reproduces the original words.
        expect(res.lines.join(" ").split(" ")).toEqual(texts);
      }),
    );
  });
});
