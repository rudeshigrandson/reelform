import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatePreviewStage, PreviewStage } from "../../editor/preview";
import { sampleSettings } from "../../settings/types";
import { ShortcutsProvider } from "../../shortcuts/ShortcutsProvider";
import { useAppSettings } from "../settings/store";
import { ProjectEditor } from "./ProjectEditor";
import { useProjectSession } from "./session";
import { type FakeHandlers, PROJECT_PATH, fakeIpc, fakeMedia, resetProjectStores } from "./testing";

/** Project session wiring: top-bar rename, registry save, autosave interval setting. */

function fakeStage(): CreatePreviewStage {
  const stage: PreviewStage = {
    setVideo: vi.fn(),
    render: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
  return vi.fn(async () => stage);
}

function renderEditor(
  opts: {
    handlers?: FakeHandlers;
    timer?: {
      setInterval: (cb: () => void, ms: number) => unknown;
      clearInterval: (h: unknown) => void;
    };
    wrap?: (ui: ReactElement) => ReactElement;
  } = {},
) {
  const ipc = fakeIpc(opts.handlers);
  const ui = (
    <ProjectEditor
      projectId="proj-1"
      onExport={() => {}}
      invoke={ipc.invoke}
      media={fakeMedia()}
      windowPort={{ back: vi.fn(), close: vi.fn() }}
      createStage={fakeStage()}
      timer={opts.timer ?? { setInterval: () => 0, clearInterval: () => {} }}
    />
  );
  render(opts.wrap ? opts.wrap(ui) : ui);
  return ipc;
}

const ready = () => screen.findByTestId("editor-shell");
const nameInput = () => screen.getByRole("textbox", { name: "Project name" });

beforeEach(() => {
  resetProjectStores();
  useAppSettings.setState({ settings: sampleSettings });
});
afterEach(() => {
  resetProjectStores();
  useAppSettings.setState({ settings: sampleSettings });
});

describe("ProjectEditor session wiring", () => {
  it("renaming in the top bar calls project:rename and follows the moved folder", async () => {
    const newPath = "/Users/me/Reelform/Launch.reelform";
    const ipc = renderEditor({
      handlers: {
        "project:rename": () => ({ path: newPath, document: {}, modifiedAt: null }),
      },
    });
    await ready();
    fireEvent.change(nameInput(), { target: { value: "Launch" } });
    fireEvent.blur(nameInput());
    await waitFor(() => expect(useProjectSession.getState().projectPath).toBe(newPath));
    expect(ipc.callsTo("project:rename")).toEqual([{ path: PROJECT_PATH, name: "Launch" }]);
    expect(nameInput()).toHaveValue("Launch");
  });

  it("a failed rename toasts and keeps the old name", async () => {
    renderEditor({
      handlers: {
        "project:rename": () => {
          throw { code: "NAME_TAKEN", message: "A project with that name exists" };
        },
      },
    });
    await ready();
    fireEvent.change(nameInput(), { target: { value: "Taken" } });
    fireEvent.blur(nameInput());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't rename — A project with that name exists",
    );
    expect(useProjectSession.getState().meta?.name).toBe("Demo");
    await waitFor(() => expect(nameInput()).toHaveValue("Demo"));
  });

  it("inside a shortcuts provider, save follows the user's binding", async () => {
    const ipc = renderEditor({
      wrap: (ui) => (
        <ShortcutsProvider platform="mac" overrides={{ "editor.save": "⌘J" }}>
          {ui}
        </ShortcutsProvider>
      ),
    });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Add Zoom at playhead" }));
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", code: "KeyS", metaKey: true });
    });
    expect(ipc.callsTo("project:save")).toEqual([]);
    await act(async () => {
      fireEvent.keyDown(window, { key: "j", code: "KeyJ", metaKey: true });
    });
    await waitFor(() => expect(ipc.callsTo("project:save")).toHaveLength(1));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("autosave runs at autosaveIntervalSec and restarts when the setting changes", async () => {
    useAppSettings.setState({ settings: { ...sampleSettings, autosaveIntervalSec: 15 } });
    const timer = {
      setInterval: vi.fn((_cb: () => void, _ms: number) => Symbol("interval")),
      clearInterval: vi.fn(),
    };
    renderEditor({ timer });
    await ready();
    expect(timer.setInterval).toHaveBeenLastCalledWith(expect.any(Function), 15_000);
    const cleared = timer.clearInterval.mock.calls.length;
    act(() => {
      useAppSettings.setState({ settings: { ...sampleSettings, autosaveIntervalSec: 60 } });
    });
    expect(timer.setInterval).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
    expect(timer.clearInterval.mock.calls.length).toBeGreaterThan(cleared);
  });
});
