import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectMeta } from "../../editor/persistence";
import { createHistory } from "../../editor/state";
import { type EditorState, initialEditorData, useEditorStore } from "../../editor/store";
import { useProjectSession } from "../project/session";
import { createMetaUpdate } from "./historyAdapters";

function meta(name: string): ProjectMeta {
  return {
    id: "p1",
    name,
    createdAt: "2026-09-15T00:00:00.000Z",
    modifiedAt: "2026-09-15T00:00:00.000Z",
    appVersion: "0.0.0",
    sources: {
      video: {
        path: "media/screen.mp4",
        durationMs: 10_000,
        width: 1920,
        height: 1080,
        fps: 60,
        codec: "h264",
        hasAudio: false,
      },
    },
  } as ProjectMeta;
}

function makeHistory() {
  let t = 0;
  return createHistory<EditorState>({
    getState: () => useEditorStore.getState(),
    setState: (s) => useEditorStore.setState(s, true),
    now: () => (t += 1000),
  });
}

beforeEach(() => {
  useEditorStore.setState({ ...useEditorStore.getState(), ...initialEditorData() }, true);
  useProjectSession.getState().reset();
  useProjectSession.getState().setSession({ meta: meta("Before") });
});

describe("createMetaUpdate", () => {
  it("applies a meta change as one undoable entry", () => {
    const history = makeHistory();
    createMetaUpdate(history)("Rename project", (m) => ({ ...m, name: "After" }));
    expect(useProjectSession.getState().meta?.name).toBe("After");
    expect(history.canUndo()).toBe(true);
    history.undo();
    expect(useProjectSession.getState().meta?.name).toBe("Before");
    history.redo();
    expect(useProjectSession.getState().meta?.name).toBe("After");
  });

  it("bundles an editor patch with the meta change in the same entry", () => {
    const history = makeHistory();
    const webcam = { ...useEditorStore.getState().webcam, enabled: true };
    createMetaUpdate(history)("Add webcam", (m) => ({ ...m, name: "With webcam" }), { webcam });
    expect(useEditorStore.getState().webcam.enabled).toBe(true);
    history.undo();
    expect(useEditorStore.getState().webcam.enabled).toBe(initialEditorData().webcam.enabled);
    expect(useProjectSession.getState().meta?.name).toBe("Before");
    expect(history.canUndo()).toBe(false);
  });

  it("does not mutate the previous meta object and is a no-op without a project", () => {
    const history = makeHistory();
    const original = useProjectSession.getState().meta;
    createMetaUpdate(history)("Rename", (m) => {
      m.name = "Mutated in place";
      return m;
    });
    expect(original?.name).toBe("Before");

    useProjectSession.getState().setSession({ meta: null });
    const before = history.canUndo();
    createMetaUpdate(history)("Rename", (m) => ({ ...m, name: "x" }));
    expect(history.canUndo()).toBe(before);
  });
});
