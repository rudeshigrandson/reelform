import { describe, expect, it, vi } from "vitest";
import { scriptedSpawn } from "../media/testUtils";
import type { FinalizeResponse } from "./contracts";
import {
  THUMBNAIL_FILE_NAME,
  buildThumbnailArgs,
  composePostProcess,
  createThumbnailPostProcess,
} from "./thumbnailPostProcess";

const BINS = { ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" };

function finalized(durationMs = 42_000, dir = "/rec/r1"): FinalizeResponse {
  return {
    recordingId: "r1",
    dir,
    video: { path: `${dir}/screen.mp4`, bytes: 1000 },
    telemetry: { path: `${dir}/telemetry.json.gz`, pointCount: 0 },
    meta: { durationMs },
  } as FinalizeResponse;
}

describe("buildThumbnailArgs", () => {
  it("seeks, takes one frame scaled to 640px wide at JPEG quality 3", () => {
    expect(buildThumbnailArgs("/in.mp4", "/out.jpg", 1)).toEqual([
      "-hide_banner",
      "-nostdin",
      "-y",
      "-ss",
      "1",
      "-i",
      "/in.mp4",
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      "-q:v",
      "3",
      "/out.jpg",
    ]);
  });
});

describe("createThumbnailPostProcess", () => {
  it("writes thumbnail.jpg next to the recording and reports its path", async () => {
    const { spawn, calls } = scriptedSpawn(({ child }) => child.close(0));
    const post = createThumbnailPostProcess({
      runner: { spawn },
      resolveBinaries: () => BINS,
      fileSize: async () => 2048,
    });
    const out = await post(finalized());
    expect(out.thumbnailPath).toBe(`/rec/r1/${THUMBNAIL_FILE_NAME}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("/bin/ffmpeg");
    expect(calls[0]?.args).toEqual(
      buildThumbnailArgs("/rec/r1/screen.mp4", "/rec/r1/thumbnail.jpg", 1),
    );
    expect(out.video).toEqual(finalized().video);
  });

  it("uses Windows separators for a Windows recording dir", async () => {
    const { spawn } = scriptedSpawn(({ child }) => child.close(0));
    const post = createThumbnailPostProcess({ runner: { spawn }, resolveBinaries: () => BINS });
    const out = await post(finalized(42_000, "C:\\rec\\r1"));
    expect(out.thumbnailPath).toBe("C:\\rec\\r1\\thumbnail.jpg");
  });

  it("retries the first frame when 1s fails, and seeks 0 for sub-second recordings", async () => {
    const { spawn, calls } = scriptedSpawn(({ child }) => child.close(calls.length === 1 ? 1 : 0));
    const log = vi.fn();
    const post = createThumbnailPostProcess({
      runner: { spawn },
      resolveBinaries: () => BINS,
      log,
    });
    const out = await post(finalized());
    expect(calls.map((c) => c.args[4])).toEqual(["1", "0"]);
    expect(out.thumbnailPath).toBe("/rec/r1/thumbnail.jpg");
    expect(log).toHaveBeenCalledOnce();

    const short = scriptedSpawn(({ child }) => child.close(0));
    const post2 = createThumbnailPostProcess({
      runner: { spawn: short.spawn },
      resolveBinaries: () => BINS,
    });
    await post2(finalized(400));
    expect(short.calls.map((c) => c.args[4])).toEqual(["0"]);
  });

  it("never fails finalize: no ffmpeg, failing runs or empty output leave no thumbnail", async () => {
    const spawn = vi.fn();
    const res = finalized();
    expect(
      await createThumbnailPostProcess({ runner: { spawn }, resolveBinaries: () => null })(res),
    ).toBe(res);
    expect(spawn).not.toHaveBeenCalled();

    const failing = scriptedSpawn(({ child }) => child.close(1));
    const out = await createThumbnailPostProcess({
      runner: { spawn: failing.spawn },
      resolveBinaries: () => BINS,
    })(res);
    expect(out.thumbnailPath).toBeUndefined();
    expect(failing.calls).toHaveLength(2);

    const empty = scriptedSpawn(({ child }) => child.close(0));
    const out2 = await createThumbnailPostProcess({
      runner: { spawn: empty.spawn },
      resolveBinaries: () => BINS,
      fileSize: async () => 0,
    })(res);
    expect(out2.thumbnailPath).toBeUndefined();
  });
});

describe("composePostProcess", () => {
  it("runs steps in order on the previous result and merges their fields", async () => {
    const order: string[] = [];
    const remux = async (r: FinalizeResponse) => {
      order.push("remux");
      return { ...r, video: { path: "/rec/r1/screen.remuxed.mp4" } };
    };
    const thumb = async (r: FinalizeResponse) => {
      order.push(`thumb:${r.video.path}`);
      return { ...r, thumbnailPath: "/rec/r1/thumbnail.jpg" };
    };
    const out = await composePostProcess(remux, thumb)(finalized());
    expect(order).toEqual(["remux", "thumb:/rec/r1/screen.remuxed.mp4"]);
    expect(out.video.path).toBe("/rec/r1/screen.remuxed.mp4");
    expect(out.thumbnailPath).toBe("/rec/r1/thumbnail.jpg");
  });

  it("skips a throwing step and keeps the earlier result", async () => {
    const out = await composePostProcess(
      async (r) => ({ ...r, thumbnailPath: "/t.jpg" }),
      async () => {
        throw new Error("boom");
      },
    )(finalized());
    expect(out.thumbnailPath).toBe("/t.jpg");
    expect(await composePostProcess()(finalized())).toEqual(finalized());
  });
});
