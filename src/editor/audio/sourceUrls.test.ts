import { describe, expect, it } from "vitest";
import type { Telemetry } from "../autozoom/types";
import {
  clickEventsFromTelemetry,
  clickSoundUrl,
  projectMediaUrl,
  regionSourceUrls,
} from "./sourceUrls";

const BASE = "reelform-media://root/";

describe("projectMediaUrl", () => {
  it("resolves project-relative paths and encodes segments", () => {
    expect(projectMediaUrl(BASE, "media/My Song.mp3")).toBe(`${BASE}media/My%20Song.mp3`);
    expect(projectMediaUrl(BASE, "media\\a.wav")).toBe(`${BASE}media/a.wav`);
  });

  it("passes URLs through and rejects absolute or unservable paths", () => {
    expect(projectMediaUrl(null, "reelform-media://x/a.wav")).toBe("reelform-media://x/a.wav");
    expect(projectMediaUrl(BASE, "/Users/me/a.wav")).toBeNull();
    expect(projectMediaUrl(BASE, "C:\\music\\a.wav")).toBeNull();
    expect(projectMediaUrl(null, "media/a.wav")).toBeNull();
    expect(projectMediaUrl(BASE, "")).toBeNull();
  });
});

describe("clickSoundUrl", () => {
  it("maps bundled packs, custom files and none", () => {
    expect(clickSoundUrl({ type: "soft", volume: 60, customSound: null }, BASE)).toBe(
      "/sounds/soft/click.wav",
    );
    expect(clickSoundUrl({ type: "mechanical", volume: 60, customSound: null }, BASE, "/a")).toBe(
      "/a/mechanical/click.wav",
    );
    expect(clickSoundUrl({ type: "none", volume: 60, customSound: null }, BASE)).toBeNull();
    expect(
      clickSoundUrl(
        { type: "custom", volume: 60, customSound: { fileName: "c.wav", path: "media/c.wav" } },
        BASE,
      ),
    ).toBe(`${BASE}media/c.wav`);
    expect(clickSoundUrl({ type: "custom", volume: 60, customSound: null }, BASE)).toBeNull();
  });
});

describe("regionSourceUrls", () => {
  it("skips regions whose file can't be served", () => {
    expect(
      regionSourceUrls(
        [
          { id: "a", path: "media/a.mp3" },
          { id: "b", path: "/abs/b.mp3" },
        ],
        BASE,
      ),
    ).toEqual([{ id: "a", url: `${BASE}media/a.mp3` }]);
  });
});

describe("clickEventsFromTelemetry", () => {
  const telemetry: Pick<Telemetry, "clicks"> = {
    clicks: [
      [5000, 0, 0, "left", "down"],
      [5100, 0, 0, "left", "up"],
      [1000, 0, 0, "left", "down"],
      [3000, 0, 0, "right", "down"],
    ],
  };

  it("keeps mouse-down clicks sorted on source time without clips", () => {
    expect(clickEventsFromTelemetry(telemetry, [])).toEqual([
      { tMs: 1000 },
      { tMs: 3000 },
      { tMs: 5000 },
    ]);
    expect(clickEventsFromTelemetry(null, [])).toEqual([]);
  });

  it("maps through clips and drops trimmed clicks", () => {
    const clips = [
      { id: "a", sourceStartMs: 0, sourceEndMs: 2000, timelineStartMs: 0 },
      { id: "b", sourceStartMs: 4000, sourceEndMs: 6000, timelineStartMs: 2000 },
    ];
    expect(clickEventsFromTelemetry(telemetry, clips)).toEqual([{ tMs: 1000 }, { tMs: 3000 }]);
  });
});
