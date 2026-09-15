import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addCaptionAt,
  filterCaptions,
  findActiveCaption,
  formatClock,
  formatCueTime,
  formatSrtTimestamp,
  formatVttTimestamp,
  isValidCaptionList,
  mergeWithPrevious,
  splitCaption,
  toSrt,
  toVtt,
  uniqueId,
  updateCaptionText,
} from "./logic";
import { DEFAULT_CAPTION_STYLE, applyPreset, modelInfo } from "./types";
import type { Caption } from "./types";

const cap = (
  id: string,
  startMs: number,
  endMs: number,
  text: string,
  words: Caption["words"] = [],
): Caption => ({
  id,
  startMs,
  endMs,
  text,
  words,
});

/** Arbitrary valid caption list: sorted, gapped/touching, non-empty text. */
const captionListArb = fc
  .array(
    fc.record({
      gap: fc.integer({ min: 0, max: 2000 }),
      dur: fc.integer({ min: 2, max: 5000 }),
      text: fc
        .array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 6 })
        .map((w) => w.join(" ")),
    }),
    { maxLength: 12 },
  )
  .map((rows) => {
    let t = 0;
    return rows.map((r, i) => {
      const start = t + r.gap;
      t = start + r.dur;
      return cap(`c${i}`, start, t, r.text);
    });
  });

describe("isValidCaptionList", () => {
  it("rejects overlap, zero length, unordered and duplicate ids", () => {
    expect(isValidCaptionList([cap("a", 0, 1000, "x"), cap("b", 1000, 2000, "y")])).toBe(true);
    expect(isValidCaptionList([cap("a", 0, 1000, "x"), cap("b", 999, 2000, "y")])).toBe(false);
    expect(isValidCaptionList([cap("a", 500, 500, "x")])).toBe(false);
    expect(isValidCaptionList([cap("a", 2000, 3000, "x"), cap("b", 0, 1000, "y")])).toBe(false);
    expect(isValidCaptionList([cap("a", 0, 1000, "x"), cap("a", 1000, 2000, "y")])).toBe(false);
  });
});

describe("uniqueId", () => {
  it("suffixes when taken", () => {
    const list = [cap("x", 0, 1, "a"), cap("x-2", 1, 2, "b")];
    expect(uniqueId(list, "y")).toBe("y");
    expect(uniqueId(list, "x")).toBe("x-3");
  });
});

describe("splitCaption", () => {
  it("splits text at the cursor with a proportional time split", () => {
    const list = [cap("a", 1000, 2000, "hello world")];
    const r = splitCaption(list, "a", 5);
    expect(r).not.toBeNull();
    const [left, right] = r!.captions;
    expect(left).toMatchObject({ id: "a", startMs: 1000, text: "hello" });
    expect(right).toMatchObject({ id: r!.newId, endMs: 2000, text: "world" });
    // 5 / 11 of 1000ms ≈ 455
    expect(left!.endMs).toBe(1455);
    expect(right!.startMs).toBe(1455);
  });

  it("is word-aware when word timings align with text", () => {
    const words = [
      { t0: 0, t1: 300, text: "one" },
      { t0: 800, t1: 1000, text: "two" },
    ];
    const r = splitCaption([cap("a", 0, 1000, "one two", words)], "a", 3)!;
    // proportional would be ~429ms; snapped into the gap [300, 800]
    expect(r.captions[0]!.endMs).toBe(429);
    expect(r.captions[0]!.words).toEqual([words[0]]);
    expect(r.captions[1]!.words).toEqual([words[1]]);
    const snapped = splitCaption([cap("a", 0, 1000, "one           two", words)], "a", 3)!;
    expect(snapped.captions[0]!.endMs).toBeGreaterThanOrEqual(300);
  });

  it("snaps a split before the previous word end to that word end", () => {
    const words = [
      { t0: 0, t1: 900, text: "aaaaaaaaa" },
      { t0: 950, t1: 1000, text: "b" },
    ];
    const r = splitCaption([cap("a", 0, 1000, "aaaaaaaaa b", words)], "a", 9)!;
    expect(r.captions[0]!.endMs).toBe(900);
  });

  it("returns null at the start/end, on whitespace-only halves, and for unknown ids", () => {
    const list = [cap("a", 0, 1000, "hi  there")];
    expect(splitCaption(list, "a", 0)).toBeNull();
    expect(splitCaption(list, "a", 9)).toBeNull();
    expect(splitCaption([cap("a", 0, 1000, "hi   ")], "a", 2)).toBeNull();
    expect(splitCaption(list, "nope", 2)).toBeNull();
    expect(splitCaption([cap("a", 0, 1, "hi there")], "a", 2)).toBeNull();
  });

  it("generates an id unique across the list", () => {
    const list = [cap("a", 0, 1000, "x y"), cap("a-split", 1000, 2000, "z w")];
    const r = splitCaption(list, "a", 1)!;
    expect(new Set(r.captions.map((c) => c.id)).size).toBe(3);
  });

  it("property: preserves invariants and total time span", () => {
    fc.assert(
      fc.property(captionListArb, fc.nat(), fc.nat(), (list, pick, pos) => {
        fc.pre(list.length > 0);
        const target = list[pick % list.length]!;
        const r = splitCaption(list, target.id, pos % (target.text.length + 1));
        if (!r) return;
        expect(isValidCaptionList(r.captions)).toBe(true);
        expect(r.captions).toHaveLength(list.length + 1);
        const i = r.captions.findIndex((c) => c.id === target.id);
        expect(r.captions[i]!.startMs).toBe(target.startMs);
        expect(r.captions[i + 1]!.endMs).toBe(target.endMs);
      }),
    );
  });
});

