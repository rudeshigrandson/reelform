import type { FfmpegProgress } from "./progress";
import { RingBuffer, runFfmpeg } from "./runner";
import { type FakeChild, scriptedSpawn } from "./testUtils";

describe("RingBuffer", () => {
  it("keeps only the newest items", () => {
    const rb = new RingBuffer<number>(3);
    for (let i = 0; i < 5; i++) rb.push(i);
    expect(rb.toArray()).toEqual([2, 3, 4]);
    expect(rb.size).toBe(3);
  });

  it("rejects zero capacity", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
  });
});

describe("runFfmpeg", () => {
  it("passes args without a shell, parses progress, resolves with stderr tail", async () => {
    const { spawn, calls } = scriptedSpawn(({ child }) => {
      child.out("frame=1\nout_time_us=1000000\nprog").out("ress=continue\n");
      child.err("line 1\nline 2\npartial");
      child.out(new TextEncoder().encode("out_time_us=2000000\nprogress=end\n"));
      child.close(0);
    });
    const progress: FfmpegProgress[] = [];
    const res = await runFfmpeg(
      { spawn },
      {
        bin: "/bin/ffmpeg",
        args: ["-i", "a b.webm"],
        onProgress: (p) => progress.push(p),
        totalDurationMs: 2000,
      },
    );
    expect(calls[0]?.args).toEqual(["-i", "a b.webm"]);
    expect(progress.map((p) => p.ratio)).toEqual([0.5, 1]);
    expect(res.stderrTail).toEqual(["line 1", "line 2", "partial"]);
  });

  it("collects stdout bytes across chunks", async () => {
    const { spawn } = scriptedSpawn(({ child }) => {
      child.out(new Uint8Array([1, 2])).out(new Uint8Array([3]));
      child.close(0);
    });
    const res = await runFfmpeg({ spawn }, { bin: "ff", args: [], collectStdout: true });
    expect([...res.stdout]).toEqual([1, 2, 3]);
  });

  it("non-zero exit rejects FFMPEG_FAILED with a bounded stderr tail", async () => {
    const { spawn } = scriptedSpawn(({ child }) => {
      for (let i = 0; i < 10; i++) child.err(`e${i}\n`);
      child.close(1);
    });
    await expect(
      runFfmpeg({ spawn }, { bin: "ff", args: [], stderrLines: 3 }),
    ).rejects.toMatchObject({
      code: "FFMPEG_FAILED",
      details: { exitCode: 1, stderrTail: ["e7", "e8", "e9"] },
    });
  });

  it("abort sends SIGTERM, escalates to SIGKILL after grace, rejects FFMPEG_CANCELLED", async () => {
    const timers: Array<() => void> = [];
    let child: FakeChild | undefined;
    const { spawn } = scriptedSpawn((c) => {
      child = c.child;
    });
    const ac = new AbortController();
    const p = runFfmpeg(
      { spawn, setTimeout: (cb) => timers.push(cb), clearTimeout: () => {} },
      { bin: "ff", args: [], signal: ac.signal },
    );
    await Promise.resolve();
    ac.abort();
    expect(child?.kills).toEqual(["SIGTERM"]);
    timers[0]?.();
    expect(child?.kills).toEqual(["SIGTERM", "SIGKILL"]);
    child?.close(null, "SIGKILL");
    await expect(p).rejects.toMatchObject({ code: "FFMPEG_CANCELLED" });
  });

  it("clears the kill timer when the process exits within grace", async () => {
    const cleared: unknown[] = [];
    const { spawn, calls } = scriptedSpawn(() => {});
    const ac = new AbortController();
    const p = runFfmpeg(
      { spawn, setTimeout: () => "t1", clearTimeout: (h) => cleared.push(h) },
      { bin: "ff", args: [], signal: ac.signal },
    );
    await Promise.resolve();
    ac.abort();
    calls[0]?.child.close(255);
    await expect(p).rejects.toMatchObject({ code: "FFMPEG_CANCELLED" });
    expect(cleared).toEqual(["t1"]);
  });

  it("already-aborted signal never spawns", async () => {
    const { spawn, calls } = scriptedSpawn(() => {});
    const ac = new AbortController();
    ac.abort();
    await expect(
      runFfmpeg({ spawn }, { bin: "ff", args: [], signal: ac.signal }),
    ).rejects.toMatchObject({ code: "FFMPEG_CANCELLED" });
    expect(calls).toHaveLength(0);
  });

  it("spawn throw and child error event map to FFMPEG_SPAWN_FAILED", async () => {
    const throwing = () => {
      throw new Error("EACCES");
    };
    await expect(runFfmpeg({ spawn: throwing }, { bin: "ff", args: [] })).rejects.toMatchObject({
      code: "FFMPEG_SPAWN_FAILED",
    });
    const { spawn } = scriptedSpawn(({ child }) => {
      child.emit("error", new Error("ENOENT"));
      child.close(-2);
    });
    await expect(runFfmpeg({ spawn }, { bin: "ff", args: [] })).rejects.toMatchObject({
      code: "FFMPEG_SPAWN_FAILED",
    });
  });

  it("overflow followed by abort sends one SIGTERM and arms one kill timer", async () => {
    const timers: unknown[] = [];
    const cleared: unknown[] = [];
    let child: FakeChild | undefined;
    const { spawn } = scriptedSpawn((c) => {
      child = c.child;
    });
    const ac = new AbortController();
    const p = runFfmpeg(
      {
        spawn,
        setTimeout: () => {
          timers.push(`t${timers.length}`);
          return `t${timers.length - 1}`;
        },
        clearTimeout: (h) => cleared.push(h),
      },
      { bin: "ff", args: [], collectStdout: true, maxStdoutBytes: 4, signal: ac.signal },
    );
    await Promise.resolve();
    child?.out(new Uint8Array(10));
    ac.abort();
    expect(child?.kills).toEqual(["SIGTERM"]);
    expect(timers).toEqual(["t0"]);
    child?.close(null, "SIGTERM");
    await expect(p).rejects.toMatchObject({ code: "FFMPEG_CANCELLED" });
    expect(cleared).toEqual(["t0"]);
  });

  it("stdout overflow kills the process and rejects", async () => {
    const { spawn, calls } = scriptedSpawn(({ child }) => {
      child.out(new Uint8Array(10));
      child.close(null, "SIGTERM");
    });
    await expect(
      runFfmpeg(
        { spawn, setTimeout: () => 0, clearTimeout: () => {} },
        { bin: "ff", args: [], collectStdout: true, maxStdoutBytes: 4 },
      ),
    ).rejects.toMatchObject({
      code: "FFMPEG_OUTPUT_TOO_LARGE",
    });
    expect(calls[0]?.child.kills).toEqual(["SIGTERM"]);
  });
});
