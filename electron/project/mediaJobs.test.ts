import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { type SpawnCall, scriptedSpawn } from "../media/testUtils";
import { projectContracts, projectEvents } from "./contracts";
import { FsIpcError } from "./errors";
import { type ProjectDeps, createProjectHandlers } from "./handlers";
import { needsProxy } from "./proxy";
import { makeTmpDir, manualClock, realFs, removeDir } from "./testHelpers";
import { estimateTrimOffsetMs, purgeTrimTrash, rewriteClips } from "./trimSource";

let tmp: string;
let library: string;
let project: string;

/** ffprobe answer per input path (default 60s 1080p). */
let probes: Map<string, { durationMs: number; width: number; height: number }>;

const probeJson = (p: { durationMs: number; width: number; height: number }) =>
  JSON.stringify({
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        width: p.width,
        height: p.height,
        avg_frame_rate: "30/1",
      },
    ],
    format: { duration: String(p.durationMs / 1000) },
  });

type FfmpegScript = (call: SpawnCall) => Promise<void>;

function fakeTools(ffmpeg: FfmpegScript) {
  return scriptedSpawn((call) => {
    if (call.command === "/bin/ffprobe") {
      const input = call.args.at(-1) ?? "";
      const probe = [...probes].find(([k]) => input.includes(k))?.[1] ?? {
        durationMs: 60_000,
        width: 1920,
        height: 1080,
      };
      call.child.out(probeJson(probe));
      call.child.close(0);
      return;
    }
    void ffmpeg(call).then(
      () => call.child.close(0),
      () => call.child.close(1),
    );
  });
}

function setup(ffmpeg: FfmpegScript, over: Partial<ProjectDeps> = {}) {
  const tools = fakeTools(ffmpeg);
  const events: unknown[] = [];
  const trashed: string[] = [];
  const handlers = createProjectHandlers({
    fs: realFs,
    now: manualClock().now,
    libraryRoot: async () => library,
    recents: { list: async () => [], touch: async () => {}, remove: async () => {} },
    validate: (doc) => ({ ok: true, value: doc }),
    trashItem: async () => {},
    probe: async () => ({ durationMs: 0, width: null, height: null }),
    ffmpeg: {
      runner: { spawn: tools.spawn },
      resolveBinaries: () => ({ ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" }),
    },
    onProxyProgress: (e) => events.push(e),
    onTrimTrashed: (d) => trashed.push(d),
    ...over,
  });
  const ffmpegCalls = () => tools.calls.filter((c) => c.command === "/bin/ffmpeg");
  return { handlers, events, trashed, ffmpegCalls };
}

const writeOutput = (bytes: number) => async (call: SpawnCall) => {
  await fsp.writeFile(call.args.at(-1) ?? "", Buffer.alloc(bytes, 2));
};

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof FsIpcError
      ? e.code
      : `other:${String((e as { code?: unknown }).code ?? e)}`;
  }
  return "resolved";
}

const exists = (p: string) =>
  fsp.access(p).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  tmp = await makeTmpDir("reelform-mediajobs-");
  library = path.join(tmp, "Library");
  project = path.join(library, "Demo.reelform");
  await fsp.mkdir(path.join(project, "media"), { recursive: true });
  await fsp.writeFile(
    path.join(project, "project.json"),
    JSON.stringify({
      schemaVersion: 1,
      id: "p1",
      modifiedAt: "2026-01-01T00:00:00.000Z",
      sources: { video: { path: "media/screen.mp4" } },
    }),
  );
  await fsp.writeFile(path.join(project, "media", "screen.mp4"), Buffer.alloc(1000, 1));
  probes = new Map();
});

afterEach(async () => {
  await removeDir(tmp);
});

describe("contracts", () => {
  it("new channels are named by their keys; references need projectId or path", () => {
    for (const [k, ch] of Object.entries(projectContracts)) expect(ch.name).toBe(k);
    expect(projectEvents["project:proxyProgress"].name).toBe("project:proxyProgress");
    const trim = projectContracts["project:trimSource"].request;
    expect(trim.safeParse({ usedRange: { startMs: 0, endMs: 1 } }).success).toBe(false);
    expect(trim.safeParse({ projectId: "p1", usedRange: { startMs: 0, endMs: 1 } }).success).toBe(
      true,
    );
    const thumbs = projectContracts["project:ensureThumbnails"].request;
    expect(thumbs.safeParse({ projectId: "p1", intervalMs: 10 }).success).toBe(false);
  });
});

