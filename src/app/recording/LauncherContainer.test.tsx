import type { ResponseOf } from "@contracts";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LauncherNotice } from "../../launcher/types";
import type { ProjectInvoke } from "../project/openProject";
import { type FakeHandlers, fakeIpc } from "../project/testing";
import {
  type DeviceLike,
  type IntervalTimers,
  LauncherContainer,
  type VisibilitySource,
  toDeviceLists,
  toLauncherProject,
} from "./LauncherContainer";
import { createMemoryBusHub } from "./bus";
import { createRecordingFlow } from "./flow";
import type { SourcesResult } from "./port";
import {
  FakeAppPort,
  FakeProjects,
  FakeSystem,
  FakeWindows,
  SOURCES,
  drain,
  fakeCaptureFactory,
} from "./testFakes";

function manualTimers() {
  const intervals = new Map<number, () => void>();
  let id = 0;
  const timers: IntervalTimers = {
    setInterval: (cb) => {
      intervals.set(++id, cb);
      return id;
    },
    clearInterval: (h) => {
      intervals.delete(h as number);
    },
  };
  return {
    timers,
    intervals,
    tick: () => {
      for (const cb of [...intervals.values()]) cb();
    },
  };
}

function fakeVisibility(initial = true) {
  let visible = initial;
  const listeners = new Set<() => void>();
  const v: VisibilitySource = {
    isVisible: () => visible,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    v,
    set: (next: boolean) => {
      visible = next;
      for (const l of listeners) l();
    },
  };
}

const DEVICES: DeviceLike[] = [
  { deviceId: "mic-1", kind: "audioinput", label: "" },
  { deviceId: "cam-1", kind: "videoinput", label: "FaceTime HD Camera" },
  { deviceId: "", kind: "audioinput", label: "hidden before permission" },
];

async function flushUi(rounds = 40) {
  await act(async () => {
    await drain(rounds);
  });
}

function setup(
  opts: {
    platform?: "darwin" | "linux";
    openEditor?: boolean;
    projectInvoke?: ProjectInvoke;
    version?: string;
    insetTitleBar?: boolean;
    extraNotices?: LauncherNotice[];
  } = {},
) {
  const log: string[] = [];
  const port = new FakeAppPort();
  const windows = new FakeWindows();
  const projects = new FakeProjects();
  const system = new FakeSystem();
  const capture = fakeCaptureFactory(log);
  const hub = createMemoryBusHub();
  let latest: SourcesResult | null = null;
  const flow = createRecordingFlow({
    port,
    windows,
    projects,
    system,
    startCapture: capture.startCapture,
    platform: opts.platform ?? "darwin",
    appVersion: "1.0.0",
    newId: () => "p1",
    nowIso: () => "2026-09-15T14:32:05.000Z",
    openEditorAfterRecording: () => opts.openEditor ?? false,
    sources: () => latest,
    bus: hub.endpoint(),
  });
  const timers = manualTimers();
  const visibility = fakeVisibility();
  const enumerateDevices = vi.fn(async () => DEVICES);
  const listSpy = vi.spyOn(port, "listSources");
  const utils = render(
    <LauncherContainer
      flow={flow}
      port={port}
      enumerateDevices={enumerateDevices}
      platform={opts.platform ?? "darwin"}
      system={system}
      onSources={(s) => {
        latest = s;
      }}
      timers={timers.timers}
      visibility={visibility.v}
      projectInvoke={opts.projectInvoke}
      version={opts.version}
      insetTitleBar={opts.insetTitleBar}
      extraNotices={opts.extraNotices}
    />,
  );
  return {
    port,
    windows,
    projects,
    system,
    flow,
    timers,
    visibility,
    enumerateDevices,
    listSpy,
    log,
    ...utils,
  };
}

describe("toDeviceLists", () => {
  it("splits by kind, names unlabeled devices and drops empty ids", () => {
    expect(toDeviceLists(DEVICES)).toEqual({
      mic: [{ id: "mic-1", label: "Microphone 1" }],
      webcam: [{ id: "cam-1", label: "FaceTime HD Camera" }],
    });
  });
});

