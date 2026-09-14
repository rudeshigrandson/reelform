import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Caption } from "../../inspector/captions/types";
import { type SidecarFormat, parseSidecar, serializeSidecar } from "./index";

/**
 * Round-trip properties: serialize → parse recovers times and text, and
 * parse → serialize is a fixed point. SRT cannot escape markup, so its text
 * alphabet excludes the formatting-tag openers `<` and `{`.
 */

const SAFE = "abcXYZ019 .,!?'\"-éü中😀";
const VTT_EXTRA = "<>&;#/";

const lineArb = (alphabet: string) =>
  fc
    .array(fc.constantFrom(...[...alphabet]), { minLength: 1, maxLength: 30 })
    .map((cs) => cs.join("").trim())
    .filter((s) => s.length > 0);

const captionArb = (alphabet: string) =>
  fc
    .record({
      startMs: fc.integer({ min: 0, max: 20 * 3_600_000 }),
      dur: fc.integer({ min: 0, max: 60_000 }),
      lines: fc.array(lineArb(alphabet), { minLength: 1, maxLength: 3 }),
    })
    .map(
      ({ startMs, dur, lines }): Caption => ({
        id: "any",
        startMs,
        endMs: startMs + dur,
        text: lines.join("\n"),
        words: [],
      }),
    );

const sortedCaptions = (alphabet: string) =>
  fc
    .array(captionArb(alphabet), { maxLength: 15 })
    .map((cs) => [...cs].sort((a, b) => a.startMs - b.startMs));

const cases: [SidecarFormat, string][] = [
  ["srt", SAFE],
  ["vtt", SAFE + VTT_EXTRA],
];

describe.each(cases)("%s round-trip", (format, alphabet) => {
  it("property: serialize → parse preserves start, end and text", () => {
    fc.assert(
      fc.property(sortedCaptions(alphabet), (caps) => {
        const { captions, warnings } = parseSidecar(serializeSidecar(caps, format), format);
        expect(warnings).toEqual([]);
        expect(captions.map((c) => [c.startMs, c.endMs, c.text])).toEqual(
          caps.map((c) => [c.startMs, c.endMs, c.text]),
        );
        captions.forEach((c, i) => expect(c.id).toBe(`cap-${i}`));
      }),
    );
  });

  it("property: parse → serialize is a fixed point", () => {
    fc.assert(
      fc.property(sortedCaptions(alphabet), (caps) => {
        const once = serializeSidecar(caps, format);
        const twice = serializeSidecar(parseSidecar(once, format).captions, format);
        expect(twice).toBe(once);
      }),
    );
  });

  it("property: CRLF line endings and a BOM parse identically", () => {
    fc.assert(
      fc.property(sortedCaptions(alphabet), (caps) => {
        const lf = serializeSidecar(caps, format);
        const crlf = `\uFEFF${lf.replace(/\n/g, "\r\n")}`;
        expect(parseSidecar(crlf, format)).toEqual(parseSidecar(lf, format));
      }),
    );
  });
});
