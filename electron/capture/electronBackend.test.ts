import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type TrackWriter,
  createElectronBackend,
  electronFirstFrameEpochNs,
} from "./electronBackend";
import { flush } from "./testUtils";
import type { CaptureEvent, StartOptions } from "./types";

const opts: StartOptions = {
  sessionId: "s1",
  outDir: "/rec/s1",
  source: { kind: "display", id: "1" },
  audio: { system: false },
  fps: 60,
  countdown: 0,
  hideCursor: false,
};

function setup(failWith?: (path: string, n: number) => Error | null) {
  const files = new Map<string, number[]>();
  const closed: string[] = [];
  const gates: (() => void)[] = [];
  let delayFirst = false;
  const backend = createElectronBackend({
    join: (...p) => p.join("/"),
    getSources: async () => ({ displays: [], windows: [] }),
    openWriter: async (path): Promise<TrackWriter> => {
      files.set(path, []);
      let n = 0;
      return {
        write: async (bytes) => {
          n++;
          const err = failWith?.(path, n);
          if (err) throw err;
          if (delayFirst && n === 1 && path.endsWith("screen.webm"))
            await new Promise<void>((r) => gates.push(r));
          files.get(path)?.push(...bytes);
        },
        close: async () => {
          closed.push(path);
        },
      };
    },
  });
  const events: CaptureEvent[] = [];
  return {
    backend,
    files,
    closed,
    gates,
    events,
    sink: (e: CaptureEvent) => events.push(e),
    delayFirstWrite: () => {
      delayFirst = true;
    },
  };
}

describe("electronFirstFrameEpochNs", () => {
  it("uses timeOrigin + recorder start by default", () => {
    expect(
      electronFirstFrameEpochNs({ timeOriginMs: 1_700_000_000_000, recorderStartMs: 12.5 }, 60),
    ).toBe(1_700_000_000_012_500_000n);
  });

  it("corrects by the first dataavailable only when the recorder lagged more than one frame", () => {
    const base = { timeOriginMs: 1000, recorderStartMs: 100, timesliceMs: 250 };
    expect(electronFirstFrameEpochNs({ ...base, firstDataMs: 360 }, 60)).toBe(1_100_000_000n); // lag 10ms < 16.7
    expect(electronFirstFrameEpochNs({ ...base, firstDataMs: 400 }, 60)).toBe(1_150_000_000n); // lag 50ms
  });

  it("property: never earlier than recorder start and µs-quantized", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e12, max: 2e12, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 5000, noNaN: true }),
        (origin, start, extra) => {
          const r = electronFirstFrameEpochNs(
            {
              timeOriginMs: origin,
              recorderStartMs: start,
              firstDataMs: start + extra,
              timesliceMs: 250,
            },
            30,
          );
          expect(r % 1000n).toBe(0n);
          expect(r).toBeGreaterThanOrEqual(BigInt(Math.round((origin + start) * 1000)) * 1000n);
        },
      ),
    );
  });
});

describe("electron backend session", () => {
  it("is available by default and lists injected sources", async () => {
    const { backend } = setup();
    expect(await backend.isAvailable()).toEqual({ ok: true });
    expect(await backend.listSources()).toEqual({ displays: [], windows: [] });
  });

  it("appends chunks per track in arrival order even when a write is slow", async () => {
    const s = setup();
    s.delayFirstWrite();
    const session = await s.backend.start(opts, s.sink);
    const write = session.writeChunk;
    if (!write) throw new Error("expected writeChunk");
    const p1 = write("screen", new Uint8Array([1, 2]), 0);
    const p2 = write("screen", new Uint8Array([3]), 1);
    const p3 = write("mic", new Uint8Array([9]), 0);
    await flush();
    await p3;
    expect(s.files.get("/rec/s1/mic.webm")).toEqual([9]);
    for (const g of s.gates) g();
    await Promise.all([p1, p2]);
    expect(s.files.get("/rec/s1/screen.webm")).toEqual([1, 2, 3]);
  });

  it("emits started once from the first screen chunk timing", async () => {
    const s = setup();
    const session = await s.backend.start(opts, s.sink);
    const t = { timeOriginMs: 1000, recorderStartMs: 5 };
    await session.writeChunk?.("mic", new Uint8Array([1]), 0, t);
    expect(s.events).toEqual([]);
    await session.writeChunk?.("screen", new Uint8Array([1]), 0, t);
    await session.writeChunk?.("screen", new Uint8Array([1]), 1, {
      timeOriginMs: 9999,
      recorderStartMs: 0,
    });
    expect(s.events).toEqual([{ type: "started", firstFramePtsNs: 1_005_000_000n }]);
  });

  it("close drains pending writes, closes writers and rejects later chunks", async () => {
    const s = setup();
    s.delayFirstWrite();
    const session = await s.backend.start(opts, s.sink);
    void session.writeChunk?.("screen", new Uint8Array([7]), 0);
    await flush();
    const closing = session.close();
    for (const g of s.gates) g();
    expect(await closing).toEqual({ durationMs: null, paths: { screen: "/rec/s1/screen.webm" } });
    expect(s.files.get("/rec/s1/screen.webm")).toEqual([7]);
    expect(s.closed).toEqual(["/rec/s1/screen.webm"]);
    await expect(session.writeChunk?.("screen", new Uint8Array([8]), 1)).rejects.toMatchObject({
      code: "SESSION_CLOSED",
    });
    expect(await session.close()).toEqual({
      durationMs: null,
      paths: { screen: "/rec/s1/screen.webm" },
    });
  });

  it("ENOSPC interrupts with diskLow; the failed seq may be retried, later seqs are gaps", async () => {
    const s = setup((_p, n) =>
      n === 1 ? Object.assign(new Error("no space"), { code: "ENOSPC" }) : null,
    );
    const session = await s.backend.start(opts, s.sink);
    await expect(session.writeChunk?.("screen", new Uint8Array([1]), 0)).rejects.toThrow(
      "no space",
    );
    expect(s.events).toEqual([{ type: "interrupted", reason: "diskLow", detail: "no space" }]);
    await expect(session.writeChunk?.("screen", new Uint8Array([2]), 1)).rejects.toMatchObject({
      code: "CHUNK_GAP",
    });
    await session.writeChunk?.("screen", new Uint8Array([2]), 0);
    expect(s.files.get("/rec/s1/screen.webm")).toEqual([2]);
  });

  it("pause/resume/stop are no-ops and discard closes writers", async () => {
    const s = setup();
    const session = await s.backend.start(opts, s.sink);
    await session.pause();
    await session.resume();
    await session.stop();
    await session.writeChunk?.("webcam", new Uint8Array([1]), 0);
    await session.discard();
    expect(s.closed).toEqual(["/rec/s1/webcam.webm"]);
  });
});
