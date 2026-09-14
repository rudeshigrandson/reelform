import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { loadProject } from "../model/v1";
import type { ProjectV1 } from "../model/v1";
import { m0Fixture } from "../model/v1/fixtures";
import { type EditorState, initialEditorData } from "../store";
import {
  AUTOSAVE_INTERVAL_MS,
  type AutosavePort,
  type SaveReason,
  bindBlurAutosave,
  bindDirtyTracking,
  createAutosaveController,
} from "./autosave";

interface Deferred {
  resolve: () => void;
  reject: (e: unknown) => void;
}

function setup(opts: { manualResolve?: boolean } = {}) {
  const saves: { doc: ProjectV1; reason: SaveReason }[] = [];
  const pending: Deferred[] = [];
  const port: AutosavePort = {
    save: (doc, reason) => {
      saves.push({ doc, reason });
      if (!opts.manualResolve) return Promise.resolve();
      return new Promise<void>((resolve, reject) => pending.push({ resolve, reject }));
    },
  };
  let tick = 0;
  const base = loadProject(m0Fixture());
  const controller = createAutosaveController({
    port,
    getDocument: () => base,
    now: () => `2026-09-14T00:00:${String(tick++).padStart(2, "0")}.000Z`,
    timer: {
      setInterval: (cb, ms) => globalThis.setInterval(cb, ms),
      clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
    },
  });
  return { controller, saves, pending };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("autosave controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing while clean", async () => {
    const { saves } = setup();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS * 3);
    expect(saves).toHaveLength(0);
  });

  it("saves every 30s while dirty, not before", async () => {
    const { controller, saves } = setup();
    controller.markDirty();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 1);
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves.map((s) => s.reason)).toEqual(["interval"]);
    expect(controller.isDirty()).toBe(false);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    expect(saves).toHaveLength(1);
    controller.markDirty();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    expect(saves).toHaveLength(2);
  });

  it("bumps modifiedAt from the injected clock on every write", async () => {
    const { controller, saves } = setup();
    await controller.save();
    await controller.save();
    expect(saves.map((s) => s.doc.modifiedAt)).toEqual([
      "2026-09-14T00:00:00.000Z",
      "2026-09-14T00:00:01.000Z",
    ]);
    expect(controller.getStatus().lastSavedAt).toBe("2026-09-14T00:00:01.000Z");
  });

  it("saves on blur only when dirty", async () => {
    const { controller, saves } = setup();
    expect(await controller.handleBlur()).toBe(false);
    controller.markDirty();
    expect(await controller.handleBlur()).toBe(true);
    expect(saves.map((s) => s.reason)).toEqual(["blur"]);
  });

  it("manual save always writes and clears dirty", async () => {
    const { controller, saves } = setup();
    expect(await controller.save()).toBe(true);
    controller.markDirty();
    expect(await controller.save()).toBe(true);
    expect(controller.isDirty()).toBe(false);
    expect(saves.map((s) => s.reason)).toEqual(["manual", "manual"]);
  });

  it("edits made during an in-flight save keep the project dirty", async () => {
    const { controller, saves, pending } = setup({ manualResolve: true });
    controller.markDirty();
    const p = controller.handleBlur();
    controller.markDirty();
    expect(controller.getStatus().saving).toBe(true);
    // A second autosave trigger while saving is skipped.
    expect(await controller.handleBlur()).toBe(false);
    pending[0]?.resolve();
    expect(await p).toBe(true);
    expect(controller.isDirty()).toBe(true);
    expect(saves).toHaveLength(1);
  });

  it("manual save waits for the in-flight save, then writes", async () => {
    const { controller, saves, pending } = setup({ manualResolve: true });
    controller.markDirty();
    void controller.handleBlur();
    const manual = controller.save();
    await flush();
    expect(saves).toHaveLength(1);
    pending[0]?.resolve();
    await flush();
    expect(saves.map((s) => s.reason)).toEqual(["blur", "manual"]);
    pending[1]?.resolve();
    expect(await manual).toBe(true);
  });

  it("a failed save keeps dirty, records the error and retries on the next tick", async () => {
    const { controller, saves, pending } = setup({ manualResolve: true });
    controller.markDirty();
    const p = controller.handleBlur();
    pending[0]?.reject(new Error("disk full"));
    expect(await p).toBe(false);
    expect(controller.isDirty()).toBe(true);
    expect((controller.getStatus().lastError as Error).message).toBe("disk full");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    expect(saves).toHaveLength(2);
    pending[1]?.resolve();
    await flush();
    expect(controller.getStatus().lastError).toBeNull();
  });

  it("dispose stops the interval and ignores further triggers", async () => {
    const { controller, saves } = setup();
    controller.markDirty();
    controller.dispose();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS * 2);
    expect(await controller.handleBlur()).toBe(false);
    expect(await controller.save()).toBe(false);
    expect(saves).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("markClean clears dirty without saving (e.g. after load)", () => {
    const { controller, saves } = setup();
    controller.markDirty();
    controller.markClean();
    expect(controller.isDirty()).toBe(false);
    expect(saves).toHaveLength(0);
  });

  it("emits status changes", async () => {
    const seen: string[] = [];
    const controller = createAutosaveController({
      port: { save: () => Promise.resolve() },
      getDocument: () => loadProject(m0Fixture()),
      now: () => "2026-09-14T00:00:00.000Z",
      onStatus: (s) => seen.push(`${s.dirty ? "D" : "c"}${s.saving ? "S" : "-"}`),
    });
    controller.markDirty();
    await controller.save();
    controller.dispose();
    expect(seen).toEqual(["D-", "DS", "c-"]);
  });
});

describe("store bindings", () => {
  function makeStore() {
    return create<EditorState>((set) => ({
      ...initialEditorData(),
      update: (patch) => set(patch),
      reset: () => set(initialEditorData()),
    }));
  }

  it("marks dirty on document edits but not on selection/transient changes", () => {
    const store = makeStore();
    let dirty = 0;
    const unbind = bindDirtyTracking(store.subscribe, { markDirty: () => dirty++ });
    store.getState().update({ selectedZoomId: "z1", activeTool: "text" });
    store.getState().update({ captionStatus: { kind: "downloading", progress: 0.5 } });
    expect(dirty).toBe(0);
    store.getState().update({ burnInCaptions: true });
    store.getState().update({ frame: { ...store.getState().frame, radius: 20 } });
    expect(dirty).toBe(2);
    unbind();
    store.getState().update({ durationMs: 1 });
    expect(dirty).toBe(2);
  });

  it("blur listener triggers handleBlur and unbinds", () => {
    const target = new EventTarget();
    let blurs = 0;
    const unbind = bindBlurAutosave(target, {
      handleBlur: () => {
        blurs++;
        return Promise.resolve(false);
      },
    });
    target.dispatchEvent(new Event("blur"));
    unbind();
    target.dispatchEvent(new Event("blur"));
    expect(blurs).toBe(1);
  });
});
