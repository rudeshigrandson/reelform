import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { type SpawnCall, scriptedSpawn } from "../media/testUtils";
import { projectContracts } from "./contracts";
import { FsIpcError } from "./errors";
import { type ProjectDeps, createProjectHandlers } from "./handlers";
import { makeTmpDir, manualClock, realFs, removeDir } from "./testHelpers";
import { LINKED_COPY_TOLERANCE_MS, linkedCutArgs, shiftTelemetry } from "./trimSource";

let tmp: string;
let project: string;

const media = (name: string) => path.join(project, "media", name);

const TELEMETRY = {
  version: 1,
  sampleHz: 60,
  origin: "display",
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 2,
  points: [
    [1000, 1, 1, "arrow"],
    [8500, 2, 2, "arrow"],
    [9000.25, 3, 3, "hand"],
    [21_000, 4, 4, "arrow"],
    [30_000, 5, 5, "arrow"],
  ],
  clicks: [
    [2000, 1, 1, 0, "down"],
    [10_000, 3, 3, 0, "down"],
  ],
  keys: [[40_000, 30, 8]],
  scrolls: [[12_000, 0, -3]],
};

/**
 * Fake ffprobe/ffmpeg. Video probes carry a video stream; everything else only
 * reports `format.duration`. `copyDurations` sets what a stream-copied linked
 * track probes as (keyframe lead-in → longer than asked).
 */
function tools(opts: {
  copyDurations?: Record<string, number>;
  failEncode?: string;
}) {
  const modes = new Map<string, "copy" | "encode">();
  const durationOf = (input: string): number => {
    const base = path.basename(input);
    if (base.startsWith("screen") && !base.includes(".partial")) return 60_000;
    if (base.includes("screen")) return 12_500;
    if (!base.includes(".partial")) return 60_000;
    const track = base.slice(1).split(".")[0] ?? "";
    if (modes.get(input) === "copy") return opts.copyDurations?.[track] ?? 12_500;
    return 12_500;
  };
  return scriptedSpawn((call: SpawnCall) => {
    const last = call.args.at(-1) ?? "";
    if (call.command === "/bin/ffprobe") {
      const durationMs = durationOf(last);
      const video = path.basename(last).includes("screen");
      call.child.out(
        JSON.stringify({
          streams: video
            ? [
                {
                  codec_type: "video",
                  codec_name: "h264",
                  width: 1920,
                  height: 1080,
                  avg_frame_rate: "30/1",
                },
              ]
            : [{ codec_type: "audio", codec_name: "opus" }],
          format: { duration: String(durationMs / 1000) },
        }),
      );
      call.child.close(0);
      return;
    }
    const mode = call.args.includes("copy") ? "copy" : "encode";
    modes.set(last, mode);
    const track = path.basename(last).slice(1).split(".")[0] ?? "";
    if (mode === "encode" && opts.failEncode === track) {
      void fsp.writeFile(last, "half").then(() => call.child.close(1));
      return;
    }
    void fsp.writeFile(last, Buffer.alloc(300, 2)).then(() => call.child.close(0));
  });
}

