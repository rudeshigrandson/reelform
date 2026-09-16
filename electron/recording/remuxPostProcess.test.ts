import { describe, expect, it, vi } from "vitest";
import { scriptedSpawn } from "../media/testUtils";
import type { FinalizeResponse } from "./contracts";
import { aacPath, createRemuxPostProcess, remuxedPath, silenceFilter } from "./remuxPostProcess";

const BINS = { ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" };

function finalized(over: Partial<FinalizeResponse> = {}): FinalizeResponse {
  return {
    recordingId: "r1",
    dir: "/rec/r1",
    video: { path: "/rec/r1/screen.webm", bytes: 1000 },
    mic: { path: "/rec/r1/mic.webm", bytes: 200 },
    telemetry: { path: "/rec/r1/telemetry.json.gz", pointCount: 0 },
    meta: {},
    ...over,
  } as FinalizeResponse;
}

function fakeFs(sizes: Record<string, number>) {
  const removed: string[] = [];
  return {
    removed,
    fileSize: vi.fn(async (p: string) => sizes[p] ?? null),
    remove: vi.fn(async (p: string) => {
      removed.push(p);
    }),
  };
}

describe("remuxedPath", () => {
  it("swaps a .webm extension for .mp4 only at the end", () => {
    expect(remuxedPath("/a/screen.webm")).toBe("/a/screen.mp4");
    expect(remuxedPath("/a/SCREEN.WEBM")).toBe("/a/SCREEN.mp4");
    expect(remuxedPath("/a.webm.dir/screen.mp4")).toBe("/a.webm.dir/screen.mp4");
  });

  it("aacPath and silenceFilter", () => {
    expect(aacPath("/a/mic.webm")).toBe("/a/mic.m4a");
    expect(aacPath("C:\\rec\\mic.m4a")).toBe("C:\\rec\\mic-muted.m4a");
    expect(silenceFilter([])).toBeNull();
    expect(silenceFilter([{ startMs: 5, endMs: 5 }])).toBeNull();
    expect(
      silenceFilter([
        { startMs: 1000, endMs: 2500 },
        { startMs: 3000.4, endMs: 4000 },
      ]),
    ).toBe("volume=0:enable='between(t,1,2.5)+between(t,3,4)'");
  });
});

describe("createRemuxPostProcess", () => {
  it("remuxes WebM video to MP4 with stream copy and transcodes WebM audio to AAC", async () => {
    const { spawn, calls } = scriptedSpawn(({ child }) => child.close(0));
    const fs = fakeFs({ "/rec/r1/screen.mp4": 900, "/rec/r1/mic.m4a": 150 });
    const post = createRemuxPostProcess({ runner: { spawn }, resolveBinaries: () => BINS, ...fs });

    const out = await post(finalized());
    expect(out.video).toEqual({ path: "/rec/r1/screen.mp4", bytes: 900 });
    expect(out.mic).toEqual({ path: "/rec/r1/mic.m4a", bytes: 150 });
    expect(out.telemetry).toEqual(finalized().telemetry);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining(["-i", "/rec/r1/screen.webm", "-c", "copy"]),
    );
    expect(calls[0]?.args[calls[0].args.length - 1]).toBe("/rec/r1/screen.mp4");
    expect(calls[1]?.args).toEqual(
      expect.arrayContaining(["-i", "/rec/r1/mic.webm", "-vn", "-c:a", "aac", "-b:a", "192k"]),
    );
    expect(calls[1]?.args).not.toContain("-af");
    expect(calls[1]?.args[calls[1].args.length - 1]).toBe("/rec/r1/mic.m4a");
    expect(fs.removed).toEqual(["/rec/r1/screen.webm", "/rec/r1/mic.webm"]);
  });

  it("keeps the original and removes the partial output when ffmpeg fails for a track", async () => {
    let n = 0;
    const { spawn } = scriptedSpawn(({ child }) => {
      n += 1;
      child.err("Invalid data found when processing input\n");
      child.close(n === 1 ? 1 : 0);
    });
    const fs = fakeFs({ "/rec/r1/mic.m4a": 150 });
    const log = vi.fn();
    const post = createRemuxPostProcess({
      runner: { spawn },
      resolveBinaries: () => BINS,
      ...fs,
      log,
    });

    const out = await post(finalized());
    expect(out.video).toEqual({ path: "/rec/r1/screen.webm", bytes: 1000 });
    expect(out.mic).toEqual({ path: "/rec/r1/mic.m4a", bytes: 150 });
    expect(fs.removed).toEqual(["/rec/r1/screen.mp4", "/rec/r1/mic.webm"]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("remux failed for /rec/r1/screen.webm"),
    );
  });

  it("treats an empty or missing output as a failure and keeps the WebM", async () => {
    const { spawn } = scriptedSpawn(({ child }) => child.close(0));
    const fs = fakeFs({ "/rec/r1/screen.mp4": 0 });
    const post = createRemuxPostProcess({ runner: { spawn }, resolveBinaries: () => BINS, ...fs });
    const out = await post(finalized({ mic: undefined }));
    expect(out.video.path).toBe("/rec/r1/screen.webm");
    expect(fs.removed).toEqual(["/rec/r1/screen.mp4"]);
  });

  it("returns the response untouched without ffmpeg or when nothing is WebM", async () => {
    const spawn = vi.fn();
    const fs = fakeFs({});
    const res = finalized();
    const noFfmpeg = createRemuxPostProcess({
      runner: { spawn },
      resolveBinaries: () => null,
      ...fs,
    });
    expect(await noFfmpeg(res)).toBe(res);

    const mp4 = finalized({ video: { path: "/rec/r1/screen.mp4" }, mic: undefined });
    const withFfmpeg = createRemuxPostProcess({
      runner: { spawn },
      resolveBinaries: () => BINS,
      ...fs,
    });
    expect(await withFfmpeg(mp4)).toEqual(mp4);
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.removed).toEqual([]);
  });

  it("silences mic ranges the backend could not mute live, even for native .m4a audio", async () => {
    const { spawn, calls } = scriptedSpawn(({ child }) => child.close(0));
    const fs = fakeFs({ "/rec/r1/mic-muted.m4a": 90 });
    const post = createRemuxPostProcess({ runner: { spawn }, resolveBinaries: () => BINS, ...fs });
    const res = finalized({
      video: { path: "/rec/r1/screen.mp4" },
      mic: { path: "/rec/r1/mic.m4a", bytes: 100 },
      system: { path: "/rec/r1/system.m4a", bytes: 100 },
      meta: { micMutedRanges: [{ startMs: 1000, endMs: 2000 }] } as FinalizeResponse["meta"],
    });
    const out = await post(res);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining(["-af", "volume=0:enable='between(t,1,2)'", "-c:a", "aac"]),
    );
    expect(out.mic).toEqual({ path: "/rec/r1/mic-muted.m4a", bytes: 90 });
    expect(out.system).toEqual(res.system);
    expect(fs.removed).toEqual(["/rec/r1/mic.m4a"]);
  });
});
