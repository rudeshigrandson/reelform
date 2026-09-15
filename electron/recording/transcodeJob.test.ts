import { describe, expect, it, vi } from "vitest";
import { scriptedSpawn } from "../media/testUtils";
import type { FinalizeResponse, TranscodeProgress } from "./contracts";
import {
  buildVideoCodecProbeArgs,
  createTranscodePostProcess,
  createTranscodeQueue,
  h264OutputPath,
  h264PartPath,
} from "./transcodeJob";

const BINS = { ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" };

interface Script {
  codec?: string;
  transcodeExit?: number;
}

function setup(script: Script = {}, files: Record<string, number> = {}) {
  const disk = new Map<string, number>(Object.entries(files));
  const events: TranscodeProgress[] = [];
  const log = vi.fn();
  const { spawn, calls } = scriptedSpawn(({ command, args, child }) => {
    if (command === BINS.ffprobe) {
      child.out(`${script.codec ?? "vp9"}\n`);
      child.close(0);
      return;
    }
    child.out("out_time_us=2000000\nprogress=continue\n");
    child.out("out_time_us=4000000\nprogress=continue\n");
    const out = args[args.length - 1] as string;
    if ((script.transcodeExit ?? 0) === 0) disk.set(out, 500);
    child.out("progress=end\n");
    child.close(script.transcodeExit ?? 0);
  });
  const queue = createTranscodeQueue({
    runner: { spawn },
    resolveBinaries: () => BINS,
    fileSize: async (p) => disk.get(p) ?? null,
    remove: async (p) => {
      disk.delete(p);
    },
    rename: async (from, to) => {
      const size = disk.get(from);
      if (size === undefined) throw new Error(`ENOENT ${from}`);
      disk.delete(from);
      disk.set(to, size);
    },
    exists: async (p) => disk.has(p),
    emit: (e) => events.push(e),
    log,
  });
  return { queue, events, calls, disk, log };
}

const JOB = { sessionId: "s1", input: "/rec/s1/screen.mp4", fps: 60, durationMs: 8000 };

describe("paths and args", () => {
  it("derives sibling names and probes only the first video stream", () => {
    expect(h264OutputPath("/rec/s1/screen.mp4")).toBe("/rec/s1/screen.h264.mp4");
    expect(h264PartPath("C:\\rec\\screen.webm")).toBe("C:\\rec\\screen.h264.part.mp4");
    expect(buildVideoCodecProbeArgs("/a.mp4")).toEqual(
      expect.arrayContaining(["-select_streams", "v:0", "/a.mp4"]),
    );
  });
});

describe("createTranscodeQueue", () => {
  it("transcodes VP9, reports progress and swaps the file in place", async () => {
    const t = setup({}, { [JOB.input]: 1000 });
    t.queue.enqueue(JOB);
    await t.queue.idle();
    expect(t.calls.map((c) => c.command)).toEqual([BINS.ffprobe, BINS.ffmpeg]);
    const args = t.calls[1]?.args ?? [];
    expect(args).toEqual(expect.arrayContaining(["-i", JOB.input, "-c:v", "libx264"]));
    expect(args[args.length - 1]).toBe("/rec/s1/screen.h264.part.mp4");
    expect(t.events[0]).toEqual({ sessionId: "s1", progress: 0, done: false, outputPath: null });
    expect(t.events.map((e) => e.progress)).toEqual([0, 0.25, 0.5, 1]);
    expect(t.events.at(-1)).toEqual({
      sessionId: "s1",
      progress: 1,
      done: true,
      outputPath: JOB.input,
    });
    expect([...t.disk.entries()]).toEqual([[JOB.input, 500]]);
  });

  it("reports the H.264 sibling when the original was already moved", async () => {
    const t = setup();
    t.queue.enqueue(JOB);
    await t.queue.idle();
    expect(t.events.at(-1)).toMatchObject({ done: true, outputPath: "/rec/s1/screen.h264.mp4" });
    expect(t.disk.get("/rec/s1/screen.h264.mp4")).toBe(500);
  });

  it("skips H.264 input and a missing ffmpeg without emitting", async () => {
    const t = setup({ codec: "h264" }, { [JOB.input]: 1000 });
    t.queue.enqueue(JOB);
    await t.queue.idle();
    expect(t.calls).toHaveLength(1);
    expect(t.events).toEqual([]);

    const spawn = vi.fn();
    const events: TranscodeProgress[] = [];
    const none = createTranscodeQueue({
      runner: { spawn },
      resolveBinaries: () => null,
      fileSize: async () => null,
      remove: async () => {},
      rename: async () => {},
      exists: async () => true,
      emit: (e) => events.push(e),
    });
    none.enqueue(JOB);
    await none.idle();
    expect(spawn).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("a failed transcode keeps the original, removes the partial file and reports the error", async () => {
    const t = setup({ transcodeExit: 1 }, { [JOB.input]: 1000 });
    t.queue.enqueue(JOB);
    await t.queue.idle();
    const last = t.events.at(-1);
    expect(last).toMatchObject({ done: true, outputPath: null });
    expect(last?.error).toMatch(/exited with 1/);
    expect([...t.disk.entries()]).toEqual([[JOB.input, 1000]]);
  });

  it("runs jobs one at a time in order", async () => {
    const t = setup({}, { [JOB.input]: 1, "/rec/s2/screen.mp4": 1 });
    t.queue.enqueue(JOB);
    t.queue.enqueue({ ...JOB, sessionId: "s2", input: "/rec/s2/screen.mp4" });
    await t.queue.idle();
    expect(t.calls.map((c) => c.args[c.args.length - 1])).toEqual([
      JOB.input,
      "/rec/s1/screen.h264.part.mp4",
      "/rec/s2/screen.mp4",
      "/rec/s2/screen.h264.part.mp4",
    ]);
    expect(t.events.filter((e) => e.done).map((e) => e.sessionId)).toEqual(["s1", "s2"]);
  });
});

describe("createTranscodePostProcess", () => {
  it("queues Electron-backend recordings only and returns the response unchanged", async () => {
    const enqueue = vi.fn();
    const step = createTranscodePostProcess({ enqueue, idle: async () => {} });
    const res = {
      recordingId: "s1",
      video: { path: JOB.input },
      meta: { backend: "electron", recordedFps: 60, durationMs: 8000 },
    } as FinalizeResponse;
    expect(await step(res)).toBe(res);
    expect(enqueue).toHaveBeenCalledWith(JOB);
    await step({ ...res, meta: { ...res.meta, backend: "sck" } });
    expect(enqueue).toHaveBeenCalledOnce();
  });
});
