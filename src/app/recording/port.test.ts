import {
  events,
  type ChannelName,
  type EventName,
  type EventPayloadOf,
  type RequestOf,
  type ResponseOf,
  contracts,
} from "@contracts";
import fc from "fast-check";
import { createChunkPump } from "../../recording/chunkPump";
import { rmsToLevel } from "../../recording/micMeter";
import type { RecordingEvent } from "../../recording/port";
import {
  IPC_UNAVAILABLE,
  type IpcClient,
  type MainRecordingEvent,
  createIpcHudWindowsPort,
  createIpcProjectPort,
  createIpcRecordingPort,
  createIpcSystemPort,
  createIpcWindowsPort,
  mapMainRecordingEvent,
} from "./port";

type Handler = (payload: unknown) => Promise<unknown>;

/** Fake IPC that validates every request against the merged contracts, like main does. */
function fakeIpc(handlers: Partial<Record<ChannelName, Handler>> = {}) {
  const calls: { channel: ChannelName; payload: unknown }[] = [];
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const client: IpcClient = {
    invoke: async <K extends ChannelName>(channel: K, payload: RequestOf<K>) => {
      const parsed = contracts[channel].request.safeParse(payload);
      if (!parsed.success) throw { code: "INVALID_REQUEST", message: parsed.error.message };
      calls.push({ channel, payload });
      const h = handlers[channel];
      return (h ? await h(payload) : { ok: true }) as ResponseOf<K>;
    },
    onEvent: <K extends EventName>(channel: K, cb: (p: EventPayloadOf<K>) => void) => {
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
      }
      const l = cb as (p: unknown) => void;
      set.add(l);
      return () => set.delete(l);
    },
  };
  const emit = (channel: EventName, payload: unknown) => {
    const parsed = events[channel].payload.safeParse(payload);
    if (!parsed.success) throw new Error(`invalid ${channel} payload: ${parsed.error.message}`);
    for (const l of listeners.get(channel) ?? []) l(payload);
  };
  return { client, calls, emit, listeners };
}

describe("mapMainRecordingEvent", () => {
  const cases: [MainRecordingEvent, RecordingEvent][] = [
    [
      { sessionId: "s", type: "countdown", remaining: 3 },
      { sessionId: "s", type: "countdown", remaining: 3 },
    ],
    [
      { sessionId: "s", type: "started", backend: "sck" },
      { sessionId: "s", type: "started", backend: "sck" },
    ],
    [
      { sessionId: "s", type: "paused", recordedMs: 1200 },
      { sessionId: "s", type: "paused", elapsedMs: 1200 },
    ],
    [
      { sessionId: "s", type: "resumed", recordedMs: 1200 },
      { sessionId: "s", type: "resumed", elapsedMs: 1200 },
    ],
    [
      {
        sessionId: "s",
        type: "stats",
        recordedMs: 4200,
        fps: 59.9,
        droppedFrames: 2,
        fileBytes: 1024,
      },
      {
        sessionId: "s",
        type: "stats",
        elapsedMs: 4200,
        fps: 59.9,
        droppedFrames: 2,
        fileBytes: 1024,
        micLevel: undefined,
      },
    ],
    [
      { sessionId: "s", type: "stopped", recordedMs: 9000, reason: "maxLength" },
      { sessionId: "s", type: "stopped", elapsedMs: 9000, reason: "maxLength" },
    ],
    [
      {
        sessionId: "s",
        type: "interrupted",
        reason: "displayDisconnected",
        detail: "HDMI",
        recordedMs: 42_000,
      },
      {
        sessionId: "s",
        type: "interrupted",
        reason: "displayDisconnected",
        message: "HDMI",
        elapsedMs: 42_000,
      },
    ],
    [
      { sessionId: "s", type: "diskLow", freeBytes: 5 },
      { sessionId: "s", type: "diskLow", freeBytes: 5 },
    ],
    [
      { sessionId: "s", type: "deviceLost", device: "mic" },
      { sessionId: "s", type: "deviceLost", device: "mic" },
    ],
    [
      { sessionId: "s", type: "discarded" },
      { sessionId: "s", type: "discarded" },
    ],
    [
      { sessionId: "s", type: "error", code: "START_FAILED", message: "x" },
      { sessionId: "s", type: "error", code: "START_FAILED", message: "x" },
    ],
  ];

  it.each(cases)("maps %o explicitly", (main, renderer) => {
    expect(events["recording:event"].payload.safeParse(main).success).toBe(true);
    expect(mapMainRecordingEvent(main)).toEqual(renderer);
  });

  it("covers every main event type", () => {
    const union = events["recording:event"].payload;
    const types = union.options.map((o) => o.shape.type.value).sort();
    expect(cases.map(([m]) => m.type).sort()).toEqual(types);
  });

  it("maps helper mic RMS onto the meter scale and sanitizes non-finite numbers", () => {
    const e = mapMainRecordingEvent({
      sessionId: "s",
      type: "stats",
      recordedMs: Number.NaN,
      fps: Number.POSITIVE_INFINITY,
      droppedFrames: 0,
      fileBytes: 0,
      micRms: 0.1,
    });
    expect(e).toMatchObject({ elapsedMs: 0, fps: 0, micLevel: rmsToLevel(0.1) });
  });
});

