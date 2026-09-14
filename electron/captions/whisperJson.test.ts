import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { segmentCaptions } from "../../src/editor/captions/segment";
import { isCaptionsError } from "./errors";
import { CAPTION_SEGMENT_OPTIONS } from "./transcribe";
import { parseWhisperJson } from "./whisperJson";

const fixture = readFileSync(new URL("./__fixtures__/whisper-full.json", import.meta.url), "utf8");

const doc = (transcription: unknown[], language = "en"): string =>
  JSON.stringify({ result: { language }, transcription });

describe("parseWhisperJson", () => {
  it("assembles sub-word tokens into words and drops special/non-speech tokens", () => {
    const { words, language } = parseWhisperJson(fixture);
    expect(language).toBe("en");
    expect(words).toEqual([
      { text: "Welcome", t0: 0, t1: 640 },
      { text: "to", t0: 640, t1: 820 },
      { text: "Reelform.", t0: 820, t1: 2000 },
      { text: "Hit", t0: 4000, t1: 4300 },
      { text: "record,", t0: 4300, t1: 4850 },
      { text: "then", t0: 4850, t1: 5100 },
      { text: "let", t0: 5100, t1: 5300 },
      { text: "auto-zoom", t0: 5300, t1: 6100 },
      { text: "do", t0: 6100, t1: 6300 },
      { text: "the", t0: 6300, t1: 6450 },
      { text: "rest!", t0: 6450, t1: 7000 },
    ]);
  });

  it("offsets every word by the chunk start", () => {
    const base = parseWhisperJson(fixture).words;
    const shifted = parseWhisperJson(fixture, 300_000).words;
    expect(shifted).toEqual(base.map((w) => ({ ...w, t0: w.t0 + 300_000, t1: w.t1 + 300_000 })));
  });

  it("fixture → captions via the shared segmenter", () => {
    const captions = segmentCaptions(parseWhisperJson(fixture).words, CAPTION_SEGMENT_OPTIONS);
    expect(captions.map((c) => [c.startMs, c.endMs, c.text])).toEqual([
      [0, 2000, "Welcome to Reelform."],
      [4000, 7000, "Hit record, then let auto-zoom do the\nrest!"],
    ]);
    expect(captions[0]?.words).toHaveLength(3);
  });

  it("falls back to proportional timing when tokens are missing", () => {
    const { words } = parseWhisperJson(
      doc([{ offsets: { from: 1000, to: 2000 }, text: " ab cd" }]),
    );
    expect(words).toEqual([
      { text: "ab", t0: 1000, t1: 1500 },
      { text: "cd", t0: 1500, t1: 2000 },
    ]);
  });

  it("clamps token offsets into the segment and keeps words monotonic", () => {
    const { words } = parseWhisperJson(
      doc([
        {
          offsets: { from: 1000, to: 2000 },
          text: " a b",
          tokens: [
            { text: " a", offsets: { from: 500, to: 1200 } },
            { text: " b", offsets: { from: 1900, to: 2600 } },
          ],
        },
        {
          offsets: { from: 1500, to: 2500 },
          text: " c",
          tokens: [{ text: " c", offsets: { from: 1500, to: 1700 } }],
        },
      ]),
    );
    expect(words[0]).toEqual({ text: "a", t0: 1000, t1: 1200 });
    expect(words[1]).toEqual({ text: "b", t0: 1900, t1: 2000 });
    expect(words[2]?.t0).toBeGreaterThanOrEqual(1900);
    for (const w of words) expect(w.t1).toBeGreaterThanOrEqual(w.t0);
  });

  it("returns no words for an all-silence transcript", () => {
    const { words } = parseWhisperJson(
      doc([
        { offsets: { from: 0, to: 3000 }, text: " [BLANK_AUDIO]" },
        { offsets: { from: 3000, to: 5000 }, text: " (music)" },
      ]),
    );
    expect(words).toEqual([]);
    expect(parseWhisperJson(doc([])).words).toEqual([]);
  });

  it("skips malformed segments and tokens", () => {
    const { words, language } = parseWhisperJson(
      JSON.stringify({
        transcription: [
          null,
          { text: " no offsets" },
          { offsets: { from: 0, to: 500 }, text: " ok", tokens: [{ text: 5 }, { text: " ok" }] },
        ],
      }),
    );
    expect(language).toBeNull();
    // Tokens lacked offsets → text fallback.
    expect(words).toEqual([{ text: "ok", t0: 0, t1: 500 }]);
  });

  it("throws whisper-output-invalid on bad JSON or shape", () => {
    for (const bad of ["{", "[]", '{"transcription":3}']) {
      try {
        parseWhisperJson(bad);
        expect.unreachable();
      } catch (err) {
        expect(isCaptionsError(err, "whisper-output-invalid")).toBe(true);
      }
    }
  });
});
