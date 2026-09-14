import { describe, expect, it } from "vitest";
import type { Caption } from "../../inspector/captions/types";
import { detectSidecarFormat, parseSidecar, serializeSidecar } from "./index";
import { parseVtt, serializeVtt, unescapeVttText } from "./vtt";

const cap = (startMs: number, endMs: number, text: string): Caption => ({
  id: "x",
  startMs,
  endMs,
  text,
  words: [],
});

describe("serializeVtt", () => {
  it("writes a header and dot timestamps, escaping markup characters", () => {
    expect(serializeVtt([cap(1000, 2000, "a < b & c > d\nx --> y")])).toBe(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\na &lt; b &amp; c &gt; d\nx --&gt; y\n",
    );
    expect(serializeVtt([])).toBe("WEBVTT\n");
  });
});

describe("parseVtt", () => {
  it("parses header, identifiers, settings, NOTE/STYLE blocks, short timestamps, BOM + CRLF", () => {
    const text = [
      "\uFEFFWEBVTT - Reelform",
      "Kind: captions",
      "",
      "STYLE",
      "::cue { color: red }",
      "",
      "NOTE this is a comment",
      "that spans lines",
      "",
      "intro",
      "00:01.000 --> 00:02.500 align:start line:0",
      "<v Roger>Hello</v> <c.loud>there</c>",
      "",
      "00:00:03.000 --> 00:00:04.000",
      "Tom &amp; Jerry &lt;3 &#x263A; &#9731;&nbsp;!",
      "second line",
      "",
    ].join("\r\n");
    const { captions, warnings } = parseVtt(text);
    expect(warnings).toEqual([]);
    expect(captions).toEqual([
      { id: "cap-0", startMs: 1000, endMs: 2500, text: "Hello there", words: [] },
      {
        id: "cap-1",
        startMs: 3000,
        endMs: 4000,
        text: "Tom & Jerry <3 ☺ ☃ !\nsecond line",
        words: [],
      },
    ]);
  });

  it("warns on a missing header but still parses cues", () => {
    const { captions, warnings } = parseVtt("00:00:01.000 --> 00:00:02.000\nhi\n");
    expect(captions.map((c) => c.text)).toEqual(["hi"]);
    expect(warnings.map((w) => w.code)).toEqual(["missing-header"]);
  });

  it("skips malformed cues with warnings", () => {
    const text =
      "WEBVTT\n\njust text\n\n00:00:01.000 --> bad\nx\n\n00:00:03.000 --> 00:00:02.000\ny\n\n00:00:04.000 --> 00:00:05.000\n<b></b>\n\n00:00:06.000 --> 00:00:07.000\nok\n";
    const { captions, warnings } = parseVtt(text);
    expect(captions.map((c) => c.text)).toEqual(["ok"]);
    expect(warnings.map((w) => w.code)).toEqual([
      "missing-timing",
      "bad-timing",
      "end-before-start",
      "empty-cue",
    ]);
  });

  it("strips inline timestamp tags used by karaoke-style cues", () => {
    expect(unescapeVttText("one <00:00:01.500>two <00:00:02.000>three")).toBe("one two three");
    expect(unescapeVttText("&bogus; &#99999999;")).toBe("&bogus; &#99999999;");
  });
});

describe("sidecar dispatch", () => {
  it("detects the format by extension, then by content", () => {
    expect(detectSidecarFormat("WEBVTT\n", "subs.SRT")).toBe("srt");
    expect(detectSidecarFormat("", "subs.vtt")).toBe("vtt");
    expect(detectSidecarFormat("\uFEFFWEBVTT\r\n")).toBe("vtt");
    expect(detectSidecarFormat("WEBVTTX\n")).toBe("srt");
    expect(detectSidecarFormat("1\n00:00:00,000 --> 00:00:01,000\nx\n")).toBe("srt");
  });

  it("parseSidecar and serializeSidecar route to the right format", () => {
    const caps = [cap(0, 1000, "hi")];
    expect(serializeSidecar(caps, "vtt").startsWith("WEBVTT")).toBe(true);
    expect(serializeSidecar(caps, "srt").startsWith("1\n")).toBe(true);
    expect(parseSidecar(serializeSidecar(caps, "vtt")).captions[0]?.text).toBe("hi");
    expect(parseSidecar(serializeSidecar(caps, "srt"), undefined, "a.srt").captions[0]?.text).toBe(
      "hi",
    );
  });
});