describe("mergeWithPrevious", () => {
  it("joins text with a space and reports the join caret", () => {
    const list = [cap("a", 0, 1000, "hello"), cap("b", 1200, 2000, "world")];
    const r = mergeWithPrevious(list, "b")!;
    expect(r.captions).toEqual([cap("a", 0, 2000, "hello world")]);
    expect(r.mergedId).toBe("a");
    expect(r.cursor).toBe(6);
  });

  it("does not double a space and handles empty text", () => {
    expect(
      mergeWithPrevious([cap("a", 0, 1, "hi "), cap("b", 1, 2, "x")], "b")!.captions[0]!.text,
    ).toBe("hi x");
    const empty = mergeWithPrevious([cap("a", 0, 1, "hi"), cap("b", 1, 2, "")], "b")!;
    expect(empty.captions[0]!.text).toBe("hi");
    expect(empty.cursor).toBe(2);
  });

  it("returns null for the first row", () => {
    expect(mergeWithPrevious([cap("a", 0, 1, "x")], "a")).toBeNull();
  });

  it("property: split then merge round-trips time and invariants", () => {
    fc.assert(
      fc.property(captionListArb, fc.nat(), fc.nat(), (list, pick, pos) => {
        fc.pre(list.length > 0);
        const target = list[pick % list.length]!;
        const s = splitCaption(list, target.id, pos % (target.text.length + 1));
        if (!s) return;
        const m = mergeWithPrevious(s.captions, s.newId)!;
        expect(isValidCaptionList(m.captions)).toBe(true);
        expect(m.captions.map((c) => [c.id, c.startMs, c.endMs])).toEqual(
          list.map((c) => [c.id, c.startMs, c.endMs]),
        );
      }),
    );
  });
});

describe("addCaptionAt", () => {
  const list = [cap("a", 1000, 2000, "x"), cap("b", 3000, 4000, "y")];

  it("inserts in order, truncated to the next caption", () => {
    const r = addCaptionAt(list, 2500)!;
    expect(r.captions.map((c) => c.id)).toEqual(["a", r.id, "b"]);
    expect(r.captions[1]).toMatchObject({ startMs: 2500, endMs: 3000, text: "" });
  });

  it("uses the full duration in open space and respects maxMs", () => {
    expect(addCaptionAt(list, 5000)!.captions[2]).toMatchObject({ startMs: 5000, endMs: 7000 });
    expect(addCaptionAt(list, 5000, { maxMs: 6000 })!.captions[2]).toMatchObject({ endMs: 6000 });
    expect(addCaptionAt([], 0)!.captions).toHaveLength(1);
  });

  it("refuses inside a caption or a too-small gap", () => {
    expect(addCaptionAt(list, 1000)).toBeNull();
    expect(addCaptionAt(list, 1999)).toBeNull();
    expect(addCaptionAt(list, 2950)).toBeNull();
    expect(addCaptionAt(list, 6000, { maxMs: 6000 })).toBeNull();
    // playhead exactly at a caption end is free
    expect(addCaptionAt(list, 2000)).not.toBeNull();
  });

  it("property: never breaks invariants", () => {
    fc.assert(
      fc.property(captionListArb, fc.integer({ min: -100, max: 60_000 }), (l, at) => {
        const r = addCaptionAt(l, at);
        if (!r) return;
        expect(isValidCaptionList(r.captions)).toBe(true);
        expect(r.captions).toHaveLength(l.length + 1);
      }),
    );
  });
});