describe("trim helpers", () => {
  it("offset accounts for the keyframe lead-in and never goes negative", () => {
    expect(estimateTrimOffsetMs({ startMs: 9000, endMs: 21000 }, 12_000)).toBe(9000);
    expect(estimateTrimOffsetMs({ startMs: 9000, endMs: 21000 }, 12_500)).toBe(8500);
    expect(estimateTrimOffsetMs({ startMs: 9000, endMs: 21000 }, 11_000)).toBe(9000);
    expect(estimateTrimOffsetMs({ startMs: 500, endMs: 5000 }, 60_000)).toBe(0);
    expect(
      rewriteClips([{ id: "a", sourceStartMs: 100, sourceEndMs: 900, timelineStartMs: 0 }], 200),
    ).toEqual([{ id: "a", sourceStartMs: 0, sourceEndMs: 700, timelineStartMs: 0 }]);
  });
});

describe("project:trimSource / project:restoreTrimmedSource", () => {
  beforeEach(() => {
    probes.set("screen.mp4", { durationMs: 60_000, width: 1920, height: 1080 });
    probes.set(".partial", { durationMs: 12_500, width: 1920, height: 1080 });
  });

  it("cuts with 1s handles, moves the original to the trim trash and rewrites clips", async () => {
    const { handlers, trashed, ffmpegCalls } = setup(writeOutput(300));
    const res = await handlers["project:trimSource"]({
      projectId: "p1",
      usedRange: { startMs: 10_000, endMs: 20_000 },
      clips: [{ id: "k1", sourceStartMs: 10_000, sourceEndMs: 20_000, timelineStartMs: 0, x: 1 }],
    });
    expect(projectContracts["project:trimSource"].response.parse(res)).toEqual(res);
    expect(res).toMatchObject({
      videoPath: "media/screen-trimmed.mp4",
      videoDurationMs: 12_500,
      savedBytes: 700,
      offsetMs: 8500,
      clips: [{ id: "k1", sourceStartMs: 1500, sourceEndMs: 11_500, timelineStartMs: 0, x: 1 }],
    });
    const args = ffmpegCalls()[0]?.args ?? [];
    expect(args[args.indexOf("-ss") + 1]).toBe("9");
    expect(args[args.indexOf("-t") + 1]).toBe("12");
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
    expect(await exists(path.join(project, "media", "screen.mp4"))).toBe(false);
    expect(await exists(path.join(project, ".trash", res.undoToken, "screen.mp4"))).toBe(true);
    expect((await fsp.readdir(path.join(project, "media"))).sort()).toEqual(["screen-trimmed.mp4"]);
    expect(trashed).toEqual([project]);

    const restored = await handlers["project:restoreTrimmedSource"]({
      path: project,
      undoToken: res.undoToken,
    });
    expect(restored).toEqual({ ok: true, videoPath: "media/screen.mp4" });
    expect(await fsp.readdir(path.join(project, "media"))).toEqual(["screen.mp4"]);
    expect(await exists(path.join(project, ".trash", res.undoToken))).toBe(false);
    expect(
      await codeOf(
        handlers["project:restoreTrimmedSource"]({ path: project, undoToken: res.undoToken }),
      ),
    ).toBe("TRIM_UNDO_NOT_FOUND");
    expect(
      await codeOf(handlers["project:restoreTrimmedSource"]({ path: project, undoToken: "../x" })),
    ).toBe("TRIM_UNDO_NOT_FOUND");
  });

  it("purgeTrimTrash deletes trimmed originals for good", async () => {
    const { handlers } = setup(writeOutput(300));
    const res = await handlers["project:trimSource"]({
      path: project,
      usedRange: { startMs: 10_000, endMs: 20_000 },
    });
    expect(res.clips).toEqual([]);
    expect(await purgeTrimTrash([project, project, path.join(tmp, "none.reelform")], realFs)).toBe(
      1,
    );
    expect(await exists(path.join(project, ".trash"))).toBe(false);
    expect(
      await codeOf(
        handlers["project:restoreTrimmedSource"]({ path: project, undoToken: res.undoToken }),
      ),
    ).toBe("TRIM_UNDO_NOT_FOUND");
  });

  it("reports FFMPEG_UNAVAILABLE, nothing to save, and ffmpeg failures without touching the source", async () => {
    const none = setup(writeOutput(1), { ffmpeg: undefined });
    expect(
      await codeOf(
        none.handlers["project:trimSource"]({
          path: project,
          usedRange: { startMs: 0, endMs: 1000 },
        }),
      ),
    ).toBe("FFMPEG_UNAVAILABLE");

    const all = setup(writeOutput(1));
    expect(
      await codeOf(
        all.handlers["project:trimSource"]({
          path: project,
          usedRange: { startMs: 500, endMs: 59_800 },
        }),
      ),
    ).toBe("TRIM_NOTHING_TO_SAVE");

    const broken = setup(async (call) => {
      await fsp.writeFile(call.args.at(-1) ?? "", "partial");
      throw new Error("encode failed");
    });
    expect(
      await codeOf(
        broken.handlers["project:trimSource"]({
          path: project,
          usedRange: { startMs: 10_000, endMs: 20_000 },
        }),
      ),
    ).toBe("TRIM_FAILED");
    expect(await fsp.readdir(path.join(project, "media"))).toEqual(["screen.mp4"]);
    expect(await exists(path.join(project, ".trash"))).toBe(false);
  });

  it("refuses projects with linked tracks unless the caller opts in", async () => {
    const doc = JSON.parse(await fsp.readFile(path.join(project, "project.json"), "utf8"));
    doc.sources.mic = { path: "media/mic.webm" };
    doc.sources.telemetry = { path: "telemetry.json" };
    await fsp.writeFile(path.join(project, "project.json"), JSON.stringify(doc));
    const { handlers, ffmpegCalls } = setup(writeOutput(300));
    const req = { path: project, usedRange: { startMs: 10_000, endMs: 20_000 } };
    const refused = handlers["project:trimSource"](req);
    await expect(refused).rejects.toMatchObject({
      code: "TRIM_LINKED_TRACKS",
      details: { tracks: ["mic", "telemetry"] },
    });
    expect(ffmpegCalls()).toHaveLength(0);
    expect(await exists(path.join(project, "media", "screen.mp4"))).toBe(true);
    const res = await handlers["project:trimSource"]({ ...req, allowLinkedTracks: true });
    expect(res.videoPath).toBe("media/screen-trimmed.mp4");
  });

  it("refuses sources outside the project and unknown projects", async () => {
    const { handlers } = setup(writeOutput(1));
    expect(
      await codeOf(
        handlers["project:trimSource"]({
          path: project,
          videoPath: "../../elsewhere.mp4",
          usedRange: { startMs: 0, endMs: 1000 },
        }),
      ),
    ).toBe("PATH_OUTSIDE_ROOT");
    expect(
      await codeOf(
        handlers["project:trimSource"]({
          projectId: "nope",
          usedRange: { startMs: 0, endMs: 1000 },
        }),
      ),
    ).toBe("PROJECT_NOT_FOUND");
  });
});

