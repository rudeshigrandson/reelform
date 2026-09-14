import fc from "fast-check";
import { createChunkPump } from "./chunkPump";
import type { WriteChunkRequest } from "./port";
import { fakeBlob } from "./testFakes";

function deferred() {
  let resolve: () => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createChunkPump", () => {
  it("writes chunks in order with sequential seq numbers", async () => {
    const writes: WriteChunkRequest[] = [];
    const pump = createChunkPump({
      sessionId: "s1",
      track: "video",
      write: async (r) => {
        writes.push(r);
      },
    });
    pump.push(fakeBlob([1, 2]));
    pump.push(fakeBlob([3]));
    pump.push(fakeBlob([4, 5, 6]));
    await pump.flush();
    expect(writes.map((w) => w.seq)).toEqual([0, 1, 2]);
    expect(writes.map((w) => Array.from(new Uint8Array(w.chunk)))).toEqual([
      [1, 2],
      [3],
      [4, 5, 6],
    ]);
    expect(writes.every((w) => w.sessionId === "s1" && w.track === "video")).toBe(true);
    expect(pump.written).toBe(3);
    expect(pump.pending).toBe(0);
  });

  it("skips empty blobs without consuming a sequence number", async () => {
    const seqs: number[] = [];
    const pump = createChunkPump({
      sessionId: "s",
      track: "mic",
      write: async (r) => {
        seqs.push(r.seq);
      },
    });
    pump.push(fakeBlob([]));
    pump.push(fakeBlob([1]));
    pump.push(fakeBlob([]));
    pump.push(fakeBlob([2]));
    await pump.flush();
    expect(seqs).toEqual([0, 1]);
  });

  it("applies backpressure: never more than one write in flight, and blobs aren't read early", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gates = [deferred(), deferred(), deferred()];
    let call = 0;
    const read: number[] = [];
    const pump = createChunkPump({
      sessionId: "s",
      track: "video",
      write: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await gates[call++]?.promise;
        inFlight--;
      },
    });
    for (let i = 0; i < 3; i++) {
      pump.push({
        size: 1,
        arrayBuffer: async () => {
          read.push(i);
          return new ArrayBuffer(1);
        },
      });
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(read).toEqual([0]);
    expect(pump.pending).toBe(3);
    gates[0]?.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(read).toEqual([0, 1]);
    gates[1]?.resolve();
    gates[2]?.resolve();
    await pump.flush();
    expect(maxInFlight).toBe(1);
    expect(pump.pending).toBe(0);
  });

  it("stops at the first write error, reports once, and flush rejects", async () => {
    const onError = vi.fn();
    const seqs: number[] = [];
    const pump = createChunkPump({
      sessionId: "s",
      track: "video",
      write: async (r) => {
        if (r.seq === 1) throw { code: "disk-full", message: "ENOSPC" };
        seqs.push(r.seq);
      },
      onError,
    });
    pump.push(fakeBlob(1));
    pump.push(fakeBlob(1));
    pump.push(fakeBlob(1));
    await expect(pump.flush()).rejects.toEqual({ code: "disk-full", message: "ENOSPC" });
    expect(seqs).toEqual([0]);
    expect(onError).toHaveBeenCalledTimes(1);
    pump.push(fakeBlob(1));
    await expect(pump.flush()).rejects.toBeTruthy();
    expect(pump.written).toBe(1);
    expect(pump.pending).toBe(0);
  });

  it("treats a failing arrayBuffer() like a write error", async () => {
    const pump = createChunkPump({ sessionId: "s", track: "video", write: async () => {} });
    pump.push({ size: 3, arrayBuffer: () => Promise.reject(new Error("read")) });
    await expect(pump.flush()).rejects.toThrow("read");
  });

  it("abort drops queued chunks that have not started", async () => {
    const gate = deferred();
    const seqs: number[] = [];
    const pump = createChunkPump({
      sessionId: "s",
      track: "video",
      write: async (r) => {
        if (r.seq === 0) await gate.promise;
        seqs.push(r.seq);
      },
    });
    pump.push(fakeBlob(1));
    pump.push(fakeBlob(1));
    await new Promise((r) => setTimeout(r, 0));
    pump.abort();
    pump.push(fakeBlob(1));
    gate.resolve();
    await pump.flush();
    expect(seqs).toEqual([0]);
    expect(pump.pending).toBe(0);
  });

  it("property: any mix of sizes yields contiguous seqs matching non-empty order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 40 }),
        async (sizes) => {
          const got: { seq: number; len: number }[] = [];
          const pump = createChunkPump({
            sessionId: "s",
            track: "webcam",
            write: async (r) => {
              got.push({ seq: r.seq, len: r.chunk.byteLength });
            },
          });
          for (const s of sizes) pump.push(fakeBlob(s));
          await pump.flush();
          const nonEmpty = sizes.filter((s) => s > 0);
          expect(got.map((g) => g.seq)).toEqual(nonEmpty.map((_, i) => i));
          expect(got.map((g) => g.len)).toEqual(nonEmpty);
        },
      ),
    );
  });
});