describe("createIpcRecordingPort", () => {
  it("subscribes to recording:event and delivers mapped events", () => {
    const ipc = fakeIpc();
    const port = createIpcRecordingPort(ipc.client);
    const seen: RecordingEvent[] = [];
    const off = port.subscribe((e) => seen.push(e));
    ipc.emit("recording:event", { sessionId: "s", type: "paused", recordedMs: 5 });
    off();
    ipc.emit("recording:event", { sessionId: "s", type: "resumed", recordedMs: 5 });
    expect(seen).toEqual([{ sessionId: "s", type: "paused", elapsedMs: 5 }]);
  });

  it("setMicMuted sends recording:setMicMuted with the session and state", async () => {
    const ipc = fakeIpc({ "recording:setMicMuted": async () => ({ ok: true, applied: false }) });
    const port = createIpcRecordingPort(ipc.client);
    await port.setMicMuted?.("s1", true);
    await port.setMicMuted?.("s1", false);
    expect(ipc.calls).toEqual([
      { channel: "recording:setMicMuted", payload: { sessionId: "s1", muted: true } },
      { channel: "recording:setMicMuted", payload: { sessionId: "s1", muted: false } },
    ]);
  });

  it("onTranscodeProgress delivers recording:transcodeProgress payloads until unsubscribed", () => {
    const ipc = fakeIpc();
    const port = createIpcRecordingPort(ipc.client);
    const seen: unknown[] = [];
    const off = port.onTranscodeProgress?.((p) => seen.push(p));
    const done = {
      sessionId: "s1",
      progress: 1,
      done: true,
      outputPath: "/rec/s1/screen.h264.mp4",
    };
    ipc.emit("recording:transcodeProgress", done);
    off?.();
    ipc.emit("recording:transcodeProgress", {
      ...done,
      progress: 0.5,
      done: false,
      outputPath: null,
    });
    expect(seen).toEqual([done]);
    expect(ipc.listeners.get("recording:transcodeProgress")?.size).toBe(0);
  });

  it("sends the chunk ArrayBuffer itself, with timing only when present", async () => {
    const ipc = fakeIpc();
    const port = createIpcRecordingPort(ipc.client);
    const chunk = new Uint8Array([1, 2, 3]).buffer;
    const timing = { timeOriginMs: 1, recorderStartMs: 2, timesliceMs: 250 };
    await port.writeChunk({ sessionId: "s", track: "screen", seq: 0, chunk, timing });
    await port.writeChunk({ sessionId: "s", track: "mic", seq: 0, chunk });
    expect(ipc.calls[0]?.payload).toEqual({
      sessionId: "s",
      track: "screen",
      seq: 0,
      chunk,
      timing,
    });
    expect((ipc.calls[0]?.payload as { chunk: unknown }).chunk).toBe(chunk);
    expect(ipc.calls[1]?.payload).not.toHaveProperty("timing");
    await port.endTrack({ sessionId: "s", track: "screen", chunkCount: 1, mimeType: "video/webm" });
    expect(ipc.calls[2]).toEqual({
      channel: "recording:endTrack",
      payload: { sessionId: "s", track: "screen", chunkCount: 1, mimeType: "video/webm" },
    });
  });

  it("writeChunk resolves only after main acknowledges (backpressure)", async () => {
    let release: () => void = () => {};
    const ipc = fakeIpc({
      "recording:writeChunk": () =>
        new Promise((r) => {
          release = () => r({ ok: true });
        }),
    });
    const port = createIpcRecordingPort(ipc.client);
    let done = false;
    const p = port
      .writeChunk({ sessionId: "s", track: "screen", seq: 0, chunk: new ArrayBuffer(1) })
      .then(() => {
        done = true;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await p;
    expect(done).toBe(true);
  });

  it("rejects with IPC_UNAVAILABLE outside Electron (invoke → null)", async () => {
    const client: IpcClient = { invoke: async () => null, onEvent: () => () => {} };
    const port = createIpcRecordingPort(client);
    await expect(port.listSources()).rejects.toMatchObject({ code: IPC_UNAVAILABLE });
    await expect(port.stop("s")).rejects.toMatchObject({ code: IPC_UNAVAILABLE });
  });

  it("main errors propagate unchanged with their code", async () => {
    const ipc = fakeIpc({
      "recording:start": async () => {
        throw { code: "PERMISSION_DENIED", message: "no", details: { missing: ["screen"] } };
      },
    });
    const port = createIpcRecordingPort(ipc.client);
    await expect(
      port.start({
        source: { kind: "display", id: "1" },
        audio: { system: false },
        fps: 60,
        countdown: 3,
        hideCursor: false,
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", details: { missing: ["screen"] } });
  });

  it("property: pump → port → main sees 0..n-1 in order without gaps, timing on chunk 0 only", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ size: fc.integer({ min: 0, max: 4 }), delay: fc.nat(3) }), {
          maxLength: 25,
        }),
        fc.option(fc.nat(24), { nil: null }),
        async (chunks, failAt) => {
          const received: { seq: number; bytes: number[]; timing: boolean }[] = [];
          let expected = 0;
          const ipc = fakeIpc({
            "recording:writeChunk": async (payload) => {
              const p = payload as { seq: number; chunk: ArrayBuffer; timing?: unknown };
              const delay = chunks[p.seq]?.delay ?? 0;
              for (let i = 0; i < delay; i++) await Promise.resolve();
              // Main-side ordering contract (electronBackend): refuse gaps.
              if (p.seq !== expected) throw { code: "CHUNK_GAP", message: "gap" };
              if (failAt !== null && p.seq === failAt) throw { code: "ENOSPC", message: "full" };
              expected++;
              received.push({
                seq: p.seq,
                bytes: [...new Uint8Array(p.chunk)],
                timing: p.timing !== undefined,
              });
              return { ok: true };
            },
          });
          const port = createIpcRecordingPort(ipc.client);
          const pump = createChunkPump({
            sessionId: "s",
            track: "screen",
            write: (req) => port.writeChunk(req),
            firstChunkTiming: () => ({ timeOriginMs: 1, recorderStartMs: 0 }),
          });
          const nonEmpty: number[][] = [];
          chunks.forEach((c, i) => {
            const bytes = Array.from({ length: c.size }, () => i % 256);
            if (c.size > 0) nonEmpty.push(bytes);
            pump.push({ size: c.size, arrayBuffer: async () => new Uint8Array(bytes).buffer });
          });
          await pump.flush().catch(() => {});
          const okCount = failAt === null ? nonEmpty.length : Math.min(failAt, nonEmpty.length);
          expect(received.map((r) => r.seq)).toEqual(Array.from({ length: okCount }, (_, i) => i));
          expect(received.map((r) => r.bytes)).toEqual(nonEmpty.slice(0, okCount));
          expect(received.map((r) => r.timing)).toEqual(received.map((r) => r.seq === 0));
          expect(pump.written).toBe(okCount);
          expect(ipc.calls.every((c) => c.channel === "recording:writeChunk")).toBe(true);
        },
      ),
      { numRuns: 80 },
    );
  });
});