function setup(opts: Parameters<typeof tools>[0] = {}, over: Partial<ProjectDeps> = {}) {
  const t = tools(opts);
  let n = 0;
  const handlers = createProjectHandlers({
    fs: realFs,
    now: manualClock().now,
    libraryRoot: async () => tmp,
    recents: { list: async () => [], touch: async () => {}, remove: async () => {} },
    validate: (doc) => ({ ok: true, value: doc }),
    trashItem: async () => {},
    probe: async () => ({ durationMs: 0, width: null, height: null }),
    newId: () => `tok-${++n}`,
    ffmpeg: {
      runner: { spawn: t.spawn },
      resolveBinaries: () => ({ ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" }),
    },
    ...over,
  });
  const ffmpegCalls = () => t.calls.filter((c) => c.command === "/bin/ffmpeg");
  return { handlers, ffmpegCalls };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof FsIpcError ? e.code : `other:${String(e)}`;
  }
  return "resolved";
}

const exists = (p: string) =>
  fsp.access(p).then(
    () => true,
    () => false,
  );

async function writeProject(sources: Record<string, unknown>) {
  await fsp.writeFile(
    path.join(project, "project.json"),
    JSON.stringify({ schemaVersion: 1, id: "p1", sources }),
  );
}

beforeEach(async () => {
  tmp = await makeTmpDir("reelform-trim-");
  project = path.join(tmp, "Demo.reelform");
  await fsp.mkdir(path.join(project, "media"), { recursive: true });
  for (const f of ["screen.mp4", "mic.webm", "system.m4a", "webcam.webm"]) {
    await fsp.writeFile(media(f), Buffer.alloc(1000, 1));
  }
  await fsp.writeFile(media("telemetry.json.gz"), gzipSync(JSON.stringify(TELEMETRY)));
  await writeProject({
    video: { path: "media/screen.mp4" },
    mic: { path: "media/mic.webm" },
    system: { path: "media/system.m4a" },
    webcam: { path: "media/webcam.webm" },
    telemetry: { path: "media/telemetry.json.gz" },
  });
});

afterEach(async () => {
  await removeDir(tmp);
});

const usedRange = { startMs: 10_000, endMs: 20_000 };

describe("linked track helpers", () => {
  it("shiftTelemetry drops entries outside the kept range and shifts the rest", () => {
    const res = shiftTelemetry(TELEMETRY, 8500, 12_500);
    expect(res.file.points).toEqual([
      [0, 2, 2, "arrow"],
      [500.25, 3, 3, "hand"],
      [12_500, 4, 4, "arrow"],
    ]);
    expect(res.file.clicks).toEqual([[1500, 3, 3, 0, "down"]]);
    expect(res.file.keys).toEqual([]);
    expect(res.file.scrolls).toEqual([[3500, 0, -3]]);
    expect(res.file.bounds).toEqual(TELEMETRY.bounds);
    expect(res).toMatchObject({ pointCount: 3, hasClicks: true, hasKeys: false });
    // The cursor position going into the cut is carried to t=0 (points only).
    const carried = shiftTelemetry(TELEMETRY, 8000, 13_000);
    expect(carried.file.points).toEqual([
      [0, 1, 1, "arrow"],
      [500, 2, 2, "arrow"],
      [1000.25, 3, 3, "hand"],
      [13_000, 4, 4, "arrow"],
    ]);
    expect(carried.file.clicks).toEqual([[2000, 3, 3, 0, "down"]]);
    expect(carried.pointCount).toBe(4);
    expect(() => shiftTelemetry({ points: "nope" }, 0, 1)).toThrow(FsIpcError);
    expect(() => shiftTelemetry({ points: [], clicks: 3 }, 0, 1)).toThrow(FsIpcError);
  });

  it("linkedCutArgs: exact stream copy, or a re-encode that keeps the container", () => {
    const range = { startMs: 8500, endMs: 21_000 };
    const copy = linkedCutArgs({
      input: "a.webm",
      output: "b.webm",
      range,
      mode: "copy",
      hasVideo: true,
    });
    expect(copy.slice(copy.indexOf("-ss"), copy.indexOf("-ss") + 6)).toEqual([
      "-ss",
      "8.5",
      "-i",
      "a.webm",
      "-t",
      "12.5",
    ]);
    expect(copy).toContain("copy");
    const webcam = linkedCutArgs({
      input: "a.webm",
      output: "b.webm",
      range,
      mode: "encode",
      hasVideo: true,
    });
    expect(webcam).toEqual(expect.arrayContaining(["libvpx-vp9", "libopus", "0:v:0?"]));
    const m4a = linkedCutArgs({
      input: "a.m4a",
      output: "b.m4a",
      range,
      mode: "encode",
      hasVideo: false,
    });
    expect(m4a).toEqual(expect.arrayContaining(["aac", "0:a:0"]));
    expect(m4a).not.toContain("libx264");
    const wav = linkedCutArgs({
      input: "a.wav",
      output: "b.wav",
      range,
      mode: "encode",
      hasVideo: false,
    });
    expect(wav).toContain("pcm_s16le");
    expect(() =>
      linkedCutArgs({
        input: "a",
        output: "b",
        range: { startMs: 5, endMs: 5 },
        mode: "copy",
        hasVideo: false,
      }),
    ).toThrow(FsIpcError);
  });
});

describe("project:trimSource with trimLinkedTracks", () => {
  it("cuts mic/system/webcam to the video's range, shifts telemetry and stashes every original", async () => {
    const { handlers, ffmpegCalls } = setup({
      copyDurations: { webcam: 12_500 + LINKED_COPY_TOLERANCE_MS + 900 },
    });
    const res = await handlers["project:trimSource"]({
      path: project,
      usedRange,
      trimLinkedTracks: true,
    });
    expect(projectContracts["project:trimSource"].response.parse(res)).toEqual(res);
    expect(res).toMatchObject({ videoPath: "media/screen-trimmed.mp4", offsetMs: 8500 });
    expect(res.linked).toEqual({
      mic: { path: "media/mic-trimmed.webm", durationMs: 12_500 },
      system: { path: "media/system-trimmed.m4a", durationMs: 12_500 },
      webcam: { path: "media/webcam-trimmed.webm", durationMs: 12_500 },
      telemetry: {
        path: "media/telemetry-trimmed.json.gz",
        pointCount: 3,
        hasClicks: true,
        hasKeys: false,
      },
    });
    expect(res.savedBytes).toBeGreaterThanOrEqual(4 * 700);

    // Linked tracks cut at the real video offset (after keyframe lead-in), not the window start.
    const calls = ffmpegCalls();
    const micArgs = calls.find((c) => c.args.at(-1)?.includes(".mic."))?.args ?? [];
    expect(micArgs[micArgs.indexOf("-ss") + 1]).toBe("8.5");
    expect(micArgs[micArgs.indexOf("-t") + 1]).toBe("12.5");
    // Webcam copy snapped to an earlier keyframe → re-encoded.
    const webcam = calls.filter((c) => c.args.at(-1)?.includes(".webcam."));
    expect(webcam.map((c) => c.args.includes("copy"))).toEqual([true, false]);
    expect(webcam[1]?.args).toContain("libvpx-vp9");
    expect(calls.filter((c) => c.args.at(-1)?.includes(".mic."))).toHaveLength(1);

    const shifted = JSON.parse(
      gunzipSync(await fsp.readFile(media("telemetry-trimmed.json.gz"))).toString("utf8"),
    );
    expect(shifted.points[0]).toEqual([0, 2, 2, "arrow"]);
    expect(shifted.sampleHz).toBe(60);

    expect((await fsp.readdir(path.join(project, "media"))).sort()).toEqual([
      "mic-trimmed.webm",
      "screen-trimmed.mp4",
      "system-trimmed.m4a",
      "telemetry-trimmed.json.gz",
      "webcam-trimmed.webm",
    ]);
    expect((await fsp.readdir(path.join(project, ".trash", res.undoToken))).sort()).toEqual([
      "manifest.json",
      "mic-mic.webm",
      "screen.mp4",
      "system-system.m4a",
      "telemetry-telemetry.json.gz",
      "webcam-webcam.webm",
    ]);

    const restored = await handlers["project:restoreTrimmedSource"]({
      path: project,
      undoToken: res.undoToken,
    });
    expect(restored).toEqual({ ok: true, videoPath: "media/screen.mp4" });
    expect((await fsp.readdir(path.join(project, "media"))).sort()).toEqual([
      "mic.webm",
      "screen.mp4",
      "system.m4a",
      "telemetry.json.gz",
      "webcam.webm",
    ]);
    expect(
      JSON.parse(gunzipSync(await fsp.readFile(media("telemetry.json.gz"))).toString()),
    ).toEqual(TELEMETRY);
    expect(await exists(path.join(project, ".trash", res.undoToken))).toBe(false);
  });

  it("a failed linked cut removes every output and leaves all originals in place", async () => {
    const { handlers } = setup({ copyDurations: { webcam: 20_000 }, failEncode: "webcam" });
    await expect(
      handlers["project:trimSource"]({ path: project, usedRange, trimLinkedTracks: true }),
    ).rejects.toMatchObject({ code: "TRIM_FAILED", details: { track: "webcam" } });
    expect((await fsp.readdir(path.join(project, "media"))).sort()).toEqual([
      "mic.webm",
      "screen.mp4",
      "system.m4a",
      "telemetry.json.gz",
      "webcam.webm",
    ]);
    expect(await exists(path.join(project, ".trash"))).toBe(false);
  });

  it("refuses a missing or out-of-project linked file before running ffmpeg", async () => {
    await fsp.rm(media("mic.webm"));
    const missing = setup();
    await expect(
      missing.handlers["project:trimSource"]({ path: project, usedRange, trimLinkedTracks: true }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND", details: { track: "mic" } });
    expect(missing.ffmpegCalls()).toHaveLength(0);

    await writeProject({
      video: { path: "media/screen.mp4" },
      system: { path: path.join(tmp, "elsewhere.m4a") },
    });
    const outside = setup();
    expect(
      await codeOf(
        outside.handlers["project:trimSource"]({
          path: project,
          usedRange,
          trimLinkedTracks: true,
        }),
      ),
    ).toBe("INVALID_PATH");
    expect(outside.ffmpegCalls()).toHaveLength(0);
  });

  it("plain telemetry JSON stays uncompressed; allowLinkedTracks alone leaves tracks untouched", async () => {
    await fsp.writeFile(media("cursor.json"), JSON.stringify(TELEMETRY));
    await writeProject({
      video: { path: "media/screen.mp4" },
      telemetry: { path: "media/cursor.json" },
    });
    const { handlers } = setup();
    const res = await handlers["project:trimSource"]({
      path: project,
      usedRange,
      trimLinkedTracks: true,
    });
    expect(res.linked).toEqual({
      telemetry: {
        path: "media/cursor-trimmed.json",
        pointCount: 3,
        hasClicks: true,
        hasKeys: false,
      },
    });
    expect(JSON.parse(await fsp.readFile(media("cursor-trimmed.json"), "utf8")).clicks).toEqual([
      [1500, 3, 3, 0, "down"],
    ]);
    await handlers["project:restoreTrimmedSource"]({ path: project, undoToken: res.undoToken });

    const plain = setup();
    const skipped = await plain.handlers["project:trimSource"]({
      path: project,
      usedRange,
      allowLinkedTracks: true,
    });
    expect(skipped.linked).toBeUndefined();
    expect(await exists(media("cursor.json"))).toBe(true);
  });

  it("restore refuses up front when a linked original's slot is taken", async () => {
    const { handlers } = setup();
    const res = await handlers["project:trimSource"]({
      path: project,
      usedRange,
      trimLinkedTracks: true,
    });
    await fsp.writeFile(media("mic.webm"), "new recording");
    expect(
      await codeOf(
        handlers["project:restoreTrimmedSource"]({ path: project, undoToken: res.undoToken }),
      ),
    ).toBe("TRIM_FAILED");
    // Nothing moved: the trimmed state and its undo token are intact.
    expect(await exists(media("screen.mp4"))).toBe(false);
    expect(await exists(media("screen-trimmed.mp4"))).toBe(true);
    expect(await exists(path.join(project, ".trash", res.undoToken, "screen.mp4"))).toBe(true);
  });
});
