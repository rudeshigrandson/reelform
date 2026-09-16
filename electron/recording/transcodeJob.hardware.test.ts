import { describe, expect, it, vi } from "vitest";
import { scriptedSpawn } from "../media/testUtils";
import type { TranscodeProgress } from "./contracts";
import type { H264EncoderSource, TranscodeEncoder } from "./h264Probe";
import { createTranscodeQueue } from "./transcodeJob";

const BINS = { ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" };
const JOB = { sessionId: "s1", input: "/rec/s1/screen.mp4", fps: 30, durationMs: 8000 };

/** Transcodes with an encoder in `failing` exit 1 after reporting 75% progress. */
function setup(select: TranscodeEncoder, failing: TranscodeEncoder[] = []) {
  const disk = new Map<string, number>([[JOB.input, 1000]]);
  const events: TranscodeProgress[] = [];
  const log = vi.fn();
  const { spawn, calls } = scriptedSpawn(({ command, args, child }) => {
    if (command === BINS.ffprobe) {
      child.out("vp9\n");
      child.close(0);
      return;
    }
    const enc = args[args.indexOf("-c:v") + 1] as TranscodeEncoder;
    if (failing.includes(enc)) {
      child.out("out_time_us=6000000\nprogress=continue\n");
      disk.set(args[args.length - 1] as string, 12); // partial output
      child.close(1);
      return;
    }
    child.out("out_time_us=2000000\nprogress=continue\n");
    disk.set(args[args.length - 1] as string, 500);
    child.out("progress=end\n");
    child.close(0);
  });
  const rejected: TranscodeEncoder[] = [];
  const encoder: H264EncoderSource = {
    select: vi.fn(async () => (rejected.includes(select) ? "libx264" : select)),
    reject: (e) => rejected.push(e),
  };
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
    encoder,
    log,
  });
  const encodes = () =>
    calls.filter((c) => c.command === BINS.ffmpeg).map((c) => c.args[c.args.indexOf("-c:v") + 1]);
  return { queue, events, disk, log, rejected, encodes, encoder };
}

describe("createTranscodeQueue — hardware encoder", () => {
  it("uses the selected hardware encoder", async () => {
    const t = setup("h264_videotoolbox");
    t.queue.enqueue(JOB);
    await t.queue.idle();
    expect(t.encodes()).toEqual(["h264_videotoolbox"]);
    expect(t.events.at(-1)).toMatchObject({ done: true, outputPath: JOB.input });
    expect(t.rejected).toEqual([]);
  });

  it("a failed hardware encode is rejected and retried with libx264; progress stays monotonic", async () => {
    const t = setup("h264_nvenc", ["h264_nvenc"]);
    t.queue.enqueue(JOB);
    await t.queue.idle();
    expect(t.encodes()).toEqual(["h264_nvenc", "libx264"]);
    expect(t.rejected).toEqual(["h264_nvenc"]);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("retrying with libx264"));
    const progress = t.events.map((e) => e.progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(t.events.at(-1)).toEqual({
      sessionId: "s1",
      progress: 1,
      done: true,
      outputPath: JOB.input,
    });
    expect(t.disk.get(JOB.input)).toBe(500);

    // The next job goes straight to software.
    t.disk.set("/rec/s2/screen.mp4", 1000);
    t.queue.enqueue({ ...JOB, sessionId: "s2", input: "/rec/s2/screen.mp4" });
    await t.queue.idle();
    expect(t.encodes()).toEqual(["h264_nvenc", "libx264", "libx264"]);
  });

  it("reports an error when the libx264 retry fails too, leaving no partial file", async () => {
    const t = setup("h264_qsv", ["h264_qsv", "libx264"]);
    t.queue.enqueue(JOB);
    await t.queue.idle();
    expect(t.encodes()).toEqual(["h264_qsv", "libx264"]);
    const last = t.events.at(-1);
    expect(last).toMatchObject({ done: true, outputPath: null });
    expect(last?.error).toBeDefined();
    expect(t.disk.has("/rec/s1/screen.h264.part.mp4")).toBe(false);
    expect(t.disk.get(JOB.input)).toBe(1000);
  });

  it("a failing software encode is not retried", async () => {
    const t = setup("libx264", ["libx264"]);
    t.queue.enqueue(JOB);
    await t.queue.idle();
    expect(t.encodes()).toEqual(["libx264"]);
    expect(t.rejected).toEqual([]);
  });

  it("an encoder selection that throws falls back to libx264", async () => {
    const t = setup("h264_amf");
    t.encoder.select = async () => {
      throw new Error("probe crashed");
    };
    t.queue.enqueue(JOB);
    await t.queue.idle();
    expect(t.encodes()).toEqual(["libx264"]);
  });
});
