import fc from "fast-check";
import { type TrackWriter, createElectronBackend } from "../../../electron/capture/electronBackend";
import type { CaptureEvent } from "../../../electron/capture/types";
import { createChunkPump } from "../../recording/chunkPump";
import { type IpcClient, createIpcRecordingPort } from "./port";

/**
 * End-to-end ordering contract across the renderer↔main boundary: the real
 * renderer chunk pump → the IPC recording port → the real Electron backend
 * session in main, with random IPC latency and a random disk failure. Disk must
 * hold exactly the chunks the renderer counted as written, in order, and
 * `endTrack` with that count must agree with main.
 */

const START = {
  sessionId: "s1",
  outDir: "/rec/s1",
  source: { kind: "display" as const, id: "1" },
  audio: { system: false },
  fps: 60 as const,
  countdown: 0 as const,
  hideCursor: false,
};

const tick = async (n: number) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe("chunk pump → IPC port → electron backend", () => {
  it("property: disk == the renderer's written prefix; endTrack counts agree; ENOSPC interrupts", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ size: fc.integer({ min: 0, max: 3 }), latency: fc.nat(4) }), {
          maxLength: 30,
        }),
        fc.option(fc.nat(29), { nil: null }),
        async (chunks, failWriteAt) => {
          const disk: number[] = [];
          let writes = 0;
          const events: CaptureEvent[] = [];
          const backend = createElectronBackend({
            join: (...p) => p.join("/"),
            getSources: async () => ({ displays: [], windows: [] }),
            openWriter: async (): Promise<TrackWriter> => ({
              write: async (bytes) => {
                const n = writes++;
                await tick(1);
                if (failWriteAt !== null && n === failWriteAt) {
                  throw Object.assign(new Error("no space"), { code: "ENOSPC" });
                }
                disk.push(...bytes);
              },
              close: async () => {},
            }),
          });
          const session = await backend.start(START, (e) => events.push(e));
          const writeChunk = session.writeChunk;
          const endTrack = session.endTrack;
          if (!writeChunk || !endTrack) throw new Error("electron session must accept chunks");

          // Minimal IPC: routes recording:* to the main session with per-call latency.
          const client: IpcClient = {
            invoke: (async (channel: string, payload: unknown) => {
              const p = payload as {
                track: "screen";
                seq: number;
                chunk: ArrayBuffer;
                chunkCount: number;
              };
              if (channel === "recording:writeChunk") {
                await tick(chunks[p.seq]?.latency ?? 0);
                await writeChunk("screen", new Uint8Array(p.chunk), p.seq);
                return { ok: true };
              }
              if (channel === "recording:endTrack") {
                return { ok: true, ...(await endTrack("screen", p.chunkCount)) };
              }
              throw new Error(`unexpected ${channel}`);
            }) as IpcClient["invoke"],
            onEvent: () => () => {},
          };
          const port = createIpcRecordingPort(client);
          const pump = createChunkPump({
            sessionId: "s1",
            track: "screen",
            write: (req) => port.writeChunk(req),
          });

          const nonEmpty: number[][] = [];
          chunks.forEach((c, i) => {
            const bytes = Array.from({ length: c.size }, (_, j) => (i * 7 + j) % 256);
            if (c.size > 0) nonEmpty.push(bytes);
            pump.push({ size: c.size, arrayBuffer: async () => new Uint8Array(bytes).buffer });
          });
          const flushed = await pump.flush().then(
            () => null,
            (e: { code?: string }) => e.code ?? "unknown",
          );

          const failed = failWriteAt !== null && failWriteAt < nonEmpty.length;
          const okCount = failed ? failWriteAt : nonEmpty.length;
          expect(flushed).toBe(failed ? "ENOSPC" : null);
          expect(pump.written).toBe(okCount);
          expect(disk).toEqual(nonEmpty.slice(0, okCount).flat());
          // Main and renderer agree on the count, so ending the track never mismatches.
          await expect(
            port.endTrack({
              sessionId: "s1",
              track: "screen",
              chunkCount: pump.written,
              mimeType: "video/webm",
            }),
          ).resolves.toBeUndefined();
          const interrupts = events.filter((e) => e.type === "interrupted");
          expect(interrupts).toEqual(
            failed ? [{ type: "interrupted", reason: "diskLow", detail: "no space" }] : [],
          );
          const res = await session.close();
          expect(res.paths.screen === undefined).toBe(nonEmpty.length === 0);
        },
      ),
      { numRuns: 80 },
    );
  });
});
