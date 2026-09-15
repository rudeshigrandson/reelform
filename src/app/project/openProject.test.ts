import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlaybackStore } from "../../editor/playback/store";
import { useEditorStore } from "../../editor/store";
import {
  PROJECT_OPEN_ERRORS,
  bindCursorTrack,
  buildCursorTrack,
  derivedDurationMs,
  mediaUrl,
  openProject,
  restoreProjectBackup,
  toIpcErrorShape,
} from "./openProject";
import { useProjectSession } from "./session";
import {
  PROJECT_PATH,
  TELEMETRY_JSON,
  fakeIpc,
  fakeMedia,
  projectDocument,
  resetProjectStores,
} from "./testing";

beforeEach(resetProjectStores);
afterEach(resetProjectStores);

const session = () => useProjectSession.getState();

describe("openProject: happy path", () => {
  it("resolves, opens, hydrates every store and wires media, telemetry and cursor", async () => {
    const ipc = fakeIpc();
    const res = await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia() });

    expect(res).toMatchObject({ status: "ready", path: PROJECT_PATH, recovery: null });
    expect(ipc.calls.map((c) => c.channel)).toEqual([
      "project:resolve",
      "project:open",
      "media:registerRoot",
      // Background derived media starts once the session is ready.
      "project:ensureProxy",
      "project:ensureThumbnails",
    ]);
    expect(ipc.callsTo("project:resolve")).toEqual([{ projectId: "proj-1" }]);
    expect(ipc.callsTo("media:registerRoot")).toEqual([{ path: PROJECT_PATH }]);

    const editor = useEditorStore.getState();
    expect(editor.clips.map((c) => c.id)).toEqual(["k1", "k2"]);
    // Stored 999ms is stale: duration derives from the clip sequence.
    expect(editor.durationMs).toBe(8000);
    expect(editor.cursorPointCount).toBe(3);
    expect(typeof editor.update).toBe("function");

    expect(usePlaybackStore.getState()).toMatchObject({ durationMs: 8000, fps: 60, currentMs: 0 });

    expect(session()).toMatchObject({
      status: "ready",
      error: null,
      projectPath: PROJECT_PATH,
      projectId: "proj-1",
      mediaRootId: "root-1",
      mediaBaseUrl: "reelform-media://root-1/",
      videoUrl: "reelform-media://root-1/media/screen.mp4",
      webcamUrl: null,
      micUrl: null,
      systemAudioUrl: null,
      mediaOffline: false,
    });
    expect(session().sourceSize).toEqual({ width: 1920, height: 1080 });
    expect(session().meta?.name).toBe("Demo");
    expect(session().telemetry?.cursorPoints).toHaveLength(TELEMETRY_JSON.points.length);
    expect(session().cursorTrack?.samples.length).toBeGreaterThan(3);
    expect(res.status === "ready" && res.mediaRootIds).toEqual(["root-1"]);
  });

  it("passes recovery info through for the Crash recovered prompt", async () => {
    const recovery = {
      backupName: "autosave-000000000000009.json",
      backupSavedAt: "2026-09-15T09:00:00.000Z",
      projectModifiedAt: "2026-09-14T10:00:00.000Z",
      backups: [{ name: "autosave-000000000000009.json", savedAt: "2026-09-15T09:00:00.000Z" }],
    };
    const ipc = fakeIpc({
      "project:open": (req) => ({
        path: req.path,
        document: projectDocument(),
        modifiedAt: null,
        recovery,
      }),
    });
    const res = await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia() });
    expect(res.status === "ready" && res.recovery).toEqual(recovery);
  });

  it("serves sources relinked by absolute path through their own media root", async () => {
    const base = projectDocument();
    const ipc = fakeIpc({
      "project:open": (req) => ({
        path: req.path,
        document: projectDocument({
          sources: {
            ...base.sources,
            webcam: { ...base.sources.video, path: "/Volumes/Ext/Cam Files/cam 1.mp4" },
            mic: { ...base.sources.video, path: "media/mic track.m4a" },
          },
        }),
        modifiedAt: null,
        recovery: null,
      }),
    });
    const res = await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia() });
    expect(ipc.callsTo("media:registerRoot")).toEqual([
      { path: PROJECT_PATH },
      { path: "/Volumes/Ext/Cam Files" },
    ]);
    expect(session().webcamUrl).toBe("reelform-media://root-2/cam%201.mp4");
    expect(session().micUrl).toBe("reelform-media://root-1/media/mic%20track.m4a");
    expect(res.status === "ready" && res.mediaRootIds).toEqual(["root-1", "root-2"]);
  });
});