describe("project:ensureProxy", () => {
  const progressWriter = async (call: SpawnCall) => {
    call.child.out("out_time=00:00:30.000000\nprogress=continue\n");
    await fsp.writeFile(call.args.at(-1) ?? "", Buffer.alloc(10, 3));
    call.child.out("out_time=00:01:00.000000\nprogress=end\n");
  };

  it("needsProxy: short edge above 1440p or longer than 30 minutes", () => {
    expect(needsProxy({ width: 2560, height: 1440, durationMs: 60_000 })).toBe(false);
    expect(needsProxy({ width: 2880, height: 1800, durationMs: 60_000 })).toBe(true);
    expect(needsProxy({ width: 1920, height: 1080, durationMs: 31 * 60_000 })).toBe(true);
  });

  it("generates once with progress events, reuses a fresh proxy, regenerates when the source is newer", async () => {
    probes.set("screen.mp4", { durationMs: 60_000, width: 3840, height: 2160 });
    const { handlers, events, ffmpegCalls } = setup(progressWriter);
    const [a, b] = await Promise.all([
      handlers["project:ensureProxy"]({ projectId: "p1" }),
      handlers["project:ensureProxy"]({ projectId: "p1" }),
    ]);
    expect(a).toEqual({ proxyPath: "cache/proxy.mp4", generated: true });
    expect(b).toEqual(a);
    expect(ffmpegCalls()).toHaveLength(1);
    const args = ffmpegCalls()[0]?.args ?? [];
    expect(args[args.indexOf("-vf") + 1]).toBe("scale=-2:1080");
    expect(path.basename(args.at(-1) ?? "")).toBe("proxy.partial.mp4");
    expect(await fsp.readdir(path.join(project, "cache"))).toEqual(["proxy.mp4"]);
    const progress = events.map((e) => (e as { progress: number }).progress);
    expect(progress[0]).toBe(0);
    expect(progress).toContain(0.5);
    expect(progress.at(-1)).toBe(1);
    for (const e of events) {
      expect(projectEvents["project:proxyProgress"].payload.parse(e)).toEqual(e);
    }

    expect(await handlers["project:ensureProxy"]({ projectId: "p1" })).toEqual({
      proxyPath: "cache/proxy.mp4",
      generated: false,
    });
    expect(ffmpegCalls()).toHaveLength(1);

    const future = new Date(Date.now() + 60_000);
    await fsp.utimes(path.join(project, "media", "screen.mp4"), future, future);
    expect((await handlers["project:ensureProxy"]({ projectId: "p1" })).generated).toBe(true);
    expect(ffmpegCalls()).toHaveLength(2);
  });

  it("returns null for small sources and PROXY_FAILED (no temp left) on ffmpeg errors", async () => {
    const small = setup(progressWriter);
    expect(await small.handlers["project:ensureProxy"]({ projectId: "p1" })).toEqual({
      proxyPath: null,
      generated: false,
    });
    expect(small.ffmpegCalls()).toHaveLength(0);

    probes.set("screen.mp4", { durationMs: 40 * 60_000, width: 1920, height: 1080 });
    const broken = setup(async (call) => {
      await fsp.writeFile(call.args.at(-1) ?? "", "half");
      throw new Error("x264 died");
    });
    expect(await codeOf(broken.handlers["project:ensureProxy"]({ projectId: "p1" }))).toBe(
      "PROXY_FAILED",
    );
    expect(await fsp.readdir(path.join(project, "cache"))).toEqual([]);
  });
});

