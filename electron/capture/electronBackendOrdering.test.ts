import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type TrackWriter, createElectronBackend } from "./electronBackend";
import { FakeTimers, flush } from "./testUtils";
import type { CaptureEvent, Session, StartOptions } from "./types";

/** Harness for the seq / gap / endTrack contract of the Electron backend session. */

const opts: StartOptions = {
  sessionId: "s1",
  outDir: "/rec/s1",
  source: { kind: "display", id: "1" },
  audio: { system: false },
  fps: 60,
  countdown: 0,
  hideCursor: false,
};

async function setup(withTimers = false, graceMs = 1000) {
  const files = new Map<string, number[]>();
  const closed: string[] = [];
  const timers = new FakeTimers();
  const backend = createElectronBackend({
    join: (...p) => p.join("/"),
    getSources: async () => ({ displays: [], windows: [] }),
    openWriter: async (path): Promise<TrackWriter> => {
      files.set(path, []);
      return {
        write: async (bytes) => {
          files.get(path)?.push(...bytes);
        },
        close: async () => {
          closed.push(path);
        },
      };
    },
    timers: withTimers ? timers : undefined,
    endTrackGraceMs: graceMs,
  });
  const events: CaptureEvent[] = [];
  const session = await backend.start(opts, (e) => events.push(e));
  const write = (track: "screen" | "mic", byte: number, seq: number) => {
    if (!session.writeChunk) throw new Error("expected writeChunk");
    return session.writeChunk(track, new Uint8Array([byte]), seq);
  };
  const end = (track: "screen" | "mic", n: number) => {
    if (!session.endTrack) throw new Error("expected endTrack");
    return session.endTrack(track, n);
  };
  return { files, closed, timers, session: session as Session, events, write, end };
}

describe("electron backend — seq ordering", () => {
  it("rejects gaps and invalid seqs without touching disk", async () => {
    const t = await setup();
    await t.write("screen", 1, 0);
    await expect(t.write("screen", 3, 2)).rejects.toMatchObject({
      code: "CHUNK_GAP",
      details: { track: "screen", expected: 1, received: 2 },
    });
    await expect(t.write("screen", 9, -1)).rejects.toMatchObject({ code: "CHUNK_SEQ_INVALID" });
    await expect(t.write("screen", 9, 1.5)).rejects.toMatchObject({ code: "CHUNK_SEQ_INVALID" });
    await t.write("screen", 2, 1);
    expect(t.files.get("/rec/s1/screen.webm")).toEqual([1, 2]);
  });

  it("a retried seq already on disk is an idempotent no-op; an in-flight one is refused", async () => {
    const t = await setup();
    const inflight = t.write("screen", 1, 0);
    await expect(t.write("screen", 1, 0)).rejects.toMatchObject({ code: "CHUNK_DUPLICATE" });
    await inflight;
    await t.write("screen", 1, 0);
    expect(t.files.get("/rec/s1/screen.webm")).toEqual([1]);
  });

  it("tracks are sequenced independently", async () => {
    const t = await setup();
    await t.write("mic", 5, 0);
    await t.write("screen", 1, 0);
    await t.write("mic", 6, 1);
    expect(t.files.get("/rec/s1/mic.webm")).toEqual([5, 6]);
  });

  it("property: disk holds exactly the longest gap-free prefix of accepted seqs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 40 }),
        async (seqs) => {
          const t = await setup();
          let expected = 0;
          for (const seq of seqs) {
            const res = await t.write("screen", seq, seq).then(
              () => "ok" as const,
              (e: { code: string }) => e.code,
            );
            if (seq === expected) {
              expect(res).toBe("ok");
              expected++;
            } else if (seq < expected) {
              expect(res).toBe("ok"); // idempotent retry
            } else {
              expect(res).toBe("CHUNK_GAP");
            }
          }
          const onDisk = t.files.get("/rec/s1/screen.webm") ?? [];
          expect(onDisk).toEqual(Array.from({ length: expected }, (_, i) => i));
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("electron backend — endTrack", () => {
  it("completes a track, refuses later chunks and reports the count on disk", async () => {
    const t = await setup();
    await t.write("screen", 1, 0);
    await t.write("screen", 2, 1);
    await expect(t.end("screen", 2)).resolves.toEqual({ chunkCount: 2 });
    await expect(t.write("screen", 3, 2)).rejects.toMatchObject({ code: "TRACK_ENDED" });
    await expect(t.end("screen", 2)).resolves.toEqual({ chunkCount: 2 });
  });

  it("waits for in-flight writes before counting", async () => {
    const t = await setup();
    void t.write("screen", 1, 0);
    void t.write("screen", 2, 1);
    await expect(t.end("screen", 2)).resolves.toEqual({ chunkCount: 2 });
  });

  it("a count mismatch still ends the track (data kept) but rejects", async () => {
    const t = await setup();
    await t.write("mic", 1, 0);
    await expect(t.end("mic", 3)).rejects.toMatchObject({
      code: "CHUNK_COUNT_MISMATCH",
      details: { track: "mic", expected: 3, received: 1 },
    });
    await expect(t.write("mic", 2, 1)).rejects.toMatchObject({ code: "TRACK_ENDED" });
    expect(t.files.get("/rec/s1/mic.webm")).toEqual([1]);
  });

  it("ending a track that never wrote is fine with 0 chunks and blocks later writes", async () => {
    const t = await setup();
    await expect(t.end("mic", 0)).resolves.toEqual({ chunkCount: 0 });
    await expect(t.write("mic", 1, 0)).rejects.toMatchObject({ code: "TRACK_ENDED" });
    expect(t.files.has("/rec/s1/mic.webm")).toBe(false);
  });
});

describe("electron backend — close waits for track completion", () => {
  it("keeps the renderer's final flush when tracks end before the grace period", async () => {
    const t = await setup(true);
    await t.write("screen", 1, 0);
    let result: unknown = null;
    void t.session.close().then((r) => {
      result = r;
    });
    await flush();
    expect(result).toBeNull();
    await t.write("screen", 2, 1); // final flush still accepted while closing
    await t.end("screen", 2);
    await flush();
    expect(result).toEqual({ durationMs: null, paths: { screen: "/rec/s1/screen.webm" } });
    expect(t.files.get("/rec/s1/screen.webm")).toEqual([1, 2]);
    expect(t.timers.pendingCount).toBe(0);
  });

  it("closes anyway after the grace period and reports incomplete tracks (interrupted renderer)", async () => {
    const t = await setup(true, 500);
    await t.write("screen", 1, 0);
    await t.write("mic", 1, 0);
    await t.end("mic", 1);
    let result: unknown = null;
    void t.session.close().then((r) => {
      result = r;
    });
    await t.timers.advanceAsync(499);
    expect(result).toBeNull();
    await t.timers.advanceAsync(1);
    expect(result).toEqual({
      durationMs: null,
      paths: { screen: "/rec/s1/screen.webm", mic: "/rec/s1/mic.webm" },
      incompleteTracks: ["screen"],
    });
    expect(t.closed.sort()).toEqual(["/rec/s1/mic.webm", "/rec/s1/screen.webm"]);
    await expect(t.write("screen", 2, 1)).rejects.toMatchObject({ code: "SESSION_CLOSED" });
  });

  it("discard never waits for tracks", async () => {
    const t = await setup(true);
    await t.write("screen", 1, 0);
    await t.session.discard();
    expect(t.closed).toEqual(["/rec/s1/screen.webm"]);
    expect(t.timers.pendingCount).toBe(0);
  });
});