describe("openProject: degraded media", () => {
  it("marks media offline when the HEAD probe fails or rejects (guide S12 state 13)", async () => {
    await openProject("proj-1", {
      invoke: fakeIpc().invoke,
      media: fakeMedia({ exists: async () => false }),
    });
    expect(session()).toMatchObject({ status: "ready", mediaOffline: true });
    resetProjectStores();
    await openProject("proj-1", {
      invoke: fakeIpc().invoke,
      media: fakeMedia({
        exists: async () => {
          throw new Error("net::ERR_FILE_NOT_FOUND");
        },
      }),
    });
    expect(session().mediaOffline).toBe(true);
  });

  it("corrupt or missing telemetry leaves the cursor layer off but still opens", async () => {
    await openProject("proj-1", {
      invoke: fakeIpc().invoke,
      media: fakeMedia({ fetchBytes: async () => new Uint8Array([0x1f, 0x8b, 1, 2, 3]) }),
    });
    expect(session()).toMatchObject({ status: "ready", telemetry: null, cursorTrack: null });
  });

  it("no telemetry ref and no point count → telemetry is never fetched", async () => {
    const base = projectDocument();
    const { telemetry: _t, ...sources } = base.sources;
    const ipc = fakeIpc({
      "project:open": (req) => ({
        path: req.path,
        document: { ...base, sources },
        modifiedAt: null,
        recovery: null,
      }),
    });
    let fetched = 0;
    await openProject("proj-1", {
      invoke: ipc.invoke,
      media: fakeMedia({
        fetchBytes: async () => {
          fetched++;
          return new Uint8Array();
        },
      }),
    });
    expect(fetched).toBe(0);
    expect(session().status).toBe("ready");
  });
});

describe("openProject: failures", () => {
  it("unknown project id → not-found, nothing registered", async () => {
    const ipc = fakeIpc({
      "project:resolve": () => {
        throw { code: "PROJECT_NOT_FOUND", message: "No project with that id" };
      },
    });
    const res = await openProject("gone", { invoke: ipc.invoke, media: fakeMedia() });
    expect(res).toEqual({
      status: "not-found",
      error: { code: "PROJECT_NOT_FOUND", message: "No project with that id" },
    });
    expect(session()).toMatchObject({ status: "error", projectId: "gone" });
    expect(ipc.callsTo("media:registerRoot")).toEqual([]);
  });

  it("a document from a newer Reelform → PROJECT_INVALID error", async () => {
    const ipc = fakeIpc({
      "project:open": (req) => ({
        path: req.path,
        document: { ...projectDocument(), schemaVersion: 7 },
        modifiedAt: null,
        recovery: null,
      }),
    });
    const res = await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia() });
    expect(res.status).toBe("error");
    expect(res.status === "error" && res.error).toMatchObject({
      code: PROJECT_OPEN_ERRORS.invalid,
      details: { reason: "future-version" },
    });
  });

  it("outside Electron (invoke resolves null) → IPC_UNAVAILABLE", async () => {
    const res = await openProject("proj-1", {
      invoke: (async () => null) as never,
      media: fakeMedia(),
    });
    expect(res.status === "error" && res.error.code).toBe(PROJECT_OPEN_ERRORS.unavailable);
  });

  it("a failure after registering media releases the roots", async () => {
    const base = projectDocument();
    let n = 0;
    const ipc = fakeIpc({
      "project:open": (req) => ({
        path: req.path,
        document: projectDocument({
          sources: { ...base.sources, webcam: { ...base.sources.video, path: "/abs/cam.mp4" } },
        }),
        modifiedAt: null,
        recovery: null,
      }),
      "media:registerRoot": () => {
        n++;
        if (n === 2) throw { code: "PATH_OUTSIDE_ROOT", message: "nope" };
        return { rootId: "root-1", baseUrl: "reelform-media://root-1/" };
      },
    });
    const res = await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia() });
    expect(res.status === "error" && res.error.code).toBe("PATH_OUTSIDE_ROOT");
    expect(ipc.callsTo("media:unregisterRoot")).toEqual([{ rootId: "root-1" }]);
  });

  it("aborting mid-load stops before the session goes ready and releases roots", async () => {
    const controller = new AbortController();
    const res = await openProject("proj-1", {
      invoke: fakeIpc().invoke,
      media: fakeMedia({
        exists: async () => {
          controller.abort();
          return true;
        },
      }),
      signal: controller.signal,
    });
    expect(res).toEqual({ status: "aborted" });
    expect(session().status).not.toBe("ready");
  });
});

