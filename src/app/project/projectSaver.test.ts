import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_INTERVAL_MS } from "../../editor/persistence";
import { createDocumentUpdate, createEditorHistory } from "../../editor/state";
import { useEditorStore } from "../../editor/store";
import { addAtPlayhead, splitClipAt } from "../../editor/timelineBinding";
import { hydrateProjectDocument, openProject } from "./openProject";
import { createProjectSaver, editorDataOf } from "./projectSaver";
import { useProjectSession } from "./session";
import { type FakeHandlers, PROJECT_PATH, fakeIpc, fakeMedia, resetProjectStores } from "./testing";

let seq = 0;
const makeId = (p: string) => `${p}-${++seq}`;

async function setup(overrides: FakeHandlers = {}) {
  const ipc = fakeIpc(overrides);
  await openProject("proj-1", { invoke: ipc.invoke, media: fakeMedia() });
  const history = createEditorHistory({ now: () => Date.now() });
  const saver = createProjectSaver({
    invoke: ipc.invoke,
    history,
    now: () => new Date().toISOString(),
  });
  const update = createDocumentUpdate(history);
  const addZoom = (t = 1000) => {
    const res = addAtPlayhead(useEditorStore.getState(), "zoom", t, makeId);
    if (res) update("Add zoom", res.patch);
  };
  return { ipc, history, saver, update, addZoom };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetProjectStores();
});

afterEach(() => {
  vi.useRealTimers();
  resetProjectStores();
});

const saves = (ipc: ReturnType<typeof fakeIpc>) =>
  ipc.callsTo("project:save") as { path: string; document: unknown; autosave?: boolean }[];

describe("manual save", () => {
  it("round-trips: edits → project:save → hydrate the written document → same editor data", async () => {
    const { ipc, history, saver, update, addZoom } = await setup();
    addZoom(2000);
    const split = splitClipAt(useEditorStore.getState(), 1500, makeId);
    if (split) update("Split clip", split);
    expect(history.isDirty()).toBe(true);
    const before = structuredClone(editorDataOf(useEditorStore.getState()));

    expect(await saver.save()).toBe(true);
    const [call] = saves(ipc);
    expect(call).toMatchObject({ path: PROJECT_PATH });
    expect(call?.autosave).toBeUndefined();
    expect(history.isDirty()).toBe(false);
    expect(useProjectSession.getState().meta?.modifiedAt).toBe("2026-09-15T12:00:00.000Z");

    resetProjectStores();
    hydrateProjectDocument(call?.document, PROJECT_PATH);
    expect(editorDataOf(useEditorStore.getState())).toEqual(before);
    expect(useEditorStore.getState().clips).toHaveLength(3);
    saver.dispose();
  });

  it("edits made while the save is in flight stay dirty", async () => {
    let release: () => void = () => {};
    const { ipc, history, saver, addZoom } = await setup({
      "project:save": (req) =>
        new Promise((resolve) => {
          release = () =>
            resolve({ path: req.path, modifiedAt: "2026-09-15T12:00:00.000Z", backupName: null });
        }),
    });
    addZoom(1000);
    const pending = saver.save();
    await vi.advanceTimersByTimeAsync(0);
    addZoom(5000);
    release();
    expect(await pending).toBe(true);
    expect(saves(ipc)).toHaveLength(1);
    expect(history.isDirty()).toBe(true);
    history.undo();
    expect(history.isDirty()).toBe(false);
    saver.dispose();
  });

  it("a failed save keeps the project dirty and reports the error", async () => {
    const { history, saver, addZoom } = await setup({
      "project:save": () => {
        throw { code: "EACCES", message: "Permission denied" };
      },
    });
    addZoom();
    expect(await saver.save()).toBe(false);
    expect(history.isDirty()).toBe(true);
    expect(saver.autosave.getStatus().lastError).toEqual({
      code: "EACCES",
      message: "Permission denied",
    });
    saver.dispose();
  });

  it("with no open project the save fails cleanly", async () => {
    const ipc = fakeIpc();
    const history = createEditorHistory({ now: () => 0 });
    const saver = createProjectSaver({ invoke: ipc.invoke, history });
    expect(await saver.save()).toBe(false);
    expect(saves(ipc)).toEqual([]);
    saver.dispose();
  });
});

describe("autosave timing (SPEC §4)", () => {
  it("writes a backup every 30s only while dirty, never moving the save point", async () => {
    const { ipc, history, saver, addZoom } = await setup();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    expect(saves(ipc)).toEqual([]);

    addZoom();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 1);
    expect(saves(ipc)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves(ipc)).toHaveLength(1);
    expect(saves(ipc)[0]?.autosave).toBe(true);
    // Backups don't write project.json: still "unsaved" for the top bar.
    expect(history.isDirty()).toBe(true);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS * 2);
    expect(saves(ipc)).toHaveLength(1);
    saver.dispose();
  });

  it("autosaves on window blur when dirty, not when clean", async () => {
    const { ipc, saver, addZoom } = await setup();
    expect(await saver.handleBlur()).toBe(false);
    addZoom();
    expect(await saver.handleBlur()).toBe(true);
    expect(saves(ipc).map((s) => s.autosave)).toEqual([true]);
    expect(await saver.handleBlur()).toBe(false);
    saver.dispose();
  });

  it("selection-only changes are not dirtying; dispose stops the interval", async () => {
    const { ipc, saver } = await setup();
    useEditorStore.getState().update({ selectedZoomId: "x" });
    saver.dispose();
    useEditorStore.getState().update({ captionLanguage: "fr" });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS * 3);
    expect(saves(ipc)).toEqual([]);
  });
});