describe("LauncherContainer — project shelf", () => {
  function fakeProjectInvoke() {
    return vi.fn(async (channel: string, _payload: unknown) => {
      if (channel === "project:list") {
        return {
          projects: [
            {
              path: "/Projects/demo.reelform",
              id: "proj-1",
              name: "Demo walkthrough",
              modifiedAt: "2026-09-15T10:00:00.000Z",
              durationMs: 42180,
              recent: true,
              missing: false,
              corrupt: false,
            },
            {
              path: "/Projects/gone.reelform",
              id: null,
              name: "Gone project",
              modifiedAt: null,
              durationMs: null,
              recent: true,
              missing: true,
              corrupt: false,
            },
          ],
        };
      }
      if (channel === "project:listTrash") return { projects: [] };
      return {};
    });
  }

  it("loads project:list into the shelf, shows the version, and opens only openable projects", async () => {
    const invoke = fakeProjectInvoke();
    setup({ projectInvoke: invoke as unknown as ProjectInvoke, version: "1.2.0" });
    await flushUi();
    expect(invoke).toHaveBeenCalledWith("project:list", {});
    expect(screen.getByText("1.2.0")).toBeInTheDocument();

    fireEvent.click(await screen.findByText("Demo walkthrough"));
    expect(invoke).toHaveBeenCalledWith("windows:openEditor", { projectId: "proj-1" });

    invoke.mockClear();
    fireEvent.click(screen.getByText("Gone project"));
    expect(invoke).not.toHaveBeenCalledWith("windows:openEditor", expect.anything());
  });

  it("shows no shelf when no project channel is given", async () => {
    setup();
    await flushUi();
    expect(screen.queryByText("Demo walkthrough")).toBeNull();
  });
});

