import { describe, expect, it } from "vitest";
import type { Translate } from "../../i18n";
import { assertValidMessage } from "../../i18n/format";
import timelineEn from "../../i18n/locales/en.timeline.json";
import { translateTimeline, tt } from "./i18n";
import { ITEM_NOUNS, ITEM_NOUN_KEYS, TRACK_LABELS, TRACK_LABEL_KEYS, clipsToItems } from "./types";

describe("timeline i18n", () => {
  it.each(Object.entries(timelineEn))("en.timeline.json %s is well-formed", (_key, message) => {
    expect(() => assertValidMessage(message)).not.toThrow();
  });

  it("uses the window translator when the catalog has the key", () => {
    const translate: Translate = (key, vars) => `[${key}:${vars?.track ?? ""}]`;
    expect(translateTimeline(translate, "timeline.trackGroup", { track: "Zoom" })).toBe(
      "[timeline.trackGroup:Zoom]",
    );
  });

  it("falls back to the namespace English when the catalog returns the raw key", () => {
    const echo: Translate = (key) => key;
    expect(translateTimeline(echo, "timeline.addAtPlayhead", { track: "Speed" })).toBe(
      "Add Speed at playhead",
    );
    expect(tt("timeline.clipLabel", { index: 3 })).toBe("Clip 3");
  });

  it("track labels and item nouns resolve through their keys", () => {
    for (const kind of Object.keys(TRACK_LABEL_KEYS) as (keyof typeof TRACK_LABEL_KEYS)[]) {
      expect(TRACK_LABELS[kind]).toBe(tt(TRACK_LABEL_KEYS[kind]));
      expect(ITEM_NOUNS[kind]).toBe(tt(ITEM_NOUN_KEYS[kind]));
    }
    expect(TRACK_LABELS.annotations).toBe("Annotations");
    expect(ITEM_NOUNS.captions).toBe("Caption");
    expect(Object.keys(TRACK_LABELS)).toEqual([
      "video",
      "zoom",
      "speed",
      "annotations",
      "captions",
    ]);
  });

  it("every namespace key is used by the timeline", () => {
    const used = new Set<string>([
      ...Object.values(TRACK_LABEL_KEYS),
      ...Object.values(ITEM_NOUN_KEYS),
      "timeline.region",
      "timeline.waveform",
      "timeline.addAtPlayhead",
      "timeline.trackGroup",
      "timeline.itemName",
      "timeline.clipLabel",
    ]);
    expect(Object.keys(timelineEn).filter((k) => !used.has(k))).toEqual([]);
    expect(
      clipsToItems([
        {
          id: "c",
          timelineStartMs: 0,
          sourceStartMs: 0,
          sourceEndMs: 10,
        } as Parameters<typeof clipsToItems>[0][number],
      ])[0]?.label,
    ).toBe("Clip 1");
  });
});
