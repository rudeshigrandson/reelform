import { describe, expect, it } from "vitest";
import type { Clip } from "../../model/schema";
import { makeProject } from "./fixtures";
import {
  buildProjectInfo,
  computeTrimSavingsBytes,
  formatBytes,
  formatDateTime,
  formatDurationMs,
  joinPath,
  usedSourceMs,
} from "./logic";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

const clip = (id: string, s: number, e: number): Clip => ({
  id,
  sourceStartMs: s,
  sourceEndMs: e,
  timelineStartMs: 0,
});

describe("formatBytes", () => {
  it("handles zero and sub-KB values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("switches units at exact boundaries", () => {
    expect(formatBytes(KB)).toBe("1 KB");
    expect(formatBytes(MB)).toBe("1 MB");
    expect(formatBytes(GB)).toBe("1 GB");
    expect(formatBytes(1024 * GB)).toBe("1 TB");
  });

  it("uses one decimal below 10 and whole numbers above", () => {
    expect(formatBytes(1.2 * GB)).toBe("1.2 GB");
    expect(formatBytes(466 * MB)).toBe("466 MB");
    expect(formatBytes(1.5 * KB)).toBe("1.5 KB");
    expect(formatBytes(9.96 * MB)).toBe("10 MB");
  });

  it("promotes when rounding reaches the next unit", () => {
    expect(formatBytes(MB - 100)).toBe("1 MB");
  });

  it("renders a dash for invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("is stable with injected locale + timezone", () => {
    const out = formatDateTime("2026-09-14T15:04:00.000Z", { locale: "en-US", timeZone: "UTC" });
    expect(out).toMatch(/^Sep 14, 2026,?\s3:04\sPM$/);
  });

  it("honours the timezone", () => {
    const out = formatDateTime("2026-09-14T23:30:00.000Z", {
      locale: "en-US",
      timeZone: "Asia/Tokyo",
    });
    expect(out).toMatch(/^Sep 15, 2026/);
  });

  it("renders a dash for invalid ISO", () => {
    expect(formatDateTime("not a date")).toBe("—");
  });
});

describe("formatDurationMs", () => {
  it("formats minutes, hours and clamps negatives", () => {
    expect(formatDurationMs(42_180)).toBe("00:42.180");
    expect(formatDurationMs(0)).toBe("00:00.000");
    expect(formatDurationMs(-5)).toBe("00:00.000");
    expect(formatDurationMs(3_723_004)).toBe("1:02:03.004");
  });
});

describe("joinPath", () => {
  it("joins posix and windows dirs without doubled separators", () => {
    expect(joinPath("/a/b/", "rec/x.mp4")).toBe("/a/b/rec/x.mp4");
    expect(joinPath("/a/b", "./x.mp4")).toBe("/a/b/x.mp4");
    expect(joinPath("C:\\Users\\me", "x.mp4")).toBe("C:\\Users\\me\\x.mp4");
    expect(joinPath("", "x.mp4")).toBe("x.mp4");
  });
});

describe("buildProjectInfo", () => {
  it("maps document + fs metadata", () => {
    const info = buildProjectInfo(makeProject(), {
      locationPath: "/p/Demo.reelform",
      sourceStats: { "recording/screen.mp4": { sizeBytes: 500 } },
      captureBackend: "ScreenCaptureKit",
      cursorPointCount: 1200,
      audioTracks: ["Mic"],
    });
    expect(info.name).toBe("Onboarding flow walkthrough");
    expect(info.sources).toEqual([
      {
        role: "video",
        path: "recording/screen.mp4",
        absolutePath: "/p/Demo.reelform/recording/screen.mp4",
        sizeBytes: 500,
        missing: false,
        durationMs: 60_000,
      },
    ]);
    expect(info.recording).toMatchObject({
      width: 3024,
      height: 1964,
      fps: 60,
      captureBackend: "ScreenCaptureKit",
      cursorPointCount: 1200,
      audioTracks: ["Mic"],
    });
  });

  it("flags missing sources and defaults optional metadata", () => {
    const info = buildProjectInfo(makeProject(), {
      locationPath: "/p",
      sourceStats: { "recording/screen.mp4": null },
    });
    expect(info.sources[0]).toMatchObject({ missing: true, sizeBytes: null });
    expect(info.recording.captureBackend).toBeNull();
    expect(info.recording.cursorPointCount).toBeNull();
    expect(info.recording.audioTracks).toEqual(["Source audio"]);
  });

  it("treats an absent stat as unknown size, not missing", () => {
    const p = makeProject();
    p.sources.video.hasAudio = false;
    const info = buildProjectInfo(p, { locationPath: "/p", sourceStats: {} });
    expect(info.sources[0]).toMatchObject({ missing: false, sizeBytes: null });
    expect(info.recording.audioTracks).toEqual([]);
  });
});

describe("usedSourceMs", () => {
  it("unions overlapping and adjacent clips", () => {
    expect(usedSourceMs([clip("a", 0, 10), clip("b", 5, 20), clip("c", 20, 30)], 100)).toBe(30);
  });

  it("handles unordered, disjoint and out-of-range clips", () => {
    expect(usedSourceMs([clip("b", 50, 60), clip("a", 0, 10)], 100)).toBe(20);
    expect(usedSourceMs([clip("a", 90, 150)], 100)).toBe(10);
    expect(usedSourceMs([], 100)).toBe(0);
  });

  it("counts a duplicated range once", () => {
    expect(usedSourceMs([clip("a", 10, 40), clip("b", 10, 40)], 100)).toBe(30);
  });
});

describe("computeTrimSavingsBytes", () => {
  const source = { sizeBytes: 1000, missing: false, durationMs: 100 };

  it("is proportional to unused duration", () => {
    expect(computeTrimSavingsBytes([clip("a", 0, 25)], source)).toBe(750);
    expect(computeTrimSavingsBytes([clip("a", 0, 25), clip("b", 50, 75)], source)).toBe(500);
  });

  it("returns 0 when the whole source is used", () => {
    expect(computeTrimSavingsBytes([clip("a", 0, 100)], source)).toBe(0);
  });

  it("returns the whole size when nothing is used", () => {
    expect(computeTrimSavingsBytes([], source)).toBe(1000);
  });

  it("returns null when not computable", () => {
    expect(computeTrimSavingsBytes([], { ...source, missing: true })).toBeNull();
    expect(computeTrimSavingsBytes([], { ...source, sizeBytes: null })).toBeNull();
    expect(computeTrimSavingsBytes([], { ...source, durationMs: 0 })).toBeNull();
  });
});
