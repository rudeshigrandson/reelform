import type { ResponseOf } from "@contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectInvoke } from "../app/project/openProject";
import { type FakeHandlers, fakeIpc } from "../app/project/testing";
import { ProjectsContainer, type ProjectsView } from "./ProjectsContainer";

type ListEntry = ResponseOf<"project:list">["projects"][number];
type TrashEntry = ResponseOf<"project:listTrash">["projects"][number];

const entry = (over: Partial<ListEntry> = {}): ListEntry => ({
  path: "/lib/Alpha.reelform",
  name: "Alpha",
  modifiedAt: "2026-09-14T10:00:00.000Z",
  thumbnailPath: null,
  missing: false,
  corrupt: false,
  recent: true,
  id: "alpha",
  durationMs: 5000,
  ...over,
});

const trashed = (over: Partial<TrashEntry> = {}): TrashEntry => ({
  path: "/lib/.trash/Old.reelform",
  name: "Old",
  id: "old",
  trashedAt: "2026-09-10T10:00:00.000Z",
  thumbnailPath: null,
  ...over,
});

function setup(
  opts: {
    projects?: ListEntry[];
    trash?: TrashEntry[];
    handlers?: FakeHandlers;
    view?: ProjectsView;
    onViewChange?: (v: ProjectsView) => void;
    invoke?: ProjectInvoke;
  } = {},
) {
  let projects = opts.projects ?? [
    entry(),
    entry({ path: "/lib/Beta.reelform", name: "Beta", id: "beta", recent: false }),
  ];
  const trash = opts.trash ?? [];
  const ipc = fakeIpc({
    "project:list": () => ({ projects }),
    "project:listTrash": () => ({ projects: trash }),
    "windows:openEditor": () => ({ ok: true }),
    "project:rename": (req) => {
      projects = projects.map((p) => (p.path === req.path ? { ...p, name: req.name } : p));
      return { path: req.path, document: {}, modifiedAt: "x" };
    },
    "project:open": (req) => ({
      path: req.path,
      document: { id: "doc" },
      modifiedAt: null,
      recovery: null,
    }),
    "project:saveAs": (req) => ({
      path: `/lib/${req.name}.reelform`,
      document: {},
      modifiedAt: "x",
    }),
    "project:moveToTrash": (req) => ({ path: `/lib/.trash/${req.path}` }),
    "project:restoreFromTrash": () => ({ path: "/lib/Old.reelform" }),
    "project:trash": () => ({ trashed: true as const }),
    ...opts.handlers,
  });
  const onNewRecording = vi.fn();
  render(
    <ProjectsContainer
      invoke={opts.invoke ?? ipc.invoke}
      onNewRecording={onNewRecording}
      view={opts.view}
      onViewChange={opts.onViewChange}
    />,
  );
  return { ipc, onNewRecording };
}

const openMenu = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));

