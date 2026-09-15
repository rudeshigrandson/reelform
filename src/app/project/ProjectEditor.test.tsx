import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatePreviewStage, PreviewStage } from "../../editor/preview";
import { useEditorStore } from "../../editor/store";
import { type EditorWindowPort, ProjectEditor } from "./ProjectEditor";
import { useProjectSession } from "./session";
import {
  type FakeHandlers,
  PROJECT_PATH,
  fakeIpc,
  fakeMedia,
  projectDocument,
  resetProjectStores,
} from "./testing";

const RECOVERY = {
  backupName: "autosave-000000000000009.json",
  backupSavedAt: "2026-09-15T09:00:00.000Z",
  projectModifiedAt: "2026-09-14T10:00:00.000Z",
  backups: [{ name: "autosave-000000000000009.json", savedAt: "2026-09-15T09:00:00.000Z" }],
};

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

function renderEditor(overrides: FakeHandlers = {}) {
  const ipc = fakeIpc(overrides);
  const port: EditorWindowPort = { back: vi.fn(), close: vi.fn() };
  const utils = render(
    <ProjectEditor
      projectId="proj-1"
      onExport={() => {}}
      invoke={ipc.invoke}
      media={fakeMedia()}
      windowPort={port}
      createStage={fakeStage()}
      timer={noTimer}
    />,
  );
  return { ipc, port, ...utils };
}

async function ready() {
  await screen.findByTestId("editor-shell");
}

const makeDirty = () =>
  fireEvent.click(screen.getByRole("button", { name: "Add Zoom at playhead" }));

beforeEach(resetProjectStores);
afterEach(resetProjectStores);

