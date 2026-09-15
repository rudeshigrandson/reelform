import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "../store";
import { createCanvasUpdate } from "./canvasGesture";
import { createDocumentUpdate, createEditorHistory } from "./editorHistory";

const crop = (x: number) => ({
  ...useEditorStore.getState().frame,
  crop: { x, y: 0, width: 0.5, height: 0.5 },
});

beforeEach(() => useEditorStore.getState().reset());

describe("createCanvasUpdate", () => {
  it("live moves write the store without history; the release records one entry", () => {
    let t = 0;
    const history = createEditorHistory({ now: () => t });
    const update = createCanvasUpdate(createDocumentUpdate(history));
    const edit = { label: "Move webcam", coalesceKey: "canvas:webcam" };
    const original = useEditorStore.getState().frame;

    update({ frame: crop(0.1) }, { ...edit, commit: false });
    expect(useEditorStore.getState().frame.crop?.x).toBe(0.1);
    expect(history.canUndo()).toBe(false);
    // A long pause mid-drag must not split the gesture.
    t = 5000;
    update({ frame: crop(0.2) }, { ...edit, commit: false });
    t = 9000;
    update({ frame: crop(0.3) }, { ...edit, commit: true });

    expect(useEditorStore.getState().frame.crop?.x).toBe(0.3);
    expect(history.undoLabel()).toBe("Undo: Move webcam");
    expect(history.isDirty()).toBe(true);
    history.undo();
    expect(useEditorStore.getState().frame).toEqual(original);
    expect(history.canUndo()).toBe(false);
  });

  it("a commit without live moves (crop Done) is a single entry", () => {
    const history = createEditorHistory({ now: () => 0 });
    const update = createCanvasUpdate(createDocumentUpdate(history));
    update({ frame: crop(0.4) }, { label: "Crop", coalesceKey: "canvas:crop", commit: true });
    expect(history.undoLabel()).toBe("Undo: Crop");
  });

  it("a gesture released where it started records nothing", () => {
    const history = createEditorHistory({ now: () => 0 });
    const update = createCanvasUpdate(createDocumentUpdate(history));
    const frame = useEditorStore.getState().frame;
    const edit = { label: "Crop", coalesceKey: "k" };
    update({ frame: crop(0.4) }, { ...edit, commit: false });
    update({ frame }, { ...edit, commit: true });
    expect(history.canUndo()).toBe(false);
    expect(useEditorStore.getState().frame).toBe(frame);
  });
});