describe("ProjectsContainer: lists", () => {
  it("loads, shows recent projects by default and all projects on demand", async () => {
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Loading projects…");
    expect(await screen.findByRole("button", { name: "Open Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Beta" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "All projects" }));
    expect(await screen.findByRole("button", { name: "Open Beta" })).toBeInTheDocument();
  });

  it("empty library → record CTA", async () => {
    const { onNewRecording } = setup({ projects: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Record something" }));
    expect(onNewRecording).toHaveBeenCalledTimes(1);
  });

  it("search with no results", async () => {
    setup();
    await screen.findByRole("button", { name: "Open Alpha" });
    fireEvent.change(screen.getByRole("searchbox", { name: /search projects/i }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/No projects match/)).toBeInTheDocument();
  });

  it("list failure → error with Retry", async () => {
    let fail = true;
    setup({
      handlers: {
        "project:list": () => {
          if (fail) throw { code: "EACCES", message: "Library not readable" };
          return { projects: [entry()] };
        },
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Library not readable");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Open Alpha" })).toBeInTheDocument();
  });

  it("outside the desktop app → explains instead of spinning", async () => {
    setup({ invoke: (async () => null) as unknown as ProjectInvoke });
    expect(await screen.findByRole("alert")).toHaveTextContent("available in the desktop app");
  });
});

describe("ProjectsContainer: actions", () => {
  it("open → editor window by project id", async () => {
    const { ipc } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Open Alpha" }));
    await waitFor(() =>
      expect(ipc.callsTo("windows:openEditor")).toEqual([{ projectId: "alpha" }]),
    );
  });

  it("missing / damaged projects explain instead of opening", async () => {
    const { ipc } = setup({
      projects: [
        entry({ missing: true, id: null }),
        entry({ path: "/lib/Bad.reelform", name: "Bad", corrupt: true, id: null }),
      ],
    });
    expect(await screen.findByText("Missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Alpha" }));
    expect(screen.getByRole("alert")).toHaveTextContent("can't be found");
    fireEvent.click(screen.getByRole("button", { name: "Open Bad" }));
    expect(screen.getByRole("alert")).toHaveTextContent("damaged");
    expect(ipc.callsTo("windows:openEditor")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rename → dialog → project:rename → list reloads", async () => {
    const { ipc } = setup();
    await screen.findByRole("button", { name: "Open Alpha" });
    openMenu("Alpha");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByRole("textbox", { name: "Project name" });
    expect(input).toHaveValue("Alpha");
    fireEvent.change(input, { target: { value: "  Launch demo " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    expect(await screen.findByRole("button", { name: "Open Launch demo" })).toBeInTheDocument();
    expect(ipc.callsTo("project:rename")).toEqual([
      { path: "/lib/Alpha.reelform", name: "Launch demo" },
    ]);
    expect(ipc.callsTo("project:list").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("rename refuses an empty name", async () => {
    setup();
    await screen.findByRole("button", { name: "Open Alpha" });
    openMenu("Alpha");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "   " } });
    expect(within(dialog).getByRole("button", { name: "Rename" })).toBeDisabled();
  });

  it("duplicate → reads the document and saves it under the new name", async () => {
    const { ipc } = setup();
    await screen.findByRole("button", { name: "Open Alpha" });
    openMenu("Alpha");
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("textbox")).toHaveValue("Alpha copy");
    fireEvent.click(within(dialog).getByRole("button", { name: "Duplicate" }));
    await waitFor(() =>
      expect(ipc.callsTo("project:saveAs")).toEqual([
        { path: "/lib/Alpha.reelform", document: { id: "doc" }, name: "Alpha copy" },
      ]),
    );
  });

  it("a failed action keeps the dialog open and shows the error", async () => {
    setup({
      handlers: {
        "project:rename": () => {
          throw { code: "PROJECT_EXISTS", message: "A project with that name already exists" };
        },
      },
    });
    await screen.findByRole("button", { name: "Open Alpha" });
    openMenu("Alpha");
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Rename" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("delete → confirm → soft trash", async () => {
    const { ipc } = setup();
    await screen.findByRole("button", { name: "Open Alpha" });
    openMenu("Alpha");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("moved to the Trash");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(ipc.callsTo("project:moveToTrash")).toEqual([{ path: "/lib/Alpha.reelform" }]),
    );
  });
});

describe("ProjectsContainer: trash (S23)", () => {
  it("empty trash state", async () => {
    setup({ view: "trash" });
    expect(await screen.findByText("Trash is empty")).toBeInTheDocument();
    // Controlled: no internal view tabs.
    expect(screen.queryByRole("radio", { name: "All projects" })).toBeNull();
  });

  it("restore and delete forever", async () => {
    const { ipc } = setup({ view: "trash", trash: [trashed()] });
    const list = await screen.findByRole("list", { name: "Trash" });
    fireEvent.click(within(list).getByRole("button", { name: "Restore Old" }));
    await waitFor(() =>
      expect(ipc.callsTo("project:restoreFromTrash")).toEqual([
        { path: "/lib/.trash/Old.reelform" },
      ]),
    );
    fireEvent.click(within(list).getByRole("button", { name: "Delete Old forever" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete project?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete forever" }));
    await waitFor(() =>
      expect(ipc.callsTo("project:trash")).toEqual([{ path: "/lib/.trash/Old.reelform" }]),
    );
  });

  it("uncontrolled tabs report view changes", async () => {
    const onViewChange = vi.fn();
    setup({ onViewChange });
    await screen.findByRole("button", { name: "Open Alpha" });
    fireEvent.click(screen.getByRole("radio", { name: "Trash" }));
    expect(onViewChange).toHaveBeenCalledWith("trash");
    expect(await screen.findByText("Trash is empty")).toBeInTheDocument();
  });
});