describe("ProjectEditor states", () => {
  it("shows loading, then the editor for the opened project", async () => {
    renderEditor();
    expect(screen.getByRole("status")).toHaveTextContent("Opening project…");
    await ready();
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("Demo");
    expect(useProjectSession.getState().status).toBe("ready");
    expect(screen.queryByLabelText("Unsaved changes")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  });

  it("not found → message and Back to projects", async () => {
    const { port } = renderEditor({
      "project:resolve": () => {
        throw { code: "PROJECT_NOT_FOUND", message: "No project with that id" };
      },
    });
    expect(await screen.findByRole("heading", { name: "Project not found" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to projects" }));
    expect(port.back).toHaveBeenCalledTimes(1);
  });

  it("error → Try again re-opens", async () => {
    let fail = true;
    renderEditor({
      "project:open": (req) => {
        if (fail) throw { code: "PROJECT_CORRUPT", message: "project.json is not valid JSON" };
        return { path: req.path, document: projectDocument(), modifiedAt: null, recovery: null };
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("project.json is not valid JSON");
    expect(screen.getByText("PROJECT_CORRUPT")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await ready();
  });

  it("releases media roots on unmount", async () => {
    const { ipc, unmount } = renderEditor();
    await ready();
    unmount();
    await waitFor(() =>
      expect(ipc.callsTo("media:unregisterRoot")).toEqual([{ rootId: "root-1" }]),
    );
  });
});

describe("crash recovery (S27)", () => {
  const withRecovery = (extra: FakeHandlers = {}) =>
    renderEditor({
      "project:open": (req) => ({
        path: req.path,
        document: projectDocument(),
        modifiedAt: null,
        recovery: RECOVERY,
      }),
      "project:restore": (req) => ({
        path: req.path,
        document: projectDocument({ name: "Recovered" }),
        modifiedAt: "2026-09-15T09:00:00.000Z",
        restoredFrom: req.backupName ?? "",
      }),
      ...extra,
    });

  it("Restore re-hydrates from the newest autosave", async () => {
    const { ipc } = withRecovery();
    expect(await screen.findByRole("dialog")).toHaveTextContent("Crash recovered");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(screen.queryByText("Crash recovered")).toBeNull());
    expect(ipc.callsTo("project:restore")).toEqual([
      { path: PROJECT_PATH, backupName: RECOVERY.backupName },
    ]);
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("Recovered");
    expect(screen.getByText("We restored your last session")).toBeInTheDocument();
    expect(screen.queryByLabelText("Unsaved changes")).toBeNull();
  });

  it("Discard drops the backups and keeps the saved version", async () => {
    const { ipc } = withRecovery();
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ipc.callsTo("project:discardBackups")).toEqual([{ path: PROJECT_PATH }]);
    expect(ipc.callsTo("project:restore")).toEqual([]);
  });

  it("Escape only dismisses the prompt; backups are kept", async () => {
    const { ipc } = withRecovery();
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ipc.callsTo("project:discardBackups")).toEqual([]);
    expect(ipc.callsTo("project:restore")).toEqual([]);
  });

  it("a failed restore stays in the dialog with the error", async () => {
    withRecovery({
      "project:restore": () => {
        throw { code: "NO_BACKUP", message: "Backup not found" };
      },
    });
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Backup not found")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("saving and leaving (S12 state 12)", () => {
  it("edits show the unsaved dot; ⌘S saves project.json, clears it and toasts", async () => {
    const { ipc } = renderEditor();
    await ready();
    makeDirty();
    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", code: "KeyS", metaKey: true });
    });
    await waitFor(() => expect(screen.queryByLabelText("Unsaved changes")).toBeNull());
    const [call] = ipc.callsTo("project:save") as {
      autosave?: boolean;
      document: { timeline: { zooms: unknown[] } };
    }[];
    expect(call?.autosave).toBeUndefined();
    expect(call?.document.timeline.zooms).toHaveLength(1);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("a failing ⌘S keeps the dot and shows the error", async () => {
    renderEditor({
      "project:save": () => {
        throw { code: "ENOSPC", message: "Disk full" };
      },
    });
    await ready();
    makeDirty();
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", code: "KeyS", ctrlKey: true });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save — Disk full");
    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
  });

  it("Back with no changes leaves immediately", async () => {
    const { port } = renderEditor();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(port.back).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Save changes?")).toBeNull();
  });

  it("Back with changes asks; Cancel stays, Don't save discards backups and leaves", async () => {
    const { ipc, port } = renderEditor();
    await ready();
    makeDirty();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Save changes?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(port.back).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Don't save" }));
    await waitFor(() => expect(port.back).toHaveBeenCalledTimes(1));
    expect(ipc.callsTo("project:discardBackups")).toEqual([{ path: PROJECT_PATH }]);
    expect(ipc.callsTo("project:save")).toEqual([]);
  });

  it("Save in the prompt writes, then leaves; a failed write keeps the prompt open", async () => {
    let fail = true;
    const { ipc, port } = renderEditor({
      "project:save": (req) => {
        if (fail) throw { code: "EACCES", message: "Permission denied" };
        return { path: req.path, modifiedAt: "2026-09-15T12:00:00.000Z", backupName: null };
      },
    });
    await ready();
    makeDirty();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findAllByText("Permission denied")).not.toHaveLength(0);
    expect(port.back).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(port.back).toHaveBeenCalledTimes(1));
    expect(ipc.callsTo("project:save")).toHaveLength(2);
  });

  it("closing the window while dirty cancels the unload and prompts; Don't save closes", async () => {
    const { port } = renderEditor();
    await ready();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    makeDirty();
    const dirty = new Event("beforeunload", { cancelable: true });
    act(() => {
      window.dispatchEvent(dirty);
    });
    expect(dirty.defaultPrevented).toBe(true);
    expect(screen.getByRole("dialog")).toHaveTextContent("Save changes?");
    fireEvent.click(screen.getByRole("button", { name: "Don't save" }));
    await waitFor(() => expect(port.close).toHaveBeenCalledTimes(1));

    // The close we asked for must not be blocked again.
    const again = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
  });

  it("window blur autosaves a backup while dirty", async () => {
    const { ipc } = renderEditor();
    await ready();
    window.dispatchEvent(new Event("blur"));
    expect(ipc.callsTo("project:save")).toEqual([]);
    makeDirty();
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() =>
      expect(
        (ipc.callsTo("project:save") as { autosave?: boolean }[]).map((c) => c.autosave),
      ).toEqual([true]),
    );
    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();
    expect(useEditorStore.getState().zoomRegions).toHaveLength(1);
  });
});
