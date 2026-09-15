import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { scriptedSpawn } from "../media/testUtils";
import { FsIpcError } from "./errors";
import { type Ffmpeg, probeDurationMs, readLinkedTrackPaths, readLinkedTracks } from "./mediaTools";
import { makeTmpDir, realFs, removeDir } from "./testHelpers";

let tmp: string;

beforeEach(async () => {
  tmp = await makeTmpDir("reelform-mediatools-");
});

afterEach(async () => {
  await removeDir(tmp);
});

function ffprobeAnswering(json: string): Ffmpeg {
  const { spawn } = scriptedSpawn((call) => {
    call.child.out(json);
    call.child.close(0);
  });
  return { runner: { spawn }, bins: { ffmpeg: "/ff", ffprobe: "/fp" } };
}

describe("probeDurationMs", () => {
  it("reads the container duration of audio-only files", async () => {
    const ff = ffprobeAnswering(
      JSON.stringify({ streams: [{ codec_type: "audio" }], format: { duration: "12.3456" } }),
    );
    expect(await probeDurationMs(ff, "/a.m4a")).toBe(12_346);
  });

  it("falls back to the longest stream duration, and fails without any", async () => {
    const streams = ffprobeAnswering(
      JSON.stringify({ streams: [{ duration: "1.5" }, { duration: 2 }, { duration: "n/a" }] }),
    );
    expect(await probeDurationMs(streams, "/a.webm")).toBe(2000);
    await expect(probeDurationMs(ffprobeAnswering("{}"), "/a")).rejects.toBeInstanceOf(FsIpcError);
    await expect(probeDurationMs(ffprobeAnswering("not json"), "/a")).rejects.toMatchObject({
      code: "TRIM_FAILED",
    });
  });
});

describe("readLinkedTrackPaths", () => {
  it("returns each linked source's stored path; bad or missing project.json → none", async () => {
    expect(await readLinkedTrackPaths(realFs, tmp)).toEqual({});
    await fsp.writeFile(
      path.join(tmp, "project.json"),
      JSON.stringify({
        sources: {
          video: { path: "media/screen.mp4" },
          mic: { path: "media/mic.webm" },
          webcam: { width: 2 },
          telemetry: { path: "media/telemetry.json.gz" },
        },
      }),
    );
    expect(await readLinkedTrackPaths(realFs, tmp)).toEqual({
      mic: "media/mic.webm",
      webcam: "",
      telemetry: "media/telemetry.json.gz",
    });
    expect(await readLinkedTracks(realFs, tmp)).toEqual(["mic", "webcam", "telemetry"]);
    await fsp.writeFile(path.join(tmp, "project.json"), "{");
    expect(await readLinkedTrackPaths(realFs, tmp)).toEqual({});
  });
});
