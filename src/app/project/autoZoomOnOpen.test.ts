import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuggestedZoom } from "../../editor/autozoom";
import type { GenerateInput } from "../../editor/inspector/host/zoomSuggestions";
import type { ZoomRegion } from "../../editor/inspector/zoom/types";
import { parseTelemetryJson, toProjectDocument } from "../../editor/persistence";
import { createDocumentUpdate, createEditorHistory } from "../../editor/state";
import { useEditorStore } from "../../editor/store";
import {
  AUTO_ZOOM_ON_OPEN_FLAG,
  AUTO_ZOOM_ON_OPEN_LABEL,
  autoZoomPrefsFromSettings,
  runAutoZoomOnOpen,
  wasAutoZoomedOnOpen,
  withoutUntouchedSuggestions,
} from "./autoZoomOnOpen";
import { defaultProjectStores, hydrateProjectDocument } from "./openProject";
import { editorDataOf } from "./projectSaver";
import { useProjectSession } from "./session";
import { PROJECT_PATH, clickTelemetryJson, projectDocument, resetProjectStores } from "./testing";

const ON = { enabled: true, sensitivity: 0.5 };

function openDoc(patch: Parameters<typeof projectDocument>[0] = {}, telemetry = true) {
  hydrateProjectDocument(projectDocument(patch), PROJECT_PATH);
  if (telemetry) {
    useProjectSession
      .getState()
      .setSession({ telemetry: parseTelemetryJson(clickTelemetryJson()) });
  }
  const history = createEditorHistory();
  return { history, documentUpdate: createDocumentUpdate(history) };
}

const run = (
  ctx: ReturnType<typeof openDoc>,
  prefs = ON,
  generate?: (input: GenerateInput) => SuggestedZoom[],
) =>
  runAutoZoomOnOpen({
    stores: defaultProjectStores(),
    documentUpdate: ctx.documentUpdate,
    prefs,
    generate,
  });

beforeEach(resetProjectStores);
afterEach(resetProjectStores);