describe("project:ensureThumbnails", () => {
  const frames = (n: number) => async (call: SpawnCall) => {
    const dir = path.dirname(call.args.at(-1) ?? "");
    for (let i = 1; i <= n; i++) {
      await fsp.writeFile(path.join(dir, `${String(i).padStart(6, "0")}.jpg`), "jpg");
    }
  };

  it("generates numbered JPEGs with an index and reuses them", async () => {
    const { handlers, ffmpegCalls } = setup(frames(3));
    const res = await handlers["project:ensureThumbnails"]({ projectId: "p1" });
    expect(res.items).toEqual([
      { sourceMs: 0, path: "cache/thumbs/000001.jpg" },
      { sourceMs: 2000, path: "cache/thumbs/000002.jpg" },
      { sourceMs: 4000, path: "cache/thumbs/000003.jpg" },
    ]);
    expect(projectContracts["project:ensureThumbnails"].response.parse(res)).toEqual(res);
    const args = ffmpegCalls()[0]?.args ?? [];
    expect(args[args.indexOf("-vf") + 1]).toBe("fps=1/2,scale=-2:160");
    expect(args.at(-1)).toBe(path.join(project, "cache", "thumbs", "%06d.jpg"));
    expect(await exists(path.join(project, "cache", "thumbs", "index.json"))).toBe(true);

    expect(await handlers["project:ensureThumbnails"]({ projectId: "p1" })).toEqual(res);
    expect(ffmpegCalls()).toHaveLength(1);
  });

  it("regenerates when parameters, the source, or a frame change", async () => {
    const { handlers, ffmpegCalls } = setup(frames(2));
    await handlers["project:ensureThumbnails"]({ projectId: "p1" });
    const tall = await handlers["project:ensureThumbnails"]({ projectId: "p1", height: 90 });
    expect(tall.items).toHaveLength(2);
    expect(ffmpegCalls()).toHaveLength(2);
    expect(ffmpegCalls()[1]?.args).toContain("fps=1/2,scale=-2:90");

    await fsp.rm(path.join(project, "cache", "thumbs", "000002.jpg"));
    await handlers["project:ensureThumbnails"]({ projectId: "p1", height: 90 });
    expect(ffmpegCalls()).toHaveLength(3);

    await fsp.appendFile(path.join(project, "media", "screen.mp4"), "more");
    await handlers["project:ensureThumbnails"]({ projectId: "p1", height: 90 });
    expect(ffmpegCalls()).toHaveLength(4);
  });

  it("THUMBNAILS_FAILED when ffmpeg writes nothing; FFMPEG_UNAVAILABLE without binaries", async () => {
    const empty = setup(frames(0));
    expect(await codeOf(empty.handlers["project:ensureThumbnails"]({ projectId: "p1" }))).toBe(
      "THUMBNAILS_FAILED",
    );
    expect(await exists(path.join(project, "cache", "thumbs"))).toBe(false);
    const none = setup(frames(1), {
      ffmpeg: { runner: { spawn: fakeTools(frames(1)).spawn }, resolveBinaries: () => null },
    });
    expect(await codeOf(none.handlers["project:ensureThumbnails"]({ projectId: "p1" }))).toBe(
      "FFMPEG_UNAVAILABLE",
    );
  });
});
