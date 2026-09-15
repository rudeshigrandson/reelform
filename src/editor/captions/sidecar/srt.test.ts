import { describe, expect, it } from "vitest";
import type { Caption } from "../../inspector/captions/types";
import { parseSrt, serializeSrt } from "./srt";

const cap = (startMs: number, endMs: number, text: string, id = "x"): Caption => ({
  id,
  startMs,
  endMs,
  text,
  words: [],
});

describe("serializeSrt", () => {
  it("writes numbered cues with comma timestamps and multi-line text", () => {
    expect(serializeSrt([cap(0, 1500, "Hello"), cap(2000, 4250, "two\nlines")])).toBe(
      "1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:00:02,000 --> 00:00:04,250\ntwo\nlines\n",
    );
  });

  it("omits empty captions, drops blank text lines and clamps times", () => {
    expect(serializeSrt([cap(0, 10, "  "), cap(-5, -10, "a\n\n b ")])).toBe(
      "1\n00:00:00,000 --> 00:00:00,000\na\nb\n",
    );
    expect(serializeSrt([])).toBe("");
  });
});

describe("parseSrt", () => {
  it("parses a typical file with BOM and CRLF", () => {
    const text =
      "\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nFirst line\r\nSecond line\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nNext\r\n";
    const { captions, warnings } = parseSrt(text);
    expect(warnings).toEqual([]);
    expect(captions).toEqual([
      { id: "cap-0", startMs: 1000, endMs: 2000, text: "First line\nSecond line", words: [] },
      { id: "cap-1", startMs: 3000, endMs: 4000, text: "Next", words: [] },
    ]);
  });

  it("tolerates missing indices, dot milliseconds, cue settings, extra blank lines and tags", () => {
    const text =
      '\n\n00:00:01.000 --> 00:00:02.000 X1:10 X2:20\n<i>styled</i> {\\an8}text\n\n\n\n5\n00:00:05,000 --> 00:00:06,000\n<font color="#fff">x</font>\n';
    const { captions, warnings } = parseSrt(text);
    expect(warnings).toEqual([]);
    expect(captions.map((c) => [c.startMs, c.endMs, c.text])).toEqual([
      [1000, 2000, "styled text"],
      [5000, 6000, "x"],
    ]);
  });

  it("skips malformed cues with warnings and keeps the rest", () => {
    const text = [
      "1",
      "garbage line",
      "",
      "2",
      "00:00:01,000 --> 00:0x:02,000",
      "bad time",
      "",
      "3",
      "00:00:05,000 --> 00:00:04,000",
      "backwards",
      "",
      "4",
      "00:00:07,000 --> 00:00:08,000",
      "",
      "5",
      "00:00:09,000 --> 00:00:10,000",
      "good",
      "",
    ].join("\n");
    const { captions, warnings } = parseSrt(text);
    expect(captions.map((c) => c.text)).toEqual(["good"]);
    expect(warnings.map((w) => [w.code, w.line])).toEqual([
      ["missing-timing", 1],
      ["bad-timing", 5],
      ["end-before-start", 9],
      ["empty-cue", 12],
    ]);
  });

  it("sorts cues by start time and assigns sequential ids", () => {
    const text =
      "1\n00:00:05,000 --> 00:00:06,000\nlater\n\n2\n00:00:01,000 --> 00:00:02,000\nearlier\n";
    const { captions } = parseSrt(text);
    expect(captions.map((c) => [c.id, c.text])).toEqual([
      ["cap-0", "earlier"],
      ["cap-1", "later"],
    ]);
  });

  it("handles empty and whitespace-only input", () => {
    expect(parseSrt("")).toEqual({ captions: [], warnings: [] });
    expect(parseSrt("\uFEFF\r\n\r\n")).toEqual({ captions: [], warnings: [] });
  });
});
