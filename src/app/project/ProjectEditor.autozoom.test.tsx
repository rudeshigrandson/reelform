import { gzipSync } from "node:zlib";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatePreviewStage, PreviewStage } from "../../editor/preview";
import { useEditorStore } from "../../editor/store";
import { ProjectEditor } from "./ProjectEditor";
import { AUTO_ZOOM_ON_OPEN_FLAG, type AutoZoomOnOpenPrefs } from "./autoZoomOnOpen";
import {
  clickTelemetryJson,
  fakeIpc,
  fakeMedia,
  projectDocument,
  resetProjectStores,
} from "./testing";

/** Boot auto-zoom through the real editor route (SPEC §6.1, guide S12 state 1). */

function fakeStage(): CreatePreviewStage {
  const stage: PreviewStage = {
    setVideo: vi.fn(),
    render: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
  return vi.fn(async () => stage);
}

const noTimer = { setInterval: () => 0, clearInterval: () => {} };
const ON: AutoZoomOnOpenPrefs = { enabled: true, sensitivity: 0.5 };

const clickMedia = () =>
  fakeMedia({
    fetchBytes: async (url) => {
      if (!url.endsWith("telemetry.json.gz")) throw new Error(`404 ${url}`);
      return new Uint8Array(gzipSync(Buffer.from(JSON.stringify(clickTelemetryJson()))));
    },
  });

function renderEditor(
  opts: {
    prefs?: AutoZoomOnOpenPrefs;
    document?: ReturnType<typeof projectDocument>;
    media?: ReturnType<typeof fakeMedia>;
  } = {},
) {
  const document = opts.document ?? projectDocument();
  const ipc = fakeIpc({
    "project:open": (req) => ({ path: req.path, document, modifiedAt: null, recovery: null }),
  });
  return render(
    <ProjectEditor
      projectId="proj-1"
      onExport={() => {}}
      autoZoomOnOpen={opts.prefs ?? ON}
      invoke={ipc.invoke}
      media={opts.media ?? clickMedia()}
      windowPort={{ back: vi.fn(), close: vi.fn() }}
      createStage={fakeStage()}
      timer={noTimer}
    />,
  );
}

const ready = () => screen.findByTestId("editor-shell");
const regions = () => useEditorStore.getState().zoomRegions;

beforeEach(resetProjectStores);
afterEach(resetProjectStores);

describe("auto-zoom on open", () => {
  it("fresh recording → ghost suggestions + toast; one Undo removes them all", async () => {
    renderEditor();
    await ready();
    const toast = await screen.findByRole("status", { name: "Zoom suggestions" });
    const n = regions().length;
    expect(n).toBeGreaterThan(0);
    expect(regions().every((r) => r.source === "auto")).toBe(true);
    expect(toast).toHaveTextContent(`We suggested ${n} ${n === 1 ? "zoom" : "zooms"}`);

    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(regions()).toEqual([]);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("Keep all closes the toast and leaves the suggestions", async () => {
    renderEditor();
    await ready();
    await screen.findByRole("status", { name: "Zoom suggestions" });
    const before = regions();
    fireEvent.click(screen.getByRole("button", { name: "Keep all" }));
    expect(screen.queryByRole("status", { name: "Zoom suggestions" })).toBeNull();
    expect(regions()).toBe(before);
  });

  it("Dismiss removes only untouched suggestions; edited regions stay", async () => {
    renderEditor();
    await ready();
    await screen.findByRole("status", { name: "Zoom suggestions" });
    const [first] = regions();
    expect(first).toBeDefined();
    // An inspector edit marks the region manual (zoomLogic).
    useEditorStore.setState({
      zoomRegions: regions().map((r) =>
        r.id === first?.id ? { ...r, level: 3, source: "manual" } : r,
      ),
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(regions().map((r) => r.id)).toEqual([first?.id]);
    expect(regions()[0]?.source).toBe("manual");
    expect(screen.queryByRole("status", { name: "Zoom suggestions" })).toBeNull();
  });

  it("Review → Keep first, Skip the rest removes the skipped ones", async () => {
    renderEditor();
    await ready();
    await screen.findByRole("status", { name: "Zoom suggestions" });
    const all = regions();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    for (let i = 1; i < all.length; i++)
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(regions().map((r) => r.id)).toEqual([all[0]?.id]);
    expect(screen.queryByRole("group", { name: "Review zoom suggestions" })).toBeNull();
  });

  it("reopened project (already auto-zoomed) → no suggestions, no toast", async () => {
    const base = projectDocument();
    renderEditor({
      document: projectDocument({
        ui: { ...base.ui, collapsed: { [AUTO_ZOOM_ON_OPEN_FLAG]: true } },
      }),
    });
    await ready();
    expect(regions()).toEqual([]);
    expect(screen.queryByRole("status", { name: "Zoom suggestions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("setting off → no-op", async () => {
    renderEditor({ prefs: { enabled: false, sensitivity: 0.5 } });
    await ready();
    expect(regions()).toEqual([]);
    expect(screen.queryByRole("status", { name: "Zoom suggestions" })).toBeNull();
  });

  it("no telemetry → no-op", async () => {
    renderEditor({
      media: fakeMedia({
        fetchBytes: async (url) => {
          throw new Error(`404 ${url}`);
        },
      }),
    });
    await ready();
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled());
    expect(regions()).toEqual([]);
    expect(screen.queryByRole("status", { name: "Zoom suggestions" })).toBeNull();
  });
});