describe("runAutoZoomOnOpen", () => {
  it("fresh recording → ghost suggestions in one undo entry + persisted flag", () => {
    const ctx = openDoc();
    const res = run(ctx);
    expect(res.status).toBe("applied");
    const suggestions = res.status === "applied" ? res.suggestions : [];
    expect(suggestions.length).toBeGreaterThan(0);

    const regions = useEditorStore.getState().zoomRegions;
    expect(regions.map((r) => r.id)).toEqual(suggestions.map((s) => s.id));
    expect(regions.every((r) => r.source === "auto")).toBe(true);
    expect(ctx.history.undoLabel()).toBe(`Undo: ${AUTO_ZOOM_ON_OPEN_LABEL}`);
    ctx.history.undo();
    expect(ctx.history.canUndo()).toBe(false);
    ctx.history.redo();
    expect(ctx.history.isDirty()).toBe(true);

    const { meta } = useProjectSession.getState();
    expect(wasAutoZoomedOnOpen(meta)).toBe(true);
    // Round-trips into the saved document.
    const doc = toProjectDocument(editorDataOf(useEditorStore.getState()), meta as never);
    expect(doc.ui.collapsed[AUTO_ZOOM_ON_OPEN_FLAG]).toBe(true);
  });

  it("one undo removes every suggestion and keeps the flag", () => {
    const ctx = openDoc();
    run(ctx);
    expect(useEditorStore.getState().zoomRegions.length).toBeGreaterThan(0);
    expect(ctx.history.undo()).toBe(true);
    expect(useEditorStore.getState().zoomRegions).toEqual([]);
    expect(ctx.history.canUndo()).toBe(false);
    expect(wasAutoZoomedOnOpen(useProjectSession.getState().meta)).toBe(true);
  });

  it("reopened project (flag persisted) → no regeneration", () => {
    const base = projectDocument();
    const ctx = openDoc({ ui: { ...base.ui, collapsed: { [AUTO_ZOOM_ON_OPEN_FLAG]: true } } });
    const generate = vi.fn(() => []);
    expect(run(ctx, ON, generate)).toEqual({ status: "skipped", reason: "not-fresh" });
    expect(generate).not.toHaveBeenCalled();
    expect(ctx.history.canUndo()).toBe(false);
  });

  it("project that already has zoom regions → no-op", () => {
    const ctx = openDoc();
    const manual: ZoomRegion = {
      id: "z-manual",
      startMs: 0,
      endMs: 1000,
      level: 2,
      focus: { mode: "fixed", x: 0.5, y: 0.5 },
      easeInMs: 300,
      easeOutMs: 300,
      curve: "linear",
      source: "manual",
    };
    useEditorStore.setState({ zoomRegions: [manual] });
    const generate = vi.fn(() => []);
    expect(run(ctx, ON, generate)).toEqual({ status: "skipped", reason: "not-fresh" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("setting off → no-op, no flag", () => {
    const ctx = openDoc();
    const generate = vi.fn(() => []);
    expect(run(ctx, { enabled: false, sensitivity: 0.5 }, generate)).toEqual({
      status: "skipped",
      reason: "disabled",
    });
    expect(generate).not.toHaveBeenCalled();
    expect(useEditorStore.getState().zoomRegions).toEqual([]);
    expect(wasAutoZoomedOnOpen(useProjectSession.getState().meta)).toBe(false);
  });

  it("no telemetry → no-op, no flag", () => {
    const ctx = openDoc({}, false);
    const generate = vi.fn(() => []);
    expect(run(ctx, ON, generate)).toEqual({ status: "skipped", reason: "no-telemetry" });
    expect(generate).not.toHaveBeenCalled();
    expect(wasAutoZoomedOnOpen(useProjectSession.getState().meta)).toBe(false);
  });

  it("passes the settings sensitivity through, keeping the project's trigger options", () => {
    const ctx = openDoc();
    const zoom = useEditorStore.getState().zoom;
    useEditorStore.setState({
      zoom: { ...zoom, autoZoom: { ...zoom.autoZoom, zoomOnTyping: false } },
    });
    const generate = vi.fn((_input: GenerateInput): SuggestedZoom[] => []);
    run(ctx, { enabled: true, sensitivity: 0.83 }, generate);
    expect(generate).toHaveBeenCalledTimes(1);
    const input = generate.mock.calls[0]?.[0];
    expect(input?.settings).toEqual({ ...zoom.autoZoom, zoomOnTyping: false, sensitivity: 0.83 });
    expect(input?.clips.map((c) => c.id)).toEqual(["k1", "k2"]);
    expect(input?.sourceSize).toEqual(useProjectSession.getState().sourceSize);
  });

  it("real engine: higher sensitivity never suggests fewer zooms", () => {
    const low = run(openDoc(), { enabled: true, sensitivity: 0 });
    resetProjectStores();
    const high = run(openDoc(), { enabled: true, sensitivity: 1 });
    const count = (r: typeof low) => (r.status === "applied" ? r.suggestions.length : -1);
    expect(count(high)).toBeGreaterThanOrEqual(count(low));
  });

  it("zero suggestions → flag set, no history entry", () => {
    const ctx = openDoc();
    expect(run(ctx, ON, () => [])).toEqual({ status: "applied", suggestions: [] });
    expect(ctx.history.canUndo()).toBe(false);
    expect(wasAutoZoomedOnOpen(useProjectSession.getState().meta)).toBe(true);
  });
});

describe("withoutUntouchedSuggestions", () => {
  const region = (id: string, source: ZoomRegion["source"], startMs: number): ZoomRegion => ({
    id,
    startMs,
    endMs: startMs + 500,
    level: 2,
    focus: { mode: "fixed", x: 0.5, y: 0.5 },
    easeInMs: 300,
    easeOutMs: 300,
    curve: "ease-out-cubic",
    source,
  });

  it("drops only the listed regions that are still auto", () => {
    const regions = [
      region("a", "auto", 0),
      region("b", "manual", 1000),
      region("c", "auto", 2000),
    ];
    expect(withoutUntouchedSuggestions(regions, ["a", "b"]).map((r) => r.id)).toEqual(["b", "c"]);
  });
});

describe("autoZoomPrefsFromSettings", () => {
  it("reads the settings fields and falls back to defaults", () => {
    expect(
      autoZoomPrefsFromSettings({ autoZoomOnNewRecording: false, autoZoomSensitivity: 0.2 }),
    ).toEqual({ enabled: false, sensitivity: 0.2 });
    expect(autoZoomPrefsFromSettings({})).toEqual({ enabled: true, sensitivity: 0.5 });
    expect(autoZoomPrefsFromSettings(null)).toEqual({ enabled: true, sensitivity: 0.5 });
    expect(autoZoomPrefsFromSettings({ autoZoomSensitivity: 7 }).sensitivity).toBe(1);
    expect(autoZoomPrefsFromSettings({ autoZoomSensitivity: Number.NaN }).sensitivity).toBe(0.5);
  });
});
