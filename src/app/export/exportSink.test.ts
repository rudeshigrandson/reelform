import { afterEach, describe, expect, it, vi } from "vitest";
import { type ExportIpc, IpcExportSink, ipcExportTransport, writeFileViaSink } from "./exportSink";
import { deferred, flush } from "./testFakes";

interface SentWrite {
  bytes: number[];
  position: number | undefined;
}

function fakeIpc() {
  const sent: SentWrite[] = [];
  const log: string[] = [];
  let size = 0;
  const gates: ReturnType<typeof deferred<void>>[] = [];
  let gateWrites = false;
  const ipc: ExportIpc = {
    begin: vi.fn(async (req) => {
      log.push(`begin:${req.config.destinationDir ?? "-"}`);
      return { exportId: "e1", tempPath: "/x/.partial" };
    }),
    writeChunk: vi.fn(async (req) => {
      const bytes = [...new Uint8Array(req.chunk as ArrayBuffer)];
      log.push(`write:${bytes.join(",")}@${req.position ?? "append"}`);
      if (gateWrites) {
        const g = deferred();
        gates.push(g);
        await g.promise;
      }
      sent.push({ bytes, position: req.position });
      size = Math.max(size, (req.position ?? size) + bytes.length);
      return { bytesWritten: bytes.length, size };
    }),
    finish: vi.fn(async (req) => {
      log.push(`finish:${req.finalName}`);
      return { path: `/x/${req.finalName}` };
    }),
    cancel: vi.fn(async () => {
      log.push("cancel");
      return { cancelled: true };
    }),
  };
  return {
    ipc,
    sent,
    log,
    gates,
    gate: () => {
      gateWrites = true;
    },
  };
}

const sinkFor = (ipc: ExportIpc, destinationDir: string | null = "/dest") =>
  new IpcExportSink({ ipc, projectId: "p1", destinationDir, finalName: "Demo.mp4" });

afterEach(() => vi.restoreAllMocks());