describe("LauncherContainer — project card menu and Open project…", () => {
  type ListEntry = ResponseOf<"project:list">["projects"][number];
  const listEntry = (over: Partial<ListEntry> = {}): ListEntry => ({
    path: "/lib/Alpha.reelform",
    name: "Alpha",
    modifiedAt: "2026-09-14T10:00:00.000Z",
    thumbnailPath: null,
    thumbnailUrl: null,
    sizeBytes: null,
    missing: false,
    corrupt: false,
    recent: true,
    id: "alpha",
    durationMs: 5000,
    ...over,
  });

  function shelfIpc(handlers: FakeHandlers = {}) {
    let projects = [listEntry()];
    return fakeIpc({
      "project:list": () => ({ projects }),
      "project:listTrash": () => ({
        projects: [
          {
            path: "/lib/.trash/Old.reelform",
            name: "Old",
            id: "old",
            trashedAt: "2026-09-10T10:00:00.000Z",
            thumbnailPath: null,
            thumbnailUrl: null,
          },
        ],
      }),
      "project:rename": (req) => {
        projects = projects.map((p) => (p.path === req.path ? { ...p, name: req.name } : p));
        return { path: req.path, document: {}, modifiedAt: "x" };
      },
      "project:open": (req) => ({
        path: req.path,
        document: { id: "doc-1" },
        modifiedAt: null,
        recovery: null,
      }),
      "project:saveAs": (req) => ({
        path: `/lib/${req.name}.reelform`,
        document: {},
        modifiedAt: "x",
      }),
      "project:moveToTrash": () => ({ path: "/lib/.trash/Alpha.reelform" }),
      "project:restoreFromTrash": () => ({ path: "/lib/Old.reelform" }),
      "project:trash": () => ({ trashed: true as const }),
      "system:reveal": () => ({ ok: true }),
      "system:pickFile": () => ({ path: "/Users/me/Talk.reelform" }),
      "windows:openEditor": () => ({ ok: true }),
      ...handlers,
    });
  }

  const pick = (card: string, item: string) => {
    fireEvent.click(screen.getByRole("button", { name: `More actions for ${card}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: item }));
  };

  it("rename → name dialog → project:rename → shelf reloads", async () => {
    const ipc = shelfIpc();
    setup({ projectInvoke: ipc.invoke });
    await flushUi();
    pick("Alpha", "Rename…");
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByRole("textbox", { name: "Project name" });
    expect(input).toHaveValue("Alpha");
    fireEvent.change(input, { target: { value: "Launch demo" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    await flushUi();
    expect(ipc.callsTo("project:rename")).toEqual([
      { path: "/lib/Alpha.reelform", name: "Launch demo" },
    ]);
    expect(ipc.callsTo("project:list")).toHaveLength(2);
    expect(screen.getByText("Launch demo")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("duplicate → reads the document and saves a copy", async () => {
    const ipc = shelfIpc();
    setup({ projectInvoke: ipc.invoke });
    await flushUi();
    pick("Alpha", "Duplicate…");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox")).toHaveValue("Alpha copy");
    fireEvent.click(within(dialog).getByRole("button", { name: "Duplicate" }));
    await flushUi();
    expect(ipc.callsTo("project:saveAs")).toEqual([
      { path: "/lib/Alpha.reelform", document: { id: "doc-1" }, name: "Alpha copy" },
    ]);
  });

  it("move to trash and reveal", async () => {
    const ipc = shelfIpc();
    setup({ projectInvoke: ipc.invoke, platform: "darwin" });
    await flushUi();
    pick("Alpha", "Reveal in Finder");
    await flushUi();
    expect(ipc.callsTo("system:reveal")).toEqual([{ path: "/lib/Alpha.reelform" }]);
    expect(ipc.callsTo("project:list")).toHaveLength(1);
    pick("Alpha", "Move to Trash");
    await flushUi();
    expect(ipc.callsTo("project:moveToTrash")).toEqual([{ path: "/lib/Alpha.reelform" }]);
    expect(ipc.callsTo("project:list")).toHaveLength(2);
  });

  it("trash view: restore, and delete forever only after confirming", async () => {
    const ipc = shelfIpc();
    setup({ projectInvoke: ipc.invoke });
    await flushUi();
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Projects" })).getByRole("button", {
        name: /Trash/,
      }),
    );
    pick("Old", "Restore");
    await flushUi();
    expect(ipc.callsTo("project:restoreFromTrash")).toEqual([{ path: "/lib/.trash/Old.reelform" }]);

    pick("Old", "Delete forever…");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("“Old” and its recording files");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(ipc.callsTo("project:trash")).toEqual([]);

    pick("Old", "Delete forever…");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete forever" }),
    );
    await flushUi();
    expect(ipc.callsTo("project:trash")).toEqual([{ path: "/lib/.trash/Old.reelform" }]);
  });

  it("a failed action shows a dismissable notice", async () => {
    const ipc = shelfIpc({
      "project:moveToTrash": () => {
        throw { code: "EBUSY", message: "Folder is in use" };
      },
    });
    setup({ projectInvoke: ipc.invoke, platform: "linux" });
    await flushUi();
    pick("Alpha", "Move to Trash");
    await flushUi();
    const notice = screen.getByTestId("launcher-notice-project-action");
    expect(notice).toHaveTextContent("Folder is in use");
    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("launcher-notice-project-action")).toBeNull();
  });

  it("Open project… picks a .reelform, opens it and routes to the editor", async () => {
    const ipc = shelfIpc();
    setup({ projectInvoke: ipc.invoke });
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Open project…" }));
    await flushUi();
    expect(ipc.callsTo("system:pickFile")).toEqual([
      expect.objectContaining({
        filters: [{ name: "Reelform project", extensions: ["reelform", "json"] }],
      }),
    ]);
    expect(ipc.callsTo("project:open")).toEqual([{ path: "/Users/me/Talk.reelform" }]);
    expect(ipc.callsTo("windows:openEditor")).toEqual([{ projectId: "doc-1" }]);
  });

  it("Open project… accepts the project.json inside a folder", async () => {
    const ipc = shelfIpc({
      "system:pickFile": () => ({ path: "C:\\Work\\Talk.reelform\\project.json" }),
    });
    setup({ projectInvoke: ipc.invoke });
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Open project…" }));
    await flushUi();
    expect(ipc.callsTo("project:open")).toEqual([{ path: "C:\\Work\\Talk.reelform" }]);
  });

  it("Open project… cancel does nothing", async () => {
    const ipc = shelfIpc({ "system:pickFile": () => ({ path: null }) });
    setup({ projectInvoke: ipc.invoke });
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Open project…" }));
    await flushUi();
    expect(ipc.callsTo("project:open")).toEqual([]);
    expect(ipc.callsTo("windows:openEditor")).toEqual([]);
    expect(screen.queryByTestId("launcher-notice-project-action")).toBeNull();
  });

  it("Open project… on a folder that isn't a project explains why", async () => {
    const ipc = shelfIpc({
      "project:open": () => {
        throw { code: "PROJECT_NOT_FOUND", message: "project.json not found" };
      },
    });
    setup({ projectInvoke: ipc.invoke });
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Open project…" }));
    await flushUi();
    expect(screen.getByTestId("launcher-notice-project-action")).toHaveTextContent(
      "project.json not found",
    );
    expect(ipc.callsTo("windows:openEditor")).toEqual([]);
  });

  it("passes thumbnail URLs and sizes to the shelf, keeping gradients without one", async () => {
    const ipc = shelfIpc({
      "project:list": () => ({
        projects: [
          listEntry({ thumbnailUrl: "reelform-media://p-1/thumbnail.jpg?v=2", sizeBytes: 1024 }),
          listEntry({ path: "/lib/Beta.reelform", name: "Beta", id: "beta" }),
        ],
      }),
    });
    setup({ projectInvoke: ipc.invoke });
    await flushUi();
    const [withThumb, without] = [
      within(screen.getByTestId("launcher-project-/lib/Alpha.reelform")),
      within(screen.getByTestId("launcher-project-/lib/Beta.reelform")),
    ];
    expect(withThumb.getByTestId("launcher-project-thumbnail").style.backgroundImage).toContain(
      "reelform-media://p-1/thumbnail.jpg?v=2",
    );
    expect(without.getByTestId("launcher-project-thumbnail").style.backgroundImage).toBe("");
    expect(
      toLauncherProject(listEntry({ thumbnailUrl: "reelform-media://x/t.jpg", sizeBytes: 9 })),
    ).toMatchObject({ thumbnailUrl: "reelform-media://x/t.jpg", sizeBytes: 9 });
    expect("sizeBytes" in toLauncherProject(listEntry())).toBe(false);
  });

  it("insetTitleBar adds the draggable strip; off by default", async () => {
    const { unmount } = setup({ insetTitleBar: true });
    await flushUi();
    expect(screen.getByTestId("launcher-titlebar")).toHaveAttribute("data-app-region", "drag");
    unmount();
    setup();
    await flushUi();
    expect(screen.queryByTestId("launcher-titlebar")).toBeNull();
  });

  it("extraNotices render inside the inset strip", async () => {
    const onClick = vi.fn();
    setup({
      insetTitleBar: true,
      extraNotices: [
        {
          id: "update",
          tone: "info",
          message: "Reelform 1.2 is available",
          action: { label: "Restart to update", onClick },
        },
      ],
    });
    await flushUi();
    const notice = screen.getByTestId("launcher-notice-update");
    expect(screen.getByTestId("launcher-titlebar")).toContainElement(notice);
    fireEvent.click(within(notice).getByRole("button", { name: "Restart to update" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("LauncherContainer — sources", () => {
  it("loads, then refreshes every interval only while visible", async () => {
    const t = setup();
    expect(screen.getByTestId("launcher-sources-loading")).toBeInTheDocument();
    await flushUi();
    expect(screen.getByText("Studio Display")).toBeInTheDocument();
    expect(t.listSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("option", { name: "Microphone 1" })).toBeInTheDocument();

    await act(async () => t.timers.tick());
    await flushUi();
    expect(t.listSpy).toHaveBeenCalledTimes(2);

    act(() => t.visibility.set(false));
    expect(t.timers.intervals.size).toBe(0);
    act(() => t.visibility.set(true));
    await flushUi();
    expect(t.listSpy).toHaveBeenCalledTimes(3);
    expect(t.timers.intervals.size).toBe(1);
  });

  it("list failure shows an error with retry", async () => {
    const t = setup();
    await flushUi();
    t.port.sourcesError = { code: "X", message: "desktopCapturer failed" };
    await act(async () => t.timers.tick());
    await flushUi();
    expect(screen.getByTestId("launcher-sources-error")).toHaveTextContent(
      "desktopCapturer failed",
    );
    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
    t.port.sourcesError = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flushUi();
    expect(screen.getByText("Studio Display")).toBeInTheDocument();
  });

  it("warns about the fallback backend on macOS and disables system audio", async () => {
    setup({ platform: "darwin" });
    await flushUi();
    expect(screen.getByTestId("launcher-notice-fallback")).toHaveTextContent(
      "Native capture unavailable — using fallback, cursor may be visible.",
    );
    expect(screen.getByText("Unavailable with fallback capture on macOS")).toBeInTheDocument();
    expect(screen.getByLabelText("System audio")).toBeDisabled();
  });

  it("no fallback warning on Linux, where Electron capture is primary", async () => {
    setup({ platform: "linux" });
    await flushUi();
    expect(screen.queryByTestId("launcher-notice-fallback")).toBeNull();
    expect(screen.getByLabelText("System audio")).not.toBeDisabled();
  });
});

describe("LauncherContainer — start", () => {
  it("permission denied → notice with Open System Settings and dismiss", async () => {
    const t = setup();
    await flushUi();
    t.port.startError = {
      code: "PERMISSION_DENIED",
      message: "capture permission missing",
      details: { missing: ["microphone"] },
    };
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await flushUi();
    const notice = screen.getByTestId("launcher-notice-permission");
    expect(notice).toHaveTextContent("Microphone permission is missing");
    fireEvent.click(within(notice).getByRole("button", { name: "Open System Settings" }));
    expect(t.system.calls).toEqual(["permissions:microphone"]);
    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("launcher-notice-permission")).toBeNull();
  });

  it("disk low → notice copy", async () => {
    const t = setup();
    await flushUi();
    t.port.startError = { code: "DISK_LOW", message: "x" };
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await flushUi();
    expect(screen.getByTestId("launcher-notice-start-error")).toHaveTextContent(
      "At least 2 GB of free disk space is needed",
    );
  });

  it("record → recording panel → processing → post-record card actions", async () => {
    const t = setup({ openEditor: false });
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await flushUi();
    expect(t.port.lastStart).toMatchObject({ source: { kind: "display", id: "d1" }, countdown: 3 });
    expect(screen.getByTestId("launcher-recording")).toHaveTextContent("Recording starts in 3");

    await act(async () => {
      t.port.emit({ sessionId: "s1", type: "started", backend: "electron" });
      t.port.emit({
        sessionId: "s1",
        type: "stats",
        elapsedMs: 65_000,
        fps: 60,
        droppedFrames: 0,
        fileBytes: 1,
      });
      await drain();
    });
    expect(screen.getByTestId("launcher-recording")).toHaveTextContent("Studio Display · 01:05");

    let release: () => void = () => {};
    const finalize = t.port.finalize.bind(t.port);
    t.port.finalize = (id) =>
      new Promise((resolve) => {
        release = () => resolve(finalize(id));
      });
    await act(async () => {
      t.port.emit({ sessionId: "s1", type: "stopped", elapsedMs: 65_000, reason: "user" });
      await drain();
    });
    expect(screen.getByTestId("post-record-processing")).toHaveTextContent("Processing recording…");
    expect(screen.getByTestId("post-record-processing")).toHaveTextContent(
      "Finalizing file and extracting cursor data",
    );
    await act(async () => release());
    await flushUi(80);
    const card = screen.getByTestId("post-record-card");
    expect(card).toHaveTextContent("Recording 2026-09-15 at 14.32.05");
    expect(screen.getByTestId("post-record-duration")).toHaveTextContent("00:42");

    fireEvent.click(screen.getByRole("button", { name: "Reveal file" }));
    await flushUi();
    expect(t.system.calls).toEqual(["reveal:/Projects/Recording 2026-09-15 at 14.32.05.reelform"]);

    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    await flushUi();
    expect(t.windows.calls).toContain("openEditor:p1");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    await flushUi();
    expect(t.system.calls).toContain("delete:/Projects/Recording 2026-09-15 at 14.32.05.reelform");
    expect(screen.getByRole("button", { name: "Record" })).toBeInTheDocument();
  });

  it("interrupted recording explains what was saved; finalize errors offer retry", async () => {
    const t = setup({ openEditor: true });
    await flushUi();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await flushUi();
    t.port.finalizeErrors = [{ code: "NO_MEDIA", message: "no video reached disk" }];
    await act(async () => {
      t.port.emit({ sessionId: "s1", type: "started", backend: "electron" });
      await drain();
      t.port.emit({
        sessionId: "s1",
        type: "interrupted",
        reason: "displayDisconnected",
        elapsedMs: 42_000,
      });
    });
    await flushUi(80);
    expect(screen.getByTestId("post-record-error")).toHaveTextContent("no video reached disk");
    expect(screen.getByTestId("post-record-interrupted")).toHaveTextContent(
      "Recording saved up to 00:42 — The display was disconnected",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flushUi(80);
    expect(screen.getByTestId("post-record-card")).toBeInTheDocument();
    // Interrupted recordings show the card instead of jumping into the editor.
    expect(t.windows.calls.some((c) => c.startsWith("openEditor"))).toBe(false);
  });

  it("region mode opens the overlays and shows a cancellable hint", async () => {
    const t = setup();
    await flushUi();
    fireEvent.click(screen.getByLabelText("Region"));
    fireEvent.click(screen.getByRole("button", { name: "Select region" }));
    await flushUi();
    expect(t.windows.calls).toContain("openRegionOverlays");
    expect(screen.getByRole("button", { name: "Selecting region…" })).toBeDisabled();
    fireEvent.click(
      within(screen.getByTestId("launcher-notice-region")).getByRole("button", { name: "Cancel" }),
    );
    await flushUi();
    expect(t.windows.calls).toContain("closeKind:region-overlay");
    expect(screen.getByRole("button", { name: "Select region" })).toBeEnabled();
  });

  it("window mode lists windows from the same source result", async () => {
    setup();
    await flushUi();
    fireEvent.click(screen.getByLabelText("Window"));
    expect(screen.getByText("Figma — Onboarding.fig")).toBeInTheDocument();
    expect(SOURCES.windows).toHaveLength(1);
  });
});