describe("restoreProjectBackup", () => {
  it("re-hydrates the restored document, keeping media and rebuilding the cursor", async () => {
    const ipc = fakeIpc({
      "project:restore": (req) => ({
        path: req.path,
        document: projectDocument({ name: "Recovered" }),
        modifiedAt: "2026-09-15T09:00:00.000Z",
        restoredFrom: req.backupName ?? "newest",
      }),
    });
    await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia() });
    const track = session().cursorTrack;
    useEditorStore.getState().update({ zoomRegions: [], durationMs: 1 });
    await restoreProjectBackup(PROJECT_PATH, "autosave-000000000000009.json", {
      invoke: ipc.invoke,
    });
    expect(ipc.callsTo("project:restore")).toEqual([
      { path: PROJECT_PATH, backupName: "autosave-000000000000009.json" },
    ]);
    expect(session().meta?.name).toBe("Recovered");
    expect(session().videoUrl).toBe("reelform-media://root-1/media/screen.mp4");
    expect(useEditorStore.getState().durationMs).toBe(8000);
    expect(session().cursorTrack).not.toBe(track);
    expect(session().cursorTrack).not.toBeNull();
  });

  it("rejects with the IPC error shape", async () => {
    const ipc = fakeIpc({
      "project:restore": () => {
        throw { code: "NO_BACKUP", message: "No autosave to restore" };
      },
    });
    await expect(
      restoreProjectBackup(PROJECT_PATH, undefined, { invoke: ipc.invoke }),
    ).rejects.toEqual({
      code: "NO_BACKUP",
      message: "No autosave to restore",
    });
    expect(ipc.callsTo("project:restore")).toEqual([{ path: PROJECT_PATH }]);
  });
});

describe("bindCursorTrack", () => {
  it("rebuilds only when smoothing or telemetry change; unsubscribe stops it", async () => {
    await openProject("proj-1", { invoke: fakeIpc().invoke, media: fakeMedia() });
    const off = bindCursorTrack();
    const first = session().cursorTrack;

    useEditorStore.getState().update({ captionLanguage: "de" });
    expect(session().cursorTrack).toBe(first);

    const cursor = useEditorStore.getState().cursor;
    useEditorStore.getState().update({ cursor: { ...cursor, smoothing: 100 } });
    const silky = session().cursorTrack;
    expect(silky).not.toBe(first);

    useProjectSession.getState().setSession({ telemetry: null });
    expect(session().cursorTrack).toBeNull();

    off();
    useEditorStore.getState().update({ cursor: { ...cursor, smoothing: 0 } });
    expect(session().cursorTrack).toBeNull();
  });
});

describe("helpers", () => {
  it("mediaUrl encodes segments and normalises separators", () => {
    expect(mediaUrl("reelform-media://r/", "media/my screen.mp4")).toBe(
      "reelform-media://r/media/my%20screen.mp4",
    );
    expect(mediaUrl("reelform-media://r", "media\\\\a#b.mp4")).toBe(
      "reelform-media://r/media/a%23b.mp4",
    );
    expect(mediaUrl("reelform-media://r/", "./media//x.mp4")).toBe(
      "reelform-media://r/media/x.mp4",
    );
  });

  it("buildCursorTrack maps 0..100 smoothing, clamps and skips empty telemetry", async () => {
    await openProject("proj-1", { invoke: fakeIpc().invoke, media: fakeMedia() });
    const telemetry = session().telemetry;
    expect(buildCursorTrack(null, 50)).toBeNull();
    expect(buildCursorTrack(telemetry && { ...telemetry, cursorPoints: [] }, 50)).toBeNull();
    const a = buildCursorTrack(telemetry, 500);
    const b = buildCursorTrack(telemetry, 100);
    expect(a?.samples).toEqual(b?.samples);
    expect(buildCursorTrack(telemetry, Number.NaN)?.samples).toEqual(
      buildCursorTrack(telemetry, 50)?.samples,
    );
  });

  it("derivedDurationMs falls back to the stored value without clips", () => {
    expect(derivedDurationMs({ clips: [], durationMs: 1234 })).toBe(1234);
  });

  it("toIpcErrorShape keeps code/details and wraps plain errors", () => {
    expect(toIpcErrorShape({ code: "X", message: "m", details: 1 })).toEqual({
      code: "X",
      message: "m",
      details: 1,
    });
    expect(toIpcErrorShape(new Error("boom"))).toEqual({ code: "INTERNAL", message: "boom" });
    expect(toIpcErrorShape("str")).toEqual({ code: "INTERNAL", message: "str" });
  });
});