describe("windows / project / system ports", () => {
  it("windows port sends validated requests", async () => {
    const ipc = fakeIpc({
      "windows:openRegionOverlays": async () => ({ ok: true, displayIds: ["1", "2"] }),
    });
    const w = createIpcWindowsPort(ipc.client);
    await w.openHud("1");
    await w.openHud();
    await w.openCountdown("2");
    await expect(w.openRegionOverlays()).resolves.toEqual(["1", "2"]);
    await w.setRegionSelecting("1", true);
    await w.openWebcamBubble();
    await w.closeKind("hud");
    await w.openEditor("p1");
    expect(ipc.calls.map((c) => [c.channel, c.payload])).toEqual([
      ["windows:openHud", { displayId: "1" }],
      ["windows:openHud", {}],
      ["windows:openCountdown", { displayId: "2" }],
      ["windows:openRegionOverlays", undefined],
      ["windows:setRegionSelecting", { displayId: "1", selecting: true }],
      ["windows:openWebcamBubble", {}],
      ["windows:closeKind", { kind: "hud" }],
      ["windows:openEditor", { projectId: "p1" }],
    ]);
  });

  it("HUD windows port prepares, commits and maps 'no HUD' to null", async () => {
    const previous = { x: 440, y: 836, width: 560, height: 64 };
    const target = { x: 570, y: 844, width: 300, height: 48 };
    let hudOpen = true;
    const ipc = fakeIpc({
      "windows:setHudExpansion": async () =>
        hudOpen
          ? { ok: true, layout: null, commitId: 1, previous: target, target: previous }
          : { ok: true, layout: null, commitId: null, previous: null, target: null },
      "windows:setHudSize": async () => ({ ok: true, commitId: 2, previous, target }),
      "windows:commitHudExpansion": async () => ({ ok: true, applied: true }),
    });
    const w = createIpcHudWindowsPort(ipc.client);
    await expect(w.setHudExpansion(null)).resolves.toEqual({
      commitId: 1,
      previous: target,
      target: previous,
      layout: null,
    });
    await expect(w.setHudSize({ width: 300, height: 48, anchor: "center" })).resolves.toEqual({
      commitId: 2,
      previous,
      target,
    });
    await expect(w.commitHudLayout(2)).resolves.toBe(true);
    await w.openSourceOutline("d1");
    await w.closeKind("source-outline");
    hudOpen = false;
    await expect(w.setHudExpansion({ width: 560, height: 104 })).resolves.toBeNull();
    expect(ipc.calls.map((c) => [c.channel, c.payload])).toEqual([
      ["windows:setHudExpansion", { size: null }],
      ["windows:setHudSize", { width: 300, height: 48, anchor: "center" }],
      ["windows:commitHudExpansion", { commitId: 2 }],
      ["windows:openSourceOutline", { displayId: "d1" }],
      ["windows:closeKind", { kind: "source-outline" }],
      ["windows:setHudExpansion", { size: { width: 560, height: 104 } }],
    ]);
  });

  it("project + system ports map to project:create/save/trash and permissions:openSettings", async () => {
    const ipc = fakeIpc({
      "project:create": async () => ({
        path: "/p.reelform",
        document: {},
        modifiedAt: "x",
        mediaFiles: [],
      }),
      "project:save": async () => ({ path: "/p.reelform", modifiedAt: "x", backupName: null }),
      "project:trash": async () => ({ trashed: true }),
      "project:relink": async () => ({
        path: "media/screen.h264.mp4",
        probe: { durationMs: 42_000, width: 3024, height: 1964 },
      }),
      "project:open": async () => ({
        path: "/p.reelform",
        document: { v: 1 },
        modifiedAt: null,
        recovery: null,
      }),
    });
    const projects = createIpcProjectPort(ipc.client);
    await expect(projects.create({ name: "R", document: {} })).resolves.toMatchObject({
      path: "/p.reelform",
    });
    await projects.save({ path: "/p.reelform", document: {} });
    await expect(
      projects.relink?.({
        path: "/p.reelform",
        filePath: "/rec/s1/screen.h264.mp4",
        expected: { durationMs: 42_000 },
        mode: "copy",
      }),
    ).resolves.toEqual({
      path: "media/screen.h264.mp4",
      probe: { durationMs: 42_000, width: 3024, height: 1964 },
    });
    await expect(projects.open?.({ path: "/p.reelform" })).resolves.toMatchObject({
      document: { v: 1 },
    });
    const reveal = vi.fn(async () => {});
    const system = createIpcSystemPort(reveal, ipc.client);
    await system.reveal("/p.reelform");
    await system.deleteProject("/p.reelform");
    await system.openPermissionSettings?.("screen");
    expect(reveal).toHaveBeenCalledWith("/p.reelform");
    expect(ipc.calls.map((c) => c.channel)).toEqual([
      "project:create",
      "project:save",
      "project:relink",
      "project:open",
      "project:trash",
      "permissions:openSettings",
    ]);
  });
});