describe("updateCaptionText", () => {
  const words = [
    { t0: 0, t1: 100, text: "helo" },
    { t0: 200, t1: 300, text: "world" },
  ];
  it("keeps word timings when token count matches, drops otherwise", () => {
    const list = [cap("a", 0, 300, "helo world", words)];
    expect(updateCaptionText(list, "a", "hello world")[0]!.words.map((w) => w.text)).toEqual([
      "hello",
      "world",
    ]);
    expect(updateCaptionText(list, "a", "hello big world")[0]!.words).toEqual([]);
  });
});

describe("filterCaptions / findActiveCaption", () => {
  const list = [cap("a", 0, 1000, "Open the\nSettings"), cap("b", 1000, 2000, "Click export")];
  it("filters case-insensitively across line breaks", () => {
    expect(filterCaptions(list, "the settings").map((c) => c.id)).toEqual(["a"]);
    expect(filterCaptions(list, "EXPORT").map((c) => c.id)).toEqual(["b"]);
    expect(filterCaptions(list, "  ")).toHaveLength(2);
    expect(filterCaptions(list, "zzz")).toEqual([]);
  });
  it("finds the caption under the playhead (half-open)", () => {
    expect(findActiveCaption(list, 999)?.id).toBe("a");
    expect(findActiveCaption(list, 1000)?.id).toBe("b");
    expect(findActiveCaption(list, 2000)).toBeUndefined();
  });
});

describe("timecodes", () => {
  it("formats SRT and VTT timestamps", () => {
    expect(formatSrtTimestamp(1000)).toBe("00:00:01,000");
    expect(formatVttTimestamp(1000)).toBe("00:00:01.000");
    expect(formatSrtTimestamp(3_723_456)).toBe("01:02:03,456");
    expect(formatVttTimestamp(-5)).toBe("00:00:00.000");
    expect(formatSrtTimestamp(1234.6)).toBe("00:00:01,235");
    expect(formatSrtTimestamp(Number.NaN)).toBe("00:00:00,000");
  });
  it("formats progress clocks and row times", () => {
    expect(formatClock(14_900)).toBe("00:14");
    expect(formatClock(42_000)).toBe("00:42");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatCueTime(1_250)).toBe("00:01.2");
    expect(formatCueTime(61_999)).toBe("01:01.9");
  });
  it("property: SRT/VTT timestamps differ only by the ms separator and are well-formed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 359_999_999 }), (ms) => {
        const srt = formatSrtTimestamp(ms);
        expect(srt).toMatch(/^\d{2}:\d{2}:\d{2},\d{3}$/);
        expect(formatVttTimestamp(ms)).toBe(srt.replace(",", "."));
      }),
    );
  });
});

describe("toSrt / toVtt", () => {
  const list = [
    cap("b", 2000, 3500, "Second <b> & -->"),
    cap("a", 0, 1000, "First line\n\n  second line  "),
    cap("empty", 1000, 2000, "   "),
  ];

  it("serializes SRT with sequential numbering in time order", () => {
    expect(toSrt(list)).toBe(
      "1\n00:00:00,000 --> 00:00:01,000\nFirst line\nsecond line\n\n" +
        "2\n00:00:02,000 --> 00:00:03,500\nSecond <b> & ->\n",
    );
  });

  it("serializes VTT with header and escaping", () => {
    expect(toVtt(list)).toBe(
      "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nFirst line\nsecond line\n\n" +
        "2\n00:00:02.000 --> 00:00:03.500\nSecond &lt;b&gt; &amp; --&gt;\n",
    );
  });

  it("handles an empty list", () => {
    expect(toSrt([])).toBe("");
    expect(toVtt([])).toBe("WEBVTT\n");
  });

  it("property: cue count equals non-blank captions, never contains stray arrows in text", () => {
    fc.assert(
      fc.property(captionListArb, (l) => {
        const srt = toSrt(l);
        const blocks = srt === "" ? [] : srt.trimEnd().split("\n\n");
        expect(blocks).toHaveLength(l.length);
        blocks.forEach((b, i) => {
          const lines = b.split("\n");
          expect(lines[0]).toBe(String(i + 1));
          expect(lines.slice(2).join("\n")).not.toContain("-->");
        });
      }),
    );
  });
});

describe("presets", () => {
  it("applies preset fields while keeping layout fields", () => {
    const base = { ...DEFAULT_CAPTION_STYLE, sizePx: 60, position: "top" as const };
    const k = applyPreset(base, "karaoke");
    expect(k).toMatchObject({
      preset: "karaoke",
      wordHighlight: true,
      sizePx: 60,
      position: "top",
    });
    expect(applyPreset(base, "outline").outline).toBe(true);
    expect(modelInfo("accurate").size).toBe("540 MB");
  });
});
