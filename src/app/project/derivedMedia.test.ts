import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDerivedMedia, openProject, renameOpenProject } from "./openProject";
import { useProjectSession } from "./session";
import { PROJECT_PATH, fakeIpc, fakeMedia, resetProjectStores } from "./testing";

/** Background proxy / filmstrip / waveform (SPEC §6.1, §6.3, §6.7) and top-bar rename (S12). */

beforeEach(resetProjectStores);
afterEach(resetProjectStores);

const session = () => useProjectSession.getState();

const derived = () =>
  fakeIpc({
    "project:ensureProxy": () => ({ proxyPath: "cache/proxy 1080.mp4", generated: true }),
    "project:ensureThumbnails": () => ({
      items: [
        { sourceMs: 2000, path: "cache/thumbs/2000.jpg" },
        { sourceMs: 0, path: "cache/thumbs/0.jpg" },
      ],
    }),
  });

describe("loadDerivedMedia", () => {
  it("fills proxy, sorted thumbnails and waveform peaks as media URLs", async () => {
    const ipc = derived();
    const decodeAudio = vi.fn(async () => ({ channels: [Float32Array.from([0.5, -1])] }));
    await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia({ decodeAudio }) });

    await vi.waitFor(() => expect(session().waveformPeaks).not.toBeNull());
    expect(session().proxyUrl).toBe("reelform-media://root-1/cache/proxy%201080.mp4");
    expect(session().thumbnails).toEqual([
      { sourceMs: 0, url: "reelform-media://root-1/cache/thumbs/0.jpg" },
      { sourceMs: 2000, url: "reelform-media://root-1/cache/thumbs/2000.jpg" },
    ]);
    expect([...(session().waveformPeaks ?? [])]).toEqual([0.5, 1]);
    expect(ipc.callsTo("project:ensureThumbnails")).toEqual([
      { projectId: "proj-1", intervalMs: 2000, height: 160 },
    ]);
  });

  it("failures leave the session defaults; results for another project are dropped", async () => {
    const failing = fakeIpc({
      "project:ensureProxy": () => {
        throw { code: "FFMPEG_MISSING", message: "no ffmpeg" };
      },
      "project:ensureThumbnails": () => {
        throw { code: "FFMPEG_MISSING", message: "no ffmpeg" };
      },
    });
    await openProject("proj-1", {
      invoke: failing.invoke,
      media: fakeMedia({ decodeAudio: async () => null }),
    });
    await loadDerivedMedia("proj-1", { invoke: failing.invoke, media: fakeMedia() });
    expect(session().proxyUrl).toBeNull();
    expect(session().thumbnails).toEqual([]);

    const ipc = derived();
    await loadDerivedMedia("other-project", { invoke: ipc.invoke, media: fakeMedia() });
    expect(session().proxyUrl).toBeNull();
  });
});

describe("renameOpenProject", () => {
  it("renamed folder: re-registers media, rebases URLs, releases the old root", async () => {
    const newPath = "/Users/me/Reelform/Launch.reelform";
    const ipc = fakeIpc({
      "project:ensureThumbnails": () => ({ items: [{ sourceMs: 0, path: "cache/t0.jpg" }] }),
      "project:rename": () => ({ path: newPath, document: {}, modifiedAt: null }),
    });
    const opened = await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia() });
    if (opened.status !== "ready") throw new Error("expected ready");
    await vi.waitFor(() => expect(session().thumbnails).toHaveLength(1));

    const res = await renameOpenProject("  Launch ", {
      invoke: ipc.invoke,
      mediaRootIds: opened.mediaRootIds,
    });

    expect(ipc.callsTo("project:rename")).toEqual([{ path: PROJECT_PATH, name: "  Launch " }]);
    expect(res).toEqual({ path: newPath, mediaRootIds: ["root-2"] });
    expect(session().projectPath).toBe(newPath);
    expect(session().meta?.name).toBe("Launch");
    expect(session().mediaBaseUrl).toBe("reelform-media://root-2/");
    expect(session().videoUrl?.startsWith("reelform-media://root-2/")).toBe(true);
    expect(session().thumbnails[0]?.url).toBe("reelform-media://root-2/cache/t0.jpg");
    expect(ipc.callsTo("media:unregisterRoot")).toEqual([{ rootId: "root-1" }]);
  });

  it("same folder: only the name changes", async () => {
    const ipc = fakeIpc();
    const opened = await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia() });
    if (opened.status !== "ready") throw new Error("expected ready");
    const res = await renameOpenProject("Demo 2", { invoke: ipc.invoke, mediaRootIds: ["root-1"] });
    expect(res).toEqual({ path: PROJECT_PATH, mediaRootIds: ["root-1"] });
    expect(session().meta?.name).toBe("Demo 2");
    expect(ipc.callsTo("media:unregisterRoot")).toEqual([]);
  });

  it("rejects with the IPC error shape and leaves the session alone", async () => {
    const ipc = fakeIpc({
      "project:rename": () => {
        throw { code: "INVALID_NAME", message: "That name can't be used" };
      },
    });
    await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia() });
    await expect(
      renameOpenProject("///", { invoke: ipc.invoke, mediaRootIds: ["root-1"] }),
    ).rejects.toEqual({ code: "INVALID_NAME", message: "That name can't be used" });
    expect(session().meta?.name).toBe("Demo");
    expect(session().projectPath).toBe(PROJECT_PATH);
  });
});
