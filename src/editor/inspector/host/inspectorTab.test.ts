import { describe, expect, it } from "vitest";
import { inspectorTabForSelection, nextInspectorTab, selectionFromEditor } from "./inspectorTab";

describe("inspector auto-switch", () => {
  it("maps each selectable kind to its tab", () => {
    expect(inspectorTabForSelection({ kind: "zoom", id: "z" })).toBe("Zoom");
    expect(inspectorTabForSelection({ kind: "speed", id: "s" })).toBe("Effects");
    expect(inspectorTabForSelection({ kind: "annotation", id: "a" })).toBe("Annotations");
    expect(inspectorTabForSelection({ kind: "caption", id: "c" })).toBe("Captions");
    expect(inspectorTabForSelection({ kind: "audio", id: "r" })).toBe("Audio");
    expect(inspectorTabForSelection({ kind: "webcam", id: "w" })).toBe("Webcam");
    expect(inspectorTabForSelection({ kind: "clip", id: "c" })).toBeNull();
    expect(inspectorTabForSelection(null)).toBeNull();
  });

  it("follows the selection only when enabled and mapped", () => {
    expect(nextInspectorTab("Frame", { kind: "zoom", id: "z" }, true)).toBe("Zoom");
    expect(nextInspectorTab("Frame", { kind: "zoom", id: "z" }, false)).toBe("Frame");
    expect(nextInspectorTab("Audio", { kind: "clip", id: "c" }, true)).toBe("Audio");
    expect(nextInspectorTab("Audio", null, true)).toBe("Audio");
  });

  it("derives a selection from the store ids", () => {
    expect(
      selectionFromEditor({
        selectedZoomId: null,
        selectedSpeedId: null,
        selectedAnnotationId: null,
      }),
    ).toBeNull();
    expect(
      selectionFromEditor({
        selectedZoomId: "z",
        selectedSpeedId: "s",
        selectedAnnotationId: null,
      }),
    ).toEqual({
      kind: "zoom",
      id: "z",
    });
    expect(
      selectionFromEditor({ selectedZoomId: "z", selectedSpeedId: null, selectedAnnotationId: "a" })
        ?.kind,
    ).toBe("annotation");
  });
});