describe("IpcExportSink", () => {
  it("begins with the destination + info and finishes to the final name", async () => {
    const f = fakeIpc();
    const sink = sinkFor(f.ipc);
    await sink.begin({ container: "gif" });
    expect(f.ipc.begin).toHaveBeenCalledWith({
      projectId: "p1",
      config: { container: "gif", destinationDir: "/dest" },
    });
    await sink.writeChunk(new Uint8Array([1, 2, 3]));
    await expect(sink.finish()).resolves.toEqual({ path: "/x/Demo.mp4" });
    expect(sink.state).toBe("finished");
    expect(sink.size).toBe(3);
    expect(sinkFor(f.ipc, null)).toBeDefined();
  });

  it("omits destinationDir when the project default is used", async () => {
    const f = fakeIpc();
    await sinkFor(f.ipc, null).begin();
    expect(f.ipc.begin).toHaveBeenCalledWith({ projectId: "p1", config: {} });
  });

  it("serializes writes in call order while responses are slow, keeping position rewrites", async () => {
    const f = fakeIpc();
    const sink = sinkFor(f.ipc);
    await sink.begin();
    f.gate();
    const a = sink.writeChunk(new Uint8Array([1, 1, 1, 1]));
    const b = sink.writeChunk(new Uint8Array([2, 2]), 8);
    const c = sink.writeChunk(new Uint8Array([9]), 0); // header rewrite
    await flush();
    // Only the first write is in flight; the rest wait for it.
    expect(f.ipc.writeChunk).toHaveBeenCalledTimes(1);
    f.gates[0]?.resolve();
    await flush();
    expect(f.ipc.writeChunk).toHaveBeenCalledTimes(2);
    f.gates[1]?.resolve();
    await flush();
    f.gates[2]?.resolve();
    await Promise.all([a, b, c]);
    expect(f.sent).toEqual([
      { bytes: [1, 1, 1, 1], position: undefined },
      { bytes: [2, 2], position: 8 },
      { bytes: [9], position: 0 },
    ]);
    expect(sink.size).toBe(10);
  });

  it("copies chunk bytes on entry (muxer buffer reuse)", async () => {
    const f = fakeIpc();
    const sink = sinkFor(f.ipc);
    await sink.begin();
    f.gate();
    const shared = new Uint8Array([5, 5]);
    const first = sink.writeChunk(new Uint8Array([0]));
    const second = sink.writeChunk(shared, 1);
    shared.fill(7);
    await flush();
    f.gates[0]?.resolve();
    await flush();
    f.gates[1]?.resolve();
    await Promise.all([first, second]);
    expect(f.sent[1]?.bytes).toEqual([5, 5]);
  });

  it("a failed write fails every later write and finish with the same error", async () => {
    const f = fakeIpc();
    const err = Object.assign(new Error("disk full"), {
      code: "EXPORT_WRITE_FAILED",
      details: { errno: "ENOSPC" },
    });
    vi.mocked(f.ipc.writeChunk).mockRejectedValueOnce(err);
    const sink = sinkFor(f.ipc);
    await sink.begin();
    const a = sink.writeChunk(new Uint8Array([1]));
    const b = sink.writeChunk(new Uint8Array([2]));
    await expect(a).rejects.toBe(err);
    await expect(b).rejects.toBe(err);
    await expect(sink.finish()).rejects.toBe(err);
    expect(f.ipc.writeChunk).toHaveBeenCalledTimes(1);
    expect(f.ipc.finish).not.toHaveBeenCalled();
  });

  it("cancel waits for queued writes, calls export:cancel once, and is idempotent", async () => {
    const f = fakeIpc();
    const sink = sinkFor(f.ipc);
    await sink.begin();
    f.gate();
    const w = sink.writeChunk(new Uint8Array([1]));
    await flush(); // first write is in flight
    const queued = sink.writeChunk(new Uint8Array([3]));
    const c1 = sink.cancel();
    const c2 = sink.cancel();
    expect(c1).toBe(c2);
    await flush();
    expect(f.ipc.cancel).not.toHaveBeenCalled();
    f.gates[0]?.resolve();
    await w;
    await expect(queued).rejects.toThrow(/closed/);
    await c1;
    expect(f.ipc.writeChunk).toHaveBeenCalledTimes(1);
    await sink.cancel();
    expect(f.ipc.cancel).toHaveBeenCalledTimes(1);
    expect(f.log.at(-1)).toBe("cancel");
    await expect(sink.writeChunk(new Uint8Array([2]))).rejects.toThrow(/cancelled/);
    await expect(sink.finish()).rejects.toThrow(/cancelled/);
  });

  it("cancel before begin never touches main; after finish it is a no-op", async () => {
    const f = fakeIpc();
    const fresh = sinkFor(f.ipc);
    await fresh.cancel();
    expect(fresh.state).toBe("cancelled");
    await expect(fresh.begin()).rejects.toThrow(/already cancelled/);
    const done = sinkFor(f.ipc);
    await done.begin();
    await done.finish();
    await done.cancel();
    expect(f.ipc.cancel).not.toHaveBeenCalled();
    expect(done.state).toBe("finished");
  });

  it("cancel racing begin discards the export main just opened", async () => {
    const f = fakeIpc();
    const gate = deferred<{ exportId: string; tempPath: string }>();
    vi.mocked(f.ipc.begin).mockReturnValueOnce(gate.promise);
    const sink = sinkFor(f.ipc);
    const began = sink.begin();
    const cancelled = sink.cancel();
    gate.resolve({ exportId: "e9", tempPath: "/t" });
    await began;
    await cancelled;
    expect(f.ipc.cancel).toHaveBeenCalledWith({ exportId: "e9" });
  });

  it("re-begins a fresh temp file after cancel (engine software restart: begin→cancel→begin→finish)", async () => {
    const f = fakeIpc();
    let n = 0;
    vi.mocked(f.ipc.begin).mockImplementation(async () => ({
      exportId: `e${++n}`,
      tempPath: `/x/.p${n}`,
    }));
    const sink = sinkFor(f.ipc);
    await sink.begin({ container: "gif" });
    await sink.writeChunk(new Uint8Array([1, 2, 3, 4, 5]));
    await sink.cancel();
    expect(f.ipc.cancel).toHaveBeenCalledWith({ exportId: "e1" });
    await sink.begin({ container: "gif" });
    expect(sink.state).toBe("open");
    expect(sink.exportId).toBe("e2");
    expect(sink.size).toBe(0);
    await sink.writeChunk(new Uint8Array([9]));
    expect(vi.mocked(f.ipc.writeChunk).mock.calls.at(-1)?.[0].exportId).toBe("e2");
    await expect(sink.finish()).resolves.toEqual({ path: "/x/Demo.mp4" });
    expect(f.ipc.cancel).toHaveBeenCalledTimes(1);
  });

  it("re-begins after a write failure once the failed file was cancelled", async () => {
    const f = fakeIpc();
    vi.mocked(f.ipc.writeChunk).mockRejectedValueOnce(new Error("encoder died mid-write"));
    const sink = sinkFor(f.ipc);
    await sink.begin();
    await expect(sink.writeChunk(new Uint8Array([1]))).rejects.toThrow("encoder died");
    await sink.cancel();
    await sink.begin();
    await sink.writeChunk(new Uint8Array([2, 2]));
    await expect(sink.finish()).resolves.toEqual({ path: "/x/Demo.mp4" });
    expect(sink.size).toBe(2);
  });

  it("a failed begin leaves the sink failed", async () => {
    const f = fakeIpc();
    vi.mocked(f.ipc.begin).mockRejectedValueOnce(new Error("EACCES"));
    const sink = sinkFor(f.ipc);
    await expect(sink.begin()).rejects.toThrow("EACCES");
    expect(sink.state).toBe("failed");
    await expect(sink.writeChunk(new Uint8Array([1]))).rejects.toThrow("EACCES");
  });
});

describe("writeFileViaSink", () => {
  it("writes a small file and returns its path", async () => {
    const f = fakeIpc();
    const path = await writeFileViaSink(
      { ipc: f.ipc, projectId: "p", destinationDir: "/d", finalName: "Demo.srt" },
      "srt",
      new TextEncoder().encode("1"),
    );
    expect(path).toBe("/x/Demo.srt");
    expect(f.log).toEqual(["begin:/d", "write:49@append", "finish:Demo.srt"]);
  });

  it("cancels the temp file when finishing fails", async () => {
    const f = fakeIpc();
    vi.mocked(f.ipc.finish).mockRejectedValueOnce(new Error("rename failed"));
    await expect(
      writeFileViaSink(
        { ipc: f.ipc, projectId: "p", finalName: "a.vtt" },
        "vtt",
        new Uint8Array(0),
      ),
    ).rejects.toThrow("rename failed");
    expect(f.ipc.writeChunk).not.toHaveBeenCalled();
  });
});

describe("ipcExportTransport", () => {
  it("fails with NOT_BRIDGED outside Electron", async () => {
    await expect(ipcExportTransport().begin({ projectId: "p", config: {} })).rejects.toMatchObject({
      code: "NOT_BRIDGED",
    });
  });
});
